// app/api/viral-content/route.ts
//
// Fase 15B.1 — Hook + Título IA (rota DESACOPLADA do render)
//
// Modo A { videoUrl }   -> baixa do Blob, extrai áudio (FFmpeg), transcreve
//                          (Whisper/Groq), gera hook+título e DEVOLVE o
//                          transcript para o cliente cachear. Apaga o Blob.
// Modo B { transcript } -> só gera hook+título (regenerar barato: sem reupload
//                          e sem retranscrição).
//
// Flag única: NEXT_PUBLIC_VIRAL_CONTENT_AI (default OFF) => off responde 404.
// Em qualquer erro de IA/transcrição => ok:false. Não toca em render, AutoCut,
// legendas, música, upload, histórico nem download.

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { del } from "@vercel/blob";
import { isAllowedBlobUrl } from "../../lib/videoClip";
import { transcribeWords } from "../../lib/transcribe";
import { generateViralContent } from "../../lib/viralContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

const FLAG_ON = process.env.NEXT_PUBLIC_VIRAL_CONTENT_AI === "1";
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Extrai áudio do vídeo (16kHz mono) — mesmo perfil usado nas legendas. */
function extractAudio(videoPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        "-map", "0:a:0",
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "aac",
        "-b:a", "64k",
      ])
      .on("error", (e: Error) => reject(e))
      .on("end", () => resolve())
      .save(outPath);
  });
}

export async function POST(req: NextRequest) {
  if (!FLAG_ON) {
    return NextResponse.json({ ok: false, disabled: true }, { status: 404 });
  }

  let body: { videoUrl?: string; transcript?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 });
  }

  // Modo B — regenerar com transcript em cache (sem reupload/retranscrição).
  const cached = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (cached) {
    try {
      const content = await generateViralContent(cached);
      return NextResponse.json({ ok: true, content });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Falha ao gerar conteúdo." },
        { status: 500 }
      );
    }
  }

  // Modo A — transcrever do vídeo (1x) e gerar.
  const videoUrl = typeof body?.videoUrl === "string" ? body.videoUrl.trim() : "";
  if (!videoUrl || !isAllowedBlobUrl(videoUrl)) {
    return NextResponse.json(
      { ok: false, error: "videoUrl ausente ou inválido." },
      { status: 400 }
    );
  }

  const jobId = randomUUID();
  const tmpDir = path.join(os.tmpdir(), "viralcut-viral-content", jobId);

  try {
    await mkdir(tmpDir, { recursive: true });

    const resp = await fetch(videoUrl);
    if (!resp.ok) {
      return NextResponse.json(
        { ok: false, error: `Falha ao baixar vídeo (HTTP ${resp.status}).` },
        { status: 502 }
      );
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > MAX_VIDEO_BYTES) {
      return NextResponse.json({ ok: false, error: "Vídeo acima do limite." }, { status: 413 });
    }

    const rawPath = path.join(tmpDir, "source_raw");
    await writeFile(rawPath, buf);

    const audioPath = path.join(tmpDir, "audio.m4a");
    await extractAudio(rawPath, audioPath);

    const words = await transcribeWords(audioPath, { language: "pt" });
    const transcript = words.map((w) => w.word).join(" ").trim();

    if (!transcript) {
      return NextResponse.json(
        { ok: false, error: "Sem fala detectada no vídeo." },
        { status: 422 }
      );
    }

    const content = await generateViralContent(transcript);
    return NextResponse.json({ ok: true, transcript, content });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Falha ao processar vídeo." },
      { status: 500 }
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    // apaga o Blob que o cliente subiu só para esta análise
    try {
      await del(videoUrl);
    } catch {
      /* ignore */
    }
  }
}