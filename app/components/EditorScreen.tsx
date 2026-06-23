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

// (Fase 16A.4) Legenda livre estilo CapCut: tamanho por slider e arraste livre.
const CAPTION_MIN_SIZE = 12;
const CAPTION_MAX_SIZE = 64;
const CAPTION_DEFAULT_SIZE = 22;

// (Fase 16A.5.1) Corte por segmentos — modelo de dados puramente visual por
// enquanto, mas já no formato que o FFmpeg vai consumir depois (cada trecho
// mantido vira um trim → concat). CutRange evita sombrear o tipo global Range.
type CutRange = { a: number; b: number };

// Une faixas sobrepostas/adjacentes e devolve ordenado. Puro.
function mergeRanges(ranges: CutRange[]): CutRange[] {
  const sorted = [...ranges].sort((x, y) => x.a - y.a);
  const out: CutRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.a <= last.b + 1e-3) {
      last.b = Math.max(last.b, r.b);
    } else {
      out.push({ a: r.a, b: r.b });
    }
  }
  return out;
}

// A partir de t, devolve o próximo tempo "tocável" pulando faixas removidas
// (ordenadas/mescladas), limitado por cap. Puro.
function skipForward(t: number, ranges: CutRange[], cap: number): number {
  let cur = t;
  for (const r of ranges) {
    if (cur >= r.a && cur < r.b) cur = r.b;
  }
  return Math.min(cur, cap);
}

