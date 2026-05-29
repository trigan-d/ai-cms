"use client";

import { useRef, useState } from "react";
import Link from "next/link";

interface DisplayMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

export function Editor({
  tenantId,
  subdomain,
  title,
}: {
  tenantId: string;
  subdomain: string;
  title: string;
}) {
  const [history, setHistory] = useState<unknown[]>([]);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [previewKey, setPreviewKey] = useState(0);
  const [recording, setRecording] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const base = `/api/sites/${tenantId}`;

  function pushMessage(m: DisplayMessage) {
    setMessages((prev) => [...prev, m]);
    requestAnimationFrame(() =>
      messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }),
    );
  }
  const reloadPreview = () => setPreviewKey((k) => k + 1);

  // Voice input. Prefers the browser's Web Speech API (instant, no backend); falls back
  // to recording + server STT (/api/stt → self-hosted Whisper) when it's unavailable.
  function toggleMic() {
    if (recording) {
      recognitionRef.current?.stop?.();
      recorderRef.current?.stop?.();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (SR) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec = new (SR as any)();
        rec.lang = "ru-RU";
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onresult = (e: any) => {
          const t = e?.results?.[0]?.[0]?.transcript ?? "";
          if (t) setInput((prev) => (prev ? prev + " " : "") + String(t).trim());
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onerror = (e: any) => setStatus(`микрофон: ${e?.error ?? "ошибка"}`);
        rec.onend = () => setRecording(false);
        recognitionRef.current = rec;
        rec.start();
        setRecording(true);
        setStatus("слушаю… (говорите; 🎤 ещё раз — стоп)");
      } catch {
        void startServerStt();
      }
      return;
    }
    void startServerStt();
  }

  // Fallback: record audio and transcribe via the server (/api/stt → self-hosted Whisper).
  async function startServerStt() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("голосовой ввод недоступен в этом браузере");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setStatus("распознаю…");
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          const form = new FormData();
          form.append("audio", blob, "audio.webm");
          const res = await fetch("/api/stt", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "ошибка распознавания");
          setInput((prev) => (prev ? prev + " " : "") + (data.text ?? "").trim());
          setStatus("");
        } catch (err) {
          setStatus(`STT: ${err instanceof Error ? err.message : err}`);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setStatus("запись… (🎤 ещё раз — стоп)");
    } catch {
      setStatus("нет доступа к микрофону");
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    pushMessage({ role: "user", text });
    setBusy(true);
    setStatus("модель думает…");
    try {
      const res = await fetch(`${base}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ошибка");
      setHistory(data.history);
      const toolCount = (data.events ?? []).filter(
        (e: { type: string }) => e.type === "tool_call",
      ).length;
      pushMessage({ role: "assistant", text: data.finalText || "(готово)" });
      setStatus(`${toolCount} правок(и) инструментами`);
      reloadPreview();
    } catch (err) {
      pushMessage({ role: "system", text: `Ошибка: ${err instanceof Error ? err.message : err}` });
      setStatus("ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    setStatus("публикую…");
    try {
      const res = await fetch(`${base}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ошибка");
      pushMessage({ role: "system", text: `Опубликовано (commit ${String(data.commit).slice(0, 8)}).` });
      setStatus("опубликовано");
    } catch (err) {
      pushMessage({ role: "system", text: `Ошибка публикации: ${err instanceof Error ? err.message : err}` });
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (busy) return;
    setBusy(true);
    setStatus("откатываю…");
    try {
      const res = await fetch(`${base}/revert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "draft" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ошибка");
      pushMessage({ role: "system", text: "Черновик возвращён к последней версии." });
      setStatus("откат выполнен");
      reloadPreview();
    } catch (err) {
      pushMessage({ role: "system", text: `Ошибка отката: ${err instanceof Error ? err.message : err}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <Link href="/" className="back">← Сайты</Link>
        <span className="title">{title || subdomain}</span>
        <span className="status">{status || `${subdomain}.platform.ru`}</span>
        <button onClick={undo} disabled={busy}>Отменить черновик</button>
        <button className="primary" onClick={publish} disabled={busy}>Опубликовать</button>
      </div>
      <div className="main">
        <div className="chat">
          <div className="messages" ref={messagesRef}>
            {messages.length === 0 && (
              <div className="msg system">
                Напишите, что изменить — например: «сделай фон тёмным и добавь пункт меню Контакты».
                Изменения появятся в превью справа. «Опубликовать» — выложить, «Отменить черновик» — вернуть как было.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>{m.text}</div>
            ))}
            {busy && <div className="msg system">…</div>}
          </div>
          <div className="composer">
            <textarea
              value={input}
              placeholder="Опишите изменение…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={busy}
            />
            <button
              className={recording ? "primary" : ""}
              onClick={() => void toggleMic()}
              disabled={busy}
              title="Голосовой ввод"
              aria-label="Голосовой ввод"
            >
              {recording ? "⏹" : "🎤"}
            </button>
            <button className="primary" onClick={() => void send()} disabled={busy}>Отправить</button>
          </div>
        </div>
        <div className="preview">
          <span className="hint">черновик (live preview)</span>
          <iframe key={previewKey} src={`/preview/${tenantId}/index.html?v=${previewKey}`} title="preview" />
        </div>
      </div>
    </div>
  );
}
