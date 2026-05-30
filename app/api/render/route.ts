// app/api/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// FFmpeg exige runtime Node (não Edge) e execução dinâmica.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // segundos (limite depende do seu plano Vercel)

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

const ALLOWED_DURATIONS = [15, 30, 45, 60];
const FPS = 30;
const ZOOM = 0.12; // intensidade do zoom (suave)

// === Fase 3: biblioteca de músicas (seleção por categoria) ===
const MUSIC_DIR = path.join(process.cwd(), "public", "music");
// Allowlist categoria -> arquivo (NUNCA usar o valor do cliente direto no path)
const MUSIC_FILES: Record<string, string> = {
  cinematic: "cinematic.mp3",
  motivational: "motivational.mp3",
  happy: "happy.mp3",
  emotional: "emotional.mp3",
  viral: "viral.mp3",
};
const DEFAULT_MUSIC = "cinematic";
const MUSIC_VOLUME = 0.15; // 15%

// === Fase 5: legenda no vídeo (drawtext) ===
// Fonte vai no bundle via outputFileTracingIncludes (ver next.config.ts).
// process.cwd() = raiz do projeto no `next dev` e na função serverless da Vercel.
const CAPTION_FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const CAPTION_MAX_LEN = 120; // frase curta
const CAPTION_WRAP = 22; // ~caracteres por linha (evita estourar a largura 1080)

/**
 * Monta os parâmetros do zoompan para cada efeito, alternando por imagem:
 *  - 0: zoom in leve     - 1: zoom out leve     - 2: pan/zoom lateral suave
 * `d1` = (frames - 1), usado para normalizar a animação de 0 a 1.
 * Importante: as expressões NÃO usam vírgula (a vírgula separa filtros na
 * filtergraph), por isso usamos progressão linear com `on` em vez de min()/max().
 */
function zoompanForEffect(effect: number, d1: number): string {
  const centerX = "x='iw/2-(iw/zoom/2)'";
  const centerY = "y='ih/2-(ih/zoom/2)'";
  switch (effect) {
    case 0: // zoom in
      return `z='1+${ZOOM}*on/${d1}':${centerX}:${centerY}`;
    case 1: // zoom out
      return `z='${1 + ZOOM}-${ZOOM}*on/${d1}':${centerX}:${centerY}`;
    default: // 2: pan lateral (zoom fixo, desloca na horizontal)
      return `z='${1 + ZOOM}':x='(iw-iw/zoom)*on/${d1}':${centerY}`;
  }
}

/**
 * Distribui `total` frames entre `n` imagens de forma que a SOMA seja
 * exatamente `total` (sem erro de arredondamento na duração final).
 */
function distributeFrames(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  let rem = total - base * n;
  return Array.from({ length: n }, () => {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem--;
    return base + extra;
  });
}

/**
 * Gera o vídeo vertical 1080x1920 com efeito Ken Burns por imagem.
 * Cada imagem vira um clipe (filter_complex) e todos são unidos com concat.
 */
function renderVideo(
  dir: string,
  outputPath: string,
  count: number,
  secondsPerImage: number,
  totalSeconds: number
): Promise<void> {
  const totalFrames = Math.round(totalSeconds * FPS);
  const framesPerImage = distributeFrames(totalFrames, count);

  const command = ffmpeg();
  for (let i = 0; i < count; i++) {
    command.input(path.join(dir, `${i + 1}.png`)); // cada imagem = 1 frame de entrada
  }

  // Monta a filtergraph: uma cadeia por imagem + concat final.
  const chains: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = framesPerImage[i];
    const d1 = Math.max(d - 1, 1); // evita divisão por zero
    const zp = zoompanForEffect(i % 3, d1);
    chains.push(
      `[${i}:v]` +
        // encaixa em 1080x1920 sem distorcer + fundo preto
        `scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,` +
        // upscale 2x antes do zoompan reduz tremor
        `scale=2160:3840,` +
        `zoompan=${zp}:d=${d}:s=1080x1920:fps=${FPS},` +
        `format=yuv420p[v${i}]`
    );
  }
  const concatInputs = Array.from({ length: count }, (_, i) => `[v${i}]`).join("");
  const filterGraph =
    chains.join(";") + `;${concatInputs}concat=n=${count}:v=1:a=0[outv]`;

  return new Promise((resolve, reject) => {
    command
      .complexFilter(filterGraph)
      .outputOptions([
        "-map", "[outv]",
        "-r", String(FPS),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
      ])
      .on("start", (cmd) => console.log("[render] ffmpeg cmd:", cmd))
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(outputPath);
  });
}

