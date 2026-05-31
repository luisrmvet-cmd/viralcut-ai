// app/components/SuccessScreen.tsx
"use client";

import { useState } from "react";

type Props = {
  videoUrl: string;
  onReset: () => void;
};

export default function SuccessScreen({ videoUrl, onReset }: Props) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      // videoUrl é uma URL REMOTA (Vercel Blob). O atributo `download` é
      // ignorado em links cross-origin, então buscamos os bytes e criamos
      // um blob same-origin para forçar o download (desktop/Android).
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error("fetch-failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `viralcut-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // folga antes de revogar para não cancelar um download em andamento
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    } catch {
      // Fallback (inclui iOS/Safari, onde o download programático pode não
      // disparar): abre o vídeo numa nova aba para o usuário salvar pelo
      // menu de compartilhamento.
      window.open(videoUrl, "_blank");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.badge}>✓</div>
      <h2 style={styles.title}>Seu Reel está pronto!</h2>
      <p style={styles.subtitle}>
        Vídeo gerado com sucesso. Assista abaixo e baixe em alta qualidade.
      </p>

      <video src={videoUrl} controls playsInline style={styles.video} />

      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        style={{
          ...styles.downloadBtn,
          ...(downloading ? styles.downloadBtnDisabled : {}),
        }}
      >
        {downloading ? "Preparando download..." : "⬇  Baixar Vídeo"}
      </button>

      <button type="button" onClick={onReset} style={styles.againBtn}>
        ↺  Gerar Outro Vídeo
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    marginTop: 24,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: "22px 18px",
    borderRadius: 18,
    background:
      "radial-gradient(420px 180px at 50% 0%, rgba(34,197,94,0.10) 0%, rgba(20,20,28,0) 70%)",
    border: "1px solid rgba(34,197,94,0.18)",
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 800,
    color: "#fff",
    background: "linear-gradient(180deg, #34d399, #10b981)",
    boxShadow: "0 8px 24px rgba(16,185,129,0.45)",
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: 800,
    margin: 0,
    letterSpacing: -0.4,
    color: "#f5f5f7",
  },
  subtitle: {
    margin: "8px 0 20px",
    fontSize: 14,
    color: "#9aa0ae",
    maxWidth: 320,
    lineHeight: 1.45,
  },
  video: {
    width: "100%",
    borderRadius: 14,
    background: "#000",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  downloadBtn: {
    width: "100%",
    marginTop: 20,
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
  downloadBtnDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
    boxShadow: "none",
  },
  againBtn: {
    width: "100%",
    marginTop: 12,
    padding: "14px 0",
    fontSize: 15,
    fontWeight: 700,
    color: "#cbd5e1",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 16,
    cursor: "pointer",
    transition: "background 0.18s ease",
  },
};
