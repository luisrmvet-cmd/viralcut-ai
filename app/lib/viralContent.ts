// app/lib/viralContent.ts
//
// Fase 15B.1 — Hook + Título IA
//
// Módulo isolado (faz rede, não é puro). Recebe o TEXTO transcrito do vídeo e
// gera, via Groq chat completions (mesma GROQ_API_KEY já usada no Whisper),
// hooks virais e títulos fortes pensados para retenção nos 3 primeiros
// segundos em Reels/TikTok. NÃO gera hashtags (reservadas para a 15B.4).
//
// Em erro real (sem chave, HTTP != 2xx, timeout, JSON inválido) → LANÇA, para
// o chamador (a rota) decidir o fallback. Não importa FFmpeg, não toca em
// render, AutoCut, legendas, música, upload, histórico nem download.

export interface ViralContent {
angulo: string;
triggerType: string;
emotion: string;
intensity: string;
viralityLevel: string;
dominantTrigger: string;

hooks: string[];

titulosInstagram: string[];
titulosTikTok: string[];


legenda: string;

ctaComentarios: string;
ctaCompartilhamento: string;
ctaSeguidores: string;

hashtags: string[];
coverTitle: string;
coverSubtitle: string;
coverStyle: string;
}


export interface ViralContentOptions {
  model?: string; // default "llama-3.3-70b-versatile"
  apiKey?: string; // default process.env.GROQ_API_KEY
  baseUrl?: string; // default "https://api.groq.com/openai/v1"
  timeoutMs?: number; // default 30000
  maxChars?: number; // corte do transcript enviado (default 6000)
}

const SYSTEM_PROMPT = `Você é um especialista brasileiro em crescimento de Instagram Reels e TikTok.

Sua missão é analisar a TRANSCRIÇÃO de um vídeo em português e escolher automaticamente o melhor ângulo viral para retenção nos 3 primeiros segundos.

Ângulos possíveis:
- dor: quando o vídeo mostra sofrimento, problema, erro, perda, medo, risco ou frustração.
- curiosidade: quando existe algo incompleto, surpreendente, estranho ou que dá vontade de continuar assistindo.
- emoção: quando existe carinho, alívio, tristeza, superação, tensão, cuidado ou conexão humana.
- alerta: quando existe perigo, urgência, risco de morte, erro comum, doença ou consequência grave.
- polemica: quando o tema divide opiniões, gera debate ou faz a pessoa querer comentar.
- autoridade: quando o conteúdo ensina, explica, orienta ou mostra conhecimento técnico/profissional.

Prioridades, nesta ordem:
1. Escolha UM único ângulo dominante com base no conteúdo real do vídeo.
2. Crie hooks muito fortes para os 3 primeiros segundos.
3. Use linguagem natural de criador brasileiro.
4. Nunca prometa algo que o vídeo não entrega.
5. Prefira frases com tensão, contraste, surpresa ou urgência.
6. Evite repetir estruturas muito parecidas entre os hooks.
7. Misture perguntas, afirmações fortes, alertas e frases inesperadas.
8. Não use aberturas genéricas.
9. Se houver risco, erro ou consequência grave, priorize esse elemento.
10. O objetivo principal é fazer a pessoa continuar assistindo após os primeiros 3 segundos.
11. Identifique qual gatilho emocional é dominante no conteúdo.
12. Classifique a intensidade do gatilho como baixa, média ou alta.
Regras dos hooks:

- Curtos, lidos em até 3 segundos.
- No máximo 12 palavras.
- Fortes, diretos e com cara de Reels.
- Sem hashtags.
- Sem emojis em excesso.
- Sem clickbait falso.
- Não use frases genéricas como "olha isso" ou "você precisa ver".
- Evite "ninguém te conta", "você não vai acreditar", "veja isso", "olha isso" e frases batidas.
- Varie o estilo entre pergunta, alerta, afirmação e curiosidade.
- Os hooks devem parecer escritos por um criador humano brasileiro.
- Determine qual emoção domina o vídeo.
- Determine qual gatilho emocional domina o vídeo.
- Classifique o potencial de viralização em baixo, médio ou alto.
Estratégias preferidas para hooks:
- Surpresa.
- Quebra de expectativa.
- Erro comum.
- Consequência grave.
- Curiosidade.
- Medo de perder algo importante.
- Contraste entre certo e errado.
- Benefício escondido.
- Histórias humanas e emoção.
- Situações que geram comentários e compartilhamentos.

Se houver mais de uma estratégia possível, escolha a que tenha maior potencial de retenção.

Regras dos títulos:
Instagram:
- Gere 3 títulos.
- Fortes e diretos.
- Bons para capa.
- No máximo 9 palavras.

TikTok:
- Gere 3 títulos.
- Mais curiosidade e impacto.
- No máximo 9 palavras.

Todos devem:
- Ser em português do Brasil.
- Combinar com o ângulo escolhido.

Regras da legenda:
- Produza uma legenda pronta para Instagram.
- Entre 2 e 6 linhas.
- Linguagem natural de criador brasileiro.
- Pode usar poucos emojis, sem exagero.
- Deve complementar o vídeo e não repetir os hooks.
- Deve aumentar comentários e compartilhamentos.

Regras do CTA:
- Produza apenas um CTA.
- Curto e natural.
- Incentive comentários, compartilhamentos ou salvamentos.
- Não use frases forçadas.

Regras das hashtags:
- Gere exatamente 5 hashtags.
- Misture hashtags amplas e específicas.
- Sem repetir hashtags.
- Sem hashtags irrelevantes.

Responda EXCLUSIVAMENTE com um objeto JSON válido, sem texto antes ou depois, neste formato exato:
{
"angulo":"<dor|curiosidade|emocao|alerta|polemica|autoridade>",

"hooks":["...","...","..."],

"titulosInstagram":["...","...","...","...","..."],
"titulosTikTok":["...","...","...","...","..."],

"legenda":"...",

"ctaComentarios":"...",
"ctaCompartilhamento":"...",
"ctaSeguidores":"...",

"hashtags":["...","...","...","...","..."],

"coverTitle":"...",
"coverSubtitle":"...",
"coverStyle":"curiosidade|alerta|emocao|autoridade|dramatico"
}

Forneça:
- 1 título para capa.
- 1 subtítulo para capa.
- 1 estilo de capa.
- 3 hooks.
- 3 títulos para Instagram.
- 3 títulos para TikTok.

- 1 legenda.
- 1 CTA para comentários.
- 1 CTA para compartilhamento.
- 1 CTA para seguir o perfil.
- Exatamente 5 hashtags.`;



