// app/api/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile, rm, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
const ffmpegStatic = process.env.FFMPEG_PATH || "ffmpeg";
import { del, put } from "@vercel/blob";
// (Fase 6) Ken Burns/zoom/pan por imagem
import {
FPS,
clipChain,
motionForIndex,
} from "../../lib/transitions";
// (Fase 7) BPM da edição inteligente (cortes no ritmo)
import { DEFAULT_BPM } from "../../lib/smartEdit";
// (Fase 8A.2) normalização de vídeo + guarda anti-SSRF
import { NORMALIZE_VF_SDR, NORMALIZE_VF_HDR, BLUR_FILL_VF_SDR, BLUR_FILL_VF_HDR, isAllowedBlobUrl } from "../../lib/videoClip";
import { transcribeWords } from "../../lib/transcribe";
import { buildCaptionsAss, type CaptionStyle, type WordTiming } from "../../lib/captions";
import { planCut, snapSegmentsToSilences, alignSegmentEndsToSilences, type SilenceInterval } from "../../lib/autocut";
import { rankCandidates } from "../../lib/viralscore";
import { detectSilences } from "../../lib/silence";
import {
buildReelsPlan,
REELS_ORCHESTRATOR_ON,
} from "../../lib/orchestrator";
import { buildVideoOverlayAI } from "../../lib/videoOverlayAI";
import { buildSoftAudioCleanChain } from "../../lib/audioclean";
import { analyzeDirector } from "@/app/lib/director";
import { buildOneClickAutoCutVideo } from "@/app/lib/oneClickAutoCutVideo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
function perfMs(label: string, start: number) {
console.log(`[perf] ${label}: ${Date.now() - start}ms`);
}

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const ALLOWED_DURATIONS = [15, 30, 45, 60];
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

// Codec idêntico para TODO clipe baked (essencial p/ o concat demuxer com -c copy)
const CLIP_ENC = [
  "-r", String(FPS),
  "-c:v", "libx264",
  "-preset", "ultrafast",
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
const MUSIC_VOLUME = 0.05;

// === Fase 5: legenda ===
const CAPTION_FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const CAPTION_MAX_LEN = 120;
const CAPTION_WRAP = 22;

type Clip = {
type: "image" | "video";
file: string;
hdr?: boolean;
start?: number; // offset em segundos na fonte (AutoCut)
end?:boolean;
};

/** (8A.2) Detecta HDR (HLG/PQ) pelo stderr do `ffmpeg -i` (sem precisar de ffprobe). */
function probeIsHDR(srcPath: string): Promise<boolean> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const bin = ffmpegStatic as unknown as string;
    if (!bin) return resolve(false);
    let err = "";
    const p = spawn(bin, ["-hide_banner", "-i", srcPath]);
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", () => {
perfMs("probeIsHDR", t0);
resolve(/smpte2084|arib-std-b67|bt2020/i.test(err));
});

    p.on("error", () => {
perfMs("probeIsHDR", t0);
resolve(false);
});
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
let perfT0 = 0; // PR 10.1
cmdObj
.on("start", (cmd: string) => {
startedCmd = cmd;
perfT0 = Date.now(); // PR 10.1
console.log(`[${tag}] ffmpeg:`, cmd);
})
.on("error", (err: Error, _stdout: string | null, stderr: string | null) => {
console.error(`[${tag}] FALHOU:`, err.message);
console.error(`[${tag}] comando:`, startedCmd);
console.error(`[${tag}] stderr:`, stderr || "(vazio)");
reject(err);
})
.on("end", () => {
console.log(`[perf] ${tag}: ${Date.now() - perfT0}ms`); // PR 10.1
resolve();
});
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
  hdr: boolean,
  startSec = 0,
  autoCutFade = false,
): Promise<void> {
  const t0 = Date.now();
// Fase 12 — Blur Fill: fundo borrado/escurecido no lugar da tarja preta.
const blurFill = process.env.BLUR_FILL === "1";

const baseVf = blurFill
? (hdr ? BLUR_FILL_VF_HDR : BLUR_FILL_VF_SDR)
: (hdr ? NORMALIZE_VF_HDR : NORMALIZE_VF_SDR);
  const vf =
    `${baseVf},fps=${FPS},setpts=PTS-STARTPTS,` +
    `tpad=stop=-1:stop_mode=clone,trim=end_frame=${frames},` +
    `setpts=PTS-STARTPTS,format=yuv420p`;
    // Fase 10 — AutoCut Pro Lite: fade visual leve, ativo só em clips do AutoCut.
const FADE_N = 6; // frames por borda (~0.2s @ 30fps)

    const vfFinal =
  autoCutFade && frames >= 30
    ? `${vf},fade=t=in:s=0:n=${FADE_N},fade=t=out:s=${Math.max(0, frames - FADE_N)}:n=${FADE_N}`
    : vf;
// 13B — micro fade de áudio nas bordas do clipe (flag por env, default OFF)
const FADE_S_13B = 0.04; // 40ms
const clipSec13B = frames / FPS;
const audioFade13B =
  process.env.TRANSITIONS_AUDIO_FADE === "1" && clipSec13B > FADE_S_13B * 2
    ? `afade=t=in:st=0:d=${FADE_S_13B},afade=t=out:st=${(clipSec13B - FADE_S_13B).toFixed(3)}:d=${FADE_S_13B}`
    : null;
  return new Promise((resolve, reject) => {
  
    const cmd = ffmpeg(rawPath);

if (startSec > 0) {
cmd.inputOptions(["-ss", String(startSec)]);
}

cmd.outputOptions([
      "-map", "0:v:0",
    "-map", "0:a?",
"-c:a", "aac",
"-b:a", "160k",
"-ac", "2",
"-ar", "44100",
...(audioFade13B ? ["-af", audioFade13B] : []),
"-sn", "-dn",
      "-vf", vfFinal,
      "-r", String(FPS),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-color_primaries", "bt709",
      "-color_trc", "bt709",
      "-colorspace", "bt709",
      "-shortest",
      "-movflags", "+faststart",
    ]);
   console.log(`[blur-fill] ${blurFill ? "on" : "off"}`);
attachLogging(
cmd,
"bake-vid",
() => {
perfMs("bakeVideoClip", t0);
resolve();
},
reject
);
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
"-c", "copy",
"-movflags", "+faststart",
]);
    attachLogging(cmd, "concat", resolve, reject);
    cmd.save(outPath);
  });
}

