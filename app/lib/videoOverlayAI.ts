export interface VideoOverlayAI {
introHook: string;
introStyle: string;
subtitle: string;
outroCTA: string;
}

export function buildVideoOverlayAI(
hook: string,
style: string,
legenda: string,
cta: string
): VideoOverlayAI {
return {
introHook: hook,
introStyle: style,
subtitle: legenda,
outroCTA: cta,
};
}