# FleetCode Dashboard

A Next.js + Tailwind dashboard for browsing company-wise coding interview questions.

## Run locally
1. Install Node.js 18.17+.
2. In this folder, run:
   ```bash
   npm install
   npm run dev
   ```
3. Open http://localhost:3000

## Included data
`public/data/google_questions.json` contains the 2,325 Google questions from the uploaded scrape.

## Add another company
Use **Import company JSON** in the sidebar. The JSON must have:
- `company`: display name
- `companySlug`: unique slug
- `questions`: array with `title`, `slug`, `difficulty`, `problemUrl`, and `solutionUrl`
- Optional `rowText`, `acceptanceRate`, and `frequencyLabel`

The app attempts to extract acceptance rate from `rowText` when `acceptanceRate` is absent. Imported data stays in the current browser session; add it to `public/data` and the initial company list in `app/page.tsx` to make it part of a deployment.

## Deploy
Push the folder to GitHub, import the repository in Vercel, and deploy with the default Next.js settings.

## Notes
- This is a frontend starter; it does not scrape TalentD automatically.
- Add only datasets you are permitted to collect and use, and respect the source site's terms.
- Branding and layout are original and are not affiliated with TalentD.


## Fetch a company directly from TalentD
The sidebar includes a **Fetch from TalentD** field. Enter a company name such as `Amazon` and click **Fetch company questions**. The browser calls this app's `/api/company-page` endpoint; that Next.js server endpoint requests the TalentD company page, parses the question rows, and returns structured data. The browser fetches pages in small batches so each server request handles one page. When complete, use **Download JSON** to save the dataset or **Export CSV** for a spreadsheet.

The input is converted to a lowercase hyphenated company slug (for example, `Google` → `google`). If TalentD uses a different slug for a company, enter its exact slug instead. The source site may rate-limit requests or change its HTML structure. Large companies can take time to fetch. On Vercel, deploy this project with the Node.js runtime; function execution limits and the source site's availability may constrain very large scrapes. The endpoint only accepts a company name/slug, not an arbitrary URL.