// ---------- Legendas automáticas (Fase 11A) ----------

function escapeFilterPath(p: string): string {
  // Fase 14B.1.1-fix — Windows: o ':' de "C:" quebra o parser do filtro
  // subtitles (vira separador de opções → erro 'original_size').
  // 1) barras invertidas → barras normais (válido no FFmpeg em Windows);
  // 2) ':' escapado em DOIS níveis (filtergraph + opções do filtro).
  return p
    .replace(/\\/g, "/")
    .replace(/:/g, "\\\\:");
}

function extractAudioForCaptions(videoPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(videoPath).outputOptions([
      "-map", "0:a:0",
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "aac",
      "-b:a", "64k",
    ]);
    attachLogging(cmd, "captions-audio", resolve, reject);
    cmd.save(outPath);
  });
}

function burnCaptions(
  videoPath: string,
  assPath: string,
  fontsDir: string,
  outPath: string
): Promise<void> {
  const vf = `subtitles=filename=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(fontsDir)}`;
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(videoPath).outputOptions([
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:a", "copy",
      "-vf", vf,
      "-r", String(FPS),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ]);
    attachLogging(cmd, "caption-burn", resolve, reject);
    cmd.save(outPath);
  });
}
// ------------------------------------------------------
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
  tmpDir: string,
  transitions0n: boolean = false
): Promise<void> {
   const baseFrames = slotFrames(totalSeconds, clips.length, smartEdit);

   const frames = clips.map((clip, index) => {
   const start = typeof clip.start === "number" ? clip.start : 0;
   const end = typeof clip.end === "number" ? clip.end : undefined;

   if (clip.type === "video" && typeof end === "number" && end > start) {
   return Math.max(1, Math.round((end - start) * FPS));
   }

   return baseFrames[index] ?? Math.max(1, Math.round(totalSeconds * FPS));
   });
   const clipPaths: string[] = [];
   const tClips = Date.now();

   console.log(
   `[perf] clips=${clips.length} frames=${frames.join(",")}`
   );
   for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const outClip = path.join(tmpDir, `clip${i}.mp4`);
    if (c.type === "video") {
      try {
      await bakeVideoClip(
c.file,
outClip,
frames[i],
c.hdr === true,
c.start ?? 0,
c.start !== undefined
);
      } catch (e1) {
        if (c.hdr) {
          console.warn("[render] bake HDR falhou; tentando SDR simples:", e1);
         await bakeVideoClip(
c.file,
outClip,
frames[i],
false,
c.start ?? 0,
c.start !== undefined
);
        } else {
          throw e1;
        }
      }
    } else {
      await bakeImageClip(c.file, outClip, motionForIndex(i), frames[i]);
    }
    clipPaths.push(outClip);
  }
