// app/lib/autocut.ts
// (Fase 9 — AutoCut AI) Corte DETERMINÍSTICO, sem IA semântica.
// Estratégia: "trechos distribuídos" — N clipes curtos espalhados
// uniformemente pelo vídeo longo, concatenados até a duração-alvo
// (15/30/45/60s), gerando um efeito de "melhores momentos".
//
// Módulo PURO: não executa FFmpeg, não toca disco, sem efeitos colaterais.
// Só calcula PLANOS de corte. A extração/concat real acontece depois, no
// pipeline de render já validado. Isso mantém esta etapa 100% testável e
// sem qualquer regressão.

export type CutSegment = {
  start: number;     // segundo de início no vídeo original
  duration: number;  // duração do trecho, em segundos
};

export type CutPlan = {
  targetDuration: number;  // 15 | 30 | 45 | 60
  sourceDuration: number;  // duração do vídeo original
  segments: CutSegment[];  // trechos a extrair, em ordem
  applied: boolean;        // false = vídeo curto demais (passthrough, sem corte)
};

export const TARGET_DURATIONS = [15, 30, 45, 60] as const;
export type TargetDuration = (typeof TARGET_DURATIONS)[number];

const DEFAULT_CLIP_LENGTH = 3; // "beat" de cada clipe, em segundos
const MIN_CLIP_LENGTH = 1;     // trava de segurança

function isValidNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Plano de corte para UMA duração-alvo.
 * - Vídeo <= alvo: nada a cortar → applied=false (caller usa o vídeo como está).
 * - Caso contrário: distribui N trechos de ~clipLength uniformemente.
 */
export function planCut(
  sourceDuration: number,
  targetDuration: number,
  clipLength: number = DEFAULT_CLIP_LENGTH
): CutPlan {
  if (!isValidNumber(sourceDuration) || !isValidNumber(targetDuration)) {
    return { targetDuration, sourceDuration, segments: [], applied: false };
  }

  // Curto demais para esse alvo → passthrough.
  if (sourceDuration <= targetDuration) {
    return { targetDuration, sourceDuration, segments: [], applied: false };
  }

  const clip = Math.max(MIN_CLIP_LENGTH, Math.min(clipLength, targetDuration));
  const count = Math.max(1, Math.round(targetDuration / clip));
  const exactClip = targetDuration / count; // fecha o alvo certinho

  const usable = sourceDuration - exactClip; // último início possível
  const segments: CutSegment[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * usable;
    const start = Math.min(Math.max(0, t), usable);
    segments.push({
      start: Number(start.toFixed(3)),
      duration: Number(exactClip.toFixed(3)),
    });
  }

  return { targetDuration, sourceDuration, segments, applied: true };
}

/** Planos para TODAS as durações oficiais (15/30/45/60) de uma vez. */
export function planAllCuts(
  sourceDuration: number,
  clipLength: number = DEFAULT_CLIP_LENGTH
): CutPlan[] {
  return TARGET_DURATIONS.map((t) => planCut(sourceDuration, t, clipLength));
}
/* Fase 11A.1 — Snap por Silêncio                                      */
/* ------------------------------------------------------------------ */
//
// Camada PURA e opcional entre planCut() e a expansão em clipsForRender.
// Desloca o início de cada segmento para o ponto médio do silêncio mais
// próximo (dentro de uma tolerância), para que os cortes caiam em pausas
// naturais da fala. NÃO altera duration: a soma continua fechando o alvo.
//
// Garantias (pós-condições):
//   - mesmo número de segmentos, mesmas durations, mesmo shape CutSegment;
//   - start ∈ [0, sourceDuration - duration];
//   - ordem crescente preservada e sem sobreposição;
//   - qualquer entrada inválida ou sem silêncios úteis → devolve cópia
//     idêntica do plano original (pior caso = AutoCut V2 atual).

export type SilenceInterval = {
  start: number; // segundo em que o silêncio começa, na fonte
  end: number;   // segundo em que o silêncio termina, na fonte
};

export type SnapOptions = {
  maxShift?: number; // deslocamento máximo permitido por corte, em segundos
};

const DEFAULT_MAX_SHIFT = 0.75; // janela de atração de cada corte (s)
const MIN_SILENCES_TO_SNAP = 2; // menos que isso → snap vira no-op

