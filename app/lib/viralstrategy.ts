// app/lib/viralstrategy.ts
// Fase 15D — Estratégia Viral Avançada (Opção A)
// Módulo determinístico puro. SEM rede, SEM LLM, SEM análise textual.
// Consome apenas a string `angulo` já produzida pelo Conteúdo IA (content.angulo).
// NÃO importa nem modifica viralContent.ts / viralscore.ts.

export type Potencial = "Alto" | "Médio" | "Baixo";

export type Plataforma =
  | "Instagram"
  | "TikTok"
  | "Shorts"
  | "Facebook"
  | "Threads";

export type Gatilho =
  | "Curiosidade"
  | "Autoridade"
  | "Dor"
  | "Emoção"
  | "Alerta"
  | "Polêmica"
  | "Humor";

export interface ViralStrategy {
  dominante: Gatilho;
  secundario: Gatilho;
  retencao: Potencial;
  compartilhamento: Potencial;
  emocional: Potencial;
  plataforma: Plataforma;
  motivo: string;
}

// Normaliza acentos e caixa para casar palavra-chave dentro do `angulo`.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Detecta qual dos 7 gatilhos o `angulo` referencia (busca por palavra-chave).
// Retorna null se nada casar -> fallback neutro.
function detectGatilho(angulo: string): Gatilho | null {
  const a = normalize(angulo);
  const tabela: Array<[Gatilho, string[]]> = [
    ["Curiosidade", ["curiosidade", "curioso", "segredo", "voce sabia"]],
    ["Autoridade", ["autoridade", "especialista", "veterinari", "expert", "tecnico"]],
    ["Dor", ["dor", "problema", "sofrimento", "erro comum", "risco para"]],
    ["Emoção", ["emocao", "emocional", "amor", "carinho", "historia"]],
    ["Alerta", ["alerta", "perigo", "cuidado", "atencao", "aviso"]],
    ["Polêmica", ["polemica", "controversia", "debate", "mito", "verdade ou"]],
    ["Humor", ["humor", "engracado", "comico", "piada", "divertido"]],
  ];
  for (const [gatilho, chaves] of tabela) {
    if (chaves.some((k) => a.includes(k))) return gatilho;
  }
  return null;
}

interface Profile {
  secundario: Gatilho;
  retencao: Potencial;
  compartilhamento: Potencial;
  emocional: Potencial;
  plataforma: Plataforma;
  motivo: string;
}

// Tabela determinística por gatilho dominante.
const PROFILES: Record<Gatilho, Profile> = {
  Curiosidade: {
    secundario: "Autoridade",
    retencao: "Alto",
    compartilhamento: "Alto",
    emocional: "Médio",
    plataforma: "Instagram",
    motivo:
      "Curiosidade + Autoridade tendem a aumentar a retenção e os compartilhamentos em vídeos educativos, segurando o espectador até a resposta.",
  },
  Autoridade: {
    secundario: "Curiosidade",
    retencao: "Alto",
    compartilhamento: "Médio",
    emocional: "Médio",
    plataforma: "Shorts",
    motivo:
      "Autoridade + Curiosidade reforçam confiança e prendem a atenção em conteúdo informativo, ideal para formatos curtos e diretos.",
  },
  Dor: {
    secundario: "Alerta",
    retencao: "Alto",
    compartilhamento: "Alto",
    emocional: "Alto",
    plataforma: "Facebook",
    motivo:
      "Dor + Alerta criam identificação imediata com um problema e senso de urgência, o que costuma gerar salvamentos e compartilhamentos.",
  },
  Emoção: {
    secundario: "Curiosidade",
    retencao: "Médio",
    compartilhamento: "Alto",
    emocional: "Alto",
    plataforma: "Instagram",
    motivo:
      "Emoção + Curiosidade favorecem conexão e compartilhamento, especialmente em histórias que despertam afeto pelo tema.",
  },
  Alerta: {
    secundario: "Dor",
    retencao: "Alto",
    compartilhamento: "Alto",
    emocional: "Médio",
    plataforma: "Facebook",
    motivo:
      "Alerta + Dor ativam senso de urgência e prevenção, aumentando salvamentos e o repasse para pessoas próximas.",
  },
  Polêmica: {
    secundario: "Curiosidade",
    retencao: "Alto",
    compartilhamento: "Alto",
    emocional: "Médio",
    plataforma: "TikTok",
    motivo:
      "Polêmica + Curiosidade estimulam comentários e debate, o que impulsiona alcance em plataformas movidas por engajamento.",
  },
  Humor: {
    secundario: "Emoção",
    retencao: "Médio",
    compartilhamento: "Alto",
    emocional: "Alto",
    plataforma: "TikTok",
    motivo:
      "Humor + Emoção aumentam o compartilhamento espontâneo e a chance de o vídeo ser enviado entre amigos.",
  },
};

// Fallback neutro quando o `angulo` não casa com nenhum gatilho conhecido.
const FALLBACK: ViralStrategy = {
  dominante: "Curiosidade",
  secundario: "Autoridade",
  retencao: "Médio",
  compartilhamento: "Médio",
  emocional: "Médio",
  plataforma: "Instagram",
  motivo:
    "Ângulo não classificado com precisão; estratégia equilibrada sugerida, com foco em curiosidade e autoridade.",
};

export function computeViralStrategy(angulo: string): ViralStrategy {
  if (!angulo || typeof angulo !== "string") return FALLBACK;
  const dominante = detectGatilho(angulo);
  if (!dominante) return FALLBACK;
  const p = PROFILES[dominante];
  return {
    dominante,
    secundario: p.secundario,
    retencao: p.retencao,
    compartilhamento: p.compartilhamento,
    emocional: p.emocional,
    plataforma: p.plataforma,
    motivo: p.motivo,
  };
}