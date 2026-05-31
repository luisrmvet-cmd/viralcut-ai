// app/api/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { del } from "@vercel/blob";
// (Fase 6) efeitos/transições
import {
  FPS,
  clipChain,
  motionForIndex,
  framesPerImage as computeFramesPerImage,
  xfadeChain,
  fadeChain,
} from "../../lib/transitions";
// (Fase 7) edição inteligente
import { beatSyncedFrames, SMART_TRANSITIONS, DEFAULT_BPM } from "../../lib/smartEdit";
// (Fase 8A.2) clipe de vídeo + normalização + guarda anti-SSRF
import {
  videoClipChain,
  isAllowedBlobUrl,
  NORMALIZE_VF_SDR,
  NORMALIZE_VF_HDR,
} from "../../lib/videoClip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

const ALLOWED_DURATIONS = [15, 30, 45, 60];
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

// === Fase 3: biblioteca de músicas ===
const MUSIC_DIR = path.join(process.cwd(), "public", "music");
const MUSIC_FILES: Record<string, string> = {
  cinematic: "cinematic.mp3",
  motivational: "motivational.mp3",
  happy: "happy.mp3",
  emotional: "emotional.mp3",
  viral: "viral.mp3",
};
const DEFAULT_MUSIC = "cinematic";
const MUSIC_VOLUME = 0.15;

// === Fase 5: legenda ===
const CAPTION_FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const CAPTION_MAX_LEN = 120;
const CAPTION_WRAP = 22;

type Clip = { type: "image" | "video"; file: string };

/**
 * (Fase 8A.2 fix) Detecta HDR (HLG/PQ) lendo o stderr do `ffmpeg -i`.
 * Não usa ffprobe (que não está instalado no projeto).
 */
function probeIsHDR(srcPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const bin = ffmpegStatic as unknown as string;
    if (!bin) return resolve(false);
    let err = "";
    const p = spawn(bin, ["-hide_banner", "-i", srcPath]);
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", () => resolve(/smpte2084|arib-std-b67|bt2020/i.test(err)));
    p.on("error", () => resolve(false));
  });
}

/**
 * (Fase 8A.2 fix) Normaliza um vídeo (iPhone/HEVC/HDR/MOV/VFR) em um passo
 * SEPARADO, ANTES do render misto: extrai só a 1ª faixa de vídeo (-map 0:v:0,
 * ignora áudio/timecode/dados), tonemap se HDR, e reescreve em H.264/yuv420p/
 * SDR/30fps CFR a 1080x1920. Isso elimina o "ffmpeg code 234" que acontecia ao
 * jogar o vídeo cru direto na filtergraph complexa do render.
 */
function normalizeVideo(src: string, out: string, hdr: boolean): Promise<void> {
  const vf = hdr ? NORMALIZE_VF_HDR : NORMALIZE_VF_SDR;
  return new Promise((resolve, reject) => {
    ffmpeg(src)
      .outputOptions([
        "-map", "0:v:0",
        "-an", "-sn", "-dn",
        "-vf", vf,
        "-r", String(FPS),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-color_primaries", "bt709",
        "-color_trc", "bt709",
        "-colorspace", "bt709",
        "-movflags", "+faststart",
      ])
      .on("start", (cmd) => console.log("[normalize] ffmpeg:", cmd))
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(out);
  });
}

/**
 * Gera o vídeo vertical 1080x1920 a partir de clipes mistos (imagem/vídeo).
 * Cada clipe ocupa um "slot" de frames (duração final continua exata).
 */
