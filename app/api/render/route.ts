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
export const maxDuration = 300; // segundos (limite depende do seu plano Vercel)

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

const ALLOWED_DURATIONS = [15, 30, 45, 60];
const FPS = 30;
const ZOOM = 0.12; // intensidade do zoom (suave)

/**
 * Monta os parâmetros do zoompan para cada efeito, alternando por imagem:
 *  - 0: zoom in leve     - 1: zoom out leve     - 2: pan/zoom lateral suave
 * `d1` = (frames - 1), usado para normalizar a animação de 0 a 1.
 * Importante: as expressões NÃO usam vírgula (a vírgula separa filtros na
 * filtergraph), por isso usamos progressão linear com `on` em vez de min()/max().
 */
function zoompanForEffect(effect: number, d1: number): string {
  const centerX = "x='iw/2-(iw/zoom/2)'";
  const centerY = "y='ih/2-(ih/zoom/2)'";
  switch (effect) {
    case 0: // zoom in
      return `z='1+${ZOOM}*on/${d1}':${centerX}:${centerY}`;
    case 1: // zoom out
      return `z='${1 + ZOOM}-${ZOOM}*on/${d1}':${centerX}:${centerY}`;
    default: // 2: pan lateral (zoom fixo, desloca na horizontal)
      return `z='${1 + ZOOM}':x='(iw-iw/zoom)*on/${d1}':${centerY}`;
  }
}

/**
 * Distribui `total` frames entre `n` imagens de forma que a SOMA seja
 * exatamente `total` (sem erro de arredondamento na duração final).
 */
function distributeFrames(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  let rem = total - base * n;
  return Array.from({ length: n }, () => {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem--;
    return base + extra;
  });
}

/**
 * Gera o vídeo vertical 1080x1920 com efeito Ken Burns por imagem.
 * Cada imagem vira um clipe (filter_complex) e todos são unidos com concat.
 */
function renderVideo(
  dir: string,
  outputPath: string,
  count: number,
  secondsPerImage: number,
  totalSeconds: number
): Promise<void> {
  const totalFrames = Math.round(totalSeconds * FPS);
  const framesPerImage = distributeFrames(totalFrames, count);

  const command = ffmpeg();
  for (let i = 0; i < count; i++) {
    command.input(path.join(dir, `${i + 1}.png`)); // cada imagem = 1 frame de entrada
  }

  // Monta a filtergraph: uma cadeia por imagem + concat final.
  const chains: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = framesPerImage[i];
    const d1 = Math.max(d - 1, 1); // evita divisão por zero
    const zp = zoompanForEffect(i % 3, d1);
    chains.push(
      `[${i}:v]` +
        // encaixa em 1080x1920 sem distorcer + fundo preto
        `scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,` +
        // upscale 2x antes do zoompan reduz tremor
        `scale=2160:3840,` +
        `zoompan=${zp}:d=${d}:s=1080x1920:fps=${FPS},` +
        `format=yuv420p[v${i}]`
    );
  }
  const concatInputs = Array.from({ length: count }, (_, i) => `[v${i}]`).join("");
  const filterGraph =
    chains.join(";") + `;${concatInputs}concat=n=${count}:v=1:a=0[outv]`;

  return new Promise((resolve, reject) => {
    command
      .complexFilter(filterGraph)
      .outputOptions([
        "-map", "[outv]",
        "-r", String(FPS),
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

    // duração: aceita SOMENTE 15/30/45/60; senão 30
    let duration = Number(form.get("duration") || 30);
    if (!ALLOWED_DURATIONS.includes(duration)) duration = 30;
    const secondsPerImage = duration / files.length;

    console.log(
      `[render] jobId=${jobId} | duration=${duration}s | imagens=${files.length} | ` +
        `segPorImagem=${secondsPerImage}`
    );

    await mkdir(tmpDir, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      const buffer = Buffer.from(await files[i].arrayBuffer());
      await writeFile(path.join(tmpDir, `${i + 1}.png`), buffer);
    }

    const outputPath = path.join(tmpDir, "video.mp4");
    await renderVideo(tmpDir, outputPath, files.length, secondsPerImage, duration);

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
