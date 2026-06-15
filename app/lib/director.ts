// app/lib/director.ts
// Fase 15F.1 — "Diretor de Vídeo IA" em modo SOMENTE LEITURA.
// Analisa, classifica e marca os melhores momentos. NÃO corta, NÃO edita vídeo,
// NÃO adiciona texto. Função pura, determinística, sem rede, sem IA externa,
// sem modelo, sem visão computacional. Não importa nenhum módulo validado.

export type DirectorMomentType =
  | "hook"
  | "emocional"
  | "autoridade"
  | "curiosidade"
  | "alerta"
  | "humor"
  | "dor"
  | "polemica"
  | "cta";

/** Palavra transcrita, normalizada pelo route a partir de transcribeWords(). */
export interface DirectorWord {
  text: string;
  start: number; // segundos
  end: number; // segundos
}

/** Silêncio detectado, normalizado pelo route a partir de detectSilences(). */
export interface DirectorSilence {
  start: number; // segundos
  end: number; // segundos
}

export interface DirectorMoment {
seconds: number;
time: string;
type: DirectorMomentType;
score: number;
viralScore: number;
chance: "ALTA" | "MEDIA" | "BAIXA";
snippet: string;
reason: string;
}

export interface AnalyzeOptions {
  sourceDuration: number;
  volumePeaks?: number[]; // segundos com picos de volume (opcional)
  topPerCategory?: number; // default 1
  minScore?: number; // default 60
  maxMoments?: number; // limite global opcional
}

// ---------------------------------------------------------------------------
// Léxicos PT-BR (próprios do diretor; não dependem do Viral Score).
// Match por substring, case-insensitive. Frases com mais palavras pesam mais.
// ---------------------------------------------------------------------------
const LEXICONS: Record<DirectorMomentType, string[]> = {
  hook: [
    "você não vai acreditar", "ninguém te conta", "o que ninguém fala",
    "o segredo", "a verdade sobre", "presta atenção", "preste atenção",
    "olha isso", "você sabia", "pare tudo", "isso mudou", "descobri",
    "vou te contar", "nunca te disseram", "atenção",
  ],
  emocional: [
    "chorei", "meu coração", "minha família", "te amo", "saudade",
    "gratidão", "realizei o sonho", "superação", "me emocionei",
    "lágrimas", "abraço", "nunca vou esquecer", "mudou minha vida","ficou bem",
"melhorou",
"sobreviveu",
"recuperou",
"final feliz",
"graças a deus",
"emocionante",
"antes e depois",
  ],
  autoridade: [
    "estudos mostram", "comprovado", "anos de experiência", "especialista",
    "a ciência", "os dados", "na minha experiência", "método", "garanto que",
    "comprova", "resultado real", "atendi", "tratei", "trabalho com","sou veterinário",
"como veterinário",
"na clínica",
"diagnóstico",
"tratamento",
"exame",
"hemograma",
"protocolo",
"paciente",
  ],
  curiosidade: [
    "por que", "você sabe por que", "será que", "o que acontece",
    "imagine se", "e se eu te disser", "descubra", "no final do vídeo",
    "espera até o final", "o motivo", "veja até o fim", "adivinha","olha isso",
"sabe o que",
"o que aconteceu",
"ninguém imagina",
"você sabia",
"presta atenção",
"repara",
"veja isso",
  ],
  alerta: [
    "cuidado", "atenção", "perigo", "nunca faça", "evite", "pare de",
    "esse erro", "risco", "não cometa", "fuja de", "isso é grave",
    "muito cuidado","urgente",
"emergência",
"grave",
"pode morrer",
"morte",
"sangramento",
"convulsão",
"carrapato",
"doença do carrapato",
"erliquiose",
"veneno",
"envenenamento",
"não espere",

  ],
  humor: [
    "kkk", "rsrs", "haha", "que mico", "zoeira", "pegadinha", "hilário",
    "engraçado", "morri de rir", "piada", "comédia",
  ],
  dor: [
    "passei por", "sofri", "fracasso", "fundo do poço", "perdi tudo",
    "quase desisti", "exausto", "estava sozinho", "muito difícil",
    "no meu pior momento", "dor de","sofrendo",
"triste",
"chorando",
"paralisado",
"não andava",
"manchas",
"petequias",
"fraco",
"sem comer",
"muito mal",
"internado",
"quase morreu",
  ],
  polemica: [
    "opinião impopular", "vão me odiar", "ninguém tem coragem de falar",
    "a verdade que ninguém", "isso é tabu", "vou ser polêmico",
    "mentira que te contaram", "contra tudo que dizem","não é normal",
"estão fazendo errado",
"o tutor erra",
"muita gente erra",
"não deveria",
"isso revolta",
  ],
  cta: [
    "segue o perfil", "compartilha", "comenta aqui", "salva esse vídeo",
    "link na bio", "clica no link", "se inscreve", "ativa o sininho",
    "manda pra alguém", "deixa o like", "chama no direct", "marca um amigo",
  ],
};

