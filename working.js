(async () => {
    const BASE = location.origin;
    const COMPANY = {
        name: "Google",
        slug: "google",
        url: `${BASE}/namespace-learning/companies/google`,
    };

    const WORKERS = 2;
    const DELAY_MS = 300;
    const MAX_REALISTIC_QUESTIONS = 10000; // Safety cap to block stray numbers

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function fetchPage(url) {
        const response = await fetch(url, {
            credentials: "same-origin",
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${url}`);
        }

        const html = await response.text();
        return new DOMParser().parseFromString(html, "text/html");
    }

    // Safely extract pagination avoiding false matches
    function getPagination(doc) {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        let node;

        while ((node = walker.nextNode())) {
            const text = node.nodeValue.trim();
            const match = text.match(
                /Showing\s+([\d,]+)\s*[-–—]\s*([\d,]+)\s+of\s+([\d,]+)/i,
            );

            if (!match) continue;

            const start = Number(match[1].replace(/,/g, ""));
            const end = Number(match[2].replace(/,/g, ""));
            const total = Number(match[3].replace(/,/g, ""));

            const perPage = end - start + 1;

            // Apply safety checks to ensure valid pagination numbers
            if (
                start !== 1 ||
                end < start ||
                total < end ||
                total > MAX_REALISTIC_QUESTIONS ||
                perPage <= 0 ||
                perPage > 100
            ) {
                continue;
            }

            return {
                total,
                perPage,
                pages: Math.ceil(total / perPage),
            };
        }

        return null;
    }

    function extractQuestions(doc) {
        return [...doc.querySelectorAll(".pr")]
            .map((row) => {
                const links = [...row.querySelectorAll("a[href]")];
                const rowText = row.innerText.trim();

                const findLink = (pattern) => {
                    const link = links.find((a) =>
                        pattern.test(`${a.textContent} ${a.getAttribute("href")}`),
                    );
                    return link ? new URL(link.getAttribute("href"), BASE).href : "";
                };

                const title =
                    row.getAttribute("data-title") ||
                    row.dataset.title ||
                    row.querySelector("a")?.textContent?.trim() ||
                    "";
                const slug = row.getAttribute("data-slug") || row.dataset.slug || "";
                const difficulty =
                    row.getAttribute("data-diff") || row.dataset.diff || "unknown";
                const rateMatch = rowText.match(/(\d+(?:\.\d+)?)\s*%/);

                return {
                    company: COMPANY.name,
                    companySlug: COMPANY.slug,
                    title,
                    slug,
                    difficulty: difficulty.toLowerCase(),
                    acceptanceRate: rateMatch ? Number(rateMatch[1]) : null,
                    problemUrl: findLink(/problem|question|leetcode/i),
                    solutionUrl: findLink(/solution|editorial/i),
                    rowText,
                };
            })
            .filter((q) => q.title || q.slug);
    }

    async function runWorkers(tasks, workerCount, callback) {
        let index = 0;

        async function worker() {
            while (index < tasks.length) {
                const task = tasks[index++];
                await callback(task);
                await sleep(DELAY_MS);
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(workerCount, tasks.length) }, () =>
                worker(),
            ),
        );
    }

    function download(filename, content, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function toCSV(data) {
        if (!data.length) return "";
        const columns = Object.keys(data[0]);
        const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

        return [
            columns.map(escape).join(","),
            ...data.map((row) => columns.map((col) => escape(row[col])).join(",")),
        ].join("\n");
    }

    try {
        console.log("Fetching Google page 1...");

        const firstPage = await fetchPage(COMPANY.url);
        const pagination = getPagination(firstPage);

        if (!pagination) {
            console.error("Could not verify Google pagination. Stopping safely.");
            console.log(
                "Visible pagination text:",
                firstPage.body.innerText.match(/Showing.{0,100}/i)?.[0],
            );
            return;
        }

        console.log("Google pagination verified:", pagination);

        let questions = extractQuestions(firstPage);
        console.log(`Page 1: extracted ${questions.length} questions`);

        // Create jobs for pages 2 onwards
        const jobs = Array.from({ length: pagination.pages - 1 }, (_, i) => i + 2);

        let completed = 0;
        const errors = [];

        await runWorkers(jobs, WORKERS, async (page) => {
            try {
                const url = `${COMPANY.url}?page=${page}`;
                const doc = await fetchPage(url);
                const pageQuestions = extractQuestions(doc);

                questions.push(...pageQuestions);
                completed++;

                console.log(
                    `Page ${page}/${pagination.pages}: ${pageQuestions.length} questions extracted`,
                );
            } catch (error) {
                errors.push({ page, error: error.message });
                console.error(`Page ${page} failed:`, error.message);
            }
        });

        // Remove duplicates
        const unique = [];
        const seen = new Set();

        for (const q of questions) {
            const key = q.slug || q.title;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            unique.push(q);
        }

        const result = {
            company: COMPANY.name,
            companySlug: COMPANY.slug,
            expectedQuestions: pagination.total,
            extractedQuestions: unique.length,
            expectedPages: pagination.pages,
            failedPages: errors,
            scrapedAt: new Date().toISOString(),
            questions: unique,
        };

        download(
            "google_questions.json",
            JSON.stringify(result, null, 2),
            "application/json",
        );
        download("google_questions.csv", toCSV(unique), "text/csv;charset=utf-8");

        console.log("--------------------------------");
        console.log("GOOGLE SCRAPING COMPLETE");
        console.log("--------------------------------");
        console.log("Expected questions:", pagination.total);
        console.log("Extracted questions:", unique.length);
        console.log("Expected pages:", pagination.pages);
        console.log("Failed pages:", errors.length);
        if (errors.length > 0) console.table(errors);
    } catch (error) {
        console.error("Scraper failed:", error);
    }
})();
