// Fase 18.G.4
// Ponte entre One Click Video Clips e renderizador futuro.
// NÃO corta vídeo.
// NÃO chama FFmpeg.
// Apenas prepara os clips para integração futura.

import {
DirectorMomentInput,
DirectorSegment,
} from "./directorAutoCut";

import {
buildOneClickVideoClips,
} from "./oneClickVideoClips";

export type OneClickVideoRenderResult = {
shouldCut: boolean;
clips: DirectorSegment[];
};

export function buildOneClickVideoRender(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickVideoRenderResult {

const result = buildOneClickVideoClips(
moments,
targetDuration
);

return {
shouldCut: result.shouldCut,
clips: result.clips,
};
}
