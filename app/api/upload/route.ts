// app/api/upload/route.ts — Fase 8A.2
// Emite o token de "client upload" do Vercel Blob: o navegador envia o vídeo
// DIRETO ao storage (sem passar pelo limite de ~4,5MB da função serverless).
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_CONTENT_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB por vídeo

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
      }),
      // Chamado pela Vercel quando o upload conclui. Em localhost sem túnel
      // público este callback não dispara — e tudo bem, não dependemos dele.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha no upload." },
      { status: 400 }
    );
  }
}
