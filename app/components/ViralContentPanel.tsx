"use client";

// Fase 15B.1 — Painel de Hook + Título IA.
// Reusa o upload validado (@vercel/blob/client + /api/upload). 1ª geração sobe
// o vídeo e transcreve (Modo A); "Gerar de novo" usa só o transcript em cache
// (Modo B), sem reupload e sem retranscrição. Componente isolado: não altera
// SuccessScreen, histórico, download nem o fluxo de render.

import { useState } from "react";
import { upload } from "@vercel/blob/client";

interface ViralContent {
angulo: string;

hooks: string[];

titulosInstagram: string[];
titulosTikTok: string[];
titulosShorts: string[];

legenda: string;

ctaComentarios: string;
ctaCompartilhamento: string;
ctaSeguidores: string;

hashtags: string[];

coverTitle: string;
coverSubtitle: string;
coverStyle: string;

}

export default function ViralContentPanel({
videoFile,
onContent,
}: {
videoFile: File;
onContent?: (content: ViralContent) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<ViralContent | null>(null);
  const [transcript, setTranscript] = useState<string>(""); // cache p/ regenerar
  const [copied, setCopied] = useState<string | null>(null);

  async function generateFromVideo() {
    setError(null);
    setLoading(true);
    try {
      setStatus("Enviando vídeo para análise...");
      const blob = await upload(videoFile.name, videoFile, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: videoFile.type || "video/mp4",
      });
      setStatus("Transcrevendo e gerando...");
      const res = await fetch("/api/viral-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: blob.url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Erro HTTP ${res.status}`);
      setTranscript(typeof data.transcript === "string" ? data.transcript : "");
      setContent(data.content as ViralContent);
      onContent?.(data.content as ViralContent);

    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao gerar.");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  async function regenerate() {
    if (!transcript) return generateFromVideo();
    setError(null);
    setLoading(true);
    try {
      setStatus("Gerando novas opções...");
      const res = await fetch("/api/viral-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Erro HTTP ${res.status}`);
      setContent(data.content as ViralContent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao regenerar.");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(text);
        setTimeout(() => setCopied(null), 1200);
      },
      () => {}
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Hook + Título IA</span>
        {content && <span style={styles.angle}>ângulo: {content.angulo}</span>}
      </div>

      {!content && (
        <button
          onClick={generateFromVideo}
          disabled={loading}
          style={{ ...styles.cta, ...(loading ? styles.ctaDisabled : {}) }}
        >
          {loading ? status || "Processando..." : "Gerar Hook + Título com IA"}
        </button>
      )}

      {content && (
        <>
          <p style={styles.sectionLabel}>Hooks (primeiros 3 segundos)</p>
          {content.hooks.map((h, i) => (
            <div key={`h${i}`} style={styles.item}>
              <span style={styles.itemText}>{h}</span>
              <button onClick={() => copy(h)} style={styles.copyBtn}>
                {copied === h ? "✓" : "copiar"}
              </button>
            </div>
          ))}

          <p style={{ ...styles.sectionLabel, marginTop: 14 }}>Títulos Instagram</p>
{content.titulosInstagram.map((t, i) => (
<div key={`ig${i}`} style={styles.item}>
<span style={styles.itemText}>{t}</span>
<button onClick={() => copy(t)} style={styles.copyBtn}>
{copied === t ? "✓" : "copiar"}
</button>
</div>
))}

<p style={{ ...styles.sectionLabel, marginTop: 14 }}>Títulos TikTok</p>
{content.titulosTikTok.map((t, i) => (
<div key={`tt${i}`} style={styles.item}>
<span style={styles.itemText}>{t}</span>
<button onClick={() => copy(t)} style={styles.copyBtn}>
{copied === t ? "✓" : "copiar"}
</button>
</div>
))}

<p style={{ ...styles.sectionLabel, marginTop: 14 }}>Títulos Shorts</p>
{content.titulosShorts.map((t, i) => (
<div key={`shorts${i}`} style={styles.item}>
<span style={styles.itemText}>{t}</span>
<button onClick={() => copy(t)} style={styles.copyBtn}>
{copied === t ? "✓" : "copiar"}
</button>
</div>
))}

<p style={{ ...styles.sectionLabel, marginTop: 14 }}>Capa IA</p>

<div style={styles.item}>
<span style={styles.itemText}>
{content.coverTitle}
</span>
<button
onClick={() => copy(content.coverTitle)}
style={styles.copyBtn}
>
{copied === content.coverTitle ? "✓" : "copiar"}
</button>
</div>

<div style={styles.item}>
<span style={styles.itemText}>
{content.coverSubtitle}
</span>
<button
onClick={() => copy(content.coverSubtitle)}
style={styles.copyBtn}
>
{copied === content.coverSubtitle ? "✓" : "copiar"}
</button>
</div>

<div style={styles.item}>
<span style={styles.itemText}>
Estilo: {content.coverStyle}
</span>
<button
onClick={() => copy(content.coverStyle)}
style={styles.copyBtn}
>
{copied === content.coverStyle ? "✓" : "copiar"}
</button>
</div>


<p style={{ ...styles.sectionLabel, marginTop: 14 }}>Legenda</p>

<div style={styles.item}>
<span style={styles.itemText}>{content.legenda}</span>
<button
onClick={() => copy(content.legenda)}
style={styles.copyBtn}
>
{copied === content.legenda ? "✓" : "copiar"}
</button>
</div>

<p style={{ ...styles.sectionLabel, marginTop: 14 }}>CTA Comentários</p>

<div style={styles.item}>
<span style={styles.itemText}>{content.ctaComentarios}</span>
<button onClick={() => copy(content.ctaComentarios)} style={styles.copyBtn}>
{copied === content.ctaComentarios ? "✓" : "copiar"}
</button>
</div>

<p style={{ ...styles.sectionLabel, marginTop: 14 }}>CTA Compartilhamento</p>

<div style={styles.item}>
<span style={styles.itemText}>{content.ctaCompartilhamento}</span>
<button onClick={() => copy(content.ctaCompartilhamento)} style={styles.copyBtn}>
{copied === content.ctaCompartilhamento ? "✓" : "copiar"}
</button>
</div>

<p style={{ ...styles.sectionLabel, marginTop: 14 }}>CTA Seguidores</p>

<div style={styles.item}>
<span style={styles.itemText}>{content.ctaSeguidores}</span>
<button onClick={() => copy(content.ctaSeguidores)} style={styles.copyBtn}>
{copied === content.ctaSeguidores ? "✓" : "copiar"}
</button>
</div>


<p style={{ ...styles.sectionLabel, marginTop: 14 }}>Hashtags</p>

<div style={styles.item}>
<span style={styles.itemText}>
{content.hashtags.join(" ")}
</span>
<button
onClick={() => copy(content.hashtags.join(" "))}
style={styles.copyBtn}
>
{copied === content.hashtags.join(" ") ? "✓" : "copiar"}
</button>
</div>

          <button
            onClick={regenerate}
            disabled={loading}
            style={{ ...styles.regen, ...(loading ? styles.ctaDisabled : {}) }}
          >
            {loading ? status || "Processando..." : "Gerar de novo"}
          </button>
        </>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    background: "rgba(20,20,28,0.6)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 14, fontWeight: 700, color: "#e5e7eb" },
  angle: { fontSize: 12, color: "#93c5fd", textTransform: "capitalize" },
  sectionLabel: { margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "#9ca3af" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    marginBottom: 6,
    borderRadius: 10,
    background: "#15151d",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  itemText: { flex: 1, fontSize: 13, color: "#f5f5f7", lineHeight: 1.4 },
  copyBtn: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    color: "#93c5fd",
    background: "transparent",
    border: "1px solid rgba(147,197,253,0.4)",
    borderRadius: 8,
    padding: "4px 8px",
    cursor: "pointer",
  },
  cta: {
    width: "100%",
    padding: "12px 0",
    fontSize: 14,
    fontWeight: 700,
    color: "#fff",
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
    background: "linear-gradient(180deg, #3b82f6, #1d4ed8)",
  },
  regen: {
    width: "100%",
    marginTop: 12,
    padding: "10px 0",
    fontSize: 13,
    fontWeight: 700,
    color: "#cbd5e1",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    cursor: "pointer",
    background: "transparent",
  },
  ctaDisabled: { opacity: 0.5, cursor: "not-allowed" },
  error: {
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#fca5a5",
    fontSize: 13,
  },
};