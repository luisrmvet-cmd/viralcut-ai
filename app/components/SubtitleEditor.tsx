// app/components/SubtitleEditor.tsx
// Fase 2 — Editor de Legendas Profissional (shell + preview + lista).
// CLIENT component isolado: sem backend, sem API, sem FFmpeg, sem ASS.
// Não toca render, AutoCut, Reel Viral, Hook+Título, CaptionControls, música.
// "Aplicar" é inerte nesta fase.

"use client";

import { useMemo, useState } from "react";

interface SubtitleEditorProps {
  open: boolean;
  videoUrl: string | null;
  subtitles: any[];
  onChange: (subs: any[]) => void;
  onClose: () => void;
}

// Leitura tolerante das legendas antigas (não muta o estado do pai).
function readText(raw: any): string {
  if (typeof raw?.text === "string") return raw.text;
  if (typeof raw?.caption === "string") return raw.caption;
  if (typeof raw?.word === "string") return raw.word;
  return "";
}
function readNum(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : fallback;
}
function readStart(raw: any): number {
  return readNum(raw?.start ?? raw?.startTime, 0);
}
function readEnd(raw: any, start: number): number {
  return readNum(raw?.end ?? raw?.endTime, start + 2);
}
function fmt(t: number): string {
  const s = Math.max(0, t);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}`;
}

export default function SubtitleEditor({
  open,
  videoUrl,
  subtitles,
  onChange,
  onClose,
}: SubtitleEditorProps) {
  // onChange já faz parte do contrato desta fase (usado plenamente na próxima).
  // Referência inofensiva evita warning de prop não usada em lint estrito.
  
  
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const list = useMemo(
    () => (Array.isArray(subtitles) ? subtitles : []),
    [subtitles]
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(8,10,14,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)",
          height: "min(720px, 92vh)",
          background: "#0f1116",
          color: "#E8EAED",
          borderRadius: 12,
          border: "1px solid #23262d",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        {/* Barra superior */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid #23262d",
          }}
        >
          <strong style={{ fontSize: 15 }}>Editor de Legendas</strong>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled
              title="Disponível na próxima fase"
              style={{
                background: "#2a2f3a",
                color: "#8b8f98",
                border: "1px solid #333842",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 13,
                cursor: "not-allowed",
              }}
            >
              Aplicar (disponível na próxima fase)
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                color: "#E8EAED",
                border: "1px solid #333842",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Fechar
            </button>
          </div>
        </div>

        {/* Corpo: lista | preview | propriedades */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Painel esquerdo — lista */}
          <div
            style={{
              width: 260,
              borderRight: "1px solid #23262d",
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            {list.length === 0 ? (
              <div style={{ padding: 16, color: "#8b8f98", fontSize: 13 }}>
                Nenhuma legenda carregada ainda.
              </div>
            ) : (
              list.map((raw, i) => {
                const start = readStart(raw);
                const end = readEnd(raw, start);
                const text = readText(raw);
                return (
                  <div
                  key={raw?.id ?? i}
                  onClick={() => setSelectedIndex(i)}
                  role="button"
                  style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid #191b21",
                  cursor: "pointer",
                  background:
                  selectedIndex === i ? "rgba(59,130,246,0.18)" : "transparent",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#8b8f98" }}>
                      {fmt(start)} → {fmt(end)}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {text || "(vazio)"}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Painel central — preview */}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              minWidth: 0,
            }}
          >
            <div
              style={{
                position: "relative",
                height: "100%",
                aspectRatio: "9 / 16",
                maxWidth: "100%",
                background: "#000",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#8b8f98",
                    fontSize: 13,
                  }}
                >
                  Sem vídeo para pré-visualizar
                </div>
              )}
            </div>
          </div>

          {/* Painel direito — propriedades (preparado, ainda vazio) */}
          <div
            style={{
              width: 280,
              borderLeft: "1px solid #23262d",
              padding: 16,
              overflowY: "auto",
              color: "#8b8f98",
              fontSize: 13,
            }}
          >
           {selectedIndex === null || !list[selectedIndex] ? (
<div>Selecione uma legenda à esquerda.</div>
) : (
<div style={{ display: "grid", gap: 12 }}>
<label style={{ display: "grid", gap: 6 }}>
<span>Texto da legenda</span>

<textarea
value={readText(list[selectedIndex])}
onChange={(e) => {
const next = [...list];
next[selectedIndex] = {
...next[selectedIndex],
text: e.target.value,
word: e.target.value,
caption: e.target.value,
};
onChange(next);
}}
rows={5}
style={{
width: "100%",
resize: "vertical",
padding: 10,
borderRadius: 8,
border: "1px solid #374151",
background: "#111827",
color: "#ffffff",
}}
/>
</label>

<button
type="button"
onClick={() => {
const next = list.filter((_, index) => index !== selectedIndex);
onChange(next);
setSelectedIndex(null);
}}
style={{
padding: "10px 12px",
borderRadius: 8,
border: "1px solid #ef4444",
background: "transparent",
color: "#fca5a5",
cursor: "pointer",
}}
>
🗑️ Apagar legenda
</button>
</div>
)}

          </div>
        </div>
      </div>
    </div>
  );
}