import {
chooseDirectorSegments,
chooseBestDirectorSegment,
} from "../directorAutoCut";

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

const segments = chooseDirectorSegments(moments, 30);

console.log("Director AutoCut Segments:");
console.table(segments);
const bestSegment = chooseBestDirectorSegment(moments, 15);

console.log("Best Director Segment:");
console.table(bestSegment);

