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