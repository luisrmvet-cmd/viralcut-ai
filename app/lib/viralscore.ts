// app/lib/viralscore.ts
// Fase 15A — Viral Score
//
// Módulo PURO: sem I/O, sem FFmpeg, sem rede, sem console.
// Pontua janelas de tempo do vídeo fonte a partir das palavras transcritas
// (WordTiming[] da Fase 11A/14A) e seleciona os trechos com maior potencial
// viral, PRESERVANDO as durações exatas do plano original (planCut).
//
// Garantias:
// - Saída sempre no mesmo shape do plano de entrada ({ start, duration }[]).
// - Mesmo número de segmentos e mesmas durations do plano (soma idêntica).
// - Segmentos selecionados sem sobreposição, em ordem cronológica.
// - Qualquer impossibilidade (sem palavras, score zero, candidatos
//   insuficientes) → devolve o plano original INALTERADO (fallback V2).

import type { WordTiming } from "./captions";

// Compatível estrutural com CutSegment de app/lib/autocut.ts (não exportado lá).
type Seg = { start: number; duration: number };

export type ViralCategory =
  | "curiosidade"
  | "alerta"
  | "emocao"
  | "autoridade"
  | "cta";

export type WindowScore = {
  start: number;
  duration: number;
  total: number;
  byCategory: Record<ViralCategory, number>;
};

// ---------------------------------------------------------------------------
// Léxicos PT-BR — tokens normalizados (minúsculos, sem acento; ver normalize)
// ---------------------------------------------------------------------------

const WORD_LEXICONS: Record<ViralCategory, string[]> = {
  curiosidade: [
    "segredo", "segredos", "ninguem", "descobri", "descobriu", "descoberta",
    "verdade", "escondido", "escondida", "revelar", "revelacao", "misterio",
    "surpreendente", "sabia", "motivo", "razao", "curioso", "curiosa",
  ],
  alerta: [
    "cuidado", "perigo", "perigoso", "perigosa", "erro", "erros", "nunca",
    "jamais", "atencao", "alerta", "risco", "riscos", "grave", "urgente",
    "pare", "evite", "evita", "proibido", "armadilha", "golpe",
  ],
  emocao: [
    "incrivel", "chocante", "absurdo", "inacreditavel", "impressionante",
    "assustador", "medo", "amor", "amei", "feliz", "triste", "raiva",
    "emocionante", "surreal", "maravilhoso", "terrivel", "doloroso",
    "sofrimento", "dor",
  ],
  autoridade: [
    "estudo", "estudos", "pesquisa", "pesquisas", "comprovado", "comprovada",
    "ciencia", "cientifico", "cientifica", "medico", "medicos", "medica",
    "especialista", "especialistas", "experiencia", "dados", "universidade",
    "doutor", "doutora", "professor", "professora", "garantido",
  ],
  cta: [
    "comenta", "comente", "compartilha", "compartilhe", "segue", "siga",
    "salva", "salve", "curte", "curta", "marca", "marque", "link", "bio",
    "inscreva", "sininho", "manda", "envia",
  ],
};

// Frases multi-palavra, verificadas no texto corrido normalizado da janela.
const PHRASE_LEXICONS: Record<ViralCategory, string[]> = {
  curiosidade: ["voce sabia", "ninguem te conta", "pouca gente", "quase ninguem"],
  alerta: ["nunca faca", "tome cuidado", "fique atento"],
  emocao: ["nao acredito", "de arrepiar"],
  autoridade: ["anos de experiencia", "estudos mostram", "ficou comprovado"],
  cta: ["salva esse video", "manda para", "ativa o sininho", "segue o perfil"],
};

const PHRASE_WEIGHT = 2; // frase completa vale mais que token isolado
const WORD_WEIGHT = 1;

// Bônus numéricos — mesmo espírito do destaque da Fase 14B.1 (lógica própria,
// sem acoplamento com captions.ts).
const RE_NUMBER = /^\d+([.,]\d+)?$/;       // 500 | 24 | 130,7
const RE_PERCENT = /\d+([.,]\d+)?%/;       // 50%
const RE_MONEY = /r\$\s?\d/;               // r$500 (já normalizado p/ minúsculo)
const BONUS_NUMBER = 1;
const BONUS_PERCENT = 2;
const BONUS_MONEY = 2;

// ---------------------------------------------------------------------------
// Normalização e janela
// ---------------------------------------------------------------------------

