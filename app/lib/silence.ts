// app/lib/silence.ts
// (Fase 11A.1 — Snap por Silêncio) Detecção de pausas/silêncios na fonte.
//
// Roda UMA passada de áudio-apenas com o filtro nativo `silencedetect` do
// FFmpeg já embarcado no projeto (ffmpeg-static) e parseia o stderr em
// intervalos { start, end }. Saída descartada (-f null): nada é gravado,
// nada é re-encodado, o vídeo não é tocado.
//
// Isolado de propósito: não importa nada do route.ts, não conhece o
// pipeline e NÃO é chamado por ninguém ainda. A ligação ao bloco R3 é o
// Bloco 3, mediante validação.
//
// Contrato de erro: falha real (spawn, exit != 0, timeout) LANÇA — o
// chamador decide o fallback (plano V2 sem snap). Sucesso sem silêncio
// devolve [] (a camada de snap já trata como no-op).

import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";
import type { SilenceInterval } from "./autocut";

export type DetectSilenceOptions = {
  noiseDb?: number;     // limiar de "silêncio", em dB (default -35)
  minSilence?: number;  // duração mínima da pausa, em segundos (default 0.3)
  timeoutMs?: number;   // trava de segurança (default 20000)
  ffmpegPath?: string;  // default: binário do ffmpeg-static (já no projeto)
};

const DEFAULT_NOISE_DB = -35;
const DEFAULT_MIN_SILENCE = 0.3;
const DEFAULT_TIMEOUT_MS = 20_000;

const RE_SILENCE_START = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
const RE_SILENCE_END = /silence_end:\s*(-?\d+(?:\.\d+)?)/g;
const RE_DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/;

export async function detectSilences(
  filePath: string,
  options: DetectSilenceOptions = {}
): Promise<SilenceInterval[]> {
  const noiseDb = options.noiseDb ?? DEFAULT_NOISE_DB;
  const minSilence = options.minSilence ?? DEFAULT_MIN_SILENCE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const bin = options.ffmpegPath ?? (ffmpegStaticPath as unknown as string);

  if (!bin) {
    throw new Error("[silence] binário do FFmpeg não resolvido (ffmpeg-static).");
  }

  const args = [
    "-hide_banner",
    "-nostdin",
    "-i", filePath,
    "-vn", // só áudio: não decodifica vídeo
    "-af", `silencedetect=noise=${noiseDb}dB:d=${minSilence}`,
    "-f", "null",
    "-",
  ];

  const stderr = await runFfmpeg(bin, args, timeoutMs);
  return parseSilences(stderr);
}

/** Parse puro do stderr do silencedetect (exportado para teste isolado). */
export function parseSilences(stderr: string): SilenceInterval[] {
  const starts = [...stderr.matchAll(RE_SILENCE_START)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(RE_SILENCE_END)].map((m) => Number(m[1]));

  const out: SilenceInterval[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = Math.max(0, starts[i]);
    let end = ends[i];

    // Silêncio aberto no fim do arquivo: fecha com a duração total, se houver.
    if (end === undefined) {
      const d = stderr.match(RE_DURATION);
      if (!d) break; // sem como fechar → descarta o intervalo aberto
      end =
        Number(d[1]) * 3600 +
        Number(d[2]) * 60 +
        Number(d[3]) +
        (d[4] ? Number(`0.${d[4]}`) : 0);
    }

    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      out.push({ start, end });
    }
  }
  return out;
}

function runFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let err = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`[silence] silencedetect estourou ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`[silence] FFmpeg saiu com código ${code}`));
        return;
      }
      resolve(err);
    });
  });
}
