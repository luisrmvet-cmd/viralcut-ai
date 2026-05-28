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

/**
 * Gera um slideshow vertical 1080x1920 a partir de 1.png, 2.png, ...
 * dentro de `dir`. Cada imagem aparece 3 segundos.
 */
function renderVideo(dir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(dir, "%d.png"))
      .inputOptions(["-framerate", "1/3", "-start_number", "1"])
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
      .on("start", (cmd) => console.log("[render] ffmpeg:", cmd))
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(outputPath);
  });
}

export async function POST(req: NextRequest) {
  const jobId = randomUUID();

  // IMPORTANTE: na Vercel, /public e /var/task são somente leitura.
  // O único lugar gravável no ambiente serverless é o diretório temporário do SO.
  // os.tmpdir() resolve para /tmp na Vercel e para o tmp local na sua máquina.
  const tmpDir = path.join(os.tmpdir(), "viralcut-renders", jobId);

  try {
    const form = await req.formData();

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

    // Cria o diretório temporário gravável.
    await mkdir(tmpDir, { recursive: true });

    // Salva as imagens como 1.png, 2.png, ... (ffmpeg detecta o formato pelo conteúdo).
    for (let i = 0; i < files.length; i++) {
      const buffer = Buffer.from(await files[i].arrayBuffer());
      await writeFile(path.join(tmpDir, `${i + 1}.png`), buffer);
    }

    // Gera o MP4 dentro do mesmo tmpDir.
    const outputPath = path.join(tmpDir, "video.mp4");
    await renderVideo(tmpDir, outputPath);

    // Lê o MP4 e devolve os BYTES diretamente — não dependemos de URL em /public.
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
    // Em erro, sempre JSON válido (nunca HTML).
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
    // Limpa o tmp (efêmero na Vercel, mas evita acúmulo localmente / entre invocações).
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
