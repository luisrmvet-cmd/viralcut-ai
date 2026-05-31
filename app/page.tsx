// app/page.tsx
"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client"; // (Fase 8A.2) client upload p/ Vercel Blob
// (1) NOVO: histórico
import { addVideo } from "./lib/videoHistory";
import VideoHistory from "./components/VideoHistory";

const DURATIONS = [15, 30, 45, 60] as const;
type Duration = (typeof DURATIONS)[number];

// (Fase 3) Biblioteca de músicas — chave (enviada à API) + rótulo (exibido)
const MUSIC_OPTIONS = [
  { key: "cinematic", label: "Cinemática" },
  { key: "motivational", label: "Motivacional" },
  { key: "happy", label: "Alegre" },
  { key: "emotional", label: "Emocional" },
  { key: "viral", label: "Viral" },
] as const;

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.8;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_MUSIC_BYTES = 3 * 1024 * 1024; // (Fase 4) limite por MP3 (evita 413 da Vercel)
const MAX_CAPTION_LEN = 120; // (Fase 5)
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // (Fase 8A.2) por vídeo (espelha /api/upload)

const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";

type VideoItem = { file: File; thumb: string };

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode-failed"));
    };
    img.src = url;
  });
}

async function compressImage(file: File): Promise<File> {
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// (Fase 8A.1) miniatura de vídeo capturada no navegador
function makeVideoThumb(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    let done = false;
    const finish = (data: string) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(data);
    };
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
      } catch {
        finish("");
      }
    };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 240 / Math.max(v.videoWidth, v.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish("");
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        finish("");
      }
    };
    v.onerror = () => finish("");
    v.src = url;
  });
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]); // imagens
  const [videoItems, setVideoItems] = useState<VideoItem[]>([]); // vídeos
  const [duration, setDuration] = useState<Duration>(30);
  const [musicKey, setMusicKey] = useState<string>("cinematic");
  const [useOwnMusic, setUseOwnMusic] = useState(false);
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [caption, setCaption] = useState<string>("");
  const [smartEdit, setSmartEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    
    const isVideo = (f: File) => {
const name = f.name.toLowerCase();
return (
f.type.startsWith("video/") ||
name.endsWith(".mov") ||
name.endsWith(".mp4") ||
name.endsWith(".webm")
);
};

const vids = picked.filter((f) => isVideo(f));
const imgs = picked.filter((f) => !isVideo(f));

    setFiles(imgs);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setError(null);
    setStatus("");

    const tooBig = vids.filter((f) => f.size > MAX_VIDEO_BYTES);
    if (tooBig.length > 0) {
      setError("Alguns vídeos passam de 200 MB e foram ignorados.");
    }
    const okVids = vids.filter((f) => f.size <= MAX_VIDEO_BYTES);

    setVideoItems([]);
    for (const f of okVids) {
      const thumb = await makeVideoThumb(f);
      setVideoItems((prev) => [...prev, { file: f, thumb }]);
    }
  }

  function onPickMusic(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (!f) {
      setMusicFile(null);
      return;
    }
    const isMp3 = f.type === "audio/mpeg" || f.name.toLowerCase().endsWith(".mp3");
    if (!isMp3) {
      setError("Selecione um arquivo .mp3.");
      setMusicFile(null);
      return;
    }
    if (f.size > MAX_MUSIC_BYTES) {
      setError("A música excede 3 MB. Escolha um arquivo menor.");
      setMusicFile(null);
      return;
    }
    setMusicFile(f);
  }

    async function handleSubmit() {
    setError(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);

    if (files.length === 0 && videoItems.length === 0) {
      setError("Selecione pelo menos uma imagem ou vídeo.");
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();

      // imagens: otimiza e anexa (caminho idêntico ao das fases anteriores)
      if (files.length > 0) {
        setStatus("Otimizando imagens...");
        const compressed: File[] = [];
        for (let i = 0; i < files.length; i++) {
          setStatus(`Otimizando imagem ${i + 1} de ${files.length}...`);
          compressed.push(await compressImage(files[i]));
        }
        const totalBytes = compressed.reduce((s, f) => s + f.size, 0);
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new Error(
            "As imagens ainda são muito grandes mesmo após otimização. " +
              "Tente selecionar menos fotos."
          );
        }
        compressed.forEach((file, i) => fd.append(`image${i + 1}`, file));
      }

      // (Fase 8A.2) vídeos: upload direto ao Vercel Blob, envia só as URLs
      for (let i = 0; i < videoItems.length; i++) {
        setStatus(`Enviando vídeo ${i + 1} de ${videoItems.length}...`);
        const v = videoItems[i].file;
        const blob = await upload(v.name, v, {
          access: "public",
          handleUploadUrl: "/api/upload",
          contentType: v.type || "video/mp4",
        });
        fd.append(`videoUrl${i + 1}`, blob.url);
      }

      fd.append("duration", String(duration));
      if (useOwnMusic && musicFile) {
        fd.append("musicFile", musicFile);
      } else {
        fd.append("musicKey", musicKey);
      }
      if (caption.trim()) fd.append("caption", caption.trim());
      if (smartEdit) fd.append("smartEdit", "1");

      setStatus("Gerando vídeo...");
      const res = await fetch("/api/render", { method: "POST", body: fd });

      if (res.status === 413) {
        throw new Error("Upload muito grande para o servidor. Selecione menos fotos.");
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || contentType.includes("application/json")) {
        let message = `Erro HTTP ${res.status}`;
        try {
          const data = await res.json();
          message = data?.error || message;
        } catch {
          /* mantém a mensagem padrão */
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);

      try {
        await addVideo(blob, duration);
        setHistoryKey((k) => k + 1);
      } catch {
        /* falha ao salvar histórico não impede o uso do vídeo atual */
      }

      window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar a mídia.");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  const hasMedia = files.length > 0 || videoItems.length > 0;

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>ViralCut AI</h1>
        <p style={styles.subtitle}>Transforme fotos e vídeos em Reels verticais</p>

        <label style={styles.label}>Imagens e vídeos</label>
        <input
          type="file"
          accept={`image/*,${VIDEO_ACCEPT}`}
          multiple
          onChange={onPick}
          disabled={loading}
          style={styles.fileInput}
        />
        {files.length > 0 && (
          <p style={styles.fileHint}>{files.length} imagem(ns) selecionada(s)</p>
        )}

        {videoItems.length > 0 && (
          <>
            <div style={styles.thumbsRow}>
              {videoItems.map((vi, i) => (
                <div key={i} style={styles.thumb}>
                  {vi.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={vi.thumb} alt={vi.file.name} style={styles.thumbImg} />
                  ) : (
                    <div style={styles.thumbFallback}>🎬</div>
                  )}
                  <span style={styles.thumbBadge}>▶</span>
                </div>
              ))}
            </div>
            <p style={styles.fileHint}>{videoItems.length} vídeo(s) selecionado(s)</p>
          </>
        )}

        <label style={{ ...styles.label, marginTop: 22 }}>Duração do Reel</label>
        <div style={styles.durationRow}>
          {DURATIONS.map((value) => {
            const active = value === duration;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setDuration(value)}
                disabled={loading}
                aria-pressed={active}
                style={{
                  ...styles.durationBtn,
                  ...(active ? styles.durationBtnActive : styles.durationBtnIdle),
                }}
              >
                {value}s
              </button>
            );
          })}
        </div>

        <label style={{ ...styles.label, marginTop: 22 }}>Música</label>
        <select
          value={musicKey}
          onChange={(e) => setMusicKey(e.target.value)}
          disabled={loading}
          style={styles.musicSelect}
        >
          {MUSIC_OPTIONS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>

        <label style={styles.ownMusicRow}>
          <input
            type="checkbox"
            checked={useOwnMusic}
            onChange={(e) => setUseOwnMusic(e.target.checked)}
            disabled={loading}
          />
          Usar minha própria música (.mp3, até 3 MB)
        </label>
        {useOwnMusic && (
          <input
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={onPickMusic}
            disabled={loading}
            style={{ ...styles.fileInput, marginTop: 10 }}
          />
        )}
        {useOwnMusic && musicFile && (
          <p style={styles.fileHint}>
            {musicFile.name} ({(musicFile.size / (1024 * 1024)).toFixed(1)} MB)
          </p>
        )}

        <label style={{ ...styles.label, marginTop: 22 }}>
          Legenda no vídeo (opcional)
        </label>
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={MAX_CAPTION_LEN}
          placeholder="Ex.: Aproveite 50% OFF hoje"
          disabled={loading}
          style={styles.captionInput}
        />
        <p style={styles.fileHint}>
          {caption.length}/{MAX_CAPTION_LEN} — aparece na parte de baixo do vídeo
        </p>

        <label style={styles.ownMusicRow}>
          <input
            type="checkbox"
            checked={smartEdit}
            onChange={(e) => setSmartEdit(e.target.checked)}
            disabled={loading}
          />
          Edição Inteligente (cortes no ritmo + transições profissionais)
        </label>

        <button
          onClick={handleSubmit}
          disabled={loading || !hasMedia}
          style={{
            ...styles.cta,
            ...(loading || !hasMedia ? styles.ctaDisabled : {}),
          }}
        >
          {loading ? status || "Processando..." : "Criar Reels"}
        </button>

        {error && <p style={styles.error}>{error}</p>}

        {videoUrl && (
          <div style={styles.result}>
            <video src={videoUrl} controls style={styles.video} />
            <a href={videoUrl} download="viralcut.mp4" style={styles.download}>
              ⬇ Baixar MP4
            </a>
          </div>
        )}

        <VideoHistory refreshKey={historyKey} />
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(1200px 600px at 50% -10%, #14142b 0%, #0a0a0f 55%)",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "32px 16px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    color: "#f5f5f7",
  },
  card: {
    width: "100%",
    maxWidth: 460,
    background: "rgba(20, 20, 28, 0.85)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    backdropFilter: "blur(12px)",
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    margin: 0,
    letterSpacing: -0.5,
    background: "linear-gradient(90deg, #fff, #9ca3af)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  subtitle: { margin: "6px 0 24px", fontSize: 14, color: "#8b8b96" },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#b9b9c4",
    marginBottom: 10,
  },
  fileInput: {
    display: "block",
    width: "100%",
    fontSize: 14,
    color: "#cfcfd6",
    background: "#15151d",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: "10px 12px",
    boxSizing: "border-box",
  },
  fileHint: { margin: "10px 0 0", fontSize: 13, color: "#8b8b96" },
  thumbsRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  thumb: {
    position: "relative",
    width: 64,
    height: 96,
    borderRadius: 8,
    overflow: "hidden",
    background: "#0f0f16",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover" },
  thumbFallback: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
  },
  thumbBadge: {
    position: "absolute",
    right: 4,
    bottom: 4,
    fontSize: 11,
    color: "#fff",
    background: "rgba(0,0,0,0.55)",
    borderRadius: 6,
    padding: "1px 5px",
  },
  durationRow: { display: "flex", gap: 10, width: "100%" },
  durationBtn: {
    flex: 1,
    minWidth: 0,
    padding: "12px 0",
    fontSize: 15,
    fontWeight: 700,
    borderRadius: 14,
    cursor: "pointer",
    transition: "all 0.18s ease",
    border: "1px solid transparent",
  },
  durationBtnIdle: {
    background: "#1f1f29",
    color: "#9ca3af",
    borderColor: "rgba(255,255,255,0.06)",
  },
  durationBtnActive: {
    background: "linear-gradient(180deg, #3b82f6, #2563eb)",
    color: "#ffffff",
    borderColor: "#3b82f6",
    boxShadow: "0 6px 18px rgba(37, 99, 235, 0.45)",
    transform: "translateY(-1px)",
  },
  musicSelect: {
    width: "100%",
    padding: "12px",
    fontSize: 15,
    fontWeight: 600,
    color: "#fff",
    background: "#15151d",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12,
    boxSizing: "border-box",
    cursor: "pointer",
  },
  captionInput: {
    width: "100%",
    padding: "12px",
    fontSize: 15,
    color: "#fff",
    background: "#15151d",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12,
    boxSizing: "border-box",
  },
  ownMusicRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    fontSize: 13,
    color: "#b9b9c4",
    cursor: "pointer",
  },
  cta: {
    width: "100%",
    marginTop: 24,
    padding: "15px 0",
    fontSize: 16,
    fontWeight: 800,
    color: "#fff",
    border: "none",
    borderRadius: 16,
    cursor: "pointer",
    background: "linear-gradient(180deg, #3b82f6, #1d4ed8)",
    boxShadow: "0 10px 28px rgba(37, 99, 235, 0.4)",
    transition: "opacity 0.18s ease",
  },
  ctaDisabled: { opacity: 0.45, cursor: "not-allowed", boxShadow: "none" },
  error: {
    marginTop: 18,
    padding: 12,
    borderRadius: 12,
    background: "rgba(239, 68, 68, 0.12)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    color: "#fca5a5",
    fontSize: 14,
    whiteSpace: "pre-wrap",
  },
  result: { marginTop: 24 },
  video: { width: "100%", borderRadius: 14, background: "#000" },
  download: {
    display: "inline-block",
    marginTop: 12,
    fontWeight: 700,
    color: "#93c5fd",
    textDecoration: "none",
  },
};
