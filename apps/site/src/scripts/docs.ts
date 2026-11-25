const root = document.body.dataset.root ?? "./";

document.querySelector(".theme-btn")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("paprika-theme", next);
  } catch {}
});

const menu = document.querySelector<HTMLButtonElement>(".menu-btn");
const sidebar = document.getElementById("sidebar");
menu?.addEventListener("click", () => {
  const open = sidebar?.classList.toggle("open") ?? false;
  menu.setAttribute("aria-expanded", String(open));
});

for (const btn of document.querySelectorAll<HTMLButtonElement>("figure.code .copy")) {
  btn.addEventListener("click", async () => {
    const code = btn.closest("figure")?.querySelector("pre")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(code);
      const label = btn.textContent;
      btn.textContent = btn.dataset.copied ?? label;
      setTimeout(() => (btn.textContent = label), 1500);
    } catch {}
  });
}

const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>(".toc a")];
if (tocLinks.length && "IntersectionObserver" in window) {
  const byId = new Map(tocLinks.map((a) => [a.hash.slice(1), a]));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        tocLinks.forEach((a) => a.removeAttribute("aria-current"));
        byId.get(e.target.id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-70px 0px -70% 0px" },
  );
  byId.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

type PagefindResult = { data: () => Promise<{ url: string; excerpt: string; meta: { title?: string } }> };
type Pagefind = { search: (q: string) => Promise<{ results: PagefindResult[] }>; options?: (o: object) => Promise<void> };

const input = document.getElementById("search") as HTMLInputElement | null;
const list = document.getElementById("search-results") as HTMLUListElement | null;
let pagefind: Promise<Pagefind | null> | null = null;
let active = -1;

const load = () =>
  (pagefind ??= import(/* @vite-ignore */ new URL(`${root}pagefind/pagefind.js`, location.href).href)
    .then(async (m: Pagefind) => {
      await m.options?.({ baseUrl: new URL(root, location.href).pathname });
      return m;
    })
    .catch(() => null));

const close = () => {
  if (!list || !input) return;
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  active = -1;
};

const select = (i: number) => {
  const items = [...(list?.querySelectorAll("a") ?? [])];
  if (!items.length) return;
  active = (i + items.length) % items.length;
  items.forEach((a, j) => a.setAttribute("aria-selected", String(j === active)));
  items[active].scrollIntoView({ block: "nearest" });
};

let seq = 0;
input?.addEventListener("input", async () => {
  const q = input.value.trim();
  const mine = ++seq;
  if (!q) return close();
  const pf = await load();
  if (!pf || mine !== seq || !list) return;
  const { results } = await pf.search(q);
  const data = await Promise.all(results.slice(0, 8).map((r) => r.data()));
  if (mine !== seq) return;
  list.replaceChildren();
  if (!data.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = `${document.body.dataset.noResults} “${q}”`;
    list.append(li);
  }
  for (const d of data) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = d.url;
    a.setAttribute("role", "option");
    const t = document.createElement("strong");
    t.textContent = d.meta.title ?? d.url;
    const ex = document.createElement("span");
    ex.innerHTML = d.excerpt;
    a.append(t, ex);
    li.append(a);
    list.append(li);
  }
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  active = -1;
});

input?.addEventListener("focus", () => void load());
input?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") (e.preventDefault(), select(active + 1));
  else if (e.key === "ArrowUp") (e.preventDefault(), select(active - 1));
  else if (e.key === "Enter" && active >= 0) list?.querySelectorAll("a")[active]?.click();
  else if (e.key === "Escape") (close(), input.blur());
});
document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest(".search")) close();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
    e.preventDefault();
    input?.focus();
  }
});