function renderVideo(
  outputPath: string,
  clips: Clip[],
  totalSeconds: number,
  smartEdit = false
): Promise<void> {
  const count = clips.length;
  const frames = smartEdit
    ? beatSyncedFrames(totalSeconds, count, DEFAULT_BPM, FPS)
    : computeFramesPerImage(totalSeconds, count, FPS);
  const transitions = smartEdit ? SMART_TRANSITIONS : ["fade"];

  const command = ffmpeg();
  clips.forEach((c) => command.input(c.file));

  const chains: string[] = [];
  const clipLabels: string[] = [];
  clips.forEach((c, i) => {
    const label = `v${i}`;
    clipLabels.push(label);
    chains.push(
      c.type === "video"
        ? videoClipChain(i, label, frames[i])
        : clipChain(i, label, motionForIndex(i), frames[i])
    );
  });

  const { chains: xchains, lastLabel } = xfadeChain(
    clipLabels,
    frames,
    totalSeconds,
    count,
    FPS,
    transitions
  );
  chains.push(...xchains);
  chains.push(fadeChain(lastLabel, totalSeconds, "outv"));

  return new Promise((resolve, reject) => {
    command
      .complexFilter(chains.join(";"))
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

// === Fase 5: legenda (drawtext) ===
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

// === Fase 2B: música de fundo ===
function mixBackgroundMusic(
  videoPath: string,
  musicPath: string,
  outPath: string
): Promise<void> {
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
  const blobUrlsToDelete: string[] = [];

  try {
    const form = await req.formData();

    const imageFiles: File[] = [];
    for (const [key, value] of form.entries()) {
      if (key.startsWith("image") && value instanceof File && value.size > 0) {
        imageFiles.push(value);
      }
    }
    const videoUrls: string[] = [];
    for (const [key, value] of form.entries()) {
      if (key.startsWith("videoUrl") && typeof value === "string" && value.trim()) {
        videoUrls.push(value.trim());
      }
    }

    if (imageFiles.length === 0 && videoUrls.length === 0) {
      return NextResponse.json(
        { ok: false, jobId, error: "Nenhuma mídia recebida." },
        { status: 400 }
      );
    }

    let duration = Number(form.get("duration") || 30);
    if (!ALLOWED_DURATIONS.includes(duration)) duration = 30;
    const smartEdit = String(form.get("smartEdit") || "") === "1";

    console.log(
      `[render] jobId=${jobId} | duration=${duration}s | imagens=${imageFiles.length} | ` +
        `videos=${videoUrls.length} | smartEdit=${smartEdit}`
    );

    await mkdir(tmpDir, { recursive: true });

    const clips: Clip[] = [];

    // 1) imagens -> clipes de imagem (caminho idêntico ao das fases anteriores)
    for (let i = 0; i < imageFiles.length; i++) {
      const p = path.join(tmpDir, `${i + 1}.png`);
      await writeFile(p, Buffer.from(await imageFiles[i].arrayBuffer()));
      clips.push({ type: "image", file: p });
    }

    // 2) vídeos: baixa do Blob -> NORMALIZA (passo separado) -> clipe de vídeo
    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i];
      if (!isAllowedBlobUrl(url)) {
        console.warn("[render] URL de vídeo rejeitada (host inválido):", url);
        continue;
      }
      blobUrlsToDelete.push(url);
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn("[render] falha ao baixar vídeo:", url, resp.status);
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.byteLength > MAX_VIDEO_BYTES) {
        console.warn("[render] vídeo acima do limite, ignorado:", url);
        continue;
      }
      const rawPath = path.join(tmpDir, `vid${i + 1}_raw`);
      await writeFile(rawPath, buf);

      // normaliza (iPhone/HEVC/HDR/MOV/VFR -> H.264/yuv420p/SDR/30fps/1080x1920)
      const hdr = await probeIsHDR(rawPath);
      const normPath = path.join(tmpDir, `vid${i + 1}.mp4`);
      try {
        await normalizeVideo(rawPath, normPath, hdr);
      } catch (e1) {
        if (hdr) {
          console.warn("[render] normalização HDR falhou; tentando conversão simples:", e1);
          try {
            await normalizeVideo(rawPath, normPath, false);
          } catch (e2) {
            console.error("[render] normalização falhou; vídeo ignorado:", e2);
            continue;
          }
        } else {
          console.error("[render] normalização falhou; vídeo ignorado:", e1);
          continue;
        }
      }
      if (existsSync(normPath)) clips.push({ type: "video", file: normPath });
    }

    if (clips.length === 0) {
      return NextResponse.json(
        { ok: false, jobId, error: "Nenhuma mídia válida para renderizar." },
        { status: 400 }
      );
    }

    const outputPath = path.join(tmpDir, "video.mp4");
    await renderVideo(outputPath, clips, duration, smartEdit);

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
    } else {
      const requestedMusic = String(form.get("musicKey") || DEFAULT_MUSIC);
      const safeMusicKey = MUSIC_FILES[requestedMusic] ? requestedMusic : DEFAULT_MUSIC;
      musicPath = path.join(MUSIC_DIR, MUSIC_FILES[safeMusicKey]);
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
    if (blobUrlsToDelete.length > 0) {
      await del(blobUrlsToDelete).catch((e) =>
        console.warn("[render] falha ao apagar blobs:", e)
      );
    }
  }
}
