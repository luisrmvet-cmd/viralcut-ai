// app/lib/highlight.ts
// Fase 14B.1 — Destaque determinístico de palavras (sem IA, sem I/O)

const MAX_HIGHLIGHT_RATIO = 0.4; // trava: acima disso, nada é destacado

const HAS_DIGIT = /\d/;
const MONEY = /^r\$/i;

function isUpperWord(raw: string): boolean {
  const letters = raw.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  return (
    letters.length >= 2 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  );
}

export function markHighlights(rawWords: string[]): boolean[] {
  const n = rawWords.length;
  const flags = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    const w = (rawWords[i] || "").trim();
    if (!w) continue;

    // números, porcentagens (50%), valores (500)
    if (HAS_DIGIT.test(w)) flags[i] = true;

    // R$ isolado ou colado (R$500); arrasta o número vizinho
    if (MONEY.test(w)) {
      flags[i] = true;
      if (i + 1 < n && HAS_DIGIT.test(rawWords[i + 1] || "")) {
        flags[i + 1] = true;
      }
    }

    // CAIXA ALTA no texto bruto do ASR
    if (isUpperWord(w)) flags[i] = true;
  }

  // "50 por cento" → arrasta "por cento" junto do número
  for (let i = 0; i < n - 2; i++) {
    if (
      flags[i] &&
      HAS_DIGIT.test(rawWords[i] || "") &&
      (rawWords[i + 1] || "").toLowerCase() === "por" &&
      (rawWords[i + 2] || "").toLowerCase().startsWith("cento")
    ) {
      flags[i + 1] = true;
      flags[i + 2] = true;
    }
  }

  const count = flags.filter(Boolean).length;
  if (n > 0 && count / n > MAX_HIGHLIGHT_RATIO) {
    return new Array<boolean>(n).fill(false);
  }
  return flags;
}