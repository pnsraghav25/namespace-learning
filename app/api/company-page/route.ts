// app/api/company-page/route.ts
import { NextRequest, NextResponse } from "next/server";
import { load } from "cheerio";
import companies from "../../../public/companies.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://www.talentd.in";
const QUESTIONS_PER_PAGE = 50;
const MAX_REALISTIC_QUESTIONS = 10000;
const TIMEOUT_MS = 18000;

type Question = {
  title: string;
  slug: string;
  difficulty: "Easy" | "Medium" | "Hard" | "Unknown";
  acceptanceRate: number | null;
  frequency: string | null;
  problemUrl: string;
  solutionUrl: string;
  page: number;
};

type Pagination = { total: number; perPage: number };

/* ---------------- slug resolution ---------------- */

let slugMap: Map<string, string> | null = null;

function getSlugMap(): Map<string, string> {
  if (slugMap) return slugMap;
  const map = new Map<string, string>();
  const raw: any = companies;
  const list: any[] = Array.isArray(raw) ? raw : raw?.companies ?? [];

  for (const c of list) {
    const name = String(c?.name ?? c?.company ?? "").trim().toLowerCase();
    let slug = String(c?.slug ?? "").trim();
    if (!slug && c?.url) {
      slug = String(c.url).split("/companies/")[1]?.split(/[/?#]/)[0] ?? "";
    }
    if (name && slug) {
      map.set(name, slug);
      map.set(slug.toLowerCase(), slug);
    }
  }
  slugMap = map;
  return map;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9&]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveSlug(company: string): string {
  return getSlugMap().get(company.trim().toLowerCase()) ?? slugify(company);
}

/* ---------------- parsing helpers ---------------- */

function parsePagination($: ReturnType<typeof load>, rowsOnPage: number): Pagination | null {
  const re = /Showing\s+([\d,]+)\s*[-–—]\s*([\d,]+)\s+of\s+([\d,]+)/i;

  const textNodes: string[] = [];
  $("body")
    .find("*")
    .contents()
    .each((_, node: any) => {
      if (node.type === "text" && node.data) textNodes.push(String(node.data).trim());
    });

  for (const text of textNodes) {
    const m = text.match(re);
    if (!m) continue;
    const start = Number(m[1].replace(/,/g, ""));
    const end = Number(m[2].replace(/,/g, ""));
    const total = Number(m[3].replace(/,/g, ""));
    const perPage = end - start + 1;
    if (end >= start && total >= end && total <= MAX_REALISTIC_QUESTIONS && perPage > 0 && perPage <= 100) {
      return { total, perPage };
    }
  }

  const t = $("title").text().match(/\(([\d,]+)\)/);
  if (t) {
    const total = Number(t[1].replace(/,/g, ""));
    if (total > 0 && total <= MAX_REALISTIC_QUESTIONS) {
      return { total, perPage: rowsOnPage || QUESTIONS_PER_PAGE };
    }
  }
  return null;
}

function parseDifficulty(text: string): Question["difficulty"] {
  const m = text.match(/\b(Easy|Medium|Hard)\b/i);
  if (!m) return "Unknown";
  const d = m[1].toLowerCase();
  return d === "easy" ? "Easy" : d === "medium" ? "Medium" : "Hard";
}

function parseAcceptance(text: string, title: string): number | null {
  const rest = title ? text.replace(title, " ") : text;
  const re = /(\d{1,3}(?:\.\d+)?)\s*%/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) last = m[1];
  if (last === null) return null;
  const v = Number(last);
  return v >= 0 && v <= 100 ? v : null;
}

function parseFrequency(text: string): string | null {
  const m = text.match(
    /Last\s+\d+\s+(?:days?|weeks?|months?|years?)|More than\s+\d+\s+(?:months?|years?)|All time/i
  );
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

function absUrl(href: string | undefined): string {
  if (!href || href === "#" || href.trim() === "") return "";
  try {
    return new URL(href, BASE).toString();
  } catch {
    return "";
  }
}

/* ---------------- handler ---------------- */

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const company = String(body?.company ?? "").trim();
  const page = Math.max(1, Math.min(Number(body?.page) || 1, 500));
  if (!company) {
    return NextResponse.json({ error: "Company is required." }, { status: 400 });
  }

  const slug = resolveSlug(company);
  const url = `${BASE}/fleetcode/companies/${encodeURIComponent(slug)}${
    page > 1 ? `?page=${page}` : ""
  }`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 404 && page > 1) {
        return NextResponse.json({ company, companySlug: slug, page, questions: [], done: true });
      }
      return NextResponse.json(
        {
          error:
            response.status === 404
              ? `Company page not found for "${company}" (slug: ${slug}). Check the company spelling or TalentD company slug.`
              : `TalentD returned HTTP ${response.status} for ${company}.`,
        },
        { status: response.status === 404 ? 404 : response.status === 429 ? 429 : 502 }
      );
    }

    const html = await response.text();
    const $ = load(html);
    const rows = $(".pr");

    if (rows.length === 0) {
      if (page > 1) {
        return NextResponse.json({ company, companySlug: slug, page, questions: [], done: true });
      }
      return NextResponse.json({ error: `No question rows were found for "${company}".` }, { status: 422 });
    }

    const questions: Question[] = [];
    rows.each((_, el) => {
      const row = $(el);
      const rowText = row.text().replace(/\s+/g, " ").trim();

      const links = row.find("a[href]");
      const problemLink = links.filter((_, a) => /\/problems?\//i.test($(a).attr("href") || "")).first();
      const solutionLink = links.filter((_, a) => /solution/i.test($(a).attr("href") || "")).first();
      const titleEl = problemLink.length ? problemLink : links.first();

      const title = titleEl.text().replace(/\s+/g, " ").trim();
      const problemUrl = absUrl(titleEl.attr("href"));
      const slugFromUrl = problemUrl.split("/").filter(Boolean).pop() ?? "";

      if (!title && !slugFromUrl) return;

      questions.push({
        title: title || slugFromUrl,
        slug: slugFromUrl,
        difficulty: parseDifficulty(rowText),
        acceptanceRate: parseAcceptance(rowText, title),
        frequency: parseFrequency(rowText),
        problemUrl,
        solutionUrl: absUrl(solutionLink.attr("href")),
        page,
      });
    });

    const pg = parsePagination($, rows.length);
    const totalQuestions = pg ? pg.total : questions.length;
    const totalPages = pg ? Math.ceil(pg.total / pg.perPage) : page;

    return NextResponse.json({
      company,
      companySlug: slug,
      page,
      totalQuestions,
      totalPages,
      questions,
      done: page >= totalPages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not fetch TalentD data: ${msg}` }, { status: 502 });
  }
}
