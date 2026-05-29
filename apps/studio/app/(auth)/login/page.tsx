"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h1>Вход</h1>
      <input type="email" placeholder="Email" value={email} required
        onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Пароль" value={password} required
        onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="auth-error">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "…" : "Войти"}
      </button>
      <p className="auth-alt">
        Нет аккаунта? <Link href="/signup">Зарегистрироваться</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
