// app/api/autocut/route.ts
// (Fase 9 — AutoCut AI) Rota ISOLADA de planejamento de cortes.
// NÃO renderiza e NÃO chama FFmpeg: valida a entrada e devolve o(s)
// plano(s) em JSON. A duração vem do cliente, então sem ffprobe aqui.
// Independente de /api/render. Com a flag desligada, o front nem a chama.

import { NextResponse } from "next/server";
import { planCut, planAllCuts, TARGET_DURATIONS } from "../../lib/autocut";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido: envie JSON." }, { status: 400 });
  }

  const sourceDuration = Number(body?.sourceDuration);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return NextResponse.json(
      { error: "sourceDuration (segundos > 0) é obrigatório." },
      { status: 400 }
    );
  }

  const target = body?.targetDuration;
  if (target !== undefined) {
    const t = Number(target);
    if (!TARGET_DURATIONS.includes(t as any)) {
      return NextResponse.json(
        { error: `targetDuration deve ser um de ${TARGET_DURATIONS.join(", ")}.` },
        { status: 400 }
      );
    }
    return NextResponse.json({ plan: planCut(sourceDuration, t) });
  }

  return NextResponse.json({ plans: planAllCuts(sourceDuration) });
}