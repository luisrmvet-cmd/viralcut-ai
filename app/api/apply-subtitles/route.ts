import { NextRequest, NextResponse } from "next/server";

type EditableSubtitle = {
id?: string;
text?: string;
word?: string;
caption?: string;
start?: number;
end?: number;
};

export async function POST(req: NextRequest) {
try {
const body = await req.json();

const videoUrl =
typeof body?.videoUrl === "string" ? body.videoUrl.trim() : "";

const subtitles: EditableSubtitle[] = Array.isArray(body?.subtitles)
? body.subtitles
: [];

if (!videoUrl) {
return NextResponse.json(
{
ok: false,
error: "URL do vídeo não informada.",
},
{ status: 400 }
);
}

if (subtitles.length === 0) {
return NextResponse.json(
{
ok: false,
error: "Nenhuma legenda editada foi enviada.",
},
{ status: 400 }
);
}

const normalizedSubtitles = subtitles.map((subtitle, index) => ({
id: String(subtitle.id ?? `subtitle-${index}`),
text: String(
subtitle.text ??
subtitle.word ??
subtitle.caption ??
""
),
start: Number(subtitle.start ?? 0),
end: Number(subtitle.end ?? subtitle.start ?? 0),
}));

return NextResponse.json({
ok: true,
message: "Legendas recebidas com sucesso.",
subtitleCount: normalizedSubtitles.length,
});
} catch (error) {
console.error("[apply-subtitles] erro:", error);

return NextResponse.json(
{
ok: false,
error:
error instanceof Error
? error.message
: "Erro ao receber as legendas.",
},
{ status: 500 }
);
}
}
