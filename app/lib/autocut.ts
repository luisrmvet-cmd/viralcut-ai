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

/**
 * Ajusta os starts dos segmentos para pausas naturais (silêncios).
 * Pura: não executa FFmpeg, não toca disco, sem efeitos colaterais.
 *
 * @param segments       segmentos vindos de planCut() (não são mutados)
 * @param silences       intervalos de silêncio detectados na fonte
 * @param sourceDuration duração total do vídeo original, em segundos
 * @param options        maxShift (default 0.75s)
 */
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

  const used = new Set<number>(); // índice de candidato já consumido
  const out: CutSegment[] = [];

  for (let i = 0; i < original.length; i++) {
    const seg = original[i];
    const maxStart = sourceDuration - seg.duration;
    const prevEnd = i > 0 ? out[i - 1].start + out[i - 1].duration : 0;

    // Candidato mais próximo do start original, ainda livre.
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let c = 0; c < candidates.length; c++) {
      if (used.has(c)) continue;
      const dist = Math.abs(candidates[c] - seg.start);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = c;
      }
    }

    let newStart = seg.start;
    if (bestIdx >= 0 && bestDist <= maxShift) {
      const snapped = Math.min(Math.max(0, candidates[bestIdx]), maxStart);
      // Aceita só se preservar ordem e não sobrepor o segmento anterior.
      if (snapped >= prevEnd) {
        newStart = snapped;
        used.add(bestIdx);
      }
    }

    // Trava final: start original também respeita os limites (defesa extra).
    if (newStart < prevEnd || newStart > maxStart || newStart < 0) {
      newStart = Math.min(Math.max(seg.start, 0), maxStart);
    }

    out.push({
      start: Number(newStart.toFixed(3)),
      duration: seg.duration, // NUNCA alterada — soma continua = targetDuration
    });
  }

  return out;
}
