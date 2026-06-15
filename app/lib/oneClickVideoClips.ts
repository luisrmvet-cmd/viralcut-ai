// Fase 18.G.3
// Ponte entre One Click AutoCut Video e videoClips futuro.
// NÃO corta vídeo.
// NÃO altera o AutoCut atual.
// Apenas prepara os clips para integração futura.

import {
DirectorMomentInput,
DirectorSegment,
} from "./directorAutoCut";

import {
buildOneClickAutoCutVideo,
} from "./oneClickAutoCutVideo";

export type OneClickVideoClipsResult = {
shouldCut: boolean;
clips: DirectorSegment[];
};

export function buildOneClickVideoClips(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickVideoClipsResult {

const result = buildOneClickAutoCutVideo(
moments,
targetDuration
);

return {
shouldCut: result.shouldCut,
clips: result.clips,
};
}
