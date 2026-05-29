import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { AccountBar } from "./_components/AccountBar";
import { CreateSite } from "./_components/CreateSite";

export const dynamic = "force-dynamic";

interface TenantRow {
  id: string;
  subdomain: string;
  title: string;
  created_at: string;
}

export default async function Dashboard() {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("id, subdomain, title, created_at")
    .order("created_at", { ascending: false });
  const tenants = (data as TenantRow[]) ?? [];

  return (
    <div className="dash">
      <header className="topbar">
        <span className="title">AI-CMS</span>
        <AccountBar email={user?.email ?? ""} />
      </header>

      <main className="dash-main">
        <section className="dash-list">
          <h2>Мои сайты</h2>
          {tenants.length === 0 && <p className="muted">Пока нет сайтов. Создайте первый справа.</p>}
          <ul className="sites">
            {tenants.map((t) => (
              <li key={t.id} className="site-row">
                <Link href={`/sites/${t.id}`} className="site-link">
                  <span className="site-title">{t.title || t.subdomain}</span>
                  <span className="site-sub">{t.subdomain}.platform.ru</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="dash-create">
          <h2>Новый сайт</h2>
          <CreateSite />
        </section>
      </main>
    </div>
  );
}