export async function generateViralContent(
  transcript: string,
  options: ViralContentOptions = {}
): Promise<ViralContent> {
  const text = (transcript || "").trim();
  if (!text) throw new Error("Transcrição vazia.");

  const model = options.model ?? "llama-3.1-8b-instant";
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
  const baseUrl = options.baseUrl ?? "https://api.groq.com/openai/v1";
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxChars = options.maxChars ?? 6000;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY ausente: defina a variável de ambiente.");
  }

  const clipped = text.length > maxChars ? text.slice(0, maxChars) : text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Transcrição do vídeo (português):\n"""\n${clipped}\n"""\n\n` +
              `Gere o JSON com angulo, hooks e titulos seguindo as regras.`,
          },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(
      `Geração falhou: HTTP ${response.status} ${response.statusText} ${detail}`.trim()
    );
  }

  const data: unknown = await response.json();
  const raw = (
    data as { choices?: { message?: { content?: unknown } }[] } | null
  )?.choices?.[0]?.message?.content;

  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Resposta da IA vazia ou inesperada.");
  }

  return parseViralContent(raw);
}

function parseViralContent(raw: string): ViralContent {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    throw new Error("JSON inválido vindo da IA.");
  }
  const o = obj as {
angulo?: unknown;
triggerType?: unknown;
emotion?: unknown;
intensity?: unknown;
viralityLevel?: unknown;
dominantTrigger?: unknown;

hooks?: unknown;

titulosInstagram?: unknown;
titulosTikTok?: unknown;

legenda?: unknown;

ctaComentarios?: unknown;
ctaCompartilhamento?: unknown;
ctaSeguidores?: unknown;

hashtags?: unknown;

coverTitle?: unknown;
coverSubtitle?: unknown;
coverStyle?: unknown;
};
const angulo = typeof o.angulo === "string" ? o.angulo.trim() : "curiosidade";
const triggerType =
typeof o.triggerType === "string"
? o.triggerType.trim()
: "";

const emotion =
typeof o.emotion === "string"
? o.emotion.trim()
: "";

const viralityLevel =
typeof o.viralityLevel === "string"
? o.viralityLevel.trim()
: "";

const dominantTrigger =
typeof o.dominantTrigger === "string"
? o.dominantTrigger.trim()
: "";

const intensity =
typeof o.intensity === "string"
? o.intensity.trim()
: "";

  const hooks = toStringList(o.hooks);

const titulosInstagram = toStringList(o.titulosInstagram);
const titulosTikTok = toStringList(o.titulosTikTok);


const legenda = typeof o.legenda === "string" ? o.legenda.trim() : "";

const ctaComentarios =
typeof o.ctaComentarios === "string" ? o.ctaComentarios.trim() : "";
const ctaCompartilhamento =
typeof o.ctaCompartilhamento === "string" ? o.ctaCompartilhamento.trim() : "";
const ctaSeguidores =
typeof o.ctaSeguidores === "string" ? o.ctaSeguidores.trim() : "";

const hashtags = toStringList(o.hashtags);
  if (hooks.length === 0 || titulosInstagram.length === 0 || titulosTikTok.length === 0) {
    throw new Error("IA não retornou hooks/títulos suficientes.");
  }
 return {
angulo,
triggerType,
emotion,
viralityLevel,
dominantTrigger,
intensity,

hooks: hooks.slice(0, 3),

titulosInstagram: titulosInstagram.slice(0, 3),
titulosTikTok: titulosTikTok.slice(0, 3),

legenda,

ctaComentarios,
ctaCompartilhamento,
ctaSeguidores,

hashtags: hashtags.slice(0, 5),
coverTitle:
typeof o.coverTitle === "string"
? o.coverTitle.trim()
: "",

coverSubtitle:
typeof o.coverSubtitle === "string"
? o.coverSubtitle.trim()
: "",

coverStyle:
typeof o.coverStyle === "string"
? o.coverStyle.trim()
: "",
};

}

function toStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((s) => s.length > 0);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const t = await response.text();
    return t ? `- ${t.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}