// app/lib/transitions.ts  (Fase 6 + extensão opcional na Fase 7)
export const FPS = 30;
const ZOOM = 0.12;

export type MotionEffect = "kenBurns" | "zoomIn" | "zoomOut" | "panLeftRight" | "panRightLeft";

export const MOTION_PALETTE: MotionEffect[] = ["kenBurns","zoomIn","zoomOut","panLeftRight","panRightLeft"];
export function motionForIndex(i: number): MotionEffect { return MOTION_PALETTE[i % MOTION_PALETTE.length]; }

export function motionExpr(effect: MotionEffect, d1: number): string {
  const cx = "x='iw/2-(iw/zoom/2)'"; const cy = "y='ih/2-(ih/zoom/2)'";
  switch (effect) {
    case "zoomIn": return `z='1+${ZOOM}*on/${d1}':${cx}:${cy}`;
    case "zoomOut": return `z='${1+ZOOM}-${ZOOM}*on/${d1}':${cx}:${cy}`;
    case "panLeftRight": return `z='${1+ZOOM}':x='(iw-iw/zoom)*on/${d1}':${cy}`;
    case "panRightLeft": return `z='${1+ZOOM}':x='(iw-iw/zoom)*(1-on/${d1})':${cy}`;
    case "kenBurns": default: return `z='1+${ZOOM}*on/${d1}':${cx}:y='(ih-ih/zoom)*on/${d1}'`;
  }
}

export function clipChain(inputIndex: number, label: string, effect: MotionEffect, frames: number): string {
  const d1 = Math.max(frames - 1, 1);
  return `[${inputIndex}:v]scale=1080:1920:force_original_aspect_ratio=decrease,`+
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,scale=2160:3840,`+
    `zoompan=${motionExpr(effect, d1)}:d=${frames}:s=1080x1920:fps=${FPS},`+
    `format=yuv420p,setpts=PTS-STARTPTS[${label}]`;
}

export function transitionDuration(totalSeconds: number, count: number): number {
  if (count < 2) return 0;
  const baseClip = totalSeconds / count;
  return Math.max(0.2, Math.min(0.6, baseClip * 0.35));
}
export function fadeDuration(totalSeconds: number): number { return Math.min(0.5, totalSeconds * 0.1); }

export function framesPerImage(totalSeconds: number, count: number, fps = FPS): number[] {
  const t = transitionDuration(totalSeconds, count);
  const clipsSeconds = totalSeconds + (count - 1) * t;
  const total = Math.round(clipsSeconds * fps);
  const base = Math.floor(total / count); let rem = total - base * count;
  return Array.from({ length: count }, () => { const e = rem > 0 ? 1 : 0; if (rem>0) rem--; return base + e; });
}

// (Fase 7) parâmetro opcional `transitions` — default ["fade"] = comportamento da Fase 6
export function xfadeChain(
  clipLabels: string[], framesArr: number[], totalSeconds: number, count: number,
  fps = FPS, transitions: string[] = ["fade"]
): { chains: string[]; lastLabel: string } {
  if (clipLabels.length === 1) return { chains: [], lastLabel: clipLabels[0] };
  const t = transitionDuration(totalSeconds, count);
  const durs = framesArr.map((f) => f / fps);
  const chains: string[] = []; let prev = clipLabels[0]; let acc = 0;
  for (let j = 1; j < clipLabels.length; j++) {
    acc += durs[j - 1];
    const offset = (acc - j * t).toFixed(4);
    const tr = transitions[(j - 1) % transitions.length];
    const out = j === clipLabels.length - 1 ? "xlast" : `x${j}`;
    chains.push(`[${prev}][${clipLabels[j]}]xfade=transition=${tr}:duration=${t.toFixed(4)}:offset=${offset}[${out}]`);
    prev = out;
  }
  return { chains, lastLabel: prev };
}

export function fadeChain(inLabel: string, totalSeconds: number, outLabel = "outv"): string {
  const fd = fadeDuration(totalSeconds); const st = (totalSeconds - fd).toFixed(4);
  return `[${inLabel}]fade=t=in:st=0:d=${fd.toFixed(4)},fade=t=out:st=${st}:d=${fd.toFixed(4)}[${outLabel}]`;
}

/* ============================================================
 * Fase 13A — Crossfade fixo 0.25s entre clipes (flag transitions)
 * Bloco aditivo. Não altera nada da Fase 6 acima.
 * ============================================================ */

import { spawn as spawn13A } from "child_process";

const FADE_13A = 0.25;

function run13A(bin: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const proc = spawn13A(bin, args);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      console.log(`[perf] ${label}: ${Date.now() - t0}ms`);
      if (code === 0) resolve();
      else reject(new Error(`${label} exit ${code}: ${err.slice(-800)}`));
    });
  });
}

// Sondagem via `ffmpeg -i` (exit code != 0 é esperado; lemos o stderr).
function probe13A(ffmpegBin: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn13A(ffmpegBin, ["-hide_banner", "-i", file]);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", () => resolve(err));
  });
}

function parseDuration13A(stderr: string, file: string): number {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`13A: duração não encontrada em ${file}`);
  const d = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  if (!isFinite(d) || d <= 0) throw new Error(`13A: duração inválida em ${file}`);
  return d;
}

export async function concatClipsWithCrossfade(
  clipPaths: string[],
  outPath: string,
  tmpDir: string,
  ffmpegBin: string
): Promise<void> {
  if (clipPaths.length < 2) {
    throw new Error("13A: crossfade requer 2+ clipes"); // route.ts faz fallback
  }

  const durations: number[] = [];
  for (const p of clipPaths) {
    const info = await probe13A(ffmpegBin, p);
    if (!/Stream #\d+:\d+.*Audio:/.test(info)) {
      throw new Error(`13A: clipe sem trilha de áudio: ${p}`); // fallback
    }
    durations.push(parseDuration13A(info, p));
  }

  const parts: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    parts.push(`[${i}:v]settb=AVTB[v${i}]`);
  }

  let vPrev = "v0";
  let aPrev = "0:a";
  let cumulative = durations[0];

  for (let i = 1; i < clipPaths.length; i++) {
    const offset = Math.max(0, cumulative - FADE_13A).toFixed(3);
    parts.push(
      `[${vPrev}][v${i}]xfade=transition=fade:duration=${FADE_13A}:offset=${offset}[vx${i}]`
    );
    parts.push(`[${aPrev}][${i}:a]acrossfade=d=${FADE_13A}[ax${i}]`);
    vPrev = `vx${i}`;
    aPrev = `ax${i}`;
    cumulative += durations[i] - FADE_13A;
  }

  parts.push(`[${vPrev}]format=yuv420p[vout]`);

  const args: string[] = [];
  for (const p of clipPaths) args.push("-i", p);
  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "[vout]",
    "-map", `[${aPrev}]`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-r", String(FPS),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    outPath
  );

  await run13A(ffmpegBin, args, `crossfade-concat(${clipPaths.length} clipes)`);
}