// Fase 18.G.2
// Ponte entre One Click Viral e AutoCut.
// NÃO corta vídeo.
// NÃO renderiza.
// NÃO altera o AutoCut atual.

import { DirectorSegment } from "./directorAutoCut";
import { buildOneClickViral } from "./oneClickViral";
import { DirectorMomentInput } from "./directorAutoCut";

export type OneClickAutoCutResult = {
shouldAutoCut: boolean;
totalSegments: number;
segments: DirectorSegment[];
};

export function buildOneClickAutoCut(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickAutoCutResult {
const result = buildOneClickViral(moments, {
targetDuration,
});

return {
shouldAutoCut: result.hasSegment,
totalSegments: result.totalSegments,
segments: result.segments,
};
}
