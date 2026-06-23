// app/lib/orchestrator.ts
// Fase 18.7 — Orquestrador invisível do plano de corte (PURO).
//
// Compõe os módulos JÁ VALIDADOS na EXATA ordem do render principal
// (app/api/render/route.ts), recebendo os primitivos (words, silences) já
// extraídos uma única vez a montante — sem re-decode, sem re-transcrição,
// sem rede, sem FFmpeg, sem disco.
//
// Ordem espelhada (idêntica ao route, guardas e maxShift inclusos):
//   planCut → rankCandidates (Viral Score) → snapSegmentsToSilences (Snap)
//            → alignSegmentEndsToSilences (Speech Guard, aninhado no Snap)
//
// 18.7 NÃO é importado por nenhum fluxo vivo: arquivo isolado e inerte.
// Flag REELS_ORCHESTRATOR_ON (default OFF) reservada p/ o wiring da 18.8.
// Não toca render, upload, histórico, download iPhone, SuccessScreen, música,
// legendas, AutoCut, login nem auth.

import {
  planCut,
  snapSegmentsToSilences,
  alignSegmentEndsToSilences,
  type CutPlan,
  type SilenceInterval,
} from "./autocut";
import { rankCandidates } from "./viralscore";
import type { WordTiming } from "./captions";

// Reservado p/ o call-site da 18.8 (default OFF). A função é pura; quem decide
// chamá-la (18.8) é que checa esta flag.
export const REELS_ORCHESTRATOR_ON = process.env.REELS_ORCHESTRATOR === "1";

// Constantes idênticas ao route validado (não inventar).
const SNAP_MAX_SHIFT = 1.2;     // route: snapSegmentsToSilences(..., { maxShift: 1.2 })
const GUARD_MAX_SHIFT = 0.9;    // route: alignSegmentEndsToSilences(..., { maxShift: 0.9 })
const DEFAULT_CLIP_LENGTH = 5;  // route: planCut(autoCutSourceDuration, duration, 5)

export interface ReelsPlanInput {
  sourceDuration: number;       // = autoCutSourceDuration
  targetDuration: number;       // = duration (15|30|45|60)
  words: WordTiming[];          // transcrição já feita (p/ Viral Score)
  silences: SilenceInterval[];  // silêncios já detectados (p/ Snap/Guard)
  clipLength?: number;          // default 5 (= route)
  viralSelection?: boolean;     // = (process.env.VIRAL_SCORE === "1"); default OFF
  snap?: boolean;               // = (process.env.AUTOCUT_SNAP !== "0"); default ON
  speechGuard?: boolean;        // = (process.env.AUTOCUT_SPEECH_GUARD !== "0"); default ON
}

export interface ReelsPlan {
  segments: CutPlan["segments"]; // {start,duration}[] — plano final de corte
  applied: boolean;              // false = vídeo curto (passthrough), igual ao route
}

/**
 * Plano determinístico de corte. PURO: mesmas funções e MESMA ORDEM do render
 * validado, com os primitivos por parâmetro. Cada etapa só roda com > 1
 * segmento (igual ao route); os fallbacks internos de cada módulo já garantem
 * devolução do plano inalterado em qualquer borda.
 */

function scoreSegmentByWords(
seg: CutPlan["segments"][number],
words: WordTiming[]
): number {
const start = seg.start;
const end = seg.start + seg.duration;

const text = words
.filter((w) => w.start >= start && w.end <= end)
.map((w) => String((w as any).text || (w as any).word || ""))
.join(" ")
.toLowerCase();

let score = 0;

const strongWords = [
"atenção",
"cuidado",
"nunca",
"sempre",
"perigo",
"grave",
"urgente",
"importante",
"verdade",
"erro",
"segredo",
"descubra",
"você precisa",
"ninguém te conta",
"olha isso",
"presta atenção",
];

for (const word of strongWords) {
if (text.includes(word)) score += 12;
}

if (text.includes("?")) score += 10;
if (text.length >= 40 && text.length <= 220) score += 10;
if (text.length < 15) score -= 15;

return score;
}

export function buildReelsPlan(input: ReelsPlanInput): ReelsPlan {
  const {
    sourceDuration,
    targetDuration,
    words,
    silences,
    clipLength = DEFAULT_CLIP_LENGTH,
    viralSelection = false,
    snap = true,
    speechGuard = true,
  } = input;

  // 1) planCut — route: planCut(autoCutSourceDuration, duration, 5)
  const plan = planCut(sourceDuration, targetDuration, clipLength);
  let segs: CutPlan["segments"] = plan.segments;

  if (words.length > 0 && segs.length > 1) {
segs = [...segs]
.map((seg) => ({
...seg,
__score: scoreSegmentByWords(seg, words),
}))
.sort((a, b) => b.__score - a.__score)
.slice(0, Math.max(1, Math.ceil(targetDuration / clipLength)))
.sort((a, b) => a.start - b.start)
.map(({ __score, ...seg }) => seg);

console.log("[orchestrator 2.0] strong-moment selection:", segs);
}

  // 2) Viral Score — route: VIRAL_SCORE=1 (default OFF) + vsWords.length > 0
  if (viralSelection && words.length > 0 && segs.length > 1) {
    segs = rankCandidates(words, sourceDuration, segs);
  }

  // 3) Snap por Silêncio — route: AUTOCUT_SNAP!=="0" (default ON), maxShift 1.2
  if (snap && segs.length > 1) {
    segs = snapSegmentsToSilences(segs, silences, sourceDuration, {
      maxShift: SNAP_MAX_SHIFT,
    });

    // 4) Speech Guard ANINHADO no Snap — route: AUTOCUT_SPEECH_GUARD!=="0"
    //    (default ON), maxShift 0.9. Só roda quando o Snap rodou (= route).
    if (speechGuard) {
      segs = alignSegmentEndsToSilences(segs, silences, sourceDuration, {
        maxShift: GUARD_MAX_SHIFT,
      });
    }
  }

  return { segments: segs, applied: plan.applied };
}