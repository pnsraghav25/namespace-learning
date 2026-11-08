"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ============================== types ============================== */

type Difficulty = "Easy" | "Medium" | "Hard" | "Unknown";

type Question = {
  title: string;
  slug: string;
  difficulty: Difficulty;
  acceptanceRate: number | null;
  frequency: string | null;
  problemUrl: string;
  solutionUrl: string;
  page?: number;
};

type Dataset = {
  slug: string;
  company: string; // display name, capitalized
  questions: Question[];
  totalQuestions: number;
  failedPages: { page: number; error: string }[];
  fetchedAt: string;
};

type CompanyInfo = { name: string; slug: string; count?: number };

type Row = Question & {
  companies: string[];
  companyDetails: Record<string, Question>;
};

type TileFilter = "All" | "Easy" | "Medium" | "Hard" | "MostAsked";

type SortKey =
  | "default"
  | "recent"
  | "companies"
  | "title"
  | "acc-desc"
  | "acc-asc"
  | "difficulty";

/* ============================ constants ============================ */

const PAGE_SIZE = 25;
const STORE_KEY = "namespace-learning-datasets-v1";
const SELECT_KEY = "namespace-learning-selected-v1";
const THEME_KEY = "namespace-learning-theme";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "default", label: "Default order" },
  { value: "recent", label: "Most recent first" },
  { value: "companies", label: "Asked by most companies" },
  { value: "acc-desc", label: "Acceptance: high → low" },
  { value: "acc-asc", label: "Acceptance: low → high" },
  { value: "difficulty", label: "Difficulty: easy → hard" },
  { value: "title", label: "Title A → Z" },
];

const DIFF_STYLE: Record<Difficulty, { color: string; bg: string }> = {
  Easy: { color: "var(--easy)", bg: "var(--easy-soft)" },
  Medium: { color: "var(--med)", bg: "var(--med-soft)" },
  Hard: { color: "var(--hard)", bg: "var(--hard-soft)" },
  Unknown: { color: "var(--muted)", bg: "var(--panel-2)" },
};

const DIFF_ORDER: Record<Difficulty, number> = {
  Easy: 0,
  Medium: 1,
  Hard: 2,
  Unknown: 3,
};

const THEME_CSS = `
.fc-root{
  --bg:#0b0d17;--panel:#121626;--panel-2:#1a1f33;--border:#272d45;--text:#e8eaf4;--muted:#8a90ab;
  --accent:#8b6cff;--accent-2:#6d4dff;--accent-soft:rgba(139,108,255,.15);
  --easy:#34d399;--easy-soft:rgba(52,211,153,.12);
  --med:#fbbf24;--med-soft:rgba(251,191,36,.12);
  --hard:#f87171;--hard-soft:rgba(248,113,113,.12);
  --hot:#f472b6;--hot-soft:rgba(244,114,182,.13);
  --shadow:0 12px 32px rgba(0,0,0,.4);
  color-scheme:dark;
}
.fc-root[data-theme="light"]{
  --bg:#f5f6fb;--panel:#ffffff;--panel-2:#eef0f7;--border:#e0e3ee;--text:#151826;--muted:#5d6380;
  --accent:#6246ea;--accent-2:#4f35d6;--accent-soft:rgba(98,70,234,.10);
  --easy:#059669;--easy-soft:rgba(5,150,105,.10);
  --med:#b45309;--med-soft:rgba(217,119,6,.12);
  --hard:#dc2626;--hard-soft:rgba(220,38,38,.10);
  --hot:#db2777;--hot-soft:rgba(219,39,119,.10);
  --shadow:0 12px 32px rgba(20,24,40,.12);
  color-scheme:light;
}
.fc-root{background:var(--bg);color:var(--text);transition:background .2s,color .2s}
.fc-root ::selection{background:var(--accent-soft)}
.fc-focus:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.fc-scroll::-webkit-scrollbar{width:8px;height:8px}
.fc-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px}
.fc-row:hover{background:var(--panel-2)}
.fc-btn:hover{background:var(--panel-2)}
.fc-primary{background:var(--accent);color:#fff}
.fc-primary:hover{background:var(--accent-2)}
.fc-primary:disabled{opacity:.6;cursor:not-allowed}
`;

