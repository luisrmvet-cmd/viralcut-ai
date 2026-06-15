// app/director-test/page.tsx
// Fase 15F.1 — Página TEMPORÁRIA de teste do endpoint /api/director.
// Apenas seleciona um vídeo, envia FormData "video" e mostra o JSON retornado.
// NÃO corta, NÃO renderiza vídeo, NÃO importa nenhum módulo validado.
// Rollback: apagar esta pasta/arquivo. Nada mais é afetado.

"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";

export default function DirectorTestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
if (!file) {
setError("Selecione um vídeo primeiro.");
return;
}

setLoading(true);
setError(null);
setResult(null);

try {
const blob = await upload(file.name, file, {
access: "public",
handleUploadUrl: "/api/upload",
contentType: file.type || "video/mp4",
});

const res = await fetch("/api/director", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ videoUrl: blob.url }),
});

const data = await res.json().catch(() => null);

if (!res.ok) {
throw new Error(data?.error || `Erro HTTP ${res.status}`);
}

setResult(data);
} catch (e) {
setError(e instanceof Error ? e.message : String(e));
} finally {
setLoading(false);
}
}


  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        color: "#e6e6e6",
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>
        Diretor de Vídeo IA — Teste (15F.1)
      </h1>
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>
        Página temporária. Somente leitura: analisa e retorna os momentos em
        JSON. Não corta nem altera o vídeo. Requer <code>DIRECTOR_AI=1</code>.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          margin: "20px 0",
        }}
      >
        <input
          type="file"
          accept="video/*"
          disabled={loading}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
        />
        <button
          onClick={handleAnalyze}
          disabled={loading || !file}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            cursor: loading || !file ? "not-allowed" : "pointer",
            background: loading || !file ? "#444" : "#2d7ff9",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {loading ? "Analisando..." : "Analisar"}
        </button>
      </div>

      {file && (
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: -8 }}>
          Selecionado: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
        </p>
      )}

      {loading && (
        <p style={{ fontSize: 14, opacity: 0.85 }}>
          Extraindo áudio, transcrevendo e classificando momentos...
        </p>
      )}

      {error && (
        <pre
          style={{
            background: "#3a1414",
            color: "#ffb4b4",
            padding: 12,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error}
        </pre>
      )}

      {result != null && (
        <>
      {result?.moments?.map((m: any, i: number) => (
<div
key={i}
className="mt-4 rounded-xl border p-4 bg-white text-black"
>
<div className="font-bold text-lg">
{m.type.toUpperCase()}
</div>

<div>Tempo: {m.time}</div>
<div>Viral Score: {m.viralScore}</div>
<div>Chance: {m.chance}</div>

<div className="mt-2 text-green-700">
✓ {m.reason}
</div>

<div className="mt-2 text-gray-600">
{m.snippet}
</div>
</div>
))}
        <pre
          style={{
            background: "#0f1115",
            color: "#cfe8ff",
            padding: 16,
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
            overflowX: "auto",
            maxHeight: 520,
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
        {result?.moments?.map((m: any, i: number) => (
<div
key={i}
className="mt-4 rounded-xl border p-4 bg-white text-black"
>
<div className="font-bold text-lg">
{m.type.toUpperCase()}
</div>

<div>
Tempo: {m.time}
</div>

<div>
Viral Score: {m.viralScore}
</div>

<div>
Chance: {m.chance}
</div>

<div className="mt-2 text-green-700">
✓ {m.reason}
</div>

<div className="mt-2 text-gray-600">
{m.snippet}
</div>
</div>
))}
</>
      )}
      </main>
      );
    }