console.log(
`[perf] clips-loop: ${Date.now() - tClips}ms`
);
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
  async function drawIntroHook(
videoPath: string,
hook: string,
outPath: string,
tmpDir: string
): Promise<void> {
const textFilePath = path.join(tmpDir, "intro-hook.txt");
await writeFile(textFilePath, wrapCaption(hook, 20), "utf8");
const escPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
const filter =
`drawtext=fontfile='${escPath(CAPTION_FONT)}':` +
`textfile='${escPath(textFilePath)}':` +
`expansion=none:` +
`fontcolor=white:fontsize=72:line_spacing=14:` +
`box=1:boxcolor=black@0.65:boxborderw=28:` +
`x=(w-text_w)/2:y=140:` +
`enable='between(t,0,3)'`;

await new Promise<void>((resolve, reject) => {
const cmd = ffmpeg()
.input(videoPath)
.videoFilters(filter)
.outputOptions([
"-c:v libx264",
"-preset veryfast",
"-crf 23",
"-pix_fmt yuv420p",
"-c:a copy",
"-movflags +faststart",
])
.output(outPath)
.on("end", () => resolve())
.on("error", reject);

cmd.run();
});
}


// === Fase 2B: música de fundo (copia o vídeo, não re-renderiza) ===
function mixBackgroundMusic(
videoPath: string,
musicPath: string,
outPath: string,
improveAudio: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanChain = buildSoftAudioCleanChain(improveAudio);
const voiceFilters = cleanChain ? `,${cleanChain}` : "";
    const cmd = ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .inputOptions(["-stream_loop", "-1"])
      .complexFilter([
`[0:a]volume=1.0${voiceFilters}[voice]`,
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

// === Fase 16A.5.2: corte preciso por trecho (re-encode) ===
// Aditivo. Usado SÓ pelo branch mode:"cut". Não toca no pipeline atual.
function bakeCutSegment(
inPath: string,
outPath: string,
startSec: number,
endSec: number
): Promise<void> {
return new Promise((resolve, reject) => {
const duration = Math.max(0.2, endSec - startSec);

const cmd = ffmpeg(inPath)
.inputOptions([
"-ss",
String(startSec),
])
.outputOptions([
"-t",
String(duration),
"-map",
"0:v:0",
"-map",
"0:a?",
"-c:v",
"libx264",
"-preset",
"ultrafast",
"-crf",
"28",
"-pix_fmt",
"yuv420p",
"-c:a",
"aac",
"-b:a",
"128k",
"-ac",
"2",
"-ar",
"44100",
"-threads",
"1",
"-movflags",
"+faststart",
]);

attachLogging(cmd, "cut-seg", resolve, reject);
cmd.save(outPath);
});
}


// (Fase 16A.5.2-fix) Suporte a data URL de vídeo (cenário local: o render
// devolve `data:video/mp4;base64,...` quando não há token do Vercel Blob).
// Usado SÓ pelo branch mode:"cut".
function isDataVideoUrl(url: string): boolean {
  return /^data:video\/[a-zA-Z0-9.+-]+;base64,/.test(url);
}

async function writeDataVideoUrlToFile(
  dataUrl: string,
  outputPath: string
): Promise<void> {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) throw new Error("Data URL inválida.");
  const base64 = dataUrl.slice(commaIndex + 1);
  const buffer = Buffer.from(base64, "base64");
  await writeFile(outputPath, buffer);
}

// (Fase 16A.5.2) Branch isolado de corte: recebe o MP4 final + os trechos
// MANTIDOS (complemento de removedRanges), recodifica cada trecho com -ss/-to
// (frame-accurate) e concatena reaproveitando concatClips. Não mexe em Upload
// (usa o mesmo put), nem apaga o vídeo de origem (não vai pra blobUrlsToDelete).
async function handleCutMode(
  form: FormData,
  jobId: string,
  tmpDir: string
): Promise<NextResponse> {
  await mkdir(tmpDir, { recursive: true });

  const cutUrl = String(
form.get("videoUrl1") ||
form.get("videoUrl") ||
""
).trim();

console.log("[handleCutMode] keys =", Array.from(form.keys()));
console.log("[handleCutMode] videoUrl1 =", form.get("videoUrl1"));
console.log("[handleCutMode] videoUrl =", form.get("videoUrl"));
console.log("[handleCutMode] cutUrl final =", cutUrl);
  const isDataVideo = isDataVideoUrl(cutUrl);
  if (!cutUrl || (!isDataVideo && !isAllowedBlobUrl(cutUrl))) {
    return NextResponse.json(
      { ok: false, jobId, error: "URL de vídeo inválida para corte." },
      { status: 400 }
    );
  }

let segments: { start: number; end: number }[] = [];
const duration = Number(form.get("duration") || 30);
const autoCutSourceDuration = Number(
form.get("autoCutSourceDuration") || duration
);
const captionsRequested = String(form.get("captions") || "") === "1";
const rawCaptionStyle = String(form.get("captionStyle") || "classico");
const captionStyle: CaptionStyle =
rawCaptionStyle === "karaoke" || rawCaptionStyle === "boxed"
? rawCaptionStyle
: "classico";

const captionsActive = captionsRequested && (duration === 15 || duration === 30);
try {
const raw: unknown = JSON.parse(String(form.get("segments") || "[]"));
if (Array.isArray(raw)) {
segments = raw
.map((s) => ({ start: Number(s.start), end: Number(s.end) }))
.filter(
(s) =>
Number.isFinite(s.start) &&
Number.isFinite(s.end) &&
s.end > s.start
)
.sort((a, b) => a.start - b.start);
}
} catch {
segments = [];
}
console.log("[cut] segments recebidos:", segments);
console.log("[cut] total segments:", segments.length);

const oneClickViralOn = form.get("oneClickViral") === "1";

if (false && oneClickViralOn && segments.length === 0) {
console.log("[DirectorAutoCut] gerando segmentos inteligentes...");

try {
const rawWords = await transcribeWords(cutUrl);
const rawSilences = await detectSilences(cutUrl);

const words = rawWords
.map((w: any) => ({
text: String(w.text || w.word || ""),
start: Number(w.start || 0),
end: Number(w.end || w.start || 0),
}))
.filter(
(w) =>
w.text &&
Number.isFinite(w.start) &&
Number.isFinite(w.end) &&
w.end >= w.start
);

const silences = rawSilences
.map((s: any) => ({
start: Number(s.start || 0),
end: Number(s.end || 0),
}))
.filter(
(s) =>
Number.isFinite(s.start) &&
Number.isFinite(s.end) &&
s.end > s.start
);

const sourceDuration = Number(form.get("autoCutSourceDuration") || 0);
const targetDuration = Number(form.get("duration") || 30);

const reelsPlan = buildReelsPlan({
sourceDuration,
targetDuration,
words: words as any,
silences,
clipLength: 5,
viralSelection: true,
snap: true,
speechGuard: true,
});

segments = reelsPlan.segments
.map((s) => ({
start: Number(s.start),
end: Number(s.start + s.duration),
}))
.filter((s) => s.end > s.start);

console.log("[orchestrator 2.0] aplicado no handleCutMode:", segments);


if (segments.length === 0 && words.length > 0) {
console.warn("[DirectorAutoCut] sem moments; fallback por frases");

const phraseSegments: { start: number; end: number }[] = [];

let currentStart = words[0].start;
let currentEnd = words[0].end;
let total = 0;

for (const w of words) {
currentEnd = w.end;

if (currentEnd - currentStart >= 5) {
phraseSegments.push({
start: Math.max(0, currentStart - 0.15),
end: currentEnd + 0.15,
});

total += currentEnd - currentStart;
currentStart = w.end;

if (total >= targetDuration) break;
}
}

segments = phraseSegments.filter((s) => s.end > s.start);
}

console.log("[DirectorAutoCut] words =", words.length);
console.log("[DirectorAutoCut] silences =", silences.length);
console.log("[DirectorAutoCut] segments =", segments);

} catch (e) {
console.warn("[DirectorAutoCut] falhou:", e);
}
}


  if (segments.length === 0) {
console.warn("[DirectorAutoCut] nenhum trecho válido; fallback para AutoCut validado");

const fallbackPlan = planCut(autoCutSourceDuration, duration, 5);
console.log("[DEBUG FALLBACK] autoCutSourceDuration:", autoCutSourceDuration);
console.log("[DEBUG FALLBACK] duration:", duration);
console.log("[DEBUG FALLBACK] fallbackPlan:", fallbackPlan);
console.log("[DEBUG FALLBACK] fallback segments:", fallbackPlan.segments);

segments = fallbackPlan.segments.map((s) => ({
start: s.start,
end: s.start + s.duration,
}));
console.log("[DEBUG FALLBACK] segments depois do fallback:", segments);
console.log("[DEBUG FALLBACK] segments length depois:", segments.length);
}

  const inPath = path.join(tmpDir, "cut-in.mp4");
  if (isDataVideo) {
    // Local/sem token: o vídeo veio como data URL — decodifica direto.
    await writeDataVideoUrlToFile(cutUrl, inPath);
  } else {
let lastDownloadError: any = null;
let buf: Buffer | null = null;

for (let attempt = 0; attempt < 12; attempt++) {
try {
console.log(`[render] download tentativa ${attempt + 1}/12`, cutUrl);

const resp = await fetch(cutUrl, {
cache: "no-store",
headers: {
"User-Agent": "ViralCutAI/1.0",
"Connection": "close",
},
});

if (!resp.ok) {
const body = await resp.text().catch(() => "");
throw new Error(`HTTP ${resp.status} ${body.slice(0, 300)}`);
}

const ab = await resp.arrayBuffer();
buf = Buffer.from(ab);

console.log("[render] download bytes:", buf.byteLength);

if (buf.byteLength < 1024 * 100) {
throw new Error(`Download muito pequeno: ${buf.byteLength} bytes`);
}

if (buf.byteLength > MAX_VIDEO_BYTES) {
return NextResponse.json(
{ ok: false, jobId, error: "Vídeo acima do limite." },
{ status: 413 }
);
}

await writeFile(inPath, buf);

const st = await stat(inPath);
console.log("[render] inPath salvo:", inPath, "size:", st.size);

break;
} catch (e) {
lastDownloadError = e;
console.warn(`[render] download tentativa ${attempt + 1}/12 falhou:`, e);

if (attempt < 11) {
await new Promise((r) => setTimeout(r, 1500 + attempt * 500));
}
}
}

if (!buf) {
console.error("[CUT DOWNLOAD ERROR FINAL]", {
cutUrl,
error: lastDownloadError,
});

return NextResponse.json(
{
ok: false,
jobId,
error: "Falha ao baixar vídeo para corte. Tente novamente.",
},
{ status: 400 }
);
}
  }
  const partPaths: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const out = path.join(tmpDir, `cut${i}.mp4`);
    await bakeCutSegment(inPath, out, segments[i].start, segments[i].end);
    partPaths.push(out);
  }

  let outPath = path.join(tmpDir, "cut-out.mp4");
  if (partPaths.length === 1) {
    await copyFile(partPaths[0], outPath);
  } else {
    const listPath = path.join(tmpDir, "cut-concat.txt");
          const concatList =
partPaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n") + "\n";

console.log("[cut] concatList:", concatList);

await writeFile(listPath, concatList, "utf8");
    await concatClips(listPath, outPath);
  }
// ---------- Legendas automáticas no modo corte ----------
if (captionsActive) {
try {
const tCap = Date.now();
const asrAudioPath = path.join(tmpDir, "cut-captions-audio.m4a");

await extractAudioForCaptions(outPath, asrAudioPath);

const words = await transcribeWords(asrAudioPath, { language: "pt" });
console.log(`[cut captions] palavras transcritas: ${words.length}`);

if (words.length > 0) {
const assPath = path.join(tmpDir, "cut-captions.ass");

await writeFile(
assPath,
buildCaptionsAss(words, {
style: captionStyle,
width: 1080,
height: 1920,
fontName: "DejaVu Sans",
}),
"utf8"
);

const fontsDir = path.join(process.cwd(), "assets", "fonts");
const captionedPath = path.join(tmpDir, "cut-captioned.mp4");

await burnCaptions(outPath, assPath, fontsDir, captionedPath);

outPath = captionedPath;
}

console.log(`[perf] cut captions: ${Date.now() - tCap}ms`);
} catch (err) {
console.error("[cut captions] falhou, seguindo sem legenda:", err);
}
}

  const outBuffer = await readFile(outPath);
  try {
    const uploaded = await put(`renders/viralcut-cut-${jobId}.mp4`, outBuffer, {
      access: "public",
      contentType: "video/mp4",
    });
    return NextResponse.json({ ok: true, url: uploaded.url });
  } catch (e) {
    if (process.env.NODE_ENV === "production") throw e;
    console.warn("[cut] Vercel Blob sem token no local — salvando em /public/renders:", e);

const publicDir = path.join(process.cwd(), "public", "renders");
await mkdir(publicDir, { recursive: true });

const publicName = `viralcut-cut-${jobId}.mp4`;
const publicPath = path.join(publicDir, publicName);

await copyFile(outPath, publicPath);

return NextResponse.json({
ok: true,
url: `/renders/${publicName}`,
local: true,
});
  }
}

export async function POST(req: NextRequest) {
  const jobId = randomUUID();
  const tmpDir = path.join(os.tmpdir(), "viralcut-renders", jobId);
  const blobUrlsToDelete: string[] = [];

  try {
    const form = await req.formData();

    // (Fase 16A.5.2) Branch de corte preciso. Aditivo e isolado: se mode !== "cut",
    // NADA abaixo muda (comportamento atual idêntico). Reaproveita concatClips e put.
    if (String(form.get("mode") || "") === "cut") {
      return await handleCutMode(form, jobId, tmpDir);
    }

    const autoCutOn = form.get("autoCut") === "1";
    const oneClickViralOn = form.get("oneClickViral") === "1";
    
    // (Fase 15E.1) Melhorar áudio automaticamente
const improveAudio = form.get("improveAudio") === "1";

    const overlayAI = buildVideoOverlayAI(
String(form.get("aiHook") || ""),
String(form.get("aiStyle") || ""),
String(form.get("aiSubtitle") || ""),
String(form.get("aiCTA") || "")
);

console.log("[overlayAI]", overlayAI);
    
const autoCutSourceDuration = Number(form.get("autoCutSourceDuration") || 0);

    const imageFiles: File[] = [];
    const videoFiles: File[] = [];
    for (const [key, value] of form.entries()) {
      if (key.startsWith("image") && value instanceof File && value.size > 0) {
        imageFiles.push(value);
      }
      if (key.startsWith("video") && value instanceof File && value.size > 0) {
      videoFiles.push(value);
      }
    }
    const videoUrls: string[] = [];
    for (const [key, value] of form.entries()) {
      if (key.startsWith("videoUrl") && typeof value === "string" && value.trim()) {
        videoUrls.push(value.trim());
      }
    }
console.log("[render] videoUrls =", videoUrls);
console.log("[render] imageFiles =", imageFiles.length);
console.log("[render] form keys =", [...form.keys()]);
    if (imageFiles.length === 0 && videoUrls.length === 0 && videoFiles.length === 0) {
      return NextResponse.json(
        { ok: false, jobId, error: "Nenhuma mídia recebida." },
        { status: 400 }
      );
    }

    let duration = Number(form.get("duration") || 30);
    if (!ALLOWED_DURATIONS.includes(duration)) duration = 30;
    const smartEdit = String(form.get("smartEdit") || "") === "1";
    // Legendas automáticas (Fase 11A): apenas 15s/30s nesta fase
const captionsRequested = String(form.get("captions") || "") === "1";
const rawCaptionStyle = String(form.get("captionStyle") || "classico");
const captionStyle: CaptionStyle =
rawCaptionStyle === "karaoke" || rawCaptionStyle === "boxed"
? rawCaptionStyle
: "classico";

const captionsActive = captionsRequested && (duration === 15 || duration === 30);


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
      for (let i = 0; i < videoFiles.length; i++) {
      const rawPath = path.join(tmpDir, `uploaded-video-${i + 1}.mp4`);
      const buf = Buffer.from(await videoFiles[i].arrayBuffer());

      if (buf.byteLength > MAX_VIDEO_BYTES) {
      console.warn("[render] vídeo enviado acima do limite, ignorado");
continue;
}

await writeFile(rawPath, buf);
const hdr = await probeIsHDR(rawPath);
clips.push({ type: "video", file: rawPath, hdr });
}

    // vídeos -> baixa do Blob, detecta HDR, vira clipe de vídeo
    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i];
      if (!isAllowedBlobUrl(url)) {
        console.warn("[render] URL de vídeo rejeitada (host inválido):", url);
        continue;
      }
      blobUrlsToDelete.push(url);
      let resp: Response | null = null;

for (let attempt = 0; attempt < 10; attempt++) {
resp = await fetch(url);

if (resp.ok) break;

console.warn(
`[render] tentativa ${attempt + 1}/10 falhou:`,
resp.status
);

await new Promise((r) => setTimeout(r, 1000));
}

if (!resp || !resp.ok) {
console.warn("[render] falha ao baixar vídeo:", url);
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

    // AutoCut (Fase 9): expande 1 vídeo em N segmentos distribuídos
let clipsForRender = clips;
if ((autoCutOn || oneClickViralOn) && autoCutSourceDuration > 0 && clips.length === 1 && clips[0].type === "video") {
  
  if (REELS_ORCHESTRATOR_ON) {
      // === Fase 18.8 — Orquestrador invisível (flag REELS_ORCHESTRATOR=1) ===
      // Mesmos flags, MESMA ordem e MESMA I/O condicional do fluxo validado.
      // words/silences extraídos UMA vez aqui e repassados ao buildReelsPlan.
      const viralOn = process.env.VIRAL_SCORE === "1";
      const snapOn = process.env.AUTOCUT_SNAP !== "0";
      const guardOn = process.env.AUTOCUT_SPEECH_GUARD !== "0";
      // planCut só "aplica" quando a fonte é maior que o alvo — mesma condição
      // que hoje dispara a I/O nos branches viral/snap. Vídeo curto = passthrough:
      // zero transcrição e zero silêncio, igual ao fluxo atual (velocidade preservada).
      const willCut = autoCutSourceDuration > duration;

      let vsWords: WordTiming[] = [];
      if (viralOn && willCut) {
        try {
          const vsAudioPath = path.join(tmpDir, "viralscore-audio.m4a");
          await extractAudioForCaptions(clips[0].file, vsAudioPath);
          vsWords = await transcribeWords(vsAudioPath, { language: "pt" });
        } catch (e) {
          console.log(`[orchestrator] transcrição viral falhou: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    
      let silences: SilenceInterval[] = [];
      if (snapOn && willCut) {
        try {
          silences = await detectSilences(clips[0].file);
        } catch (e) {
          console.log(`[orchestrator] detectSilences falhou: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const plan = buildReelsPlan({
        sourceDuration: autoCutSourceDuration,
        targetDuration: duration,
        words: vsWords,
        silences,
        viralSelection: viralOn,
        snap: snapOn,
        speechGuard: guardOn,
      });
      const segs = plan.segments;
      console.log(
        `[orchestrator] ON viral=${viralOn} snap=${snapOn} guard=${guardOn} ` +
          `words=${vsWords.length} silences=${silences.length} segmentos=${segs.length}`
      );

      if (segs.length > 1) {
        clipsForRender = segs.map((s) => ({
          ...clips[0],
          start: s.start,
        }));
      }
    } else {
      // === Fluxo validado (Fase 9–15A) — INALTERADO (caminho de rollback) ===
      const plan = planCut(autoCutSourceDuration, duration, 5);
  
    let segs = Array.isArray(plan) ? plan : plan.segments;
    
  // Fase 15A — Viral Score (ativar: VIRAL_SCORE=1; default OFF)
  const viralOn = process.env.VIRAL_SCORE === "1";
  if (viralOn && segs && segs.length > 1) {
    try {
      const tVs = Date.now();
      const vsAudioPath = path.join(tmpDir, "viralscore-audio.m4a");
      await extractAudioForCaptions(clips[0].file, vsAudioPath);
      const vsWords = await transcribeWords(vsAudioPath, { language: "pt" });
      if (vsWords.length > 0) {
        const ranked = rankCandidates(vsWords, autoCutSourceDuration, segs);
        console.log(
          `[viral-score] on palavras=${vsWords.length} segmentos=${ranked.length} t=${Date.now() - tVs}ms`
        );
        segs = ranked;
      } else {
        console.log("[viral-score] 0 palavras; mantendo plano V2");
      }
    } catch (e) {
      console.log(`[viral-score] fallback V2: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!viralOn) {
    console.log("[viral-score] off (VIRAL_SCORE!=1)");
  }

  // Fase 11A.1 — Snap por Silêncio (rollback: AUTOCUT_SNAP=0)
 
const snapOn = process.env.AUTOCUT_SNAP !== "0";
if (!snapOn) {
console.log("[autocut-snap] off (AUTOCUT_SNAP=0)");
} else if (segs && segs.length > 1) {
try {
const tSnap = Date.now();
const silences = await detectSilences(clips[0].file);
const snapped = snapSegmentsToSilences(segs, silences, autoCutSourceDuration, { maxShift: 1.2 });
const moved = snapped.filter((s, i) => s.start !== segs[i].start).length;
console.log(
`[autocut-snap] on silencios=${silences.length} movidos=${moved}/${segs.length} t=${Date.now() - tSnap}ms`
);
segs = snapped;

// Fase 14B.1.1 — Speech Guard (rollback: AUTOCUT_SPEECH_GUARD=0)
const guardOn = process.env.AUTOCUT_SPEECH_GUARD !== "0";
if (guardOn) {
  const guarded = alignSegmentEndsToSilences(segs, silences, autoCutSourceDuration, { maxShift: 0.9 });
  const ajustados = guarded.filter((s, idx) => s.start !== segs[idx].start).length;
  console.log(`[speech-guard] on ajustados=${ajustados}/${segs.length}`);
  segs = guarded;
} else {
  console.log("[speech-guard] off (AUTOCUT_SPEECH_GUARD=0)");
}
} catch (e) {
console.log(`[autocut-snap] fallback V2: ${e instanceof Error ? e.message : String(e)}`);
}
}

  if (segs && segs.length > 1) {
   clipsForRender = segs.map((s) => ({
...clips[0],
start: s.start ?? s.offset ?? 0,
end: s.end,
}));
    console.log(`[autocut] ${segs.length} segmentos planejados`);
  }
}
}
// 1) render principal: bake de cada clipe + concat demuxer
const baseVideo = path.join(tmpDir, "video.mp4");
const tRender = Date.now(); // PR 10.1
await renderVideo(baseVideo, clipsForRender, duration, smartEdit, tmpDir);

let videoWithHook = baseVideo;

console.log(`[perf] total-render: ${Date.now() - tRender}ms`); // PR 10.1

    // 2) legenda opcional (Fase 5)
    const caption = sanitizeCaption(String(form.get("caption") || overlayAI.subtitle || ""));
    let videoForMusic = videoWithHook;
    

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
await mixBackgroundMusic(videoForMusic, musicPath, withMusicPath, improveAudio);
}
        if (existsSync(withMusicPath)) deliverPath = withMusicPath;
      } catch (e) {
        console.error("[render] falha ao adicionar música; vídeo sem áudio:", e);
      }
    }

    // ---------- Legendas automáticas (Fase 11A) ----------
    if (captionsActive) {
      try {
        const tCap = Date.now();
        const asrAudioPath = path.join(tmpDir, "captions-audio.m4a");
        // áudio pré-música (voz limpa para o ASR); timeline idêntica à do deliverPath
        await extractAudioForCaptions(videoForMusic, asrAudioPath);

        const words = await transcribeWords(asrAudioPath, { language: "pt" });
        console.log(`[captions] palavras transcritas: ${words.length}`);

        if (words.length > 0) {
          const assPath = path.join(tmpDir, "captions.ass");
          await writeFile(
            assPath,
            buildCaptionsAss(words, {
              style: captionStyle,
              width: 1080,
              height: 1920,
              fontName: "DejaVu Sans",
            }),
            "utf8"
          );

          const fontsDir = path.join(process.cwd(), "assets", "fonts");
          const captionedPath = path.join(tmpDir, "captioned.mp4");
          await burnCaptions(deliverPath, assPath, fontsDir, captionedPath);
          await copyFile(captionedPath, deliverPath);
        }
        console.log(`[perf] captions: ${Date.now() - tCap}ms`);
      } catch (err) {
        console.error("[captions] falhou, seguindo sem legenda:", err);
      }
    }
    // ------------------------------------------------------

       // sobe o MP4 final ao Vercel Blob e devolve a URL (evita "Load failed" no
    // iOS por segurar conexão longa + baixar binário grande inline).
    const videoBuffer = await readFile(deliverPath);

try {
const tBlob = Date.now();
const uploaded = await put(`renders/viralcut-${jobId}.mp4`, videoBuffer, {
access: "public",
contentType: "video/mp4",
});

console.log(`[perf] blob-upload: ${Date.now() - tBlob}ms`);
return NextResponse.json({ ok: true, url: uploaded.url });
} catch (e) {
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
}
}
}
