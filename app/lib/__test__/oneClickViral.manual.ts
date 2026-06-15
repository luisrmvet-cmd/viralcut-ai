import { buildOneClickViral } from "../oneClickViral";

const moments = [
{
seconds: 4,
type: "Autoridade",
viralScore: 92,
reason: "Trecho com autoridade profissional",
snippet: "Isso aqui é muito importante para o tutor entender.",
},
{
seconds: 8,
type: "Dor",
viralScore: 88,
reason: "O animal pode piorar rápido se não tratar.",
snippet: "O animal pode piorar rápido se não tratar.",
},
{
seconds: 20,
type: "Curiosidade",
viralScore: 75,
reason: "Pouca gente sabe disso.",
snippet: "Pouca gente sabe disso.",
},
];

const result = buildOneClickViral(moments, {
targetDuration: 30,
});

console.log("One Click Viral Result:");
console.log(result);

console.log("Segments:");
console.table(result.segments);

console.log("Best Segment:");
console.table(result.bestSegment);
