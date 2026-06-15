// Fase 18.G.5
// Ponte entre One Click Video Render e videoClip.ts.
// NÃO corta vídeo.
// NÃO chama FFmpeg.
// Apenas prepara os clips para integração real futura.

import {
DirectorMomentInput,
DirectorSegment,
} from "./directorAutoCut";

import {
buildOneClickVideoRender,
} from "./oneClickVideoRender";

export type OneClickVideoClipBridgeResult = {
shouldCut: boolean;
clips: DirectorSegment[];
};

export function buildOneClickVideoClipBridge(
moments: DirectorMomentInput[],
targetDuration = 30
): OneClickVideoClipBridgeResult {
const result = buildOneClickVideoRender(
moments,
targetDuration
);

return {
shouldCut: result.shouldCut,
clips: result.clips,
};
}