/**
 * Fase 5 — passo ISOLADO de legenda, executado APÓS o render visual e ANTES da
 * música. Grava a frase no vídeo via drawtext. Re-encoda o vídeo (drawtext
 * altera pixels — não dá `-c:v copy` aqui). NÃO toca em renderVideo nem em
 * mixBackgroundMusic.
 *
 * Decisões à prova de bug (validadas em render real):
 *  - `textfile=`: a frase vai num arquivo, então `:` `'` e acentos no TEXTO
 *    não precisam de escape no filtergraph.
 *  - `expansion=none`: trata `%` e `%{...}` como texto literal (senão o `%`
 *    quebra o filtro).
 *  - wrapCaption: quebra em linhas de ~22 chars para não estourar a largura.
 *  - escapamos apenas os CAMINHOS (`:` -> `\:`) do fontfile/textfile.
 */
function sanitizeCaption(raw: string): string {
  return (raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CAPTION_MAX_LEN);
}

function wrapCaption(text: string, maxPerLine = CAPTION_WRAP): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxPerLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

async function drawCaption(
  videoPath: string,
  caption: string,
  outPath: string,
  tmpDir: string
): Promise<void> {
  const textFilePath = path.join(tmpDir, "caption.txt");
  await writeFile(textFilePath, wrapCaption(caption), "utf8");

  const escPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
  const filter =
    `drawtext=fontfile='${escPath(CAPTION_FONT)}':` +
    `textfile='${escPath(textFilePath)}':` +
    `expansion=none:` +
    `fontcolor=white:fontsize=60:line_spacing=12:` +
    `box=1:boxcolor=black@0.55:boxborderw=24:` +
    `x=(w-text_w)/2:y=h-text_h-180`;

  console.log("[caption] aplicando legenda:", JSON.stringify(caption));
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .videoFilters(filter)
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
      ])
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(outPath);
  });
}

/**
 * Fase 2B — passo ISOLADO de áudio, executado APÓS o render visual.
 * Faz loop da música, aplica volume 15% e copia o vídeo SEM re-renderizar
 * (rápido, não re-processa os frames). `-shortest` corta no fim do vídeo,
 * então a música toca o vídeo inteiro e repete se for mais curta.
 */
function mixBackgroundMusic(
  videoPath: string,
  musicPath: string,
  outPath: string
): Promise<void> {
  console.log("[mix] videoPath=", videoPath);
  console.log("[mix] musicPath=", musicPath);
  console.log("[mix] outPath=", outPath);
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .inputOptions(["-stream_loop", "-1"]) // loop infinito da música
      .complexFilter(`[1:a]volume=${MUSIC_VOLUME}[a]`)
      .outputOptions([
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy", // NÃO re-renderiza o vídeo
        "-c:a", "aac",
        "-shortest",
      ])
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(outPath);
  });
}

