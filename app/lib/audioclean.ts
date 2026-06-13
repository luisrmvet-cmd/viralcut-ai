// app/lib/audioclean.ts
// Fase 15E.2 — Limpeza inteligente de áudio PLUS
// Modo conservador: melhora voz sem pesar muito o render.

const SOFT_CHAIN =
  "highpass=f=90,lowpass=f=12000,afftdn=nr=10:nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11";
export function buildSoftAudioCleanChain(
improveAudio: boolean | undefined
): string {
const killSwitchOn = process.env.AUDIO_CLEAN === "1";
if (!improveAudio || !killSwitchOn) return "";
return SOFT_CHAIN;
}