"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Msg {
  role: "user" | "assistant";
  text: string;
}
type Step =
  | { t: "site"; site: string; stage: number; name: string }
  | { t: "stage"; site: string; stage: number }
  | { t: "view"; mode: "dashboard" | "editor"; active?: string }
  | { t: "cap"; text: string }
  | { t: "user"; text: string }
  | { t: "ai"; text: string }
  | { t: "publish" }
  | { t: "clear" }
  | { t: "wait"; ms: number }
  | { t: "done" };

function scenario(lang: "ru" | "en"): Step[] {
  const ru = lang === "ru";
  const S = (r: string, e: string) => (ru ? r : e);
  const bakery = S("Тёплый хлеб", "Warm Bread");
  return [
    { t: "cap", text: S("Личный кабинет: все сайты клиента в одном месте.", "Dashboard: all the client's sites in one place.") },
    { t: "view", mode: "dashboard", active: "bakery" },
    { t: "wait", ms: 4200 },
    { t: "cap", text: S("Открываем первый сайт — пекарню.", "We open the first site — the bakery.") },
    { t: "view", mode: "editor" },
    { t: "site", site: "bakery", stage: 1, name: bakery },
    { t: "wait", ms: 3500 },
    { t: "cap", text: S("Задачу пишем обычными словами — без тем и блоков.", "We describe the task in plain words — no themes or blocks.") },
    { t: "user", text: S("Сделай светлый сайт пекарни на засечках. Заголовок: «Свежий хлеб каждое утро».", "Make a light serif bakery site. Heading: “Fresh bread every morning”.") },
    { t: "wait", ms: 1500 },
    { t: "ai", text: S("Готово: тёплая палитра и шрифт с засечками.", "Done: warm palette and a serif typeface.") },
    { t: "stage", site: "bakery", stage: 2 },
    { t: "wait", ms: 7000 },
    { t: "cap", text: S("Добавляем витрину товаров и контакты.", "Adding a product showcase and contacts.") },
    { t: "user", text: S("Добавь витрину «Что мы печём» и контакты в подвале.", "Add a “What we bake” showcase and contacts in the footer.") },
    { t: "wait", ms: 1500 },
    { t: "ai", text: S("Добавил витрину и подвал с контактами.", "Added the showcase and a contacts footer.") },
    { t: "stage", site: "bakery", stage: 3 },
    { t: "wait", ms: 7000 },
    { t: "cap", text: S("Нравится — «Опубликовать».", "Happy with it — “Publish”.") },
    { t: "publish" },
    { t: "ai", text: S("Опубликовано.", "Published.") },
    { t: "wait", ms: 2500 },
    { t: "cap", text: S("Возвращаемся в кабинет и переключаемся на второй сайт.", "Back to the dashboard — switching to the second site.") },
    { t: "view", mode: "dashboard", active: "pulse" },
    { t: "wait", ms: 4200 },
    { t: "cap", text: S("Совсем другой проект — ночной клуб. Тот же редактор.", "A completely different project — a nightclub. The same editor.") },
    { t: "view", mode: "editor" },
    { t: "clear" },
    { t: "site", site: "pulse", stage: 1, name: "PULSE" },
    { t: "wait", ms: 3500 },
    { t: "cap", text: S("Никаких шаблонов — другой стиль одной фразой.", "No templates — a different style in one phrase.") },
    { t: "user", text: S("Тёмный неоновый постер для ночного клуба PULSE, крупное название.", "A dark neon poster for the PULSE nightclub, a huge title.") },
    { t: "wait", ms: 1500 },
    { t: "ai", text: S("Сделал тёмный постер с неоновым названием.", "Built a dark poster with a neon title.") },
    { t: "stage", site: "pulse", stage: 2 },
    { t: "wait", ms: 7000 },
    { t: "cap", text: S("Добавляем афишу вечеринок и кнопку билетов.", "Adding the party lineup and a tickets button.") },
    { t: "user", text: S("Добавь афишу ближайших вечеринок и кнопку «Билеты».", "Add the upcoming lineup and a “Get tickets” button.") },
    { t: "wait", ms: 1500 },
    { t: "ai", text: S("Добавил афишу и кнопку билетов.", "Added the lineup and a tickets button.") },
    { t: "stage", site: "pulse", stage: 3 },
    { t: "wait", ms: 7000 },
    { t: "cap", text: S("Публикуем — и смотрим оба сайта на их адресах.", "Publish — then we view both sites at their addresses.") },
    { t: "publish" },
    { t: "wait", ms: 2500 },
    { t: "done" },
  ];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Demo() {
  const lang = (useSearchParams().get("lang") === "en" ? "en" : "ru") as "ru" | "en";
  const tr = (r: string, e: string) => (lang === "ru" ? r : e);
  const sites = [
    { key: "bakery", name: tr("Тёплый хлеб", "Warm Bread"), sub: "bakery" },
    { key: "pulse", name: "PULSE", sub: "pulse" },
  ];

  const [view, setView] = useState<"dashboard" | "editor">("dashboard");
  const [active, setActive] = useState("bakery");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [caption, setCaption] = useState("");
  const [siteName, setSiteName] = useState("");
  const [src, setSrc] = useState("about:blank");
  const [typing, setTyping] = useState("");
  const [publishOn, setPublishOn] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      for (const step of scenario(lang)) {
        switch (step.t) {
          case "cap":
            setCaption(step.text);
            break;
          case "view":
            setView(step.mode);
            if (step.active) setActive(step.active);
            break;
          case "site":
            setSiteName(step.name);
            setSrc(`/demo-stages/${lang}/${step.site}/${step.stage}.html`);
            setMessages([]);
            break;
          case "stage":
            setSrc(`/demo-stages/${lang}/${step.site}/${step.stage}.html`);
            break;
          case "clear":
            setMessages([]);
            break;
          case "user": {
            for (let i = 1; i <= step.text.length; i += 2) setTimeout(() => setTyping(step.text.slice(0, i)), i * 9);
            await sleep(step.text.length * 9 + 250);
            setTyping("");
            setMessages((m) => [...m, { role: "user", text: step.text }]);
            break;
          }
          case "ai":
            setMessages((m) => [...m, { role: "assistant", text: step.text }]);
            break;
          case "publish":
            setPublishOn(true);
            await sleep(700);
            setPublishOn(false);
            break;
          case "wait":
            await sleep(step.ms);
            break;
          case "done":
            (window as unknown as { __demoDone?: boolean }).__demoDone = true;
            break;
        }
      }
    })();
  }, [lang]);

  if (view === "dashboard") {
    return (
      <div className="dash">
        <div className="topbar">
          <span className="title">AI-CMS</span>
          <span className="status">demo@studio</span>
          <button>{tr("Выйти", "Sign out")}</button>
        </div>
        <div className="dash-main">
          <section className="dash-list">
            <h2>{tr("Мои сайты", "My sites")}</h2>
            <ul className="sites">
              {sites.map((s) => (
                <li
                  key={s.key}
                  className="site-row"
                  style={active === s.key ? { outline: "3px solid #2563eb", borderColor: "#2563eb" } : undefined}
                >
                  <span className="site-link">
                    <span className="site-title">{s.name}</span>
                    <span className="site-sub">{s.sub}.platform.ru</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="dash-create">
            <h2>{tr("Новый сайт", "New site")}</h2>
            <div className="create-form">
              <label>
                {tr("Адрес (поддомен)", "Address (subdomain)")}
                <div className="sub-input"><input readOnly placeholder="my-site" /><span>.platform.ru</span></div>
              </label>
              <button className="primary">{tr("Создать сайт", "Create site")}</button>
            </div>
          </section>
        </div>
        <div className="caption-bar">{caption}</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="back">← {tr("Сайты", "Sites")}</span>
        <span className="title">{siteName || "AI-CMS Studio"}</span>
        <span className="status">{tr("черновик", "draft")}</span>
        <button>{tr("Отменить черновик", "Discard draft")}</button>
        <button className="primary" style={publishOn ? { outline: "3px solid #93c5fd" } : undefined}>
          {tr("Опубликовать", "Publish")}
        </button>
      </div>
      <div className="main">
        <div className="chat">
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>{m.text}</div>
            ))}
          </div>
          <div className="composer">
            <textarea value={typing} readOnly placeholder={tr("Опишите изменение…", "Describe a change…")} />
            <button className="primary">{tr("Отправить", "Send")}</button>
          </div>
        </div>
        <div className="preview">
          <iframe src={src} title="preview" />
        </div>
      </div>
      <div className="caption-bar">{caption}</div>
    </div>
  );
}

export default function DemoPage() {
  return (
    <Suspense fallback={null}>
      <Demo />
    </Suspense>
  );
}
