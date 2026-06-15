// Fase 18.G.5
// Ponte final entre o One Click Viral e o AutoCut.
// NÃO altera o AutoCut atual.
// NÃO corta vídeo.
// Apenas prepara os segmentos para integração futura.

import {
DirectorMomentInput,
DirectorSegment,
} from "./directorAutoCut";

import {
selectOneClickSegments,
} from "./oneClickAutoCutSelector";

export type OneClickAutoCutBridgeResult = {
shouldAutoCut: boolean;
segments: DirectorSegment[];
};

export function buildOneClickAutoCutBridge(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickAutoCutBridgeResult {

const result = selectOneClickSegments(
moments,
targetDuration
);

return {
shouldAutoCut: result.shouldAutoCut,
segments: result.selectedSegments,
};
}
