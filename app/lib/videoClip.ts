// app/lib/videoClip.ts — Fase 8A.2
import { FPS } from "./transitions";

// Normaliza QUALQUER vídeo para um clipe vertical 1080x1920 de EXATAMENTE
// `frames` quadros @ FPS — mesmo "slot" das imagens, então duração e a
// matemática de xfade/smart edit continuam idênticas.
export function videoClipChain(inputIndex: number, label: string, frames: number): string {
  return `[${inputIndex}:v]scale=1080:1920:force_original_aspect_ratio=decrease,`+
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS},`+
    `setpts=PTS-STARTPTS,tpad=stop=-1:stop_mode=clone,`+
    `trim=end_frame=${frames},setpts=PTS-STARTPTS,format=yuv420p[${label}]`;
}

// Evita SSRF: só baixa de URLs do Vercel Blob via https.
export function isAllowedBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}
