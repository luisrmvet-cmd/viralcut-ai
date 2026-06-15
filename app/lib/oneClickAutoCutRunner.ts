// Fase 18.G.3
// Runner isolado do One Click AutoCut.
// NÃO corta vídeo.
// NÃO altera AutoCut.
// Apenas prepara os segmentos para integração futura.

import {
DirectorMomentInput,
DirectorSegment,
} from "./directorAutoCut";

import { buildOneClickAutoCut } from "./oneClickAutoCut";

export type OneClickAutoCutRunnerResult = {
shouldRun: boolean;
totalSegments: number;
segments: DirectorSegment[];
};

export function runOneClickAutoCut(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickAutoCutRunnerResult {
const result = buildOneClickAutoCut(
moments,
targetDuration
);

return {
shouldRun: result.shouldAutoCut,
totalSegments: result.totalSegments,
segments: result.segments,
};
}