function rangesEqual(x: CutRange, y: CutRange): boolean {
  return Math.abs(x.a - y.a) < 1e-3 && Math.abs(x.b - y.b) < 1e-3;
}

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

  // (Fase 16A.5.1) Corte por segmentos.
  const [cutMode, setCutMode] = useState<"trim" | "split">("trim");
  const [marker, setMarker] = useState(0);
  const [splitPoints, setSplitPoints] = useState<number[]>([]);
  const [removedRanges, setRemovedRanges] = useState<CutRange[]>([]);
  const [selectedRange, setSelectedRange] = useState<CutRange | null>(null);

  // (Fase 16A.5.2) Export real do corte via rota de render (mode: "cut").
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // (Fase 16A.4) Legenda livre: texto + tamanho (px) + posição (% do preview).
  // Persiste na sessão; só zera em "Limpar legenda" ou ao sair do editor.
  const [caption, setCaption] = useState("");
  const [captionSize, setCaptionSize] = useState<number>(CAPTION_DEFAULT_SIZE);
  const [captionXY, setCaptionXY] = useState({ x: 50, y: 50 });

  // Refs para evitar closures velhas dentro dos listeners do <video>.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startRef = useRef(0);
  const endRef = useRef(0);
  const previewingRef = useRef(false);
  const didInitRef = useRef(false);
  const removedRangesRef = useRef<CutRange[]>([]);

  // (Fase 16A.4) Refs do arraste da legenda.
  const previewRef = useRef<HTMLDivElement | null>(null);
  const captionBoxRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ px: 0, py: 0, x: 50, y: 50 });

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
  useEffect(() => {
    removedRangesRef.current = removedRanges;
  }, [removedRanges]);

  // (Fase 16A.4) Mantém a legenda dentro do vídeo quando o tamanho ou o texto
  // mudam (ela pode crescer e encostar na borda). Não roda durante o arraste.
  useEffect(() => {
    if (draggingRef.current) return;
    setCaptionXY((cur) => {
      const next = clampToBox(cur.x, cur.y);
      if (
        Math.abs(next.x - cur.x) < 0.01 &&
        Math.abs(next.y - cur.y) < 0.01
      ) {
        return cur;
      }
      return next;
    });
    // clampToBox só lê refs e constantes — estável na prática.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caption, captionSize]);

  function applyDuration(d: number) {
    if (!Number.isFinite(d) || d <= 0) return;
    setDuration(d);
    if (!didInitRef.current) {
      didInitRef.current = true;
      setStart(0);
      setEnd(d);
      setMarker(d / 2);
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
    if (!previewingRef.current) return;
    // (Fase 16A.5.1) pula trechos removidos → simula a junção automática.
    const ranges = removedRangesRef.current;
    for (const r of ranges) {
      if (v.currentTime >= r.a && v.currentTime < r.b) {
        try {
          v.currentTime = r.b;
        } catch {}
        break;
      }
    }
    if (v.currentTime >= endRef.current) {
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
    const startAt = skipForward(
      startRef.current,
      removedRangesRef.current,
      endRef.current
    );
    try {
      v.currentTime = startAt;
    } catch {}
    const p = v.play();
    if (p && typeof p.then === "function") {
      p.catch(() => {
        previewingRef.current = false;
      });
    }
  }

  // (Fase 16A.5.1) Helpers de segmentos (derivados — não viram estado).
  function pct(t: number) {
    const span = end - start;
    if (span <= 0) return 0;
    return Math.min(100, Math.max(0, ((t - start) / span) * 100));
  }

  function getSegments(): CutRange[] {
    if (!(end > start)) return [];
    const pts = [start, end];
    for (const p of splitPoints) {
      if (p > start + 1e-3 && p < end - 1e-3) pts.push(p);
    }
    const rounded = pts.map((p) => Math.round(p * 1000) / 1000);
    const uniq = Array.from(new Set(rounded)).sort((x, y) => x - y);
    const segs: CutRange[] = [];
    for (let i = 0; i < uniq.length - 1; i++) {
      segs.push({ a: uniq[i], b: uniq[i + 1] });
    }
    return segs;
  }

  function addSplit() {
    const m = marker;
    if (!(m > start + 0.05 && m < end - 0.05)) return;
    setSplitPoints((prev) => {
      if (prev.some((p) => Math.abs(p - m) < 0.05)) return prev;
      return [...prev, m].sort((x, y) => x - y);
    });
    setSelectedRange(null);
  }

  function deleteSelected() {
    if (!selectedRange) return;
    setRemovedRanges((prev) => mergeRanges([...prev, selectedRange]));
    setSelectedRange(null);
  }

  function restoreCuts() {
    setSplitPoints([]);
    setRemovedRanges([]);
    setSelectedRange(null);
  }

  // (Fase 16A.5.2) Trechos MANTIDOS = complemento de removedRanges dentro de
  // [start, end] (honra trim Início/Fim + exclusões). Mesma base do preview.
  function keptSegments(): { start: number; end: number }[] {
    if (!(end > start)) return [];
    const merged = mergeRanges(removedRanges);
    const segs: { start: number; end: number }[] = [];
    let cursor = start;
    for (const r of merged) {
      const a = Math.min(end, Math.max(start, r.a));
      const b = Math.min(end, Math.max(start, r.b));
      if (b <= a) continue;
      if (a > cursor + 1e-3) segs.push({ start: cursor, end: a });
      cursor = Math.max(cursor, b);
    }
    if (end - cursor > 1e-3) segs.push({ start: cursor, end });
    return segs.filter((s) => s.end - s.start > 0.05);
  }

  // (Fase 16A.5.2) Baixa/compartilha o MP4 cortado DENTRO do editor (sem tocar
  // na SuccessScreen). No iPhone tenta a folha nativa; senão, baixa/abre.
  async function saveResult(url: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], `viralcut-cortado-${Date.now()}.mp4`, {
        type: blob.type || "video/mp4",
      });
      const nav = navigator as Navigator & {
        canShare?: (data?: { files?: File[] }) => boolean;
      };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: "ViralCut AI" });
          return;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
        }
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    } catch {
      window.open(url, "_blank");
    }
  }

  async function handleExportCut() {
    if (removedRanges.length === 0) return;
    const segments = keptSegments();
    if (segments.length === 0) {
      setExportError("Nada para exportar: todos os trechos foram removidos.");
      return;
    }
    setExporting(true);
    setExportError(null);
    setResultUrl(null);
    try {
      const fd = new FormData();
      fd.append("mode", "cut");
     
      fd.append("videoUrl", videoUrl);
      fd.append("segments", JSON.stringify(segments));
      const res = await fetch("/api/render", { method: "POST", body: fd });
      const data = await res.json();
      
      if (!data?.ok || !data?.url) {
        throw new Error(data?.error || "Falha ao exportar o corte.");
      }
      setResultUrl(data.url as string);
      await saveResult(data.url as string);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Falha ao exportar.");
    } finally {
      setExporting(false);
    }
  }

  // (Fase 16A.4) Confina o CENTRO da legenda de modo que a CAIXA INTEIRA
  // permaneça dentro do previewArea (desconta metade da largura/altura do box).
  function clampToBox(xPct: number, yPct: number) {
    const prev = previewRef.current?.getBoundingClientRect();
    if (!prev || prev.width === 0 || prev.height === 0) {
      return { x: xPct, y: yPct };
    }
    let minX = 0;
    let maxX = 100;
    let minY = 0;
    let maxY = 100;
    const box = captionBoxRef.current?.getBoundingClientRect();
    if (box) {
      const halfW = (box.width / prev.width) * 50;
      const halfH = (box.height / prev.height) * 50;
      minX = halfW;
      maxX = 100 - halfW;
      minY = halfH;
      maxY = 100 - halfH;
      if (minX > maxX) minX = maxX = 50;
      if (minY > maxY) minY = maxY = 50;
    }
    return {
      x: Math.min(maxX, Math.max(minX, xPct)),
      y: Math.min(maxY, Math.max(minY, yPct)),
    };
  }

  function onCaptionPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    dragStartRef.current = {
      px: e.clientX,
      py: e.clientY,
      x: captionXY.x,
      y: captionXY.y,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }

  function onCaptionPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const prev = previewRef.current?.getBoundingClientRect();
    if (!prev || prev.width === 0 || prev.height === 0) return;
    const dxPct = ((e.clientX - dragStartRef.current.px) / prev.width) * 100;
    const dyPct = ((e.clientY - dragStartRef.current.py) / prev.height) * 100;
    setCaptionXY(
      clampToBox(dragStartRef.current.x + dxPct, dragStartRef.current.y + dyPct)
    );
  }

  function onCaptionPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }

  if (!mounted) return null;

  const ready = Number.isFinite(duration) && duration > 0;
  const selected = Math.max(0, end - start);

  // Painel de corte por trim (reutilizado no modo "Início/Fim" e no legado).
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

  // (Fase 16A.5.1) Painel "Dividir": timeline em segmentos selecionáveis.
  function renderSplit() {
    if (!ready) {
      return <div style={styles.readout}>Carregando vídeo…</div>;
    }
    const segments = getSegments();
    const merged = mergeRanges(removedRanges);
    const isRemoved = (seg: CutRange) =>
      merged.some((r) => r.a <= seg.a + 1e-3 && r.b >= seg.b - 1e-3);
    const keptDur = segments.reduce(
      (acc, s) => acc + (isRemoved(s) ? 0 : s.b - s.a),
      0
    );
    const canDivide =
      marker > start + 0.05 &&
      marker < end - 0.05 &&
      !splitPoints.some((p) => Math.abs(p - marker) < 0.05);
    const canDelete = !!selectedRange && !isRemoved(selectedRange);
    const canRestore = splitPoints.length > 0 || removedRanges.length > 0;

    return (
      <div style={styles.splitWrap}>
        <div style={styles.trimGroup}>
          <label style={styles.trimLabel}>
            Ponto de divisão: {formatTime(marker)}
          </label>
          <input
            type="range"
            min={start}
            max={end}
            step={0.1}
            value={marker}
            onChange={(e) =>
              setMarker(
                Math.min(end, Math.max(start, Number(e.target.value)))
              )
            }
            style={styles.slider}
            aria-label="Ponto de divisão"
          />
        </div>

        <div style={styles.timeline}>
          {segments.map((seg, i) => {
            const removed = isRemoved(seg);
            const isSel = !!selectedRange && rangesEqual(selectedRange, seg);
            return (
              <button
                key={`${seg.a}-${seg.b}-${i}`}
                type="button"
                onClick={() => setSelectedRange(isSel ? null : seg)}
                disabled={removed}
                aria-label={`Trecho ${formatTime(seg.a)} a ${formatTime(
                  seg.b
                )}`}
                style={{
                  ...styles.segment,
                  left: `${pct(seg.a)}%`,
                  width: `${Math.max(0, pct(seg.b) - pct(seg.a))}%`,
                  ...(removed ? styles.segmentRemoved : {}),
                  ...(isSel ? styles.segmentSelected : {}),
                }}
              />
            );
          })}
          {splitPoints
            .filter((p) => p > start && p < end)
            .map((p, i) => (
              <div
                key={`mk-${i}`}
                style={{ ...styles.timelineMarker, left: `${pct(p)}%` }}
              />
            ))}
          <div
            style={{ ...styles.timelinePlayhead, left: `${pct(marker)}%` }}
          />
        </div>

        <div style={styles.readout}>
          {selectedRange ? (
            <>
              Trecho selecionado:{" "}
              <strong>
                {formatTime(selectedRange.a)}–{formatTime(selectedRange.b)}
              </strong>
            </>
          ) : (
            <>
              Mantido: <strong>{formatTime(keptDur)}</strong> de{" "}
              {formatTime(end - start)}
            </>
          )}
        </div>

        <p style={styles.cutHint}>
          “Dividir aqui” cria pontos; toque num trecho para selecioná-lo.
        </p>

        <div style={styles.splitActions}>
          <button
            type="button"
            onClick={addSplit}
            disabled={!canDivide}
            style={{
              ...styles.splitBtn,
              ...(canDivide ? {} : styles.splitBtnDisabled),
            }}
          >
            ✂ Dividir aqui
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!canDelete}
            style={{
              ...styles.deleteBtn,
              ...(canDelete ? {} : styles.splitBtnDisabled),
            }}
          >
            🗑 Excluir trecho selecionado
          </button>
          <button
            type="button"
            onClick={restoreCuts}
            disabled={!canRestore}
            style={{
              ...styles.splitBtn,
              ...(canRestore ? {} : styles.splitBtnDisabled),
            }}
          >
            ↺ Restaurar cortes
          </button>
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

        {removedRanges.length > 0 && (
          <div style={styles.exportWrap}>
            <button
              type="button"
              onClick={handleExportCut}
              disabled={exporting}
              style={{
                ...styles.exportBtn,
                ...(exporting ? styles.splitBtnDisabled : {}),
              }}
            >
              {exporting ? "Exportando…" : "⬇ Exportar MP4 com cortes"}
            </button>
            {exportError && <p style={styles.exportError}>{exportError}</p>}
            {resultUrl && (
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.resultLink}
              >
                Abrir vídeo cortado
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  // (Fase 16A.5.1) Wrapper do Cortar: seletor de modo + corpo do modo ativo.
  function renderCutPanel() {
    return (
      <div style={styles.cutPanel}>
        <div style={styles.cutModeRow}>
          <button
            type="button"
            onClick={() => setCutMode("trim")}
            aria-pressed={cutMode === "trim"}
            style={{
              ...styles.cutModeBtn,
              ...(cutMode === "trim" ? styles.cutModeBtnActive : {}),
            }}
          >
            Início/Fim
          </button>
          <button
            type="button"
            onClick={() => setCutMode("split")}
            aria-pressed={cutMode === "split"}
            style={{
              ...styles.cutModeBtn,
              ...(cutMode === "split" ? styles.cutModeBtnActive : {}),
            }}
          >
            Dividir
          </button>
        </div>
        {cutMode === "trim" ? renderTrim() : renderSplit()}
      </div>
    );
  }

  // (Fase 16A.4) Painel da Legenda livre: texto + slider de tamanho + ações.
  function renderCaptionPanel() {
    return (
      <div style={styles.captionPanel}>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Digite a legenda..."
          rows={2}
          style={styles.captionInput}
          aria-label="Texto da legenda"
        />

        <div style={styles.captionRow}>
          <label style={styles.captionRowLabel}>
            Tamanho: {captionSize}px
          </label>
          <input
            type="range"
            min={CAPTION_MIN_SIZE}
            max={CAPTION_MAX_SIZE}
            step={1}
            value={captionSize}
            onChange={(e) => setCaptionSize(Number(e.target.value))}
            style={styles.slider}
            aria-label="Tamanho da legenda"
          />
        </div>

        <p style={styles.captionHint}>
          Arraste a legenda no preview para posicionar.
        </p>

        <div style={styles.captionBtnRow}>
          <button
            type="button"
            onClick={() => setCaptionXY({ x: 50, y: 50 })}
            style={styles.centerBtn}
          >
            Centralizar legenda
          </button>
          <button
            type="button"
            onClick={() => setCaption("")}
            disabled={caption.length === 0}
            style={{
              ...styles.clearBtn,
              ...(caption.length === 0 ? styles.clearBtnDisabled : {}),
            }}
          >
            Limpar legenda
          </button>
        </div>
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
      if (TRIM_ENABLED && videoUrl) return renderCutPanel();
      return renderPlaceholder(tool);
    }
    if (tool.id === "legenda") {
      return renderCaptionPanel();
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
      <div ref={previewRef} style={styles.previewArea}>
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

        {/* (Fase 16A.4) Overlay da legenda. O wrapper é pointerEvents:none
            (controles do vídeo passam por baixo); só o box é arrastável. */}
        {videoUrl && caption.trim() !== "" && (
          <div style={styles.captionOverlay}>
            <div
              ref={captionBoxRef}
              style={{
                ...styles.captionBox,
                left: `${captionXY.x}%`,
                top: `${captionXY.y}%`,
                fontSize: captionSize,
              }}
              onPointerDown={onCaptionPointerDown}
              onPointerMove={onCaptionPointerMove}
              onPointerUp={onCaptionPointerUp}
              onPointerCancel={onCaptionPointerUp}
            >
              {caption}
            </div>
          </div>
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
    position: "relative",
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
  captionOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    overflow: "hidden",
  },
  captionBox: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    maxWidth: "86%",
    padding: "6px 12px",
    borderRadius: 8,
    background: "rgba(0,0,0,0.42)",
    color: "#ffffff",
    fontWeight: 800,
    lineHeight: 1.25,
    textAlign: "center",
    textShadow: "0 2px 6px rgba(0,0,0,0.95)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    pointerEvents: "auto",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    cursor: "grab",
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
  cutPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  cutModeRow: {
    display: "flex",
    gap: 6,
  },
  cutModeBtn: {
    flex: 1,
    padding: "9px 0",
    fontSize: 13,
    fontWeight: 700,
    color: "#b8b8c0",
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 10,
    cursor: "pointer",
  },
  cutModeBtnActive: {
    color: "#ffffff",
    background: "rgba(124,58,237,0.20)",
    border: "1px solid rgba(124,58,237,0.55)",
  },
  splitWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  timeline: {
    position: "relative",
    width: "100%",
    height: 44,
    background: "#0d0d10",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 8,
    overflow: "hidden",
  },
  segment: {
    position: "absolute",
    top: 0,
    bottom: 0,
    padding: 0,
    margin: 0,
    background: "rgba(124,58,237,0.14)",
    border: "1px solid rgba(255,255,255,0.18)",
    cursor: "pointer",
  },
  segmentSelected: {
    background: "rgba(124,58,237,0.45)",
    border: "1px solid #a855f7",
    zIndex: 2,
  },
  segmentRemoved: {
    background:
      "repeating-linear-gradient(45deg, rgba(239,68,68,0.30), rgba(239,68,68,0.30) 6px, rgba(239,68,68,0.12) 6px, rgba(239,68,68,0.12) 12px)",
    border: "1px solid rgba(239,68,68,0.5)",
    cursor: "not-allowed",
  },
  timelineMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    background: "#a855f7",
    transform: "translateX(-1px)",
    pointerEvents: "none",
    zIndex: 3,
  },
  timelinePlayhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    background: "rgba(255,255,255,0.85)",
    transform: "translateX(-1px)",
    pointerEvents: "none",
    zIndex: 3,
  },
  cutHint: {
    margin: 0,
    fontSize: 12,
    color: "#8a8a92",
    textAlign: "center",
  },
  splitActions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  splitBtn: {
    width: "100%",
    padding: "11px 0",
    fontSize: 14,
    fontWeight: 700,
    color: "#e6e6ec",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 12,
    cursor: "pointer",
  },
  splitBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  deleteBtn: {
    width: "100%",
    padding: "11px 0",
    fontSize: 14,
    fontWeight: 800,
    color: "#fca5a5",
    background: "rgba(239,68,68,0.10)",
    border: "1px solid rgba(239,68,68,0.40)",
    borderRadius: 12,
    cursor: "pointer",
  },
  exportWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 4,
    paddingTop: 12,
    borderTop: "1px solid rgba(255,255,255,0.10)",
  },
  exportBtn: {
    width: "100%",
    padding: "13px 0",
    fontSize: 15,
    fontWeight: 800,
    color: "#fff",
    background: "linear-gradient(180deg, #34d399, #10b981)",
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
    boxShadow: "0 8px 22px rgba(16,185,129,0.35)",
  },
  exportError: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.4,
    color: "#fca5a5",
    textAlign: "center",
  },
  resultLink: {
    display: "inline-block",
    fontSize: 14,
    fontWeight: 700,
    color: "#93c5fd",
    textDecoration: "underline",
    textAlign: "center",
  },
  captionPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  captionInput: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: 48,
    padding: "10px 12px",
    fontSize: 15,
    lineHeight: 1.35,
    color: "#ffffff",
    background: "#0d0d10",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 10,
    fontFamily: "inherit",
  },
  captionRow: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  captionRowLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#d6d6dd",
  },
  captionHint: {
    margin: 0,
    fontSize: 12,
    color: "#8a8a92",
    textAlign: "center",
  },
  captionBtnRow: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  centerBtn: {
    width: "100%",
    padding: "12px 0",
    fontSize: 14,
    fontWeight: 700,
    color: "#e6e6ec",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 12,
    cursor: "pointer",
  },
  clearBtn: {
    width: "100%",
    padding: "12px 0",
    fontSize: 14,
    fontWeight: 800,
    color: "#fca5a5",
    background: "rgba(239,68,68,0.10)",
    border: "1px solid rgba(239,68,68,0.40)",
    borderRadius: 12,
    cursor: "pointer",
  },
  clearBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
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
