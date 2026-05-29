"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // Email confirmations are off locally → session is active immediately.
    router.push("/");
    router.refresh();
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h1>Регистрация</h1>
      <input type="email" placeholder="Email" value={email} required
        onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Пароль (мин. 6 символов)" value={password} required minLength={6}
        onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="auth-error">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "…" : "Создать аккаунт"}
      </button>
      <p className="auth-alt">
        Уже есть аккаунт? <Link href="/login">Войти</Link>
      </p>
    </form>
  );
}
