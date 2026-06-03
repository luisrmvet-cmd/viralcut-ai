// app/components/CaptionControls.tsx
"use client";

import type { CaptionStyle } from "../lib/captions";

export interface CaptionControlsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  style: CaptionStyle;
  onStyleChange: (style: CaptionStyle) => void;
  /** Desabilita o controle (ex.: durações 45s/60s nesta fase). */
  disabled?: boolean;
  /** Mensagem opcional explicando por que está desabilitado. */
  disabledReason?: string;
}

const STYLE_OPTIONS: { value: CaptionStyle; label: string }[] = [
  { value: "classico", label: "Clássico" },
  { value: "karaoke", label: "Karaokê" },
  { value: "boxed", label: "Boxed" },
];

export default function CaptionControls({
  enabled,
  onEnabledChange,
  style,
  onStyleChange,
  disabled = false,
  disabledReason,
}: CaptionControlsProps) {
  return (
    <div
      data-testid="caption-controls"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        <span>Legendas automáticas</span>
      </label>

      {disabled && disabledReason ? (
        <span style={{ fontSize: 12, opacity: 0.7 }}>{disabledReason}</span>
      ) : null}

      {enabled && !disabled ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STYLE_OPTIONS.map((opt) => {
            const active = opt.value === style;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onStyleChange(opt.value)}
                aria-pressed={active}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: active
                    ? "2px solid currentColor"
                    : "1px solid rgba(0,0,0,0.2)",
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}