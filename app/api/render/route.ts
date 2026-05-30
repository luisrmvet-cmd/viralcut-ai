// app/api/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
// (Fase 6) efeitos/transições isolados
import {
  FPS,
  clipChain,
  motionForIndex,
  framesPerImage as computeFramesPerImage,
  xfadeChain,
  fadeChain,
} from "../../lib/transitions";
// (Fase 7) edição inteligente isolada
import { beatSyncedFrames, SMART_TRANSITIONS, DEFAULT_BPM } from "../../lib/smartEdit";

// FFmpeg exige runtime Node (não Edge) e execução dinâmica.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // segundos (limite depende do seu plano Vercel)

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

const ALLOWED_DURATIONS = [15, 30, 45, 60];

// === Fase 3: biblioteca de músicas (seleção por categoria) ===
const MUSIC_DIR = path.join(process.cwd(), "public", "music");
const MUSIC_FILES: Record<string, string> = {
  cinematic: "cinematic.mp3",
  motivational: "motivational.mp3",
  happy: "happy.mp3",
  emotional: "emotional.mp3",
  viral: "viral.mp3",
};
const DEFAULT_MUSIC = "cinematic";
const MUSIC_VOLUME = 0.15; // 15%

// === Fase 5: legenda no vídeo (drawtext) ===
const CAPTION_FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const CAPTION_MAX_LEN = 120;
const CAPTION_WRAP = 22;

/**
 * Gera o vídeo vertical 1080x1920 com efeito Ken Burns/zoom/pan por imagem.
 *
 * (Fase 6) corte seco virou crossfade (xfade) + fade in/out.
 * (Fase 7) modo `smartEdit`: cortes sincronizados a uma grade de batidas
 *   aproximada (BPM assumido) + paleta de transições profissionais.
 *   Quando `smartEdit` é false (padrão), o comportamento é EXATAMENTE o da
 *   Fase 6. O modo inteligente mantém a MESMA soma de frames, então a duração
 *   final é idêntica à do modo normal (15/30/45/60s preservados).
 */
function renderVideo(
  dir: string,
  outputPath: string,
  count: number,
  _secondsPerImage: number,
  totalSeconds: number,
  smartEdit = false
): Promise<void> {
  // (Fase 7) distribuição de frames: inteligente (na batida) ou normal
  const frames = smartEdit
    ? beatSyncedFrames(totalSeconds, count, DEFAULT_BPM, FPS)
    : computeFramesPerImage(totalSeconds, count, FPS);

  // (Fase 7) transições: paleta pro no modo inteligente; "fade" no normal
  const transitions = smartEdit ? SMART_TRANSITIONS : ["fade"];

  const command = ffmpeg();
  for (let i = 0; i < count; i++) {
    command.input(path.join(dir, `${i + 1}.png`));
  }

  const chains: string[] = [];

  // 1) cadeia de cada imagem (Ken Burns / zoom / pan) -> [v0..v{count-1}]
  const clipLabels: string[] = [];
  for (let i = 0; i < count; i++) {
    const label = `v${i}`;
    clipLabels.push(label);
    chains.push(clipChain(i, label, motionForIndex(i), frames[i]));
  }

  // 2) transições entre clipes (xfade encadeado)
  const { chains: xchains, lastLabel } = xfadeChain(
    clipLabels,
    frames,
    totalSeconds,
    count,
    FPS,
    transitions
  );
  chains.push(...xchains);

  // 3) fade in / fade out na saída final -> [outv]
  chains.push(fadeChain(lastLabel, totalSeconds, "outv"));

  const filterGraph = chains.join(";");

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

// === Fase 5: legenda (drawtext), passo isolado ===
function sanitizeCaption(raw: string): string {
  return (raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CAPTION_MAX_LEN);
}

function wrapCaption(text: string, maxPerLine = CAPTION_WRAP): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxPerLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

async function drawCaption(
  videoPath: string,
  caption: string,
  outPath: string,
  tmpDir: string
): Promise<void> {
  const textFilePath = path.join(tmpDir, "caption.txt");
  await writeFile(textFilePath, wrapCaption(caption), "utf8");

  const escPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
  const filter =
    `drawtext=fontfile='${escPath(CAPTION_FONT)}':` +
    `textfile='${escPath(textFilePath)}':` +
    `expansion=none:` +
    `fontcolor=white:fontsize=60:line_spacing=12:` +
    `box=1:boxcolor=black@0.55:boxborderw=24:` +
    `x=(w-text_w)/2:y=h-text_h-180`;

  console.log("[caption] aplicando legenda:", JSON.stringify(caption));
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .videoFilters(filter)
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
      ])
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(outPath);
  });
}

