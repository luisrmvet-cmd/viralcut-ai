"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

type EditorScreenProps = {
  videoUrl: string;
  onBack: () => void;
};

// (Fase 16A.2) Flag do trim. (Fase 16A.3) Flag da barra de ferramentas.
// Ambas default OFF: sem elas o editor fica idêntico à fase anterior.
const TRIM_ENABLED = process.env.NEXT_PUBLIC_EDITOR_TRIM === "1";
const TOOLBAR_ENABLED = process.env.NEXT_PUBLIC_EDITOR_TOOLBAR === "1";

// Folga mínima entre início e fim (segundos).
const MIN_GAP = 0.5;

type Tool = { id: string; label: string; icon: string };

const TOOLS: Tool[] = [
  { id: "cortar", label: "Cortar", icon: "✂️" },
  { id: "legenda", label: "Legenda", icon: "💬" },
  { id: "musica", label: "Música", icon: "🎵" },
  { id: "audio", label: "Áudio", icon: "🎙️" },
  { id: "filtros", label: "Filtros", icon: "🎨" },
  { id: "volume", label: "Volume", icon: "🔊" },
  { id: "texto", label: "Texto", icon: "🔤" },
];

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const t = Math.floor((sec * 10) % 10);
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

export default function EditorScreen({ videoUrl, onBack }: EditorScreenProps) {
  const [mounted, setMounted] = useState(false);

  // Ferramenta ativa (só usada quando a barra está ON).
  const [activeTool, setActiveTool] = useState("cortar");

  // Estado do trim
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);

  // Refs para evitar closures velhas dentro dos listeners do <video>.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startRef = useRef(0);
  const endRef = useRef(0);
  const previewingRef = useRef(false);
  const didInitRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    startRef.current = start;
  }, [start]);
  useEffect(() => {
    endRef.current = end;
  }, [end]);

  function applyDuration(d: number) {
    if (!Number.isFinite(d) || d <= 0) return;
    setDuration(d);
    if (!didInitRef.current) {
      didInitRef.current = true;
      setStart(0);
      setEnd(d);
      startRef.current = 0;
      endRef.current = d;
    }
  }

  function handleLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration;
    if (Number.isFinite(d) && d > 0) {
      applyDuration(d);
      return;
    }
    // iOS Safari às vezes reporta duration = Infinity até bufferizar.
    const onSeeked = () => {
      v.removeEventListener("seeked", onSeeked);
      try {
        v.currentTime = 0;
      } catch {}
    };
    v.addEventListener("seeked", onSeeked);
    try {
      v.currentTime = 1e6;
    } catch {}
  }

  function handleDurationChange() {
    const v = videoRef.current;
    if (!v) return;
    applyDuration(v.duration);
  }

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    if (previewingRef.current && v.currentTime >= endRef.current) {
      v.pause();
      previewingRef.current = false;
      try {
        v.currentTime = endRef.current;
      } catch {}
    }
  }

  function handleStartChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = Number(e.target.value);
    const clamped = Math.max(0, Math.min(raw, end - MIN_GAP));
    setStart(clamped);
    startRef.current = clamped;
  }

  function handleEndChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = Number(e.target.value);
    const clamped = Math.min(duration, Math.max(raw, start + MIN_GAP));
    setEnd(clamped);
    endRef.current = clamped;
  }

  function handlePreview() {
    const v = videoRef.current;
    if (!v) return;
    previewingRef.current = true;
    try {
      v.currentTime = startRef.current;
    } catch {}
    const p = v.play();
    if (p && typeof p.then === "function") {
      p.catch(() => {
        previewingRef.current = false;
      });
    }
  }

  if (!mounted) return null;

  const ready = Number.isFinite(duration) && duration > 0;
  const selected = Math.max(0, end - start);

  // Painel de corte (reutilizado tanto no modo legado quanto na barra).
  function renderTrim() {
    return (
      <div style={styles.trimPanel}>
        <div style={styles.trimGroup}>
          <label style={styles.trimLabel}>Início: {formatTime(start)}</label>
          <input
            type="range"
            min={0}
            max={ready ? duration : 0}
            step={0.1}
            value={start}
            onChange={handleStartChange}
            disabled={!ready}
            style={styles.slider}
            aria-label="Início do corte"
          />
        </div>

        <div style={styles.trimGroup}>
          <label style={styles.trimLabel}>Fim: {formatTime(end)}</label>
          <input
            type="range"
            min={0}
            max={ready ? duration : 0}
            step={0.1}
            value={end}
            onChange={handleEndChange}
            disabled={!ready}
            style={styles.slider}
            aria-label="Fim do corte"
          />
        </div>

        <div style={styles.readout}>
          Duração selecionada: <strong>{formatTime(selected)}</strong> (
          {selected.toFixed(1)}s)
        </div>

        <button
          type="button"
          onClick={handlePreview}
          disabled={!ready}
          style={{
            ...styles.previewBtn,
            ...(ready ? {} : styles.previewBtnDisabled),
          }}
        >
          ▶ Pré-visualizar corte
        </button>
      </div>
    );
  }

  function renderPlaceholder(tool: Tool) {
    return (
      <div style={styles.placeholderPanel}>
        <div style={styles.placeholderIcon}>{tool.icon}</div>
        <div style={styles.placeholderTitle}>{tool.label}</div>
        <div style={styles.placeholderSub}>Em breve</div>
      </div>
    );
  }

  // Conteúdo do painel inferior conforme a ferramenta ativa.
  function renderPanel() {
    const tool = TOOLS.find((t) => t.id === activeTool) ?? TOOLS[0];
    if (tool.id === "cortar") {
      if (TRIM_ENABLED && videoUrl) return renderTrim();
      return renderPlaceholder(tool);
    }
    return renderPlaceholder(tool);
  }

  const content = (
    <div style={styles.overlay}>
      {/* Cabeçalho fixo no topo */}
      <div style={styles.header}>
        <button
          type="button"
          onClick={onBack}
          style={styles.backButton}
          aria-label="Voltar"
        >
          ‹ Voltar
        </button>
        <span style={styles.title}>Editor</span>
        <span style={styles.headerSpacer} aria-hidden="true" />
      </div>

      {/* Preview do vídeo, centralizado */}
      <div style={styles.previewArea}>
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={handleLoadedMetadata}
            onDurationChange={handleDurationChange}
            onTimeUpdate={handleTimeUpdate}
            style={styles.video}
          />
        ) : (
          <p style={styles.emptyText}>Nenhum vídeo disponível.</p>
        )}
      </div>

      {TOOLBAR_ENABLED ? (
        <>
          {/* Barra de ferramentas (rolável na horizontal no iPhone) */}
          <div style={styles.toolbar}>
            {TOOLS.map((t) => {
              const active = t.id === activeTool;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTool(t.id)}
                  aria-pressed={active}
                  style={{
                    ...styles.toolBtn,
                    ...(active ? styles.toolBtnActive : {}),
                  }}
                >
                  <span style={styles.toolIcon}>{t.icon}</span>
                  <span style={styles.toolText}>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Painel da ferramenta ativa */}
          <div style={styles.panel}>{renderPanel()}</div>
        </>
      ) : (
        // Modo legado (16A.2): sem barra.
        <div style={styles.footer}>
          {TRIM_ENABLED && videoUrl ? (
            renderTrim()
          ) : (
            <div style={styles.toolbarPlaceholder}>Ferramentas em breve</div>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(content, document.body);
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 2147483647,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    backgroundColor: "#0d0d10",
    color: "#ffffff",
    fontFamily: "inherit",
    WebkitTapHighlightColor: "transparent",
  },
  header: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 14px",
    paddingTop: "calc(env(safe-area-inset-top) + 10px)",
    backgroundColor: "#16161b",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
  },
  backButton: {
    display: "flex",
    alignItems: "center",
    minHeight: 40,
    padding: "8px 14px",
    fontSize: 15,
    fontWeight: 700,
    color: "#ffffff",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 10,
    cursor: "pointer",
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: "#ffffff",
  },
  headerSpacer: {
    width: 88,
    flexShrink: 0,
  },
  previewArea: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    overflow: "hidden",
    backgroundColor: "#0d0d10",
  },
  video: {
    maxWidth: "100%",
    maxHeight: "100%",
    width: "auto",
    height: "auto",
    objectFit: "contain",
    borderRadius: 10,
    backgroundColor: "#000000",
  },
  emptyText: {
    color: "#9a9aa2",
    fontSize: 14,
  },
  toolbar: {
    flexShrink: 0,
    display: "flex",
    gap: 6,
    overflowX: "auto",
    padding: "8px 10px",
    backgroundColor: "#16161b",
    borderTop: "1px solid rgba(255,255,255,0.10)",
    WebkitOverflowScrolling: "touch",
  },
  toolBtn: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    minWidth: 58,
    padding: "8px 6px",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 12,
    color: "#b8b8c0",
    cursor: "pointer",
  },
  toolBtnActive: {
    color: "#ffffff",
    background: "rgba(124,58,237,0.20)",
    border: "1px solid rgba(124,58,237,0.55)",
  },
  toolIcon: {
    fontSize: 20,
    lineHeight: 1,
  },
  toolText: {
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  panel: {
    flexShrink: 0,
    padding: "14px 16px",
    paddingBottom: "calc(env(safe-area-inset-bottom) + 14px)",
    backgroundColor: "#16161b",
  },
  footer: {
    flexShrink: 0,
    padding: "14px 16px",
    paddingBottom: "calc(env(safe-area-inset-bottom) + 14px)",
    backgroundColor: "#16161b",
    borderTop: "1px solid rgba(255,255,255,0.10)",
  },
  trimPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  trimGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  trimLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#d6d6dd",
  },
  slider: {
    width: "100%",
    height: 28,
    accentColor: "#7c3aed",
    cursor: "pointer",
  },
  readout: {
    fontSize: 13,
    color: "#b8b8c0",
    textAlign: "center",
  },
  previewBtn: {
    width: "100%",
    padding: "13px 0",
    fontSize: 15,
    fontWeight: 800,
    color: "#fff",
    background: "linear-gradient(180deg, #a855f7, #7c3aed)",
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
    boxShadow: "0 8px 22px rgba(124, 58, 237, 0.4)",
  },
  previewBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
    boxShadow: "none",
  },
  placeholderPanel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    padding: "16px 12px",
    border: "1px dashed rgba(255,255,255,0.22)",
    borderRadius: 10,
    textAlign: "center",
  },
  placeholderIcon: {
    fontSize: 26,
    lineHeight: 1,
  },
  placeholderTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "#e6e6ec",
  },
  placeholderSub: {
    fontSize: 12,
    color: "#8a8a92",
    letterSpacing: 0.3,
  },
  toolbarPlaceholder: {
    border: "1px dashed rgba(255,255,255,0.22)",
    borderRadius: 10,
    padding: "18px 12px",
    textAlign: "center",
    color: "#8a8a92",
    fontSize: 13,
    letterSpacing: 0.2,
  },
};