import { buildOneClickVideoClipReal } from "../oneClickVideoClipReal";

const moments = [
{
seconds: 4,
type: "Autoridade",
viralScore: 92,
reason: "Trecho importante",
snippet: "Isso é muito importante.",
},
{
seconds: 8,
type: "Dor",
viralScore: 88,
reason: "Animal pode piorar",
snippet: "Pode piorar rapidamente.",
},
{
seconds: 20,
type: "Curiosidade",
viralScore: 75,
reason: "Pouca gente sabe disso",
snippet: "Pouca gente sabe disso.",
},
];

const result = buildOneClickVideoClipReal(
moments,
30
);

console.log("One Click Video Clip Real:");
console.table(result.clips);

console.log(
"shouldCut:",
result.shouldCut
);
