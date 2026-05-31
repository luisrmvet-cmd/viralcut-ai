// app/lib/videoClip.ts — Fase 8A.2 (+ fix vídeo de iPhone/HEVC/HDR/MOV)
import { FPS } from "./transitions";

// VFs do passo SEPARADO de normalização (rodado ANTES do render misto):
// SDR/comum -> encaixa em 1080x1920 e força yuv420p.
export const NORMALIZE_VF_SDR =
  "scale=1080:1920:force_original_aspect_ratio=decrease," +
  "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p";

// HDR (HLG/PQ — ex.: iPhone "HDR Video") -> tonemap para bt709 antes de encaixar.
// Usa zscale+tonemap (presentes em builds completos do ffmpeg-static). Se não
// houver, o backend cai automaticamente no NORMALIZE_VF_SDR.
export const NORMALIZE_VF_HDR =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709," +
  "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p," +
  "scale=1080:1920:force_original_aspect_ratio=decrease," +
  "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1";

// Cadeia de UM clipe de vídeo (já normalizado) para o slot de `frames` quadros.
// Como o clipe normalizado já é 1080x1920/yuv420p/30fps, scale/pad aqui são
// idempotentes (segurança p/ o xfade). tpad clona o último quadro se a fonte
// for mais curta que o slot; trim corta no exato.
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
