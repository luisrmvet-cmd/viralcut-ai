// app/lib/transitions.ts
//
// Fase 6 — builders PUROS de filtros FFmpeg para os efeitos/transições do
// ViralCut AI. Este módulo NÃO executa FFmpeg e NÃO importa nada do projeto:
// apenas monta strings de filtergraph, o que o torna isolado e testável.
//
// Efeitos cobertos (os 7 da Fase 6):
//   movimento por imagem (família Ken Burns):
//     1. zoomIn      2. zoomOut      3. panLeftRight (E→D)
//     4. panRightLeft (D→E)          5. kenBurns (zoom + deslocamento)
//   entre imagens:  crossfade suave (xfade)
//   no vídeo todo:  Fade In + Fade Out
//
// IMPORTANTE: nas expressões do zoompan NÃO pode haver vírgula — a vírgula
// separa filtros na filtergraph. Por isso usamos progressão linear com `on`.

export const FPS = 30;
const ZOOM = 0.12; // intensidade do zoom/pan (suave)

export type MotionEffect =
  | "kenBurns"
  | "zoomIn"
  | "zoomOut"
  | "panLeftRight"
  | "panRightLeft";

// Rotação de efeitos por imagem. Mantém zoomIn/zoomOut/panLeftRight com as
// MESMAS expressões já validadas nas fases anteriores e acrescenta panRightLeft
// e kenBurns.
export const MOTION_PALETTE: MotionEffect[] = [
  "kenBurns",
  "zoomIn",
  "zoomOut",
  "panLeftRight",
  "panRightLeft",
];

export function motionForIndex(i: number): MotionEffect {
  return MOTION_PALETTE[i % MOTION_PALETTE.length];
}

/**
 * Expressão (z/x/y) do zoompan para um efeito. `d1` = (frames - 1), usado para
 * normalizar a animação de 0 a 1 ao longo do clipe.
 */
export function motionExpr(effect: MotionEffect, d1: number): string {
  const cx = "x='iw/2-(iw/zoom/2)'";
  const cy = "y='ih/2-(ih/zoom/2)'";
  switch (effect) {
    case "zoomIn":
      return `z='1+${ZOOM}*on/${d1}':${cx}:${cy}`;
    case "zoomOut":
      return `z='${1 + ZOOM}-${ZOOM}*on/${d1}':${cx}:${cy}`;
    case "panLeftRight":
      return `z='${1 + ZOOM}':x='(iw-iw/zoom)*on/${d1}':${cy}`;
    case "panRightLeft":
      return `z='${1 + ZOOM}':x='(iw-iw/zoom)*(1-on/${d1})':${cy}`;
    case "kenBurns":
    default:
      // zoom in lento + leve deslocamento vertical (clássico Ken Burns)
      return `z='1+${ZOOM}*on/${d1}':${cx}:y='(ih-ih/zoom)*on/${d1}'`;
  }
}

/**
 * Cadeia de filtro de UM clipe: entrada [inputIndex:v] -> [label].
 * Encaixa em 1080x1920 com fundo preto, faz upscale 2x (reduz tremor do
 * zoompan), aplica o movimento e normaliza timestamps (setpts) para o xfade.
 */
export function clipChain(
  inputIndex: number,
  label: string,
  effect: MotionEffect,
  frames: number
): string {
  const d1 = Math.max(frames - 1, 1);
  return (
    `[${inputIndex}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,scale=2160:3840,` +
    `zoompan=${motionExpr(effect, d1)}:d=${frames}:s=1080x1920:fps=${FPS},` +
    `format=yuv420p,setpts=PTS-STARTPTS[${label}]`
  );
}

/**
 * Duração (s) do crossfade entre clipes. Suave, porém curta o bastante para não
 * engolir clipes pequenos (muitas imagens em pouco tempo).
 */
export function transitionDuration(totalSeconds: number, count: number): number {
  if (count < 2) return 0;
  const baseClip = totalSeconds / count;
  return Math.max(0.2, Math.min(0.6, baseClip * 0.35));
}

/** Duração (s) do fade in e do fade out. */
export function fadeDuration(totalSeconds: number): number {
  return Math.min(0.5, totalSeconds * 0.1);
}

/**
 * Frames por imagem, COMPENSANDO a sobreposição do xfade para manter a duração
 * final EXATA. O xfade encurta o total em (count-1)*t; então os clipes somam
 * totalSeconds + (count-1)*t, e o xfade devolve a sobreposição -> totalSeconds.
 */
export function framesPerImage(
  totalSeconds: number,
  count: number,
  fps = FPS
): number[] {
  const t = transitionDuration(totalSeconds, count);
  const clipsSeconds = totalSeconds + (count - 1) * t;
  const total = Math.round(clipsSeconds * fps);
  const base = Math.floor(total / count);
  let rem = total - base * count;
  return Array.from({ length: count }, () => {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem--;
    return base + extra;
  });
}

/**
 * Cadeia de xfade encadeado a partir dos labels dos clipes.
 * offset_j = (soma das durações dos j primeiros clipes) - j*t.
 * Retorna as linhas da filtergraph e o label final (para os fades).
 * Com 1 clipe não há transição: retorna o próprio label.
 */
export function xfadeChain(
  clipLabels: string[],
  framesArr: number[],
  totalSeconds: number,
  count: number,
  fps = FPS
): { chains: string[]; lastLabel: string } {
  if (clipLabels.length === 1) return { chains: [], lastLabel: clipLabels[0] };
  const t = transitionDuration(totalSeconds, count);
  const durs = framesArr.map((f) => f / fps);
  const chains: string[] = [];
  let prev = clipLabels[0];
  let acc = 0;
  for (let j = 1; j < clipLabels.length; j++) {
    acc += durs[j - 1];
    const offset = (acc - j * t).toFixed(4);
    const out = j === clipLabels.length - 1 ? "xlast" : `x${j}`;
    chains.push(
      `[${prev}][${clipLabels[j]}]xfade=transition=fade:` +
        `duration=${t.toFixed(4)}:offset=${offset}[${out}]`
    );
    prev = out;
  }
  return { chains, lastLabel: prev };
}

/** Fade In no começo e Fade Out no fim, aplicados ao stream final -> [outLabel]. */
export function fadeChain(
  inLabel: string,
  totalSeconds: number,
  outLabel = "outv"
): string {
  const fd = fadeDuration(totalSeconds);
  const st = (totalSeconds - fd).toFixed(4);
  return (
    `[${inLabel}]fade=t=in:st=0:d=${fd.toFixed(4)},` +
    `fade=t=out:st=${st}:d=${fd.toFixed(4)}[${outLabel}]`
  );
}
