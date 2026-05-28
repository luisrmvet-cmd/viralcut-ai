"use client";

import { useState } from "react";

export default function Home() {
const [files, setFiles] = useState<File[]>([]);
const [loading, setLoading] = useState(false);
const [videoUrl, setVideoUrl] = useState<string | null>(null);
const [error, setError] = useState<string | null>(null);

function onPick(e: React.ChangeEvent<HTMLInputElement>) {
setFiles(Array.from(e.target.files ?? []));
setVideoUrl(null);
setError(null);
}

async function handleSubmit() {
setError(null);
setVideoUrl(null);

if (files.length === 0) {
setError("Selecione pelo menos uma imagem.");
return;
}

setLoading(true);

try {
const fd = new FormData();

files.forEach((file, i) => {
fd.append(`image${i + 1}`, file);
});

const res = await fetch("/api/render", {
method: "POST",
body: fd,
});

const contentType = res.headers.get("content-type") || "";

if (!res.ok || contentType.includes("application/json")) {
const text = await res.text();
throw new Error(text);
}

const blob = await res.blob();
const url = URL.createObjectURL(blob);

setVideoUrl(url);
} catch (err: any) {
setError(err.message || "Erro ao gerar vídeo");
} finally {
setLoading(false);
}
}

return (
<main
style={{
minHeight: "100vh",
background: "#0f172a",
color: "white",
display: "flex",
justifyContent: "center",
alignItems: "center",
padding: 20,
}}
>
<div
style={{
width: "100%",
maxWidth: 420,
background: "#111827",
borderRadius: 24,
padding: 24,
boxShadow: "0 0 40px rgba(0,0,0,0.4)",
}}
>
<h1
style={{
fontSize: 32,
fontWeight: "bold",
marginBottom: 10,
textAlign: "center",
}}
>
ViralCut AI
</h1>

<p
style={{
textAlign: "center",
color: "#9ca3af",
marginBottom: 30,
}}
>
Gere reels automáticos em segundos
</p>

<input
type="file"
accept="image/*"
multiple
onChange={onPick}
style={{
marginBottom: 20,
width: "100%",
}}
/>

{files.length > 0 && (
<div
style={{
marginBottom: 20,
color: "#d1d5db",
fontSize: 14,
}}
>
{files.length} imagens selecionadas
</div>
)}

<button
onClick={handleSubmit}
disabled={loading}
style={{
width: "100%",
padding: 16,
borderRadius: 16,
border: "none",
background: loading ? "#374151" : "#2563eb",
color: "white",
fontSize: 18,
fontWeight: "bold",
cursor: "pointer",
}}
>
{loading ? "Gerando vídeo..." : "Criar Reels"}
</button>

{error && (
<div
style={{
marginTop: 20,
background: "#7f1d1d",
padding: 14,
borderRadius: 12,
color: "#fecaca",
}}
>
{error}
</div>
)}

{videoUrl && (
<div style={{ marginTop: 24 }}>
<video
src={videoUrl}
controls
autoPlay
style={{
width: "100%",
borderRadius: 20,
}}
/>

<a
href={videoUrl}
download="viralcut.mp4"
style={{
display: "block",
marginTop: 16,
textAlign: "center",
background: "#16a34a",
padding: 14,
borderRadius: 14,
color: "white",
textDecoration: "none",
fontWeight: "bold",
}}
>
Baixar MP4
</a>
</div>
)}
</div>
</main>
);
}
