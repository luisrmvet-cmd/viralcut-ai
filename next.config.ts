// next.config.ts
//
// CRÍTICO (já existente): impede o Next de empacotar o fluent-ffmpeg e o binário
// do ffmpeg-static. Sem isto, o caminho do binário aponta para dentro de .next,
// o arquivo não existe (ou perde permissão de execução) e o render falha.
//
// (Fase 5) NOVO: outputFileTracingIncludes garante que a fonte da legenda
// (assets/fonts/*) seja incluída no bundle da função serverless da Vercel.
// Sem isto, drawtext não encontra a fonte em produção e a legenda não aparece
// (em `next dev` local funciona mesmo sem este bloco).

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["fluent-ffmpeg"],

  outputFileTracingIncludes: {
    "/api/render": ["./assets/fonts/**/*"], // (Fase 5) fonte da legenda no bundle
  },
};

export default nextConfig;
