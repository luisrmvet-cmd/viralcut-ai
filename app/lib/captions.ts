// app/lib/captions.ts
//
// Geração PURA de legendas no formato ASS (Advanced SubStation Alpha),
// para queima posterior via filtro `subtitles` do FFmpeg (libass).
// Não faz I/O, não chama FFmpeg e não acessa a rede.

export type CaptionStyle = "classico" | "karaoke" | "boxed";

export interface WordTiming {
  word: string;
  start: number; // segundos
  end: number;   // segundos
}

export interface BuildCaptionsOptions {
  style: CaptionStyle;
  width: number;   // ex.: 1080
  height: number;  // ex.: 1920
  fontName?: string; // família interna da fonte empacotada
}

const MIN_WORD_DURATION = 0.15;
const LAST_WORD_TAIL = 0.4;

export function buildCaptionsAss(
  words: WordTiming[],
  options: BuildCaptionsOptions
): string {
  const { style, width, height } = options;
  const fontName = options.fontName ?? "DejaVu Sans";

  return [
    buildHeader(width, height),
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    buildStyleLine(style, fontName, height),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...buildEvents(words),
    "",
  ].join("\n");
}

function buildHeader(width: number, height: number): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${Math.round(width)}`,
    `PlayResY: ${Math.round(height)}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
  ].join("\n");
}

interface StylePreset {
  primary: string;
  outline: string;
  back: string;
  borderStyle: number;
  outlineMul: number;
  shadow: number;
  alignment: number;
  fontMul: number;
  marginVMul: number;
}

const STYLE_PRESETS: Record<CaptionStyle, StylePreset> = {
  classico: {
    primary: "&H00FFFFFF",
    outline: "&H00000000",
    back: "&H00000000",
    borderStyle: 1,
   outlineMul: 0.007,
    shadow: 2,
    alignment: 2,
    fontMul: 0.065,
    marginVMul: 0.26,
  },
  karaoke: {
    primary: "&H0000FFFF",
    outline: "&H00000000",
    back: "&H00000000",
    borderStyle: 1,
    outlineMul: 0.004,
    shadow: 0,
    alignment: 5,
    fontMul: 0.058,
    marginVMul: 0,
  },
  boxed: {
    primary: "&H00FFFFFF",
    outline: "&H80000000",
    back: "&H00000000",
    borderStyle: 3,
    outlineMul: 0.006,
    shadow: 0,
    alignment: 5,
    fontMul: 0.055,
    marginVMul: 0.05,
  },
};

function buildStyleLine(
  style: CaptionStyle,
  fontName: string,
  height: number
): string {
  const p = STYLE_PRESETS[style];
  const fontSize = Math.round(height * p.fontMul);
  const outline = Math.max(1, Math.round(height * p.outlineMul));
  const marginV = Math.round(height * p.marginVMul);

  return [
    "Style: Caption",
    fontName,
    String(fontSize),
    p.primary,
    "&H000000FF",
    p.outline,
    p.back,
    "-1",
    "0",
    "0",
    "0",
    "100",
    "100",
    "0",
    "0",
    String(p.borderStyle),
    String(outline),
    String(p.shadow),
    String(p.alignment),
    "60",
    "60",
    String(marginV),
    "1",
  ].join(",");
}

function buildEvents(words: WordTiming[]): string[] {
  if (!words || words.length === 0) return [];

  const lines: string[] = [];
  const n = words.length;

  for (let i = 0; i < n; i++) {
    const w = words[i];
    const text = sanitize(w.word);
    if (!text) continue;

    const start = Math.max(0, w.start);
    let end: number;

    if (i < n - 1) {
      const nextStart = Math.max(0, words[i + 1].start);
      end = Math.max(w.end, start + MIN_WORD_DURATION);
      end = Math.min(end, nextStart);
      if (end <= start) end = nextStart;
    } else {
      end = Math.max(w.end, start + MIN_WORD_DURATION) + LAST_WORD_TAIL;
    }

    if (end <= start) continue;

    lines.push(
      `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Caption,,0,0,0,,${text}`
    );
  }

  return lines;
}

function toAssTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const cc = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${hour}:${pad(min)}:${pad(sec)}.${pad(cc)}`;
}

function sanitize(raw: string): string {
  return (raw ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "")
    .trim();
}