"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateSite() {
  const router = useRouter();
  const [subdomain, setSubdomain] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subdomain, title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ошибка");
      router.push(`/sites/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className="create-form" onSubmit={submit}>
      <label>
        Адрес (поддомен)
        <div className="sub-input">
          <input
            value={subdomain}
            placeholder="acme"
            onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
            required
          />
          <span>.platform.ru</span>
        </div>
      </label>
      <label>
        Название
        <input value={title} placeholder="Моя пекарня" onChange={(e) => setTitle(e.target.value)} />
      </label>
      {error && <p className="auth-error">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "Создаю…" : "Создать сайт"}
      </button>
    </form>
  );
}
