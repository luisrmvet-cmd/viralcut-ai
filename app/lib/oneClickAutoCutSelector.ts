// Fase 18.G.4
// Ponte entre One Click AutoCut Runner e AutoCut futuro.
// NÃO corta vídeo.
// NÃO altera o AutoCut atual.

import {
DirectorMomentInput,
DirectorSegment,
} from "./directorAutoCut";

import { runOneClickAutoCut } from "./oneClickAutoCutRunner";

export type OneClickAutoCutSelection = {
shouldAutoCut: boolean;
selectedSegments: DirectorSegment[];
};

export function selectOneClickSegments(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickAutoCutSelection {

const result = runOneClickAutoCut(
moments,
targetDuration
);

return {
shouldAutoCut: result.shouldRun,
selectedSegments: result.segments,
};
}
