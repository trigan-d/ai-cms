import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionTenant, RESERVED_SUBDOMAINS } from "@/lib/tenant";

export const runtime = "nodejs";

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

interface CreateBody {
  subdomain?: string;
  title?: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { subdomain = "", title = "" } = (await req.json()) as CreateBody;
  const sub = subdomain.trim().toLowerCase();

  if (!SUBDOMAIN_RE.test(sub)) {
    return NextResponse.json(
      { error: "Поддомен: 2–32 символа, латиница/цифры/дефис, не на дефисе по краям." },
      { status: 400 },
    );
  }
  if (RESERVED_SUBDOMAINS.has(sub)) {
    return NextResponse.json({ error: "Этот поддомен зарезервирован." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tenants")
    .insert({ subdomain: sub, title: title.trim() || sub, owner_id: user.id })
    .select("id, subdomain")
    .single();

  if (error) {
    const taken = error.code === "23505" || /duplicate|unique/i.test(error.message);
    return NextResponse.json(
      { error: taken ? "Такой поддомен уже занят." : error.message },
      { status: taken ? 409 : 500 },
    );
  }

  await provisionTenant(data.id, data.subdomain);
  return NextResponse.json({ id: data.id, subdomain: data.subdomain });
}
