// Fase 18.G.6
// Primeira camada do corte real.
// Ainda NÃO executa FFmpeg.
// Apenas transforma os segmentos em clips reais.

import {
DirectorMomentInput,
DirectorSegment,
} from "./directorAutoCut";

import {
buildOneClickVideoClipBridge,
} from "./oneClickVideoClipBridge";

export type OneClickVideoClipRealResult = {
shouldCut: boolean;
clips: DirectorSegment[];
};

export function buildOneClickVideoClipReal(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickVideoClipRealResult {

const result = buildOneClickVideoClipBridge(
moments,
targetDuration
);

return {
shouldCut: result.shouldCut,
clips: result.clips,
};
}
