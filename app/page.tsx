"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Download, Upload, Code2, Building2, SlidersHorizontal, X, Check } from "lucide-react";

type Question = {
  company: string; companySlug: string; title: string; slug: string;
  difficulty: string; problemUrl: string; solutionUrl: string;
  rowText?: string; acceptanceRate?: number | null; frequencyLabel?: string | null;
};
type Dataset = { company: string; companySlug: string; expectedQuestions: number; extractedQuestions: number; questions: Question[] };

const PAGE_SIZE = 25;
const initialCompanies = [{ name: "Google", slug: "google", file: "/data/google_questions.json" }];

export default function Home() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [company, setCompany] = useState("Google");
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState("all");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("source");
  const [uploadError, setUploadError] = useState("");
  const [companyInput, setCompanyInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all(initialCompanies.map(async c => {
      const r = await fetch(c.file); if (!r.ok) throw new Error("Could not load dataset");
      return await r.json() as Dataset;
    })).then(setDatasets).catch(() => setUploadError("Could not load the starter dataset.")).finally(() => setLoaded(true));
  }, []);

  const companies = useMemo(() => datasets.map(d => d.company), [datasets]);
  const active = datasets.find(d => d.company === company) || datasets[0];
  const filtered = useMemo(() => {
    if (!active) return [];
    let rows = active.questions.filter(q =>
      (difficulty === "all" || q.difficulty.toLowerCase() === difficulty) &&
      q.title.toLowerCase().includes(query.trim().toLowerCase())
    );
    if (sort === "title") rows = [...rows].sort((a,b) => a.title.localeCompare(b.title));
    if (sort === "acceptance") rows = [...rows].sort((a,b) => (b.acceptanceRate ?? -1) - (a.acceptanceRate ?? -1));
    return rows;
  }, [active, difficulty, query, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, difficulty, company, sort]);

  async function fetchCompany() {
    const name = companyInput.trim();
    if (!name || fetching) return;
    setFetching(true); setFetchError(""); setFetchProgress("Contacting TalentD…");
    try {
      const requestPage = async (pageNumber: number) => {
        const response = await fetch("/api/company-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company: name, page: pageNumber })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
        return payload;
      };
      const first = await requestPage(1);
      const allQuestions = [...first.questions];
      const totalPages = Number(first.totalPages || 1);
      for (let start = 2; start <= totalPages; start += 4) {
        const batchPages = Array.from({length: Math.min(4, totalPages - start + 1)}, (_, i) => start + i);
        setFetchProgress(`Fetching pages ${start}–${batchPages[batchPages.length - 1]} of ${totalPages}…`);
        const batch = await Promise.all(batchPages.map(requestPage));
        for (const result of batch) allQuestions.push(...result.questions);
      }
      const unique = Array.from(new Map(allQuestions.map(q => [q.slug, q])).values());
      const dataset = {
        company: first.company,
        companySlug: first.companySlug,
        expectedQuestions: first.totalQuestions,
        extractedQuestions: unique.length,
        expectedPages: totalPages,
        failedPages: [],
        scrapedAt: new Date().toISOString(),
        source: "TalentD FleetCode",
        questions: unique
      };
      setDatasets(prev => [...prev.filter(d => d.companySlug !== dataset.companySlug), dataset]);
      setCompany(dataset.company);
      setCompanyInput("");
      setFetchProgress(`Fetched ${unique.length.toLocaleString()} questions.`);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Unable to fetch company data.");
      setFetchProgress("");
    } finally {
      setFetching(false);
    }
  }

  function downloadJson() {
    if (!active) return;
    const blob = new Blob([JSON.stringify(active, null, 2)], {type:"application/json;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `${active.companySlug}-questions.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.company || !Array.isArray(parsed.questions)) throw new Error("Expected a company JSON with a questions array.");
      const cleaned = parsed.questions.map((q: Question) => ({...q, acceptanceRate: q.acceptanceRate ?? (q.rowText?.match(/(\d+(?:\.\d+)?)%/) ? Number(q.rowText.match(/(\d+(?:\.\d+)?)%/)![1]) : null)}));
      const next = {...parsed, questions: cleaned};
      setDatasets(prev => [...prev.filter(d => d.companySlug !== next.companySlug), next]);
      setCompany(next.company);
      setUploadError("");
    } catch (e) { setUploadError(e instanceof Error ? e.message : "Invalid JSON file."); }
    if (fileRef.current) fileRef.current.value = "";
  }

  function exportCsv() {
    const headers = ["Company","Question","Difficulty","Acceptance rate","Frequency","Problem URL","Solution URL"];
    const rows = filtered.map(q => [q.company,q.title,q.difficulty,q.acceptanceRate == null ? "" : `${q.acceptanceRate}%`,q.frequencyLabel || "",q.problemUrl,q.solutionUrl]);
    const csv = [headers,...rows].map(row => row.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href=url; a.download=`${active?.companySlug || "questions"}-questions.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const counts = active?.questions.reduce((acc,q) => { const d=q.difficulty.toLowerCase(); acc[d]=(acc[d]||0)+1; return acc; }, {} as Record<string,number>) || {};
  return (
    <main className="min-h-screen">
      <header className="border-b border-white/[.07] bg-[#0c111b]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/15 text-blue-400"><Code2 size={20}/></div><div><div className="text-[15px] font-extrabold tracking-tight">Fleet<span className="text-blue-400">Code</span></div><div className="text-[10px] tracking-[.18em] text-slate-500">INTERVIEW PREP</div></div></div>
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-400"/> Local dataset workspace</div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-8 lg:grid-cols-[250px_minmax(0,1fr)] lg:px-8">
        <aside className="space-y-5">
          <div className="rounded-2xl border border-white/[.08] bg-[#101722] p-4">
            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-slate-400"><Building2 size={14}/> Companies</div>
            <div className="space-y-1">
              {companies.map(name => <button key={name} onClick={()=>setCompany(name)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${company===name?"bg-blue-500/15 text-blue-300":"text-slate-400 hover:bg-white/[.04] hover:text-white"}`}><span>{name}</span>{company===name&&<Check size={15}/>}</button>)}
              {companies.length===0 && <p className="text-xs text-slate-500">No company data loaded.</p>}
            </div>
            <button onClick={()=>fileRef.current?.click()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 px-3 py-3 text-xs font-semibold text-slate-400 hover:border-blue-400 hover:text-blue-300"><Upload size={14}/> Import company JSON</button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={e=>importFile(e.target.files?.[0])}/>
            <p className="mt-2 text-[11px] leading-5 text-slate-600">Add a saved company JSON, or fetch a company directly from TalentD using the server.</p>
            <div className="mt-4 border-t border-white/[.07] pt-4">
              <label className="mb-2 block text-xs font-semibold text-slate-300">Fetch from TalentD</label>
              <input value={companyInput} onChange={e=>setCompanyInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter") fetchCompany();}} placeholder="e.g. Amazon" className="w-full rounded-lg border border-white/10 bg-[#0b111a] px-3 py-2.5 text-sm outline-none placeholder:text-slate-600 focus:border-blue-400/60"/>
              <button onClick={fetchCompany} disabled={!companyInput.trim()||fetching} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50">{fetching?"Fetching…":"Fetch company questions"}</button>
              {fetchProgress&&<p className="mt-2 text-[11px] text-emerald-400">{fetchProgress}</p>}
              {fetchError&&<p className="mt-2 text-[11px] leading-4 text-rose-400">{fetchError}</p>}
            </div>
            {uploadError && <p className="mt-2 text-xs text-rose-400">{uploadError}</p>}
          </div>
          <div className="rounded-2xl border border-white/[.08] bg-[#101722] p-4">
            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-slate-400"><SlidersHorizontal size={14}/> Difficulty</div>
            <div className="space-y-1">
              {["all","easy","medium","hard"].map(d=><button key={d} onClick={()=>setDifficulty(d)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm capitalize ${difficulty===d?"bg-white/[.07] text-white":"text-slate-400 hover:bg-white/[.03]"}`}><span>{d==="all"?"All questions":d}</span><span className="font-mono text-xs text-slate-500">{d==="all"?(active?.questions.length??0):(counts[d]||0)}</span></button>)}
            </div>
          </div>
          <div className="rounded-2xl border border-blue-400/15 bg-blue-500/[.06] p-4"><div className="text-xs font-bold text-blue-300">Your dataset</div><p className="mt-2 text-xs leading-5 text-slate-400">This starter includes Google’s {active?.questions.length.toLocaleString() ?? "—"} questions. Import more company JSON files as you scrape them.</p></div>
        </aside>

        <section className="min-w-0">
          <div className="mb-7">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-blue-400">Company question bank</div>
            <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{active?.company || "Interview questions"}</h1><p className="mt-2 text-sm text-slate-500">Explore coding questions reported for {active?.company || "this company"} interviews.</p></div><div className="flex gap-2"><button onClick={downloadJson} disabled={!active} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/[.08] disabled:opacity-40"><Download size={15}/> Download JSON</button><button onClick={exportCsv} disabled={!filtered.length} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/[.08] disabled:opacity-40"><Download size={15}/> Export CSV</button></div></div>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Total questions",active?.questions.length ?? "—"],["Easy",counts.easy||0],["Medium",counts.medium||0],["Hard",counts.hard||0]].map(([label,value],i)=><div key={label} className="rounded-2xl border border-white/[.07] bg-[#101722] p-4"><div className="text-xs text-slate-500">{label}</div><div className={`mt-2 text-2xl font-bold ${i===1?"text-emerald-400":i===2?"text-amber-300":i===3?"text-rose-400":"text-white"}`}>{typeof value==="number"?value.toLocaleString():value}</div></div>)}
          </div>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1"><Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search questions..." className="w-full rounded-xl border border-white/[.09] bg-[#101722] py-3 pl-11 pr-10 text-sm outline-none placeholder:text-slate-600 focus:border-blue-400/60"/>{query&&<button onClick={()=>setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"><X size={15}/></button>}</div>
            <div className="relative"><select value={sort} onChange={e=>setSort(e.target.value)} className="h-full min-w-[170px] appearance-none rounded-xl border border-white/[.09] bg-[#101722] px-4 py-3 pr-9 text-sm text-slate-300 outline-none"><option value="source">Original order</option><option value="title">Title A–Z</option><option value="acceptance">Acceptance rate</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"/></div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#101722]">
            <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4"><div className="text-sm font-bold">Questions <span className="ml-1 font-normal text-slate-500">({filtered.length.toLocaleString()})</span></div><div className="text-[11px] text-slate-500">Showing {filtered.length?((page-1)*PAGE_SIZE+1):0}–{Math.min(page*PAGE_SIZE,filtered.length)} of {filtered.length}</div></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[690px] text-left text-sm">
                <thead className="bg-white/[.025] text-[10px] font-bold uppercase tracking-[.13em] text-slate-500"><tr><th className="w-14 px-5 py-3">#</th><th className="px-3 py-3">Question</th><th className="px-3 py-3">Acceptance</th><th className="px-3 py-3">Difficulty</th><th className="px-3 py-3">Frequency</th><th className="px-5 py-3 text-right">Links</th></tr></thead>
                <tbody className="divide-y divide-white/[.055]">
                  {visible.map((q,i)=><tr key={`${q.companySlug}-${q.slug}`} className="group hover:bg-white/[.025]"><td className="px-5 py-4 font-mono text-xs text-slate-600">{(page-1)*PAGE_SIZE+i+1}</td><td className="px-3 py-4"><div className="font-semibold text-slate-200">{q.title}</div><div className="mt-1 font-mono text-[10px] text-slate-600">{q.slug}</div></td><td className="px-3 py-4 font-mono text-xs text-slate-400">{q.acceptanceRate==null?"—":`${q.acceptanceRate}%`}</td><td className="px-3 py-4"><span className={`rounded-md px-2 py-1 text-[11px] font-semibold capitalize ${q.difficulty.toLowerCase()==="easy"?"bg-emerald-400/10 text-emerald-400":q.difficulty.toLowerCase()==="medium"?"bg-amber-400/10 text-amber-300":"bg-rose-400/10 text-rose-400"}`}>{q.difficulty}</span></td><td className="px-3 py-4 text-xs text-slate-500">{q.frequencyLabel||"—"}</td><td className="px-5 py-4"><div className="flex justify-end gap-3"><a href={q.problemUrl} target="_blank" rel="noreferrer" title="Open problem" className="text-slate-500 hover:text-blue-300"><ExternalLink size={16}/></a><a href={q.solutionUrl} target="_blank" rel="noreferrer" title="Open solution" className="text-slate-500 hover:text-blue-300"><Code2 size={16}/></a></div></td></tr>)}
                  {!visible.length&&<tr><td colSpan={6} className="px-5 py-14 text-center text-sm text-slate-500">No questions match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] px-5 py-4"><div className="text-xs text-slate-500">Page {page} of {totalPages}</div><div className="flex items-center gap-2"><button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[.06] disabled:opacity-30"><ChevronLeft size={16}/></button><span className="px-2 font-mono text-xs text-slate-400">{page} / {totalPages}</span><button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[.06] disabled:opacity-30"><ChevronRight size={16}/></button></div></div>
          </div>
          <p className="mt-4 text-center text-[11px] text-slate-600">Independent study tool. Question links open the original TalentD FleetCode pages.</p>
        </section>
      </div>
    </main>
  );
}
