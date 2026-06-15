    // app/api/director/route.ts
// Fase 15F.1 — Endpoint isolado do "Diretor de Vídeo IA" (SOMENTE LEITURA).
// Recebe um vídeo, extrai áudio, transcreve, detecta silêncios, roda o diretor
// e retorna DirectorMoment[] em JSON. NÃO corta, NÃO edita vídeo, NÃO toca no
// render/AutoCut/Hook/Viral Score/editor. Gated por DIRECTOR_AI=1 (default OFF).

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { transcribeWords } from "../../lib/transcribe";
import { detectSilences } from "../../lib/silence";
import {
  analyzeDirector,
  type DirectorWord,
  type DirectorSilence,
} from "../../lib/director";

export const runtime = "nodejs";
export const maxDuration = 60;

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);

/** Extrai áudio mono 16kHz (ideal p/ Whisper, leve). Código novo e isolado. */
function extractAudio(videoPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac"])
      .on("end", () => resolve())
      .on("error", reject)
      .save(outPath);
  });
}

export async function POST(req: NextRequest) {
  if (process.env.DIRECTOR_AI !== "1") {
    return NextResponse.json(
      { ok: false, error: "Director AI desativado (DIRECTOR_AI != 1)" },
      { status: 403 }
    );
  }

  const jobId = randomUUID();
  const tmpDir = path.join(os.tmpdir(), `director-${jobId}`);

  try {
    const form = await req.formData();
    const file = form.get("video");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { ok: false, error: "Envie um arquivo no campo 'video'." },
        { status: 400 }
      );
    }

    await mkdir(tmpDir, { recursive: true });
    const videoPath = path.join(tmpDir, "input.mp4");
    await writeFile(videoPath, Buffer.from(await file.arrayBuffer()));

    const audioPath = path.join(tmpDir, "audio.m4a");
    await extractAudio(videoPath, audioPath);

    const t0 = Date.now();
    const [rawWords, rawSilences] = await Promise.all([
      transcribeWords(audioPath, { language: "pt" }),
      detectSilences(audioPath),
    ]);

    // Adapta a saída das libs para o formato do diretor (campo word -> text).
    const words: DirectorWord[] = rawWords.map((w) => ({
      text: w.word,
      start: w.start,
      end: w.end,
    }));
    // Suposição sinalizada: SilenceInterval = { start, end }.
    const silences: DirectorSilence[] = rawSilences.map((s) => ({
      start: s.start,
      end: s.end,
    }));

    const sourceDuration = words.length ? words[words.length - 1].end : 0;
    const moments = analyzeDirector(words, silences, { sourceDuration });

    console.log(
      `[director] palavras=${words.length} silencios=${silences.length} ` +
        `momentos=${moments.length} t=${Date.now() - t0}ms`
    );

    return NextResponse.json({
      ok: true,
      moments,
      stats: { words: words.length, silences: silences.length },
    });
  } catch (e) {
    console.error("[director] erro:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}