const ALL_TYPES = Object.keys(LEXICONS) as DirectorMomentType[];

// Limiares de segmentação por silêncio.
const PHRASE_GAP = 0.45; // s de silêncio que inicia nova frase
const PHRASE_MAX = 12; // s — frase não passa disso

interface Phrase {
     start: number;
  end: number;
  text: string;
  wordCount: number;
  afterSilence: boolean;
   intensity: number;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

/** Agrupa palavras em frases, quebrando em silêncios ou no limite de duração. */
function segmentBySilences(
  words: DirectorWord[],
  silences: DirectorSilence[]
): Phrase[] {
  const sorted = [...words].filter((w) => w.text?.trim()).sort((a, b) => a.start - b.start);
  const silenceStarts = silences.map((s) => s.start).sort((a, b) => a - b);
  const nearSilence = (t: number) =>
    silenceStarts.some((ss) => Math.abs(ss - t) <= 0.4);

  const phrases: Phrase[] = [];
  let cur: DirectorWord[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    const start = cur[0].start;
    const end = cur[cur.length - 1].end;
    phrases.push({
      start,
      end,
      text: cur.map((w) => w.text.trim()).join(" "),
      wordCount: cur.length,
      afterSilence: nearSilence(start),
      intensity: Math.min(99, Math.round(cur.length * 8 + (nearSilence(start) ? 12 : 0))),
    });
    cur = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      const gap = w.start - prev.end;
      const dur = w.end - cur[0].start;
      if (gap >= PHRASE_GAP || dur >= PHRASE_MAX) flush();
    }
    cur.push(w);
  }
  flush();
  return phrases;
}

/** Peso bruto de uma categoria numa frase (frases mais longas no léxico pesam mais). */
const VET_NORMALIZE: Record<string, string> = {
helicliose: "erliquiose",
eliciose: "erliquiose",
erlichiose: "erliquiose",
erliquiose: "erliquiose",
cinomoze: "cinomose",
cinomosi: "cinomose",
parvovirozi: "parvovirose",
emoparasitose: "hemoparasitose",
};
const EMOTION_WORDS = [
"olha",
"veja",
"presta atenção",
"não faça",
"grave",
"urgente",
"inacreditável",
"surpreendente",
"quase morreu",
"muita gente não sabe",
];
const CURIOSITY_WORDS = [
"por que",
"porque",
"será que",
"o que aconteceu",
"ninguém imagina",
"ninguem imagina",
"você sabia",
"voce sabia",
"sabia que",
"descubra",
"revelei",
"revelou",
"surpreendente",
"inesperado",
"não parece",
"nao parece",
"como isso",
];

const QUESTION_WORDS = [
"por que",
"como",
"quando",
"onde",
"quem",
"qual",
"será",
"você sabia",
];
const SUSPENSE_WORDS = [
"mas",
"porém",
"entretanto",
"até que",
"de repente",
"ninguém esperava",
"o final",
"o resultado",
"surpreendeu",
"inesperado",
];
const ENDING_WORDS = [
"sobreviveu",
"recuperou",
"recuperada",
"recuperado",
"deu tudo certo",
"ficou bem",
"já está bem",
"21 dias depois",
"voltou a andar",
"voltou a comer",
"teve alta",
"não tem mais",
"resultado surpreendeu",
"final feliz",
"conseguiu",
"salvou",
];

