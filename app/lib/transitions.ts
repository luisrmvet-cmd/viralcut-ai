// app/lib/transitions.ts  (Fase 6 + extensão opcional na Fase 7)
export const FPS = 30;
const ZOOM = 0.12;

export type MotionEffect = "kenBurns" | "zoomIn" | "zoomOut" | "panLeftRight" | "panRightLeft";

export const MOTION_PALETTE: MotionEffect[] = ["kenBurns","zoomIn","zoomOut","panLeftRight","panRightLeft"];
export function motionForIndex(i: number): MotionEffect { return MOTION_PALETTE[i % MOTION_PALETTE.length]; }

export function motionExpr(effect: MotionEffect, d1: number): string {
  const cx = "x='iw/2-(iw/zoom/2)'"; const cy = "y='ih/2-(ih/zoom/2)'";
  switch (effect) {
    case "zoomIn": return `z='1+${ZOOM}*on/${d1}':${cx}:${cy}`;
    case "zoomOut": return `z='${1+ZOOM}-${ZOOM}*on/${d1}':${cx}:${cy}`;
    case "panLeftRight": return `z='${1+ZOOM}':x='(iw-iw/zoom)*on/${d1}':${cy}`;
    case "panRightLeft": return `z='${1+ZOOM}':x='(iw-iw/zoom)*(1-on/${d1})':${cy}`;
    case "kenBurns": default: return `z='1+${ZOOM}*on/${d1}':${cx}:y='(ih-ih/zoom)*on/${d1}'`;
  }
}

export function clipChain(inputIndex: number, label: string, effect: MotionEffect, frames: number): string {
  const d1 = Math.max(frames - 1, 1);
  return `[${inputIndex}:v]scale=1080:1920:force_original_aspect_ratio=decrease,`+
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,scale=2160:3840,`+
    `zoompan=${motionExpr(effect, d1)}:d=${frames}:s=1080x1920:fps=${FPS},`+
    `format=yuv420p,setpts=PTS-STARTPTS[${label}]`;
}

export function transitionDuration(totalSeconds: number, count: number): number {
  if (count < 2) return 0;
  const baseClip = totalSeconds / count;
  return Math.max(0.2, Math.min(0.6, baseClip * 0.35));
}
export function fadeDuration(totalSeconds: number): number { return Math.min(0.5, totalSeconds * 0.1); }

export function framesPerImage(totalSeconds: number, count: number, fps = FPS): number[] {
  const t = transitionDuration(totalSeconds, count);
  const clipsSeconds = totalSeconds + (count - 1) * t;
  const total = Math.round(clipsSeconds * fps);
  const base = Math.floor(total / count); let rem = total - base * count;
  return Array.from({ length: count }, () => { const e = rem > 0 ? 1 : 0; if (rem>0) rem--; return base + e; });
}

// (Fase 7) parâmetro opcional `transitions` — default ["fade"] = comportamento da Fase 6
export function xfadeChain(
  clipLabels: string[], framesArr: number[], totalSeconds: number, count: number,
  fps = FPS, transitions: string[] = ["fade"]
): { chains: string[]; lastLabel: string } {
  if (clipLabels.length === 1) return { chains: [], lastLabel: clipLabels[0] };
  const t = transitionDuration(totalSeconds, count);
  const durs = framesArr.map((f) => f / fps);
  const chains: string[] = []; let prev = clipLabels[0]; let acc = 0;
  for (let j = 1; j < clipLabels.length; j++) {
    acc += durs[j - 1];
    const offset = (acc - j * t).toFixed(4);
    const tr = transitions[(j - 1) % transitions.length];
    const out = j === clipLabels.length - 1 ? "xlast" : `x${j}`;
    chains.push(`[${prev}][${clipLabels[j]}]xfade=transition=${tr}:duration=${t.toFixed(4)}:offset=${offset}[${out}]`);
    prev = out;
  }
  return { chains, lastLabel: prev };
}

export function fadeChain(inLabel: string, totalSeconds: number, outLabel = "outv"): string {
  const fd = fadeDuration(totalSeconds); const st = (totalSeconds - fd).toFixed(4);
  return `[${inLabel}]fade=t=in:st=0:d=${fd.toFixed(4)},fade=t=out:st=${st}:d=${fd.toFixed(4)}[${outLabel}]`;
}
