// Fase 18.G.1
// Ponte isolada para o One Click Viral.
// NÃO corta vídeo.
// NÃO renderiza.
// NÃO altera AutoCut.
// Apenas prepara os dados para o fluxo futuro.

import {
DirectorMomentInput,
buildOneClickDirectorInput,
} from "./directorAutoCut";

export type OneClickViralInput = {
targetDuration?: number;
};

export type OneClickViralResult = {
hasSegment: boolean;
totalSegments: number;
bestSegment: ReturnType<
typeof buildOneClickDirectorInput
>["bestSegment"];
segments: ReturnType<
typeof buildOneClickDirectorInput
>["segments"];
};

export function buildOneClickViral(
moments: DirectorMomentInput[],
options: OneClickViralInput = {}
): OneClickViralResult {
const targetDuration = options.targetDuration ?? 30;

const result = buildOneClickDirectorInput(
moments,
targetDuration
);

return {
hasSegment: result.hasSegment,
totalSegments: result.totalSegments,
bestSegment: result.bestSegment,
segments: result.segments,
};
}