function isValidSilence(s: unknown): s is SilenceInterval {
  if (typeof s !== "object" || s === null) return false;
  const v = s as { start?: unknown; end?: unknown };
  return (
    typeof v.start === "number" &&
    typeof v.end === "number" &&
    Number.isFinite(v.start) &&
    Number.isFinite(v.end) &&
    v.start >= 0 &&
    v.end > v.start
  );
}

export function snapSegmentsToSilences(
  segments: CutSegment[],
  silences: SilenceInterval[],
  sourceDuration: number,
  options: SnapOptions = {}
): CutSegment[] {
  const original = Array.isArray(segments)
    ? segments.map((s) => ({ start: s.start, duration: s.duration }))
    : [];

  // Guardas: nada a fazer → devolve cópia idêntica (comportamento V2).
  if (original.length < 2) return original;
  if (!isValidNumber(sourceDuration)) return original;

  const maxShift =
    isValidNumber(options.maxShift ?? NaN) ? (options.maxShift as number) : DEFAULT_MAX_SHIFT;

  const valid = Array.isArray(silences) ? silences.filter(isValidSilence) : [];
  if (valid.length < MIN_SILENCES_TO_SNAP) return original;

  // Candidatos: ponto médio de cada silêncio, ordenados e dentro da fonte.
  const candidates = valid
    .map((s) => (s.start + s.end) / 2)
    .filter((m) => m > 0 && m < sourceDuration)
    .sort((a, b) => a - b);
  if (candidates.length < MIN_SILENCES_TO_SNAP) return original;

  // Distância de um instante até a pausa mais próxima (qualidade da borda).
  const nearestDist = (t: number): number => {
    let best = Infinity;
    for (const m of candidates) {
      const d = Math.abs(m - t);
      if (d < best) best = d;
    }
    return best;
  };

  const EPS = 1e-9;
  const used = new Set<number>(); // índice de candidato já consumido p/ alinhamento

  // Soma das durações restantes a partir de cada índice (p/ teto de viabilidade).
  const restAfter: number[] = new Array(original.length + 1).fill(0);
  for (let i = original.length - 1; i >= 0; i--) {
    restAfter[i] = restAfter[i + 1] + original[i].duration;
  }

  const out: CutSegment[] = [];

  for (let i = 0; i < original.length; i++) {
    const seg = original[i];
    const segEnd = seg.start + seg.duration;
    // Teto de viabilidade: deixa espaço p/ TODOS os segmentos seguintes
    // (garante que nenhum shift force sobreposição mais à frente).
    const feasibleMax = sourceDuration - restAfter[i];
    const prevEnd = i > 0 ? out[i - 1].start + out[i - 1].duration : 0;

    // Candidato base: ficar parado (nunca piorar o plano V2).
    let bestShift = 0;
    let bestScore = nearestDist(seg.start) + nearestDist(segEnd);
    let bestIdx = -1;

    for (let c = 0; c < candidates.length; c++) {
      if (used.has(c)) continue;
      const m = candidates[c];
      // Dois deslocamentos possíveis por pausa: alinhar o INÍCIO ou o FIM nela.
      const shifts = [m - seg.start, m - segEnd];
      for (const shift of shifts) {
        if (Math.abs(shift) > maxShift) continue;
        const newStart = seg.start + shift;
        if (newStart < 0 || newStart > feasibleMax || newStart < prevEnd) continue;
        const score = nearestDist(newStart) + nearestDist(newStart + seg.duration);
        if (score < bestScore - EPS) {
          bestScore = score;
          bestShift = shift;
          bestIdx = c;
        }
      }
    }

    if (bestIdx >= 0) used.add(bestIdx);
    let newStart = seg.start + bestShift;

    // Trava final: piso = fim do segmento anterior; teto = viabilidade dos
    // próximos. Sempre satisfazível: o plano original do planCut cabe em
    // sequência (espaçamento >= duração) e o teto reserva esse espaço.
    newStart = Math.min(Math.max(newStart, prevEnd, 0), feasibleMax);

    out.push({
      start: Number(newStart.toFixed(3)),
      duration: seg.duration, // NUNCA alterada — soma continua = targetDuration
    });
  }

  return out;
}