export async function POST(req: NextRequest) {
  const jobId = randomUUID();
  const tmpDir = path.join(os.tmpdir(), "viralcut-renders", jobId);

  try {
    const form = await req.formData();

    const files: File[] = [];
    for (const [key, value] of form.entries()) {
      // só entradas image* são fotos; "musicFile" (Fase 4) NÃO entra aqui
      if (key.startsWith("image") && value instanceof File && value.size > 0) {
        files.push(value);
      }
    }
    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, jobId, error: "Nenhuma imagem recebida." },
        { status: 400 }
      );
    }

    // duração: aceita SOMENTE 15/30/45/60; senão 30
    let duration = Number(form.get("duration") || 30);
    if (!ALLOWED_DURATIONS.includes(duration)) duration = 30;
    const secondsPerImage = duration / files.length;

    console.log(
      `[render] jobId=${jobId} | duration=${duration}s | imagens=${files.length} | ` +
        `segPorImagem=${secondsPerImage}`
    );

    await mkdir(tmpDir, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      const buffer = Buffer.from(await files[i].arrayBuffer());
      await writeFile(path.join(tmpDir, `${i + 1}.png`), buffer);
    }

    const outputPath = path.join(tmpDir, "video.mp4");
    await renderVideo(tmpDir, outputPath, files.length, secondsPerImage, duration);

    // === Fase 5: legenda opcional — etapa ISOLADA, entre o render e a música ===
    // Sem frase (ou sem fonte no bundle) => videoForMusic = outputPath, ou seja,
    // o fluxo fica IDÊNTICO ao já validado. Falha na legenda não quebra o vídeo.
    const caption = sanitizeCaption(String(form.get("caption") || ""));
    let videoForMusic = outputPath;
    if (caption && existsSync(CAPTION_FONT)) {
      const captionedPath = path.join(tmpDir, "video-caption.mp4");
      try {
        await drawCaption(outputPath, caption, captionedPath, tmpDir);
        if (existsSync(captionedPath)) videoForMusic = captionedPath;
      } catch (e) {
        console.error("[render] falha ao aplicar legenda; seguindo sem legenda:", e);
      }
    } else if (caption && !existsSync(CAPTION_FONT)) {
      console.warn("[render] legenda solicitada mas fonte não encontrada em", CAPTION_FONT);
    }

    // Fase 4: música própria enviada tem PRIORIDADE; biblioteca é o fallback
    const uploadedMusic = form.get("musicFile");
    let musicPath: string;
    if (uploadedMusic instanceof File && uploadedMusic.size > 0) {
      const customPath = path.join(tmpDir, "custom-music.mp3");
      await writeFile(customPath, Buffer.from(await uploadedMusic.arrayBuffer()));
      musicPath = customPath;
      console.log("[render] música enviada pelo usuário:", uploadedMusic.size, "bytes");
    } else {
      // Fase 3: biblioteca via allowlist (default = cinematic)
      const requestedMusic = String(form.get("musicKey") || DEFAULT_MUSIC);
      const safeMusicKey = MUSIC_FILES[requestedMusic] ? requestedMusic : DEFAULT_MUSIC;
      musicPath = path.join(MUSIC_DIR, MUSIC_FILES[safeMusicKey]);
      console.log("[render] musicKey=", safeMusicKey, "file=", MUSIC_FILES[safeMusicKey]);
    }

    // Fase 2B: adiciona música de fundo se existir (senão, vídeo normal)
    // (Fase 5) a música agora consome `videoForMusic` — o vídeo COM legenda,
    // se houver; senão é o próprio outputPath. mixBackgroundMusic NÃO muda.
    let deliverPath = videoForMusic;
    if (existsSync(musicPath)) {
      const withMusicPath = path.join(tmpDir, "video-music.mp4");
      try {
        await mixBackgroundMusic(videoForMusic, musicPath, withMusicPath);
        if (existsSync(withMusicPath)) deliverPath = withMusicPath;
      } catch (e) {
        // se a mixagem falhar, entrega o vídeo SEM música
        console.error("[render] falha ao adicionar música; vídeo sem áudio:", e);
      }
    }

    const videoBuffer = await readFile(deliverPath);
    return new NextResponse(new Uint8Array(videoBuffer), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(videoBuffer.length),
        "Content-Disposition": `attachment; filename="viralcut-${jobId}.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[render] ERRO:", err);
    return NextResponse.json(
      {
        ok: false,
        jobId,
        error: err instanceof Error ? err.message : "Falha ao gerar o vídeo.",
      },
      { status: 500 }
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
