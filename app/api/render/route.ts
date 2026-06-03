// app/api/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { del, put } from "@vercel/blob";
// (Fase 6) Ken Burns/zoom/pan por imagem
import { FPS, clipChain, motionForIndex } from "../../lib/transitions";
// (Fase 7) BPM da edição inteligente (cortes no ritmo)
import { DEFAULT_BPM } from "../../lib/smartEdit";
// (Fase 8A.2) normalização de vídeo + guarda anti-SSRF
import { NORMALIZE_VF_SDR, NORMALIZE_VF_HDR, isAllowedBlobUrl } from "../../lib/videoClip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

const ALLOWED_DURATIONS = [15, 30, 45, 60];
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

// Codec idêntico para TODO clipe baked (essencial p/ o concat demuxer com -c copy)
const CLIP_ENC = [
  "-r", String(FPS),
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-an",
  "-movflags", "+faststart",
];

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
const MUSIC_VOLUME = 0.08;

// === Fase 5: legenda ===
const CAPTION_FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const CAPTION_MAX_LEN = 120;
const CAPTION_WRAP = 22;

type Clip = { type: "image" | "video"; file: string; hdr?: boolean };

/** (8A.2) Detecta HDR (HLG/PQ) pelo stderr do `ffmpeg -i` (sem precisar de ffprobe). */
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
 * (Fix mídia mista) Distribui os frames por clipe somando EXATAMENTE
 * round(totalSeconds*FPS) — sem compensação de xfade, pois agora concatenamos
 * (corte seco), sem sobreposição. smartEdit alinha os cortes a uma grade de
 * batida aproximada (BPM); senão, divisão uniforme. A duração final fica exata.
 */
function slotFrames(totalSeconds: number, count: number, smartEdit: boolean): number[] {
  const total = Math.round(totalSeconds * FPS);
  const even = (tot: number, n: number) => {
    const base = Math.floor(tot / n);
    let rem = tot - base * n;
    return Array.from({ length: n }, () => {
      const e = rem > 0 ? 1 : 0;
      if (rem > 0) rem--;
      return base + e;
    });
  };
  if (smartEdit && count > 1) {
    const bf = Math.max(1, Math.round((60 / DEFAULT_BPM) * FPS));
    const totalBeats = Math.floor(total / bf);
    if (totalBeats >= count) {
      const base = Math.floor(totalBeats / count);
      let rem = totalBeats - base * count;
      const beats = Array.from({ length: count }, () => {
        const e = rem > 0 ? 1 : 0;
        if (rem > 0) rem--;
        return base + e;
      });
      const fr = beats.map((b) => b * bf);
      fr[fr.length - 1] += total - fr.reduce((a, b) => a + b, 0);
      if (Math.min(...fr) > 0) return fr;
    }
  }
  return even(total, count);
}

/** Loga falha do FFmpeg com o COMANDO exato e o stderr completo. */
function attachLogging(
  cmdObj: ffmpeg.FfmpegCommand,
  tag: string,
  resolve: () => void,
  reject: (e: Error) => void
) {
  let startedCmd = "";
  cmdObj
    .on("start", (cmd: string) => {
      startedCmd = cmd;
      console.log(`[${tag}] ffmpeg:`, cmd);
    })
    .on("error", (err: Error, _stdout: string | null, stderr: string | null) => {
      console.error(`[${tag}] FALHOU:`, err.message);
      console.error(`[${tag}] comando:`, startedCmd);
      console.error(`[${tag}] stderr:`, stderr || "(vazio)");
      reject(err);
    })
    .on("end", () => resolve());
}

/** Bakeia UM clipe de imagem (Ken Burns) em MP4 normalizado de `frames` quadros. */
function bakeImageClip(
  imgPath: string,
  outPath: string,
  effect: ReturnType<typeof motionForIndex>,
  frames: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(imgPath)
      .complexFilter(clipChain(0, "v", effect, frames))
      .outputOptions(["-map", "[v]", ...CLIP_ENC]);
    attachLogging(cmd, "bake-img", resolve, reject);
    cmd.save(outPath);
  });
}

/**
 * Bakeia UM clipe de vídeo (iPhone/HEVC/HDR/MOV) em MP4 normalizado de `frames`
 * quadros, numa única passada: -map 0:v:0 (ignora áudio/timecode/dados),
 * tonemap se HDR, scale/pad 1080x1920, fps 30, tpad clone + trim p/ o slot,
 * H.264/yuv420p. Saída idêntica ao clipe de imagem -> concat -c copy seguro.
 */
function bakeVideoClip(
  rawPath: string,
  outPath: string,
  frames: number,
  hdr: boolean
): Promise<void> {
  const baseVf = hdr ? NORMALIZE_VF_HDR : NORMALIZE_VF_SDR;
  const vf =
    `${baseVf},fps=${FPS},setpts=PTS-STARTPTS,` +
    `tpad=stop=-1:stop_mode=clone,trim=end_frame=${frames},` +
    `setpts=PTS-STARTPTS,format=yuv420p`;
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(rawPath).outputOptions([
      "-map", "0:v:0",
    "-map", "0:a?",
"-c:a", "aac",
"-b:a", "160k",
"-ac", "2",
"-ar", "44100",
"-sn", "-dn",
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
    ]);
    attachLogging(cmd, "bake-vid", resolve, reject);
    cmd.save(outPath);
  });
}

/** Concatena os clipes baked re-encodando (recronometra tudo; evita drop de segmento no -c copy). */
function concatClips(listPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(listPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
        "-movflags", "+faststart",
      ]);
    attachLogging(cmd, "concat", resolve, reject);
    cmd.save(outPath);
  });
}

