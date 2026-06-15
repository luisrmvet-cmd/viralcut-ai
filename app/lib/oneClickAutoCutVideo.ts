// Fase 18.G.2
// Ponte entre One Click AutoCut e videoClips futuro.
// NÃO altera o AutoCut atual.
// NÃO renderiza vídeo.
// Apenas prepara os segmentos que serão enviados ao FFmpeg.

import {
DirectorMomentInput,
DirectorSegment,
} from "./directorAutoCut";

import {
buildOneClickAutoCutBridge,
} from "./oneClickAutoCutBridge";

export type OneClickAutoCutVideoResult = {
shouldCut: boolean;
clips: DirectorSegment[];
};

export function buildOneClickAutoCutVideo(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickAutoCutVideoResult {

const result = buildOneClickAutoCutBridge(
moments,
targetDuration
);

return {
shouldCut: result.shouldAutoCut,
clips: result.segments,
};
}
