// app/page.tsx
"use client";

import { useState } from "react";

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
    setVideoUrl(null);
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    setVideoUrl(null);

    if (files.length === 0) {
      setError("Selecione pelo menos uma imagem.");
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach((file, i) => fd.append(`image${i + 1}`, file));

      const res = await fetch("/api/render", { method: "POST", body: fd });

      // Lê como texto primeiro: assim, se o backend devolver HTML de erro,
      // mostramos a causa real em vez de quebrar no JSON.parse.
      const contentType = res.headers.get("content-type") || "";

if (!res.ok || contentType.includes("application/json")) {
const text = await res.text();
throw new Error(text);
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
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
        ViralCut AI — Gerar vídeo vertical
      </h1>

      <input
        type="file"
        accept="image/*"
        multiple
        onChange={onPick}
        disabled={loading}
        style={{ display: "block", marginBottom: 16 }}
      />

      {files.length > 0 && (
        <p style={{ marginBottom: 16, color: "#555" }}>
          {files.length} imagem(ns) selecionada(s).
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || files.length === 0}
        style={{
          padding: "10px 20px",
          fontSize: 16,
          fontWeight: 600,
          borderRadius: 8,
          border: "none",
          cursor: loading ? "not-allowed" : "pointer",
          background: loading ? "#999" : "#111",
          color: "#fff",
        }}
      >
        {loading ? "Gerando vídeo..." : "Gerar MP4"}
      </button>

      {error && (
        <p
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: "#fde8e8",
            color: "#9b1c1c",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </p>
      )}

      {videoUrl && (
        <div style={{ marginTop: 24 }}>
          <video
            src={videoUrl}
            controls
            style={{ width: "100%", borderRadius: 12, background: "#000" }}
          />
          <a
            href={videoUrl}
            download="viralcut.mp4"
            style={{
              display: "inline-block",
              marginTop: 12,
              fontWeight: 600,
              color: "#111",
            }}
          >
            ⬇ Baixar MP4
          </a>
        </div>
      )}
    </main>
  );
}