/**
 * Render principal (mídia mista) — SEM xfade:
 *  1) bakeia cada clipe (imagem ou vídeo) em MP4 normalizado idêntico;
 *  2) concatena com o concat demuxer (corte seco).
 * Música e legenda são aplicadas DEPOIS, no vídeo final.
 */
async function renderVideo(
  outputPath: string,
  clips: Clip[],
  totalSeconds: number,
  smartEdit: boolean,
  tmpDir: string
): Promise<void> {
  const frames = slotFrames(totalSeconds, clips.length, smartEdit);
  const clipPaths: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const outClip = path.join(tmpDir, `clip${i}.mp4`);
    if (c.type === "video") {
      try {
        await bakeVideoClip(c.file, outClip, frames[i], c.hdr === true);
      } catch (e1) {
        if (c.hdr) {
          console.warn("[render] bake HDR falhou; tentando SDR simples:", e1);
          await bakeVideoClip(c.file, outClip, frames[i], false);
        } else {
          throw e1;
        }
      }
    } else {
      await bakeImageClip(c.file, outClip, motionForIndex(i), frames[i]);
    }
    clipPaths.push(outClip);
  }

  // concat demuxer
  const listPath = path.join(tmpDir, "concat.txt");
  await writeFile(
    listPath,
    clipPaths.map((p) => `file '${p}'`).join("\n") + "\n",
    "utf8"
  );
  await concatClips(listPath, outputPath);
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
    const cmd = ffmpeg()
      .input(videoPath)
      .videoFilters(filter)
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
      ]);
    attachLogging(cmd, "caption", resolve, reject);
    cmd.save(outPath);
  });
}

// === Fase 2B: música de fundo (copia o vídeo, não re-renderiza) ===
function mixBackgroundMusic(
  videoPath: string,
  musicPath: string,
  outPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .inputOptions(["-stream_loop", "-1"])
      .complexFilter([
`[0:a]volume=1.0[voice]`,
`[1:a]volume=${MUSIC_VOLUME}[music]`,
`[voice][music]amix=inputs=2:duration=first:dropout_transition=0[a]`
])
.outputOptions([
"-map", "0:v:0",
"-map", "[a]",
"-c:v", "copy",
"-c:a", "aac",
"-b:a", "160k",
"-ac", "2",
"-ar", "44100",
"-shortest",
])
    attachLogging(cmd, "music", resolve, reject);
    cmd.save(outPath);
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

    // imagens -> clipes de imagem
    for (let i = 0; i < imageFiles.length; i++) {
      const p = path.join(tmpDir, `img${i + 1}.png`);
      await writeFile(p, Buffer.from(await imageFiles[i].arrayBuffer()));
      clips.push({ type: "image", file: p });
    }

    // vídeos -> baixa do Blob, detecta HDR, vira clipe de vídeo
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
      const hdr = await probeIsHDR(rawPath);
      clips.push({ type: "video", file: rawPath, hdr });
    }

    if (clips.length === 0) {
      return NextResponse.json(
        { ok: false, jobId, error: "Nenhuma mídia válida para renderizar." },
        { status: 400 }
      );
    }

    // 1) render principal: bake de cada clipe + concat demuxer
    const baseVideo = path.join(tmpDir, "video.mp4");
    await renderVideo(baseVideo, clips, duration, smartEdit, tmpDir);

    // 2) legenda opcional (Fase 5)
    const caption = sanitizeCaption(String(form.get("caption") || ""));
    let videoForMusic = baseVideo;
    if (caption && existsSync(CAPTION_FONT)) {
      const captionedPath = path.join(tmpDir, "video-caption.mp4");
      try {
        await drawCaption(baseVideo, caption, captionedPath, tmpDir);
        if (existsSync(captionedPath)) videoForMusic = captionedPath;
      } catch (e) {
        console.error("[render] falha ao aplicar legenda; seguindo sem legenda:", e);
      }
    } else if (caption && !existsSync(CAPTION_FONT)) {
      console.warn("[render] legenda solicitada mas fonte não encontrada em", CAPTION_FONT);
    }

    // 3) música (Fase 4/3/2B)
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

    let deliverPath = videoForMusic;
    if (existsSync(musicPath)) {
      const withMusicPath = path.join(tmpDir, "video-music.mp4");
      try {
        if (process.env.SKIP_MUSIC === "1") {
// TESTE TEMPORÁRIO — diagnóstico de áudio. Remover depois.
console.warn("[render] SKIP_MUSIC=1 — pulando mixBackgroundMusic; entregando vídeo sem música");
await copyFile(videoForMusic, withMusicPath);
} else {
await mixBackgroundMusic(videoForMusic, musicPath, withMusicPath);
}
        if (existsSync(withMusicPath)) deliverPath = withMusicPath;
      } catch (e) {
        console.error("[render] falha ao adicionar música; vídeo sem áudio:", e);
      }
    }

    // sobe o MP4 final ao Vercel Blob e devolve a URL (evita "Load failed" no
    // iOS por segurar conexão longa + baixar binário grande inline).
    const videoBuffer = await readFile(deliverPath);

try {
  const uploaded = await put(`renders/viralcut-${jobId}.mp4`, videoBuffer, {
    access: "public",
    contentType: "video/mp4",
  });
  return NextResponse.json({ ok: true, url: uploaded.url });
} catch (e) {
  // Só local + sem token: não derruba o render. Caso contrário, mantém o comportamento atual.
  if (process.env.NODE_ENV === "production") throw e;
  console.warn("[render] Vercel Blob sem token no local — usando data URL para teste:", e);
  return NextResponse.json({
    ok: true,
    url: `data:video/mp4;base64,${videoBuffer.toString("base64")}`,
    local: true,
  });
}
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
try {
await del(blobUrlsToDelete);
} catch (e) {
console.warn("[render] falha ao apagar blobs:", e);
}
}}}