const BEFORE_AFTER_WORDS = [
"antes",
"depois",
"agora",
"21 dias depois",
"dias depois",
"semanas depois",
"meses depois",
"já está bem",
"ja esta bem",
"não tem mais",
"nao tem mais",
"voltou ao normal",
"ficou assim",
"resultado final",
"antes e depois",
"transformação",
"transformacao",
"recuperada",
"recuperado",
"melhorou",
];
const TUTOR_EMOTION_WORDS = [
"tutor desesperado",
"tutora desesperada",
"tutor chorando",
"tutora chorando",
"chorou",
"chorando",
"emocionado",
"emocionada",
"não acreditava",
"nao acreditava",
"ficou aliviado",
"ficou aliviada",
"família chorando",
"familia chorando",
"muito triste",
"muito feliz",
"desesperado",
"desesperada",
"aliviado",
"aliviada",
];


const HOOK_WORDS = [
"olha isso",
"presta atenção",
"você faria isso",
"muita gente não sabe",
"quase morreu",
"o tutor chegou desesperado",
"ninguém acredita",
"não faça isso",
"grave",
"urgente",
];

function normalizeVetText(text: string): string {
let t = text.toLowerCase();

for (const [wrong, right] of Object.entries(VET_NORMALIZE)) {
t = t.replaceAll(wrong, right);
}

return t;
}

function rawScore(text: string, type: DirectorMomentType): number {
  const t = normalizeVetText(text);
  let raw = 0;
  for (const phrase of LEXICONS[type]) {
    if (t.includes(phrase)) raw += phrase.trim().split(/\s+/).length;
  }
  return raw;
}

/**
 * Analisa a transcrição + silêncios (+ picos opcionais) e devolve os melhores
 * momentos por categoria. SOMENTE LEITURA — não corta nem edita nada.
 */