// === Fase 2B: música de fundo, passo isolado (copia o vídeo, não re-renderiza) ===
function mixBackgroundMusic(
  videoPath: string,
  musicPath: string,
  outPath: string
): Promise<void> {
  console.log("[mix] videoPath=", videoPath);
  console.log("[mix] musicPath=", musicPath);
  console.log("[mix] outPath=", outPath);
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .inputOptions(["-stream_loop", "-1"])
      .complexFilter(`[1:a]volume=${MUSIC_VOLUME}[a]`)
      .outputOptions([
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
      ])
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(outPath);
  });
}

export async function POST(req: NextRequest) {
  const jobId = randomUUID();
  const tmpDir = path.join(os.tmpdir(), "viralcut-renders", jobId);

  try {
    const form = await req.formData();

    const files: File[] = [];
    for (const [key, value] of form.entries()) {
      if (key.startsWith("image") && value instanceof File && value.size > 0) {
        files.push(value);
      }
    }
    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, jobId, error: "Nenhuma imagem recebida." },
        { status: 400 }
      );
    }

    let duration = Number(form.get("duration") || 30);
    if (!ALLOWED_DURATIONS.includes(duration)) duration = 30;
    const secondsPerImage = duration / files.length;

    // (Fase 7) flag de edição inteligente (default OFF -> fallback Fase 6)
    const smartEdit = String(form.get("smartEdit") || "") === "1";

    console.log(
      `[render] jobId=${jobId} | duration=${duration}s | imagens=${files.length} | ` +
        `segPorImagem=${secondsPerImage} | smartEdit=${smartEdit}`
    );

    await mkdir(tmpDir, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      const buffer = Buffer.from(await files[i].arrayBuffer());
      await writeFile(path.join(tmpDir, `${i + 1}.png`), buffer);
    }

    const outputPath = path.join(tmpDir, "video.mp4");
    await renderVideo(tmpDir, outputPath, files.length, secondsPerImage, duration, smartEdit);

    // === Fase 5: legenda opcional ===
    const caption = sanitizeCaption(String(form.get("caption") || ""));
    let videoForMusic = outputPath;
    if (caption && existsSync(CAPTION_FONT)) {
      const captionedPath = path.join(tmpDir, "video-caption.mp4");
      try {
        await drawCaption(outputPath, caption, captionedPath, tmpDir);
        if (existsSync(captionedPath)) videoForMusic = captionedPath;
      } catch (e) {
        console.error("[render] falha ao aplicar legenda; seguindo sem legenda:", e);
      }
    } else if (caption && !existsSync(CAPTION_FONT)) {
      console.warn("[render] legenda solicitada mas fonte não encontrada em", CAPTION_FONT);
    }

    // === Fase 4/3: música própria (prioridade) ou biblioteca ===
    const uploadedMusic = form.get("musicFile");
    let musicPath: string;
    if (uploadedMusic instanceof File && uploadedMusic.size > 0) {
      const customPath = path.join(tmpDir, "custom-music.mp3");
      await writeFile(customPath, Buffer.from(await uploadedMusic.arrayBuffer()));
      musicPath = customPath;
      console.log("[render] música enviada pelo usuário:", uploadedMusic.size, "bytes");
    } else {
      const requestedMusic = String(form.get("musicKey") || DEFAULT_MUSIC);
      const safeMusicKey = MUSIC_FILES[requestedMusic] ? requestedMusic : DEFAULT_MUSIC;
      musicPath = path.join(MUSIC_DIR, MUSIC_FILES[safeMusicKey]);
      console.log("[render] musicKey=", safeMusicKey, "file=", MUSIC_FILES[safeMusicKey]);
    }

    // === Fase 2B: adiciona música se existir ===
    let deliverPath = videoForMusic;
    if (existsSync(musicPath)) {
      const withMusicPath = path.join(tmpDir, "video-music.mp4");
      try {
        await mixBackgroundMusic(videoForMusic, musicPath, withMusicPath);
        if (existsSync(withMusicPath)) deliverPath = withMusicPath;
      } catch (e) {
        console.error("[render] falha ao adicionar música; vídeo sem áudio:", e);
      }
    }

    const videoBuffer = await readFile(deliverPath);
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
