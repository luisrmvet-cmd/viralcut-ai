// app/api/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// FFmpeg exige runtime Node (não Edge) e execução dinâmica.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos (limite depende do seu plano Vercel)

// Aponta o fluent-ffmpeg para o binário do ffmpeg-static.
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

// Durações permitidas (em segundos).
const ALLOWED_DURATIONS = [15, 30, 45, 60];

/**
 * Gera um slideshow vertical 1080x1920 a partir de 1.png, 2.png, ...
 * `secondsPerImage` = quantos segundos cada imagem fica na tela.
 * No demuxer de imagens isso é controlado pelo framerate de ENTRADA:
 * cada quadro dura 1/framerate, então framerate = 1 / secondsPerImage.
 * Duração final do vídeo = nImagens * secondsPerImage = duração escolhida.
 */
function renderVideo(
  dir: string,
  outputPath: string,
  secondsPerImage: number
): Promise<void> {
  const inputFramerate = 1 / secondsPerImage;

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(dir, "%d.png"))
      .inputOptions([
        "-framerate", String(inputFramerate),
        "-start_number", "1",
      ])
      .videoFilters([
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        "setsar=1",
        "format=yuv420p",
      ])
      .outputOptions([
        "-r", "30",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
      ])
      .on("start", (cmd) => console.log("[render] ffmpeg cmd:", cmd))
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(outputPath);
  });
}

export async function POST(req: NextRequest) {
  const jobId = randomUUID();

  // Na Vercel, /public e /var/task são somente leitura; só /tmp é gravável.
  const tmpDir = path.join(os.tmpdir(), "viralcut-renders", jobId);

  try {
    const form = await req.formData();

    // ---- imagens ----
    const files: File[] = [];
    for (const value of form.values()) {
      if (value instanceof File && value.size > 0) files.push(value);
    }
    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, jobId, error: "Nenhuma imagem recebida." },
        { status: 400 }
      );
    }

    // ---- duração ----
    // 1) lê o campo enviado pelo frontend
    let duration = Number(form.get("duration") || 30);
    // 2) aceita SOMENTE 15, 30, 45 ou 60; qualquer outra coisa vira 30
    if (!ALLOWED_DURATIONS.includes(duration)) duration = 30;

    // 3) tempo de cada imagem na tela
    const secondsPerImage = duration / files.length;

    console.log(
      `[render] jobId=${jobId} | rawDuration=${form.get("duration")} | ` +
        `duration=${duration}s | imagens=${files.length} | ` +
        `segPorImagem=${secondsPerImage}`
    );

    // ---- salva imagens em /tmp ----
    await mkdir(tmpDir, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      const buffer = Buffer.from(await files[i].arrayBuffer());
      await writeFile(path.join(tmpDir, `${i + 1}.png`), buffer);
    }

    // ---- gera o MP4 com a duração escolhida ----
    const outputPath = path.join(tmpDir, "video.mp4");
    await renderVideo(tmpDir, outputPath, secondsPerImage);

    // ---- devolve os bytes do MP4 (blob response intacto) ----
    const videoBuffer = await readFile(outputPath);
    return new NextResponse(new Uint8Array(videoBuffer), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(videoBuffer.length),
        "Content-Disposition": `attachment; filename="viralcut-${jobId}.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[render] ERRO:", err);
    return NextResponse.json(
      {
        ok: false,
        jobId,
        error: err instanceof Error ? err.message : "Falha ao gerar o vídeo.",
      },
      { status: 500 }
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