export function analyzeDirector(
  words: DirectorWord[],
  silences: DirectorSilence[],
  opts: AnalyzeOptions
): DirectorMoment[] {
  const minScore = opts.minScore ?? 45;
  const topPerCategory = Math.max(1, opts.topPerCategory ?? 1);
  const peaks = opts.volumePeaks ?? [];

  const phrases = segmentBySilences(words, silences);
  if (phrases.length === 0) return [];

  const hookWindow = (opts.sourceDuration || 0) * 0.2; // 1º 20% favorece hook

  type Scored = {
  phrase: Phrase;
  type: DirectorMomentType;
  score: number;
  viralScore: number;
  chance: "ALTA" | "MEDIA" | "BAIXA";
  reason: string;
  };
  const scored: Scored[] = [];

  for (const phrase of phrases) {
    const peakInside = peaks.some((p) => p >= phrase.start && p <= phrase.end);
    for (const type of ALL_TYPES) {
      const raw = rawScore(phrase.text, type);
      if (raw === 0) continue;

      let score = 50 + raw * 14;
      if (phrase.afterSilence) score += 12; // entrada limpa na fala
      if (peakInside) score += 12; // momento forte (volume)
      if (type === "hook" && phrase.start <= hookWindow) score += 15;
      if (phrase.intensity >= 60) score += 8;
      if (phrase.intensity >= 80) score += 12;
      if (phrase.wordCount <= 8) score += 6;
      if (phrase.wordCount <= 5) score += 10;
      const lowerText = phrase.text.toLowerCase();
      const hasEmotion =
EMOTION_WORDS.some((w) => lowerText.includes(w));

const hasHook =
HOOK_WORDS.some((w) => lowerText.includes(w));

const hasCuriosity =
CURIOSITY_WORDS.some((w) => lowerText.includes(w));

const hasQuestion =
QUESTION_WORDS.some((w) => lowerText.includes(w));

const hasSuspense =
SUSPENSE_WORDS.some((w) => lowerText.includes(w));

const hasEnding =
ENDING_WORDS.some((w) => lowerText.includes(w));

const hasBeforeAfter =
BEFORE_AFTER_WORDS.some((w) => lowerText.includes(w));

const hasTutorEmotion =
TUTOR_EMOTION_WORDS.some((w) => lowerText.includes(w));


      if (lowerText.includes("?")) score += 8;
      if (lowerText.includes("!")) score += 8;

      if (EMOTION_WORDS.some((w) => lowerText.includes(w))) {
      score += 12;
      }
      if (HOOK_WORDS.some((w) => lowerText.includes(w))) {
      score += 18;
      }
      if (CURIOSITY_WORDS.some((w) => lowerText.includes(w))) {
      score += 15;
      }
      if (QUESTION_WORDS.some((w) => lowerText.includes(w))) {
      score += 10;
      }

      if (SUSPENSE_WORDS.some((w) => lowerText.includes(w))) {
      score += 12;
      }
      if (ENDING_WORDS.some((w) => lowerText.includes(w))) {
      score += 20;
      }
      if (BEFORE_AFTER_WORDS.some((w) => lowerText.includes(w))) {
      score += 18;
      }
      if (TUTOR_EMOTION_WORDS.some((w) => lowerText.includes(w))) {
      score += 18;
      }
      if (hasHook && hasCuriosity) {
      score += 20;
      }

      if (hasEmotion && hasCuriosity) {
      score += 15;
      }

      if (hasSuspense && hasEnding) {
      score += 20;
      }

      if (hasBeforeAfter && hasTutorEmotion) {
      score += 25;
      }

      if (hasHook && phrase.start <= hookWindow) {
      score += 25;
      }

      if (hasQuestion && hasCuriosity) {
      score += 15;
      }



      if (phrase.wordCount < 3) score -= 10; // frase curta = menos confiável

      score = Math.max(0, Math.min(99, Math.round(score)));
      const viralScore = Math.min(
      99,
      Math.round(
      score +
      phrase.intensity * 0.15 +
      Math.min(10, phrase.wordCount)
      )
      );

      const chance =
      viralScore >= 85
      ? "ALTA"
      : viralScore >= 70
      ? "MEDIA"
      : "BAIXA";
      let reason = "";

      if (hasHook && phrase.start <= hookWindow) {
      reason = "Hook forte nos primeiros segundos";
      } else if (hasBeforeAfter && hasTutorEmotion) {
      reason = "Antes e depois com emoção";
      } else if (hasEmotion && hasCuriosity) {
      reason = "Emoção + curiosidade";
      } else if (hasSuspense && hasEnding) {
      reason = "Suspense com final forte";
      } else if (hasQuestion && hasCuriosity) {
      reason = "Pergunta + curiosidade";
      } else if (type === "autoridade") {
      reason = "Linguagem técnica e autoridade";
      } else {
      reason = "Combinação de gatilhos de viralização";
      }


      if (score >= minScore) {
      scored.push({
      phrase,
      type,
      score,
      viralScore,
      chance,
      reason,
      });
      }

    }
  }

  // Melhores N por categoria.
  const byType = new Map<DirectorMomentType, Scored[]>();
  for (const s of scored) {
    const arr = byType.get(s.type) ?? [];
    arr.push(s);
    byType.set(s.type, arr);
  }

  const moments: DirectorMoment[] = [];
  
  for (const type of ALL_TYPES) {
    const arr = (byType.get(type) ?? []).sort((a, b) => b.score - a.score);
    let taken = 0;
    for (const s of arr) {
        if (s.phrase.intensity < 40) continue;
      
      
      const text = normalizeVetText(s.phrase.text).replace(/\s+/g, " ").trim();

      moments.push({
        seconds: Math.round(s.phrase.start),
        time: formatTime(s.phrase.start),
        type,
        score: s.score,
        viralScore: s.viralScore,
        chance: s.chance,
        reason: s.reason,
        snippet: text.length > 80 ? text.slice(0, 79).trimEnd() + "…" : text,
      });
      if (++taken >= topPerCategory) break;
    }
  }

  moments.sort((a, b) => a.seconds - b.seconds);
  return typeof opts.maxMoments === "number"
    ? moments.slice(0, opts.maxMoments)
    : moments;
}