"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AccountBar({ email }: { email: string }) {
  const router = useRouter();
  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <>
      {email && <span className="status">{email}</span>}
      <button onClick={logout}>Выйти</button>
    </>
  );
}
