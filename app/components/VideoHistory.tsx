// app/components/VideoHistory.tsx
"use client";

import { useEffect, useState } from "react";
import {
  listVideos,
  getVideoBlob,
  deleteVideo,
  type VideoHistoryItem,
} from "../lib/videoHistory";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * `refreshKey` muda quando um novo vídeo é gerado, forçando a releitura
 * do histórico sem recarregar a página.
 */
export default function VideoHistory({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<VideoHistoryItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setItems(listVideos());
  }, [refreshKey]);

  async function handleDownload(item: VideoHistoryItem) {
    setBusyId(item.id);
    try {
      const blob = await getVideoBlob(item.id);
      if (!blob) {
        alert("Este vídeo não está mais disponível neste dispositivo.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(item: VideoHistoryItem) {
    await deleteVideo(item.id);
    setItems(listVideos());
  }

  return (
    <section style={styles.wrap}>
      <h2 style={styles.heading}>Histórico de vídeos</h2>

      {items.length === 0 ? (
        <p style={styles.empty}>Nenhum vídeo gerado ainda.</p>
      ) : (
        <ul style={styles.list}>
          {items.map((item) => (
            <li key={item.id} style={styles.item}>
              <div style={styles.meta}>
                <span style={styles.duration}>{item.duration}s</span>
                <span style={styles.sub}>
                  {formatDate(item.createdAt)} · {formatSize(item.size)}
                </span>
              </div>
              <div style={styles.actions}>
                <button
                  type="button"
                  onClick={() => handleDownload(item)}
                  disabled={busyId === item.id}
                  style={styles.dl}
                >
                  {busyId === item.id ? "..." : "Baixar"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  style={styles.del}
                  aria-label="Excluir do histórico"
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 28 },
  heading: { fontSize: 16, fontWeight: 700, margin: "0 0 12px", color: "#e5e5ea" },
  empty: { fontSize: 14, color: "#8b8b96", margin: 0 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px",
    background: "#15151d",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
  },
  meta: { display: "flex", flexDirection: "column", minWidth: 0 },
  duration: { fontWeight: 700, fontSize: 15, color: "#fff" },
  sub: { fontSize: 12, color: "#8b8b96" },
  actions: { display: "flex", gap: 8, flexShrink: 0 },
  dl: {
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    background: "linear-gradient(180deg, #3b82f6, #2563eb)",
  },
  del: {
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 700,
    color: "#fca5a5",
    border: "1px solid rgba(239,68,68,0.35)",
    borderRadius: 10,
    cursor: "pointer",
    background: "transparent",
  },
};
