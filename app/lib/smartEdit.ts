// app/lib/smartEdit.ts — Fase 7 (Edição Inteligente)
// Cortes sincronizados a uma grade de batidas APROXIMADA (BPM assumido) +
// paleta de transições profissionais. Puro: só calcula números/strings.
// Mantém a MESMA soma de frames do modo normal, então a duração final continua
// exata com o xfade. Se não der p/ sincronizar com segurança, cai no modo normal.
import { FPS, framesPerImage, transitionDuration } from "./transitions";

export const DEFAULT_BPM = 120; // "batidas aproximadas" (ainda sem análise de áudio)

// transições pro alternadas no modo inteligente (todas existem no ffmpeg)
export const SMART_TRANSITIONS = ["fade","slideleft","slideright","wipeleft","circleopen","smoothup"];

export function beatSyncedFrames(totalSeconds: number, count: number, bpm = DEFAULT_BPM, fps = FPS): number[] {
  const t = transitionDuration(totalSeconds, count);
  const clipsSeconds = totalSeconds + (count - 1) * t;
  const total = Math.round(clipsSeconds * fps);          // MESMO total do modo normal
  if (count <= 1) return [total];

  const beatFrames = Math.max(1, Math.round((60 / bpm) * fps));
  const totalBeats = Math.floor(total / beatFrames);
  const minSafe = Math.ceil((t + 0.15) * fps);           // clipe precisa ser > transição

  if (totalBeats < count) return framesPerImage(totalSeconds, count, fps); // fallback

  const baseBeats = Math.floor(totalBeats / count);
  let remBeats = totalBeats - baseBeats * count;
  const beatsPerClip = Array.from({ length: count }, () => {
    const e = remBeats > 0 ? 1 : 0; if (remBeats > 0) remBeats--; return baseBeats + e;
  });

  const frames = beatsPerClip.map((b) => b * beatFrames);
  const used = frames.reduce((a, b) => a + b, 0);
  frames[frames.length - 1] += total - used;             // soma exata == total

  if (Math.min(...frames) < minSafe) return framesPerImage(totalSeconds, count, fps); // fallback seguro
  return frames;
}