/** minúsculo, sem acento, sem pontuação (preserva dígitos, %, $, vírgula e ponto). */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%$.,\s]/g, "")
    .trim();
}

/** Palavras cuja fala intersecta a janela [start, start+duration). */
function wordsInWindow(words: WordTiming[], start: number, duration: number): WordTiming[] {
  const end = start + duration;
  return words.filter((w) => w.end > start && w.start < end);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreWindow(
  words: WordTiming[],
  start: number,
  duration: number
): WindowScore {
  const byCategory: Record<ViralCategory, number> = {
    curiosidade: 0,
    alerta: 0,
    emocao: 0,
    autoridade: 0,
    cta: 0,
  };

  const inWindow = wordsInWindow(words, start, duration);
  const tokens = inWindow.map((w) => normalize(w.word)).filter(Boolean);
  const joined = tokens.join(" ");

  for (const cat of Object.keys(WORD_LEXICONS) as ViralCategory[]) {
    for (const token of tokens) {
      if (WORD_LEXICONS[cat].includes(token)) byCategory[cat] += WORD_WEIGHT;
    }
    for (const phrase of PHRASE_LEXICONS[cat]) {
      if (joined.includes(phrase)) byCategory[cat] += PHRASE_WEIGHT;
    }
  }

  // Bônus numéricos entram em "autoridade" (números concretos = credibilidade).
  for (const token of tokens) {
    if (RE_MONEY.test(token)) byCategory.autoridade += BONUS_MONEY;
    else if (RE_PERCENT.test(token)) byCategory.autoridade += BONUS_PERCENT;
    else if (RE_NUMBER.test(token)) byCategory.autoridade += BONUS_NUMBER;
  }

  const total =
    byCategory.curiosidade +
    byCategory.alerta +
    byCategory.emocao +
    byCategory.autoridade +
    byCategory.cta;

  return { start, duration, total, byCategory };
}

// ---------------------------------------------------------------------------
// Ranking — API consumida pelo route.ts
// ---------------------------------------------------------------------------

const CANDIDATE_STEP = 1.5; // passo das janelas deslizantes, em segundos

/**
 * Seleciona os N trechos de maior score, onde N = planSegments.length.
 *
 * - Janelas candidatas deslizantes (passo 1,5s) com a duration do plano.
 * - Seleção gulosa top-N SEM sobreposição (margem = maior duration do plano).
 * - Resultado reordenado cronologicamente; durations originais do plano são
 *   reaplicadas na ordem cronológica → soma total idêntica ao plano V2.
 * - Fallbacks (devolvem planSegments inalterado): sem palavras, plano vazio,
 *   todas as janelas com score 0, ou candidatos não-sobrepostos insuficientes.
 */
export function rankCandidates(
  words: WordTiming[],
  sourceDuration: number,
  planSegments: Seg[]
): Seg[] {
  const n = planSegments.length;
  if (n === 0 || words.length === 0 || !(sourceDuration > 0)) return planSegments;

  const durations = planSegments.map((s) => s.duration);
  const baseDur = durations[0];
  const maxDur = Math.max(...durations);
  if (!(baseDur > 0) || !(maxDur > 0) || maxDur > sourceDuration) return planSegments;

  // 1) Gera e pontua candidatas
  const lastStart = sourceDuration - baseDur;
  const scored: WindowScore[] = [];
  for (let s = 0; s <= lastStart; s += CANDIDATE_STEP) {
    scored.push(scoreWindow(words, s, baseDur));
  }
  if (scored.length === 0) return planSegments;

  // 2) Sem sinal algum → mantém distribuição uniforme validada (V2)
  if (scored.every((c) => c.total === 0)) return planSegments;

  // 3) Ordena por score (desc); empate → mais cedo primeiro (determinístico)
  scored.sort((a, b) => b.total - a.total || a.start - b.start);

  // 4) Seleção gulosa top-N sem sobreposição (margem segura = maxDur)
  const selected: number[] = [];
  for (const cand of scored) {
    const overlaps = selected.some(
      (s) => cand.start < s + maxDur && s < cand.start + maxDur
    );
    if (!overlaps) {
      selected.push(cand.start);
      if (selected.length === n) break;
    }
  }
  if (selected.length < n) return planSegments;

  // 5) Ordem cronológica + durations originais do plano + clamp de borda
  selected.sort((a, b) => a - b);
  return selected.map((start, i) => {
    const duration = durations[i];
    const clampedStart = Math.max(0, Math.min(start, sourceDuration - duration));
    return { start: clampedStart, duration };
  });
}
