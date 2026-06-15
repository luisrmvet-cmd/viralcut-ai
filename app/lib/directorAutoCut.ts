// app/lib/directorAutoCut.ts
// Fase 18.F.2 — Ponte isolada entre Director IA e AutoCut.
// NÃO corta vídeo. NÃO renderiza. NÃO mexe em upload, login, render ou AutoCut.
// Apenas transforma momentos do Director em segmentos candidatos.

export type DirectorMomentInput = {
seconds?: number;
time?: string;
type?: string;
viralScore?: number;
score?: number;
chance?: string;
reason?: string;
snippet?: string;
};

export type DirectorSegment = {
start: number;
end: number;
type: string;
viralScore: number;
reason?: string;
snippet?: string;
};

function safeNumber(value: unknown, fallback = 0): number {
return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function chooseDirectorSegments(
moments: DirectorMomentInput[],
targetDuration: number
): DirectorSegment[] {
const duration = Math.max(5, safeNumber(targetDuration, 15));

return moments
.map((moment) => {
const start = Math.max(0, safeNumber(moment.seconds, 0));
const viralScore = safeNumber(moment.viralScore, safeNumber(moment.score, 0));

return {
start,
end: start + Math.min(6, duration),
type: moment.type || "momento",
viralScore,
reason: moment.reason,
snippet: moment.snippet,
};
})
.filter((segment) => segment.viralScore > 0)
.sort((a, b) => b.viralScore - a.viralScore)
.reduce<DirectorSegment[]>((selected, segment) => {
const total = selected.reduce((sum, item) => sum + (item.end - item.start), 0);

if (total >= duration) return selected;

const hasOverlap = selected.some((item) => {
return segment.start < item.end && segment.end > item.start;
});

if (!hasOverlap) {
selected.push(segment);
}

return selected;
}, [])
.sort((a, b) => a.start - b.start);

}
