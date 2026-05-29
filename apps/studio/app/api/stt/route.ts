import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Speech-to-text for the editor's voice input. Forwards the recorded audio to a
 * self-hosted, OpenAI-compatible transcription endpoint (e.g. faster-whisper-server /
 * whisper.cpp server) configured via env — keeping voice on our own infra (RF-friendly).
 *
 *   STT_BASE_URL=http://whisper:8000/v1   STT_MODEL=Systran/faster-whisper-base
 *
 * Protected: /api/* is auth-gated by proxy.ts (owner only).
 */
export async function POST(req: Request) {
  const base = process.env.STT_BASE_URL;
  if (!base) {
    return NextResponse.json(
      { error: "Голосовой ввод не настроен на сервере (STT_BASE_URL)." },
      { status: 503 },
    );
  }

  let audio: FormDataEntryValue | null;
  try {
    audio = (await req.formData()).get("audio");
  } catch {
    return NextResponse.json({ error: "Ожидался audio (multipart/form-data)." }, { status: 400 });
  }
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "Поле 'audio' обязательно." }, { status: 400 });
  }

  const out = new FormData();
  out.append("file", audio, audio.name || "audio.webm");
  out.append("model", process.env.STT_MODEL || "whisper-1");
  if (process.env.STT_LANGUAGE) out.append("language", process.env.STT_LANGUAGE);

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: process.env.STT_API_KEY ? { Authorization: `Bearer ${process.env.STT_API_KEY}` } : {},
      body: out,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `STT backend error ${res.status}: ${(await res.text()).slice(0, 200)}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ text: data.text ?? "" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
