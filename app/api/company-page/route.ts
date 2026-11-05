import { NextRequest, NextResponse } from "next/server";
import { load } from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUESTIONS_PER_PAGE = 50;

function parseTotalCount(text: string): number | null {
  // Specifically captures the total count after "of" (e.g., "Showing 1 - 50 of 2,325")
  const match = text.match(/Showing\s+[\d,]+\s*[-–—]\s*[\d,]+\s+of\s+([\d,]+)/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const company = String(body.company || "").trim();
    const page = Number(body.page || 1);

    if (!company || company.length > 80) {
      return NextResponse.json({ error: "Enter a company name (maximum 80 characters)." }, { status: 400 });
    }
    if (!Number.isInteger(page) || page < 1 || page > 1000) {
      return NextResponse.json({ error: "Invalid page number." }, { status: 400 });
    }

    const slug = company.toLowerCase()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    if (!slug) return NextResponse.json({ error: "Could not create a company slug from that name." }, { status: 400 });

    const url = `https://www.talentd.in/fleetcode/companies/${encodeURIComponent(slug)}${page > 1 ? `?page=${page}` : ""}`;
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(18000)
    });

    if (!response.ok) {
      return NextResponse.json({
        error: response.status === 404
          ? `Company page not found for "${company}". Check the company spelling or TalentD company slug.`
          : `TalentD returned HTTP ${response.status} for ${company}.`
      }, { status: response.status === 404 ? 404 : 502 });
    }

    const html = await response.text();
    const $ = load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    
    const totalQuestions = parseTotalCount(bodyText);
    const rows: any[] = [];

    $(".pr").each((_, element) => {
      const row = $(element);
      const rowText = row.text().replace(/\s+/g, " ").trim();
      const title = String(row.attr("data-title") || row.find("[data-title]").attr("data-title") || row.find("a").first().text() || "").trim();
      let questionSlug = String(row.attr("data-slug") || row.find("[data-slug]").attr("data-slug") || "").trim();
      
      if (!questionSlug) {
        const href = row.find('a[href*="/fleetcode/problems/"]').first().attr("href") || "";
        questionSlug = href.split("/").filter(Boolean).pop() || "";
      }
      
      const difficulty = String(row.attr("data-diff") || row.find("[data-diff]").attr("data-diff") || "").trim().toLowerCase();
      if (!title || !questionSlug) return;
      
      const rateMatch = rowText.match(/(\d+(?:\.\d+)?)\s*%/);
      rows.push({
        company: company,
        companySlug: slug,
        title,
        slug: questionSlug,
        difficulty: difficulty || "unknown",
        acceptanceRate: rateMatch ? Number(rateMatch[1]) : null,
        frequencyLabel: /last\s+30\s+days/i.test(rowText) ? "Last 30 days" : null,
        problemUrl: `https://www.talentd.in/fleetcode/problems/${questionSlug}`,
        solutionUrl: `https://www.talentd.in/fleetcode/solutions/${questionSlug}`,
        rowText
      });
    });

    if (rows.length === 0) {
      return NextResponse.json({
        error: `No question rows were found for "${company}". The page layout may have shifted or you've exceeded the available pages.`
      }, { status: 422 });
    }

    // Safely calculate total pages using the fixed 50 items-per-page rule
    const totalPages = totalQuestions ? Math.ceil(totalQuestions / QUESTIONS_PER_PAGE) : page;

    return NextResponse.json({
      company, 
      companySlug: slug, 
      page, 
      pageSize: rows.length,
      totalQuestions: totalQuestions ?? rows.length,
      totalPages,
      questions: rows,
      sourceUrl: url
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: `Could not fetch TalentD data: ${message}` }, { status: 502 });
  }
}