/* ============================= helpers ============================= */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function titleCase(s: string) {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|\s|&|\()([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

function normDifficulty(v: any): Difficulty {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("easy")) return "Easy";
  if (s.startsWith("med")) return "Medium";
  if (s.startsWith("hard")) return "Hard";
  return "Unknown";
}

function normAcceptance(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace("%", ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function normQuestion(raw: any): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title ?? raw.name ?? "").trim();
  const problemUrl = String(raw.problemUrl ?? raw.url ?? raw.link ?? "");
  const slug = String(
    raw.slug ?? problemUrl.split("/").filter(Boolean).pop() ?? "",
  ).trim();
  if (!title && !slug) return null;
  const sol = String(raw.solutionUrl ?? raw.solution ?? "");
  return {
    title: title || titleCase(slug),
    slug,
    difficulty: normDifficulty(raw.difficulty),
    acceptanceRate: normAcceptance(
      raw.acceptanceRate ?? raw.acceptance ?? raw.acceptance_rate,
    ),
    frequency: String(raw.frequencyLabel ?? raw.frequency ?? "").trim() || null,
    problemUrl,
    solutionUrl: /^https?:\/\//.test(sol) ? sol : "",
    page: typeof raw.page === "number" ? raw.page : undefined,
  };
}

function dedupe(list: Question[]) {
  return Array.from(
    new Map(list.map((q) => [(q.slug || q.title).toLowerCase(), q])).values(),
  );
}

/** Lower = asked more recently. */
function freqDays(f: string | null): number {
  if (!f) return Number.POSITIVE_INFINITY;
  const s = f.toLowerCase();
  if (s.includes("all time")) return 100000;
  const m = s.match(/(\d+)\s*(day|week|month|year)/);
  if (!m) return 50000;
  const n = Number(m[1]);
  const mult =
    m[2] === "day" ? 1 : m[2] === "week" ? 7 : m[2] === "month" ? 30 : 365;
  const days = n * mult;
  return s.includes("more than") ? days + 1 : days;
}

const isLast30 = (f: string | null) => freqDays(f) <= 30;

function normCompanies(raw: any): CompanyInfo[] {
  const list: any[] = Array.isArray(raw) ? raw : (raw?.companies ?? []);
  const out: CompanyInfo[] = [];
  for (const c of list) {
    const name = String(c?.name ?? c?.company ?? "").trim();
    let slug = String(c?.slug ?? "").trim();
    if (!slug && c?.url)
      slug = String(c.url).split("/companies/")[1]?.split(/[/?#]/)[0] ?? "";
    const count = Number(
      c?.count ?? c?.questions ?? c?.questionCount ?? c?.total,
    );
    if (name && slug)
      out.push({
        name: titleCase(slug),
        slug,
        count: Number.isFinite(count) ? count : undefined,
      });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for http:// LAN access where the Clipboard API is blocked
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function parseImportedDatasets(
  raw: any,
  filename: string,
  catalog: CompanyInfo[],
): Record<string, Dataset> {
  const grouped = new Map<string, Question[]>();
  let invalid = 0;
  const companySlug = (value: any): string => {
    const text =
      typeof value === "string"
        ? value.trim()
        : String(
            value?.companySlug ??
              value?.slug ??
              value?.name ??
              value?.company ??
              "",
          ).trim();
    if (!text) throw new Error("A company entry is missing its name or slug.");
    const known = catalog.find(
      (c) =>
        c.slug.toLowerCase() === text.toLowerCase() ||
        c.name.toLowerCase() === text.toLowerCase() ||
        titleCase(c.slug).toLowerCase() === text.toLowerCase(),
    );
    return known?.slug || text.toLowerCase().replace(/\s+/g, "-");
  };
  const members = (value: any): any[] =>
    Array.isArray(value) ? value : value ? [value] : [];
  const add = (row: any, defaults: any[], fallback: string) => {
    const q = normQuestion(row);
    if (!q) {
      invalid++;
      return;
    }
    const detail = row.companyDetails;
    const explicit = members(
      row.companySlugs ?? row.companies ?? row.companySlug ?? row.company,
    );
    const names =
      detail && typeof detail === "object" && !Array.isArray(detail)
        ? Object.keys(detail)
        : explicit;
    const targets = names.length
      ? names
      : defaults.length === 1
        ? defaults
        : defaults.length > 1
          ? []
          : [fallback];
    if (!targets.length)
      throw new Error(
        "Combined JSON needs company membership on each question (companies or companySlug). A top-level company list alone cannot identify common questions.",
      );
    for (const name of targets) {
      const slug = companySlug(name);
      const perCompany = detail?.[typeof name === "string" ? name : slug];
      const question = perCompany ? normQuestion({ ...row, ...perCompany }) : q;
      if (question) grouped.set(slug, [...(grouped.get(slug) || []), question]);
    }
  };
  const fallback = filename.replace(/(?:[_-]questions)?\.json$/i, "");
  const visit = (node: any, inherited: any[] = []) => {
    if (Array.isArray(node)) {
      node.forEach((item) =>
        Array.isArray(item?.questions)
          ? visit(item, inherited)
          : add(item, inherited, fallback),
      );
      return;
    }
    if (!node || typeof node !== "object")
      throw new Error("JSON must contain questions or company datasets.");
    if (Array.isArray(node.questions)) {
      const defaults = members(
        node.companySlug ?? node.company ?? node.companies,
      );
      node.questions.forEach((q: any) =>
        add(q, defaults.length ? defaults : inherited, fallback),
      );
      return;
    }
    const collection = node.datasets ?? node;
    if (Array.isArray(collection)) {
      visit(collection, inherited);
      return;
    }
    let found = false;
    for (const [key, value] of Object.entries(collection)) {
      if (
        Array.isArray(value) ||
        (value &&
          typeof value === "object" &&
          Array.isArray((value as any).questions))
      ) {
        visit(value, [key]);
        found = true;
      }
    }
    if (!found)
      throw new Error("No questions array or company datasets found.");
  };
  visit(raw);
  if (!grouped.size) throw new Error("No valid questions found.");
  if (invalid)
    throw new Error(
      `${invalid} invalid question entries found. Fix them and upload again; no data was imported.`,
    );
  const result: Record<string, Dataset> = {};
  grouped.forEach((list, slug) => {
    const questions = dedupe(list);
    result[slug] = {
      slug,
      company: titleCase(slug),
      questions,
      totalQuestions: questions.length,
      failedPages: [],
      fetchedAt: new Date().toISOString(),
    };
  });
  return result;
}

/* ============================== icons ============================== */

type IconProps = { className?: string };
const svg = (d: string) =>
  function Icon({ className = "h-4 w-4" }: IconProps) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={d} />
      </svg>
    );
  };
const SearchIcon = svg("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3");
const BuildingIcon = svg(
  "M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 9h2a2 2 0 0 1 2 2v10M9 7h2M9 11h2M9 15h2",
);
const SunIcon = svg(
  "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
);
const MoonIcon = svg("M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z");
const CopyIcon = svg("M9 9h11v11H9zM5 15H4V4h11v1");
const CheckIcon = svg("M20 6 9 17l-5-5");
const XIcon = svg("M18 6 6 18M6 6l12 12");
const ChevronIcon = svg("m6 9 6 6 6-6");
const DownloadIcon = svg(
  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
);
const UploadIcon = svg(
  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
);
const FlameIcon = svg(
  "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.4 1.4 1.4 2.8 2.5 2.8z",
);
const ExternalIcon = svg(
  "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
);

/* ============================ components =========================== */

function Dropdown<T extends string>({
  value,
  options,
  onChange,
  prefix,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  prefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative w-full sm:w-64">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="fc-focus flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 text-sm transition hover:border-[var(--accent)]"
      >
        <span className="truncate">
          {prefix && <span className="text-[var(--muted)]">{prefix} </span>}
          <span className="font-medium">{current?.label}</span>
        </span>
        <span
          className={`text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-30 mt-2 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] py-1"
          style={{ boxShadow: "var(--shadow)" }}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="fc-btn flex w-full items-center justify-between px-3 py-2.5 text-left text-sm"
                  style={
                    active
                      ? {
                          color: "var(--accent)",
                          background: "var(--accent-soft)",
                        }
                      : undefined
                  }
                >
                  {o.label}
                  {active && <CheckIcon />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatTile({
  label,
  count,
  color,
  bg,
  active,
  onClick,
  icon,
  hint,
}: {
  label: string;
  count: number;
  color: string;
  bg: string;
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="fc-focus group flex h-full w-full min-w-0 flex-col items-start gap-1 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 sm:p-4"
      style={{
        borderColor: active ? color : "var(--border)",
        background: active ? bg : "var(--panel)",
        boxShadow: active ? `0 0 0 1px ${color}` : undefined,
      }}
    >
      <span
        className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide"
        style={{ color }}
      >
        {icon}
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums sm:text-3xl">
        {count.toLocaleString()}
      </span>
      {hint && (
        <span className="truncate text-[11px] text-[var(--muted)]">{hint}</span>
      )}
    </button>
  );
}

function CompanyDialog({
  open,
  onClose,
  companies,
  loadedSlugs,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  companies: CompanyInfo[];
  loadedSlugs: string[];
  onUse: (slug: string) => void;
}) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(s) || c.slug.toLowerCase().includes(s),
    );
  }, [companies, q]);

  if (!open) return null;

  const handleCopy = async (slug: string) => {
    if (await copyText(slug)) {
      setCopied(slug);
      setTimeout(() => setCopied((c) => (c === slug ? "" : c)), 1500);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Companies"
    >
      <div
        className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl border border-[var(--border)] bg-[var(--panel)] sm:max-w-2xl sm:rounded-3xl"
        style={{ boxShadow: "var(--shadow)" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-semibold">Companies</h2>
            <p className="text-sm text-[var(--muted)]">
              {companies.length.toLocaleString()} companies · copy a slug or
              click <b>Use</b> to fill the fetch box
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="fc-btn fc-focus rounded-lg p-2 text-[var(--muted)]"
            aria-label="Close"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 pb-2 sm:px-5">
          <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 focus-within:border-[var(--accent)]">
            <SearchIcon className="h-4 w-4 text-[var(--muted)]" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search company or slug…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)] h-11"
            />
          </label>
        </div>

        <ul className="fc-scroll flex-1 overflow-y-auto px-2 pb-3 sm:px-3">
          {companies.length === 0 && (
            <li className="p-6 text-center text-sm text-[var(--muted)]">
              Couldn&apos;t load <code>/namespace-learning_companies.json</code>
              . Make sure it&apos;s in <code>public/</code>.
            </li>
          )}
          {companies.length > 0 && list.length === 0 && (
            <li className="p-6 text-center text-sm text-[var(--muted)]">
              No companies match &ldquo;{q}&rdquo;.
            </li>
          )}
          {list.map((c) => {
            const loaded = loadedSlugs.includes(c.slug);
            const isCopied = copied === c.slug;
            return (
              <li
                key={c.slug}
                className="fc-row flex items-center gap-2 rounded-xl px-2 py-2 sm:px-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {loaded && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{
                          color: "var(--easy)",
                          background: "var(--easy-soft)",
                        }}
                      >
                        Loaded
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <code className="truncate">{c.slug}</code>
                    {c.count !== undefined && (
                      <span className="shrink-0">
                        · {c.count.toLocaleString()} Qs
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(c.slug)}
                  className="fc-btn fc-focus flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
                  style={
                    isCopied
                      ? { color: "var(--easy)", borderColor: "var(--easy)" }
                      : undefined
                  }
                  aria-label={`Copy slug ${c.slug}`}
                >
                  {isCopied ? (
                    <CheckIcon className="h-3.5 w-3.5" />
                  ) : (
                    <CopyIcon className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {isCopied ? "Copied" : "Copy"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onUse(c.slug)}
                  className="fc-primary fc-focus shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold"
                >
                  Use
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function CopyProblemName({ title }: { title: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const handleCopy = async () => {
    let ok = false;
    try {
      ok = await copyText(title);
    } catch {
      ok = false;
    }
    setStatus(ok ? "copied" : "error");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 1800);
  };
  return (
    <span className="ml-1 inline-flex align-middle">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy problem name: ${title}`}
        title={
          status === "copied"
            ? "Copied!"
            : status === "error"
              ? "Copy failed. Try again."
              : "Copy problem name"
        }
        className="fc-btn fc-focus inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--accent)]"
        style={status === "copied" ? { color: "var(--easy)" } : undefined}
      >
        {status === "copied" ? (
          <CheckIcon className="h-4 w-4" />
        ) : (
          <CopyIcon className="h-4 w-4" />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied"
          ? `Copied ${title}`
          : status === "error"
            ? "Could not copy. Please try again."
            : ""}
      </span>
    </span>
  );
}

function CompanyTags({ names, max = 3 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {shown.map((n) => (
        <span
          key={n}
          className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
          style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
        >
          {n}
        </span>
      ))}
      {extra > 0 && (
        <span
          className="rounded-md bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
          title={names.slice(max).join(", ")}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

function DiffBadge({ d }: { d: Difficulty }) {
  const s = DIFF_STYLE[d];
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ color: s.color, background: s.bg }}
    >
      {d === "Unknown" ? "—" : d}
    </span>
  );
}

function FreqBadge({ f }: { f: string | null }) {
  if (!f) return <span className="text-[var(--muted)]">—</span>;
  const hot = isLast30(f);
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs"
      style={
        hot
          ? {
              color: "var(--hot)",
              background: "var(--hot-soft)",
              fontWeight: 600,
            }
          : { color: "var(--muted)" }
      }
    >
      {hot && <FlameIcon className="h-3 w-3" />}
      {f}
    </span>
  );
}

function SolutionLink({ url }: { url: string }) {
  if (!url) return <span className="text-[var(--muted)]">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="fc-focus inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:underline"
    >
      Solution <ExternalIcon className="h-3.5 w-3.5" />
    </a>
  );
}

/* =============================== page ============================== */

export default function Page() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [hydrated, setHydrated] = useState(false);

  const [datasets, setDatasets] = useState<Record<string, Dataset>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const [fetchInput, setFetchInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fetchingRef = useRef(false);
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [tile, setTile] = useState<TileFilter>("All");
  const [sort, setSort] = useState<SortKey>("default");
  const [page, setPage] = useState(1);
  const [matchMode, setMatchMode] = useState<"or" | "common" | "uncommon">(
    "or",
  );
  const [pageInput, setPageInput] = useState("1");
  const [pageMessage, setPageMessage] = useState("");

  /* ---------- initial load ---------- */
  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark") setTheme(t);
      else if (window.matchMedia?.("(prefers-color-scheme: light)").matches)
        setTheme("light");
    } catch {}

    fetch("/companies.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => raw && setCompanies(normCompanies(raw)))
      .catch(() => {});

    let stored: Record<string, Dataset> = {};
    let storedSel: string[] = [];
    try {
      stored = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
      storedSel = JSON.parse(localStorage.getItem(SELECT_KEY) || "[]") || [];
    } catch {}

    if (Object.keys(stored).length) {
      for (const key of Object.keys(stored)) {
        stored[key] = {
          ...stored[key],
          company: titleCase(key),
          questions: dedupe(
            (stored[key].questions || [])
              .map(normQuestion)
              .filter(Boolean) as Question[],
          ),
        };
      }
      setDatasets(stored);
      if (stored.google) {
        fetch("/data/google_questions.json")
          .then((r) => (r.ok ? r.json() : null))
          .then((raw) => {
            const source = Array.isArray(raw) ? raw : (raw?.questions ?? []);
            const labels = new Map<string, string>();
            source.forEach((q: any) => {
              const label = String(
                q.frequencyLabel ?? q.frequency ?? "",
              ).trim();
              if (label)
                labels.set(String(q.slug || q.title).toLowerCase(), label);
            });
            setDatasets((prev) => {
              if (!prev.google) return prev;
              return {
                ...prev,
                google: {
                  ...prev.google,
                  questions: prev.google.questions.map((q) => ({
                    ...q,
                    frequency:
                      q.frequency ||
                      labels.get((q.slug || q.title).toLowerCase()) ||
                      null,
                  })),
                },
              };
            });
          })
          .catch(() => {});
      }
      const sel = storedSel.filter((s) => stored[s]);
      setSelected(sel.length ? sel : [Object.keys(stored)[0]]);
      setHydrated(true);
      return;
    }

    // First visit: load the bundled Google starter
    fetch("/data/google_questions.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (!raw) return;
        const list: any[] = Array.isArray(raw) ? raw : (raw.questions ?? []);
        const qs = dedupe(list.map(normQuestion).filter(Boolean) as Question[]);
        if (!qs.length) return;
        setDatasets({
          google: {
            slug: "google",
            company: "Google",
            questions: qs,
            totalQuestions: qs.length,
            failedPages: [],
            fetchedAt: new Date().toISOString(),
          },
        });
        setSelected(["google"]);
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  /* ---------- persistence ---------- */
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(datasets));
      localStorage.setItem(SELECT_KEY, JSON.stringify(selected));
    } catch {
      setNotice(
        "Browser storage is full. New data will be lost on refresh. Remove some companies or export them.",
      );
    }
  }, [datasets, selected, hydrated]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  useEffect(() => setPage(1), [search, tile, sort, selected, matchMode]);

  /* ---------- derived data ---------- */
  const resolveDisplayName = (slug: string, _input: string) => titleCase(slug);

  const loadedList = useMemo(
    () =>
      Object.values(datasets)
        .map((d) => ({ ...d, company: titleCase(d.slug) }))
        .sort((a, b) => a.company.localeCompare(b.company)),
    [datasets],
  );

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    for (const slug of selected) {
      const stored = datasets[slug];
      if (!stored) continue;
      const ds = { ...stored, company: titleCase(slug) };
      for (const q of ds.questions) {
        const key = (q.slug || q.title).toLowerCase();
        const ex = map.get(key);
        if (!ex) {
          map.set(key, {
            ...q,
            companies: [ds.company],
            companyDetails: { [slug]: q },
          });
        } else {
          ex.companyDetails[slug] = q;
          if (!ex.companies.includes(ds.company)) ex.companies.push(ds.company);
          if (freqDays(q.frequency) < freqDays(ex.frequency))
            ex.frequency = q.frequency;
          if (!ex.solutionUrl && q.solutionUrl) ex.solutionUrl = q.solutionUrl;
          if (ex.acceptanceRate === null && q.acceptanceRate !== null)
            ex.acceptanceRate = q.acceptanceRate;
        }
      }
    }
    return Array.from(map.values());
  }, [datasets, selected]);

  const searched = useMemo(() => {
    const s = search.trim().toLowerCase();
    const matching = rows.filter((r) =>
      matchMode === "common"
        ? r.companies.length === selected.length
        : matchMode === "uncommon"
          ? r.companies.length === 1
          : true,
    );
    if (!s) return matching;
    return matching.filter(
      (r) =>
        r.title.toLowerCase().includes(s) ||
        r.companies.some((c) => c.toLowerCase().includes(s)),
    );
  }, [rows, search, matchMode, selected.length]);

  const counts = useMemo(() => {
    const c = {
      All: searched.length,
      Easy: 0,
      Medium: 0,
      Hard: 0,
      MostAsked: 0,
    };
    for (const r of searched) {
      if (r.difficulty === "Easy") c.Easy++;
      else if (r.difficulty === "Medium") c.Medium++;
      else if (r.difficulty === "Hard") c.Hard++;
      if (isLast30(r.frequency)) c.MostAsked++;
    }
    return c;
  }, [searched]);

  const filtered = useMemo(() => {
    let list = searched;
    if (tile === "MostAsked") list = list.filter((r) => isLast30(r.frequency));
    else if (tile !== "All") list = list.filter((r) => r.difficulty === tile);

    const sorted = [...list];
    switch (sort) {
      case "recent":
        sorted.sort((a, b) => freqDays(a.frequency) - freqDays(b.frequency));
        break;
      case "companies":
        sorted.sort(
          (a, b) =>
            b.companies.length - a.companies.length ||
            freqDays(a.frequency) - freqDays(b.frequency),
        );
        break;
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "acc-desc":
        sorted.sort(
          (a, b) => (b.acceptanceRate ?? -1) - (a.acceptanceRate ?? -1),
        );
        break;
      case "acc-asc":
        sorted.sort(
          (a, b) => (a.acceptanceRate ?? 101) - (b.acceptanceRate ?? 101),
        );
        break;
      case "difficulty":
        sorted.sort(
          (a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty],
        );
        break;
    }
    return sorted;
  }, [searched, tile, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  useEffect(() => {
    setPageInput(String(safePage));
  }, [safePage, totalPages]);

  const goToPage = () => {
    if (!/^-?\d+$/.test(pageInput.trim())) {
      setPageMessage("Enter a whole page number.");
      return;
    }
    const requested = Number(pageInput.trim());
    const next = Math.max(1, Math.min(requested, totalPages));
    setPage(next);
    setPageInput(String(next));
    setPageMessage(
      requested > totalPages
        ? `Maximum is ${totalPages}. Showing the last page.`
        : requested < 1
          ? "Minimum is 1. Showing the first page."
          : "",
    );
  };

  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const selectedNames = selected
    .map((s) => (datasets[s] ? titleCase(s) : ""))
    .filter(Boolean) as string[];

  /* ---------- actions ---------- */
  const toggleCompany = (slug: string) =>
    setSelected((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );

  const removeCompany = (slug: string) => {
    const name = datasets[slug]?.company ?? slug;
    if (!window.confirm(`Remove ${name} and its saved questions?`)) return;
    setDatasets((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
    setSelected((prev) => prev.filter((s) => s !== slug));
  };

  const fetchCompany = async () => {
    const input = fetchInput.trim();

    if (!input || fetchingRef.current) return;

    const CONCURRENCY = 4;
    const BATCH_DELAY_MS = 300;
    const MAX_FETCH_PAGES = 200;

    type PagePayload = {
      companySlug?: string;
      totalPages?: number;
      totalQuestions?: number;
      questions?: unknown[];
      done?: boolean;
      error?: string;
    };

    fetchingRef.current = true;
    cancelRef.current = false;

    setFetching(true);
    setError("");
    setNotice("");
    setProgress("Fetching page 1…");

    const requestPage = async (
      pageNumber: number,
      retry = true,
    ): Promise<PagePayload> => {
      const response = await fetch("/api/company-page", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company: input,
          page: pageNumber,
        }),
        cache: "no-store",
      });

      // Retry a rate-limited request once.
      if (response.status === 429 && retry) {
        const retryAfter = response.headers.get("Retry-After");
        let delayMs = 2000;

        if (retryAfter) {
          const seconds = Number(retryAfter);

          if (Number.isFinite(seconds) && seconds >= 0) {
            delayMs = seconds * 1000;
          } else {
            const retryAt = Date.parse(retryAfter);

            if (Number.isFinite(retryAt)) {
              delayMs = Math.max(0, retryAt - Date.now());
            }
          }
        }

        // Keep retry waits bounded.
        delayMs = Math.min(30000, Math.max(1000, delayMs));

        await response.text();
        await sleep(delayMs);

        return requestPage(pageNumber, false);
      }

      const text = await response.text();
      let payload: PagePayload;

      try {
        const parsed: unknown = JSON.parse(text);

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Invalid response structure.");
        }

        payload = parsed as PagePayload;
      } catch {
        throw new Error(
          `Page ${pageNumber}: server returned an invalid JSON response ` +
            `(HTTP ${response.status}).`,
        );
      }

      if (!response.ok) {
        throw new Error(
          payload.error ||
            `Page ${pageNumber}: request failed ` +
              `(HTTP ${response.status}).`,
        );
      }

      if (!Array.isArray(payload.questions) && payload.done !== true) {
        throw new Error(
          `Page ${pageNumber}: response is missing the questions array.`,
        );
      }

      return payload;
    };

    try {
      const first = await requestPage(1);

      const slug = String(first.companySlug || input)
        .trim()
        .toLowerCase();

      const reportedPages = Number(first.totalPages);

      if (!Number.isSafeInteger(reportedPages) || reportedPages < 1) {
        throw new Error("The server returned an invalid total page count.");
      }

      const total = Math.min(reportedPages, MAX_FETCH_PAGES);

      const all: unknown[] = Array.isArray(first.questions)
        ? [...first.questions]
        : [];

      const failedPages: {
        page: number;
        error: string;
      }[] = [];

      let reachedEnd = first.done === true;

      for (let start = 2; start <= total && !reachedEnd; start += CONCURRENCY) {
        if (cancelRef.current) break;

        const end = Math.min(start + CONCURRENCY - 1, total);

        setProgress(
          start === end
            ? `Fetching page ${start} of ${total}…`
            : `Fetching pages ${start}–${end} of ${total}…`,
        );

        const pageNumbers = Array.from(
          { length: end - start + 1 },
          (_, index) => start + index,
        );

        const results = await Promise.allSettled(
          pageNumbers.map((pageNumber) => requestPage(pageNumber)),
        );

        // Results retain the requested page order.
        // A failed page does not discard successful pages.
        for (let index = 0; index < results.length; index++) {
          const result = results[index];
          const pageNumber = pageNumbers[index];

          if (result.status === "rejected") {
            failedPages.push({
              page: pageNumber,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            });

            continue;
          }

          const payload = result.value;
          const questions = Array.isArray(payload.questions)
            ? payload.questions
            : [];

          all.push(...questions);

          if (payload.done === true) {
            reachedEnd = true;
            break;
          }
        }

        if (reachedEnd || cancelRef.current) break;

        if (end < total) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      const normalized = all
        .map(normQuestion)
        .filter((question): question is Question => question !== null);

      const questions = dedupe(normalized);

      if (!questions.length) {
        throw new Error("No valid questions were returned.");
      }

      const name = resolveDisplayName(slug, input);

      const reportedTotal = Number(first.totalQuestions);
      const totalQuestions =
        Number.isSafeInteger(reportedTotal) && reportedTotal > 0
          ? reportedTotal
          : questions.length;

      setDatasets((previous) => ({
        ...previous,
        [slug]: {
          slug,
          company: name,
          questions,
          totalQuestions,
          failedPages,
          fetchedAt: new Date().toISOString(),
        },
      }));

      setSelected((previous) =>
        previous.includes(slug) ? previous : [...previous, slug],
      );

      setFetchInput("");

      const messages: string[] = [
        cancelRef.current
          ? `Stopped early. Saved ${questions.length.toLocaleString()} questions for ${name}.`
          : `Fetched ${questions.length.toLocaleString()} questions for ${name}.`,
      ];

      if (failedPages.length > 0) {
        messages.push(
          `${failedPages.length} page${
            failedPages.length === 1 ? "" : "s"
          } failed; this dataset may be incomplete.`,
        );
      }

      if (
        reportedPages > MAX_FETCH_PAGES &&
        !reachedEnd &&
        !cancelRef.current
      ) {
        messages.push(
          `Stopped at the safety limit of ${MAX_FETCH_PAGES} ` +
            `out of ${reportedPages} pages.`,
        );
      }

      setNotice(messages.join(" "));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      fetchingRef.current = false;
      cancelRef.current = false;

      setFetching(false);
      setProgress("");
    }
  };

  const importJson = async (file: File) => {
    setError("");
    setNotice("");
    try {
      const raw = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      const imported = parseImportedDatasets(raw, file.name, companies);
      const slugs = Object.keys(imported);
      setDatasets((prev) => {
        const next = { ...prev };
        for (const slug of slugs) {
          const questions = dedupe([
            ...(prev[slug]?.questions || []),
            ...imported[slug].questions,
          ]);
          next[slug] = {
            ...imported[slug],
            questions,
            totalQuestions: questions.length,
          };
        }
        return next;
      });
      setSelected((prev) => Array.from(new Set([...prev, ...slugs])));
      setMatchMode("or");
      setSearch("");
      setTile("All");
      setNotice(
        `Imported ${slugs.map((slug) => `${titleCase(slug)} (${imported[slug].questions.length})`).join(", ")}. Existing company data was merged.`,
      );
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportName = (selectedNames.join("_") || "questions")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

  const exportJson = () =>
    download(
      `${exportName}.json`,
      JSON.stringify(
        {
          companies: selectedNames,
          exportedAt: new Date().toISOString(),
          questions: filtered,
        },
        null,
        2,
      ),
      "application/json",
    );

  const exportCsv = () => {
    const head = [
      "Title",
      "Difficulty",
      "Acceptance %",
      "Frequency",
      "Companies",
      "Problem URL",
      "Solution URL",
    ];
    const lines = filtered.map((r) =>
      [
        r.title,
        r.difficulty,
        r.acceptanceRate ?? "",
        r.frequency ?? "",
        r.companies.join("; "),
        r.problemUrl,
        r.solutionUrl,
      ]
        .map(csvCell)
        .join(","),
    );
    download(
      `${exportName}.csv`,
      [head.map(csvCell).join(","), ...lines].join("\n"),
      "text/csv",
    );
  };

  /* ---------- render ---------- */
  const tiles: {
    key: TileFilter;
    label: string;
    color: string;
    bg: string;
    icon?: ReactNode;
    hint?: string;
  }[] = [
    {
      key: "All",
      label: "All",
      color: "var(--accent)",
      bg: "var(--accent-soft)",
    },
    {
      key: "Easy",
      label: "Easy",
      color: "var(--easy)",
      bg: "var(--easy-soft)",
    },
    {
      key: "Medium",
      label: "Medium",
      color: "var(--med)",
      bg: "var(--med-soft)",
    },
    {
      key: "Hard",
      label: "Hard",
      color: "var(--hard)",
      bg: "var(--hard-soft)",
    },
    {
      key: "MostAsked",
      label: "Most asked",
      color: "var(--hot)",
      bg: "var(--hot-soft)",
      icon: <FlameIcon className="h-3.5 w-3.5" />,
      hint: "Last 30 days",
    },
  ];

  return (
    <div className="fc-root min-h-screen" data-theme={theme}>
      <style>{THEME_CSS}</style>

      {/* ---------- header ---------- */}
      <header
        className="sticky top-0 z-40 border-b border-[var(--border)] backdrop-blur"
        style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <div className="fc-primary grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold">
              FC
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold sm:text-lg">
                namespace-learning
              </h1>
              <p className="hidden text-xs text-[var(--muted)] sm:block">
                Company-wise interview questions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="fc-btn fc-focus flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 text-sm font-medium"
            >
              <BuildingIcon />
              <span className="hidden sm:inline">Companies</span>
              {companies.length > 0 && (
                <span
                  className="rounded-md px-1.5 text-xs"
                  style={{
                    color: "var(--accent)",
                    background: "var(--accent-soft)",
                  }}
                >
                  {companies.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="fc-btn fc-focus grid h-10 w-10 place-items-center rounded-xl border border-[var(--border)] bg-[var(--panel)]"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        {/* ---------- fetch bar ---------- */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              fetchCompany();
            }}
          >
            <label className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 focus-within:border-[var(--accent)]">
              <BuildingIcon className="h-4 w-4 text-[var(--muted)]" />
              <input
                value={fetchInput}
                onChange={(e) => setFetchInput(e.target.value)}
                placeholder="Company name or slug (e.g. amazon, at&t)"
                disabled={fetching}
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
              />
            </label>
            <div className="flex gap-2">
              {fetching ? (
                <button
                  type="button"
                  onClick={() => (cancelRef.current = true)}
                  className="fc-btn fc-focus h-11 flex-1 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold sm:flex-none"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!fetchInput.trim()}
                  className="fc-primary fc-focus h-11 flex-1 rounded-xl px-5 text-sm font-semibold sm:flex-none"
                >
                  Fetch
                </button>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="fc-btn fc-focus flex h-11 items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 text-sm"
                title="Upload single-company or combined JSON"
              >
                <UploadIcon />
                <span>Upload JSON</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && importJson(e.target.files[0])
                }
              />
            </div>
          </form>

          <div aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">
            {fetching && (
              <span className="flex items-center gap-2 text-[var(--muted)]">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                {progress}
              </span>
            )}
            {!fetching && error && (
              <span style={{ color: "var(--hard)" }}>{error}</span>
            )}
            {!fetching && !error && notice && (
              <span style={{ color: "var(--easy)" }}>{notice}</span>
            )}
          </div>

          {/* ---------- loaded companies (multi-select) ---------- */}
          {loadedList.length > 0 && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Loaded companies · {selected.length} selected
                </span>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="fc-focus text-[var(--accent)] hover:underline"
                    onClick={() => setSelected(loadedList.map((d) => d.slug))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="fc-focus text-[var(--muted)] hover:underline"
                    onClick={() => setSelected([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="fc-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
                {loadedList.map((d) => {
                  const on = selected.includes(d.slug);
                  return (
                    <div
                      key={d.slug}
                      className="flex shrink-0 items-center overflow-hidden rounded-full border text-sm transition"
                      style={{
                        borderColor: on ? "var(--accent)" : "var(--border)",
                        background: on
                          ? "var(--accent-soft)"
                          : "var(--panel-2)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleCompany(d.slug)}
                        aria-pressed={on}
                        className="fc-focus flex items-center gap-1.5 py-1.5 pl-3 pr-2"
                        style={{ color: on ? "var(--accent)" : "var(--text)" }}
                        title={
                          d.failedPages.length
                            ? `${d.failedPages.length} page(s) failed during fetch`
                            : undefined
                        }
                      >
                        <span
                          className="grid h-4 w-4 place-items-center rounded border"
                          style={{
                            borderColor: on ? "var(--accent)" : "var(--muted)",
                            background: on ? "var(--accent)" : "transparent",
                            color: "#fff",
                          }}
                        >
                          {on && <CheckIcon className="h-3 w-3" />}
                        </span>
                        <span className="font-medium">{d.company}</span>
                        <span className="text-xs text-[var(--muted)]">
                          {d.questions.length.toLocaleString()}
                        </span>
                        {d.failedPages.length > 0 && (
                          <span style={{ color: "var(--med)" }}>!</span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCompany(d.slug)}
                        className="fc-focus py-1.5 pl-1 pr-2.5 text-[var(--muted)] hover:text-[var(--hard)]"
                        aria-label={`Remove ${d.company}`}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ---------- heading ---------- */}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-tight sm:text-2xl">
              {selectedNames.length === 0
                ? "No company selected"
                : selectedNames.length <= 3
                  ? selectedNames.join(" + ")
                  : `${selectedNames.slice(0, 3).join(" + ")} +${selectedNames.length - 3} more`}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {rows.length.toLocaleString()} unique questions
              {selectedNames.length > 1 && " across selected companies"}
            </p>
          </div>
          {filtered.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exportCsv}
                className="fc-btn fc-focus flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm"
              >
                <DownloadIcon /> CSV
              </button>
              <button
                type="button"
                onClick={exportJson}
                className="fc-btn fc-focus flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm"
              >
                <DownloadIcon /> JSON
              </button>
            </div>
          )}
        </div>

        {/* ---------- stat tiles ---------- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map((t, i) => (
            <div
              key={t.key}
              className={i === 4 ? "col-span-2 sm:col-span-1" : ""}
            >
              <StatTile
                label={t.label}
                count={counts[t.key]}
                color={t.color}
                bg={t.bg}
                icon={t.icon}
                hint={t.hint}
                active={tile === t.key}
                onClick={() =>
                  setTile((cur) =>
                    cur === t.key && t.key !== "All" ? "All" : t.key,
                  )
                }
              />
            </div>
          ))}
        </div>

        {selected.length > 1 && (
          <section
            aria-label="Company matching"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-sm text-[var(--muted)]">
              Company matching:
            </span>
            {(
              [
                {
                  value: "or",
                  label: "All",
                  hint: "Questions from any selected company, common and uncommon.",
                },
                {
                  value: "common",
                  label: "Common",
                  hint: "Questions found in every selected company.",
                },
                {
                  value: "uncommon",
                  label: "Uncommon",
                  hint: "Questions found in exactly one selected company.",
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={matchMode === option.value}
                title={option.hint}
                onClick={() => setMatchMode(option.value)}
                className="fc-focus rounded-xl border px-4 py-2 text-sm font-medium"
                style={{
                  borderColor:
                    matchMode === option.value
                      ? "var(--accent)"
                      : "var(--border)",
                  background:
                    matchMode === option.value
                      ? "var(--accent-soft)"
                      : "var(--panel)",
                  color:
                    matchMode === option.value
                      ? "var(--accent)"
                      : "var(--text)",
                }}
              >
                {option.label}
              </button>
            ))}
          </section>
        )}

        {/* ---------- search + sort ---------- */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 focus-within:border-[var(--accent)]">
            <SearchIcon className="h-4 w-4 text-[var(--muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions or companies…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-[var(--muted)]"
                aria-label="Clear search"
              >
                <XIcon />
              </button>
            )}
          </label>
          <Dropdown<SortKey>
            value={sort}
            options={SORT_OPTIONS}
            onChange={setSort}
            prefix="Sort:"
          />
        </div>

        {/* ---------- results ---------- */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted)]">
            {selected.length === 0
              ? "Select a company above, or fetch a new one."
              : "No questions match the current filters."}
          </div>
        ) : (
          <>
            {/* desktop / tablet table */}
            <div className="hidden overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="w-14 px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Question</th>
                    <th className="w-28 px-4 py-3 font-medium">Difficulty</th>
                    <th className="w-28 px-4 py-3 text-right font-medium">
                      Acceptance
                    </th>
                    <th className="w-40 px-4 py-3 font-medium">Frequency</th>
                    <th className="w-28 px-4 py-3 font-medium">Solution</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => (
                    <tr
                      key={(r.slug || r.title) + i}
                      className="fc-row border-b border-[var(--border)] last:border-0"
                    >
                      <td className="px-4 py-3 align-top tabular-nums text-[var(--muted)]">
                        {(safePage - 1) * PAGE_SIZE + i + 1}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {r.problemUrl ? (
                          <a
                            href={r.problemUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="fc-focus font-medium hover:text-[var(--accent)]"
                          >
                            {r.title}
                          </a>
                        ) : (
                          <span className="font-medium">{r.title}</span>
                        )}
                        <CopyProblemName title={r.title} />
                        <CompanyTags names={r.companies} max={4} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <DiffBadge d={r.difficulty} />
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums">
                        {r.acceptanceRate !== null ? (
                          `${r.acceptanceRate.toFixed(1)}%`
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <FreqBadge f={r.frequency} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <SolutionLink url={r.solutionUrl} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* mobile cards */}
            <ul className="space-y-2 md:hidden">
              {pageRows.map((r, i) => (
                <li
                  key={(r.slug || r.title) + i}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="mr-1.5 text-xs tabular-nums text-[var(--muted)]">
                        {(safePage - 1) * PAGE_SIZE + i + 1}.
                      </span>
                      {r.problemUrl ? (
                        <a
                          href={r.problemUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:text-[var(--accent)]"
                        >
                          {r.title}
                        </a>
                      ) : (
                        <span className="font-medium">{r.title}</span>
                      )}
                      <CopyProblemName title={r.title} />
                    </div>
                    <DiffBadge d={r.difficulty} />
                  </div>
                  <CompanyTags names={r.companies} max={3} />
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <FreqBadge f={r.frequency} />
                      {r.acceptanceRate !== null && (
                        <span className="text-[var(--muted)]">
                          {r.acceptanceRate.toFixed(1)}% acc.
                        </span>
                      )}
                    </div>
                    <SolutionLink url={r.solutionUrl} />
                  </div>
                </li>
              ))}
            </ul>

            {/* pagination */}
            <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-sm text-[var(--muted)]">
                Showing {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–
                {Math.min(
                  safePage * PAGE_SIZE,
                  filtered.length,
                ).toLocaleString()}{" "}
                of {filtered.length.toLocaleString()}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  className="fc-btn fc-focus h-9 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm disabled:opacity-40"
                >
                  Prev
                </button>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    goToPage();
                  }}
                >
                  <label htmlFor="page-number" className="text-sm">
                    Page
                  </label>
                  <input
                    id="page-number"
                    type="text"
                    inputMode="numeric"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    aria-describedby="page-message"
                    className="fc-focus h-9 w-16 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 text-center text-sm"
                  />
                  <span className="text-sm">/ {totalPages}</span>
                  <button
                    type="submit"
                    className="fc-primary fc-focus h-9 rounded-lg px-3 text-sm"
                  >
                    Go
                  </button>
                </form>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                  className="fc-btn fc-focus h-9 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
            <p
              id="page-message"
              role="status"
              aria-live="polite"
              className="text-center text-sm text-[var(--muted)]"
            >
              {pageMessage}
            </p>
          </>
        )}
      </main>

      <CompanyDialog
        open={dialogOpen}
        onClose={closeDialog}
        companies={companies}
        loadedSlugs={Object.keys(datasets)}
        onUse={(slug) => {
          setFetchInput(slug);
          setDialogOpen(false);
        }}
      />
    </div>
  );
}
