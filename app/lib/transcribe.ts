// app/lib/transcribe.ts
//
// Transcrição de áudio via Groq (Whisper) com timestamp por palavra.
// Recebe o caminho de um arquivo de áudio e devolve WordTiming[].
//
// Não é puro (faz leitura de arquivo + rede), mas é isolado: não importa
// FFmpeg, não toca no pipeline de render.
//
// Em caso de erro real (sem chave, HTTP != 2xx, timeout) ele LANÇA, para o
// chamador decidir o fallback (render sem legenda). Quando a transcrição
// dá certo mas não há fala, devolve [] (sem legenda, sem crash).

import { readFile } from "node:fs/promises";
import type { WordTiming } from "./captions";

export interface TranscribeOptions {
  language?: string;   // default "pt"
  model?: string;      // default "whisper-large-v3-turbo"
  apiKey?: string;     // default process.env.GROQ_API_KEY
  baseUrl?: string;    // default "https://api.groq.com/openai/v1"
  timeoutMs?: number;  // default 60000
  filename?: string;   // default "audio.m4a" (a extensão ajuda o servidor)
}

export async function transcribeWords(
  audioPath: string,
  options: TranscribeOptions = {}
): Promise<WordTiming[]> {
  const language = options.language ?? "pt";
  const model = options.model ?? "whisper-large-v3-turbo";
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
  const baseUrl = options.baseUrl ?? "https://api.groq.com/openai/v1";
  const timeoutMs = options.timeoutMs ?? 60000;
  const filename = options.filename ?? "audio.m4a";

  if (!apiKey) {
    throw new Error("GROQ_API_KEY ausente: defina a variável de ambiente.");
  }

  const buffer = await readFile(audioPath);

  const form = new FormData();
  form.append("file", new Blob([buffer]), filename);
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(
      `Transcrição falhou: HTTP ${response.status} ${response.statusText} ${detail}`.trim()
    );
  }

  const data: unknown = await response.json();
  return normalizeWords(data);
}

interface RawWord {
  word?: unknown;
  start?: unknown;
  end?: unknown;
}

function normalizeWords(data: unknown): WordTiming[] {
  const words = (data as { words?: unknown } | null)?.words;
  if (!Array.isArray(words)) return []; // sem palavras -> sem legenda (graceful)

  const out: WordTiming[] = [];
  for (const raw of words as RawWord[]) {
    const word = typeof raw.word === "string" ? raw.word.trim() : "";
    const start =
      typeof raw.start === "number" ? raw.start : Number(raw.start);
    const end = typeof raw.end === "number" ? raw.end : Number(raw.end);
    if (!word) continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({ word, start: Math.max(0, start), end: Math.max(0, end) });
  }
  return out;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const t = await response.text();
    return t ? `- ${t.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}