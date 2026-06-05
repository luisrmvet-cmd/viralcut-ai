// app/lib/videoClip.ts — Fase 8A.2 (+ fix iPhone/HEVC/HDR + uniformização p/ xfade)
import { FPS } from "./transitions";

// VFs do passo SEPARADO de normalização (rodado ANTES do render misto):
export const NORMALIZE_VF_SDR =
  "scale=1080:1920:force_original_aspect_ratio=decrease," +
  "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p";

export const NORMALIZE_VF_HDR =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709," +
  "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p," +
  "scale=1080:1920:force_original_aspect_ratio=decrease," +
  "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1";
// ---------- Fase 12 — Blur Fill (selecionado no route.ts via flag BLUR_FILL) ----------
// Fundo = a própria mídia cobrindo 1080x1920, borrada e escurecida ~20%.
// Cobertura calculada em baixa resolução (108x192) para custo mínimo de CPU.
const BLUR_BG_SMALL = "108:192"; // resolução de trabalho do fundo
const BLUR_SIGMA = 6;            // intensidade do gaussian blur
const BLUR_DARKEN = 0.8;         // fator de escurecimento (~20%)

const BLUR_FILL_CORE =
  "split=2[bf_bg][bf_fg];" +
  `[bf_bg]scale=${BLUR_BG_SMALL}:force_original_aspect_ratio=increase,` +
  `crop=${BLUR_BG_SMALL},gblur=sigma=${BLUR_SIGMA},lutyuv=y=val*${BLUR_DARKEN},` +
  "scale=1080:1920:flags=fast_bilinear[bf_bgout];" +
  "[bf_fg]scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2[bf_fgout];" +
  "[bf_bgout][bf_fgout]overlay=(W-w)/2:(H-h)/2:format=yuv420,setsar=1";

export const BLUR_FILL_VF_SDR = `format=yuv420p,${BLUR_FILL_CORE},format=yuv420p`;

export const BLUR_FILL_VF_HDR =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709," +
  "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p," +
  BLUR_FILL_CORE;
/**
 * (Fix) Prep aplicado a TODO clipe (imagem OU vídeo) imediatamente antes do
 * xfade, garantindo que ambos os streams sejam IDÊNTICOS: mesmo SAR, fps,
 * pixel format e MESMO timebase (settb=AVTB) + PTS zerado. O xfade aborta
 * (ffmpeg code 234) quando os dois lados divergem em timebase/fps — o que
 * acontecia ao fundir o clipe de imagem (zoompan) com o de vídeo (tpad/trim).
 */
export const XFADE_PREP =
  `setsar=1,fps=${FPS},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS`;

/**
 * Cadeia de UM clipe de vídeo (já normalizado) para o slot de `frames` quadros.
 * tpad clona o último quadro se a fonte for mais curta que o slot; trim corta.
 * A uniformização final fica a cargo do XFADE_PREP (aplicado em renderVideo).
 */
export function videoClipChain(inputIndex: number, label: string, frames: number): string {
  return `[${inputIndex}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS},` +
    `setpts=PTS-STARTPTS,tpad=stop=-1:stop_mode=clone,` +
    `trim=end_frame=${frames},setpts=PTS-STARTPTS,format=yuv420p[${label}]`;
}

// Evita SSRF: só baixa de URLs https do Vercel Blob.
export function isAllowedBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}
