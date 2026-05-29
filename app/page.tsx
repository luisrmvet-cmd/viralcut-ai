// app/page.tsx
"use client";

import { useState } from "react";

const DURATIONS = [15, 30, 45, 60] as const;
type Duration = (typeof DURATIONS)[number];

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [duration, setDuration] = useState<Duration>(30); // padrão: 30s
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);

    if (files.length === 0) {
      setError("Selecione pelo menos uma imagem.");
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach((file, i) => fd.append(`image${i + 1}`, file));
      // Envia a duração escolhida junto ao FormData.
      fd.append("duration", String(duration));

      const res = await fetch("/api/render", { method: "POST", body: fd });
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
      window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar imagens.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>ViralCut AI</h1>
        <p style={styles.subtitle}>Transforme suas imagens em Reels verticais</p>

        {/* Upload */}
        <label style={styles.label}>Imagens</label>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={onPick}
          disabled={loading}
          style={styles.fileInput}
        />
        {files.length > 0 && (
          <p style={styles.fileHint}>
            {files.length} imagem(ns) selecionada(s)
          </p>
        )}

        {/* Seletor de duração — estilo CapCut */}
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

        {/* Botão principal */}
        <button
          onClick={handleSubmit}
          disabled={loading || files.length === 0}
          style={{
            ...styles.cta,
            ...(loading || files.length === 0 ? styles.ctaDisabled : {}),
          }}
        >
          {loading ? "Gerando Reels..." : "Criar Reels"}
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
      </div>
    </main>
  );
}

/* ---------- estilos (tema escuro premium) ---------- */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(1200px 600px at 50% -10%, #14142b 0%, #0a0a0f 55%)",
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
  durationRow: {
    display: "flex",
    gap: 10,
    width: "100%",
  },
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
