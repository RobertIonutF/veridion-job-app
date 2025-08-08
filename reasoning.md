# Reasoning and Approach

# Preface: AI and reasoning on its own
I used AI (more precisely, GPT‑5) not for “vibe‑coding,” but as a focused assistant. My approach was to drive toward the product requirements as a software engineer: define clear goals, have the AI draft pieces, then step in wherever it got stuck or produced problematic code. I first saved the requirements (the brief in `meta/req.md`) and guided the AI to the end result. I also added tests (unit and integration) and a tiny EJS + Tailwind frontend for easier validation.

# Steps
1. Guide the A.I towards the product requirements. (Step in when needed, e.g: applying a different algorithm, concept, etc)
2. Add tests
3. Optimize & Secure API & process
4. Documentation.
5. Deploy

# Why? Doesn’t this defeat the purpose of testing skills?
- My view: the primary goal is translating requirements into robust software. AI can accelerate this while I retain ownership of architecture, quality, and security. Treat initial drafts as fallible; harden and optimize them.
- What matters is that the code is readable, secure, optimized, documented, and working—maintainable for future changes. Using AI is a force multiplier when directed with engineering discipline. (“Artificial intelligence won’t replace software engineers; engineers who use AI will.”)

# Introduction
This document explains how I translated the requirements in `meta/req.md` into the implementation under `src/`, why I chose this stack, and the steps I followed to deliver a working end‑to‑end solution.

## What I understood from the brief
- Build an API that returns data about a company.
- First, extract signals (phones, socials, optional address) from a given list of websites.
- Analyze coverage/fill rates and make the process scalable to the full list.
- Merge the extracted signals with the provided company names dataset.
- Store/index the merged data so it can be queried by name, website, phone, or Facebook and return the best match.
- Validate the API using `data/API-input-sample.csv`.

## Architecture at a glance
- Scraper (`src/scraper/scrape.ts`)
  - Reads the list of websites, fetches HTML concurrently, extracts phones/socials/address.
  - Emits `out/scraped.json`.
- Merger (`src/ingest/merge.ts`)
  - Reads the names CSV and `scraped.json`, joins on website, emits `out/profiles.json`.
- Indexer (`src/search/buildIndex.ts`)
  - Builds a MiniSearch index over the profiles, emits `out/index.json`.
- API (`src/api/server.ts`)
  - Loads the index and exposes `/match` to return the best company profile.
  - A very small EJS UI helps with manual testing (interview convenience only).

All pieces read configuration from `.env` (with sane defaults) so I can tune concurrency, timeouts, inputs/outputs, and ports quickly.

## Why Node.js + TypeScript
- I wanted fast iteration, good HTTP performance, and a familiar ecosystem for scraping and text processing.
- TypeScript gives me safety and good refactoring ergonomics during the interview timeline.

## Key libraries and why I picked them
- `undici` (via `fetch`): modern, fast HTTP client; stable redirect handling; easy AbortController timeouts.
- `cheerio`: reliable server‑side HTML parsing, no headless browser overhead.
- `libphonenumber-js`: best‑in‑class for extracting/normalizing phone numbers.
- `csv-parse`: battle‑tested CSV ingestion for both website inputs and names.
- `minisearch`: tiny full‑text engine; great for a local index, no infra dependency; fast and embeddable.
- `fuse.js`: fuzzy lookup as a safety net when exact/strict candidates are missing.
- `fastify`: lightweight, fast HTTP server with good DX.
- `zod`: request validation without ceremony.
- `p-limit` + `cli-progress`: bounded concurrency and visibility while scraping.
- `dotenv`: a `.env` switchboard to make runs stable and reproducible.
- `vitest`: fast tests, watchable, and simple to stand up for both unit and integration layers.

## Step‑by‑step: how I built it
1) Bootstrapped the project with TypeScript and split concerns into `scraper/`, `ingest/`, `search/`, and `api/`.
2) Implemented the scraper:
   - Used `undici.fetch` with `redirect: 'follow'` and AbortController timeouts.
   - Added optional proxy and insecure TLS for stubborn hosts (dev only).
   - Built small extractors: phones with `libphonenumber-js`; social links (facebook/twitter/linkedin etc. by anchor pattern); best‑effort address.
   - Made the run concurrent (`CONCURRENCY`) and added a progress bar.
   - Logged counts so I can infer coverage/fill rates during runs.
3) Merged signals with names:
   - Read `sample-websites-company-names.csv` and mapped to websites.
   - Produced `profiles.json` with website, name, phones, social, address.
4) Indexed for search:
   - MiniSearch over `name`, `website`, `address` with `storeFields` for the API payloads.
   - Kept the serialized index and raw profiles together in `out/index.json`.
5) Built the API and matching:
   - `/match` accepts `name`, `website`, `phone`, `facebook`.
   - Matching/Scoring:
     - Website exact canonical match (+5).
     - Phone last‑10 digits match (+3) to ignore country code variance.
     - Facebook handle canonical match (+4) with `fb.com`/`m.`/`www.` normalization.
     - Name similarity via token Jaccard + Levenshtein tie‑breaker (up to +3 blended).
     - Domain token overlap to help when input site differs from the indexed site.
     - URL pre‑sanitization to repair typos like `https://https//...`.
   - Candidate discovery:
     - MiniSearch queries for text fields + exact canonical website matches.
     - If empty, fuzzy Fuse queries (and a looser second pass) and, as last resort, brute‑force scoring over the index.
   - Pagination/filter/sort for results so I can triage candidates quickly.
  - Performance: precomputed fields and lookup maps (see below), bounded workload caps, and simple timing metrics are included in responses (UI path) to observe latency.
6) Added a tiny EJS UI strictly for interview demo/testing (not for prod):
   - Home page form + a table sourced from `API-input-sample.csv` with one‑click Match.
   - Results page shows best match and candidates with sorting/filtering/pagination.
7) Wrote tests (TDD style on key parts):
   - Unit: extractors.
   - API unit-ish: `/match` for exact website, phone, facebook.
   - Integration: run sample CSV rows through the API; assert non‑zero scores for multiple noisy inputs; keep deterministic by using a fallback index when needed.

## How this lines up with the requirements
- 1.1 Extraction: phones, socials, and address are parsed from HTML; concurrency and timeouts keep it practical.
- 1.2 Analysis: I surface coverage/fill rates during runs via progress/log counts; easy to turn into a small report if needed.
- 1.3 Scaling: `CONCURRENCY`, `REQUEST_TIMEOUT_MS`, optional proxy support, and non‑blocking I/O scale the crawl; the scraper remains a simple pool without a heavy browser.
- 2.1 Storing: merged profiles are a compact JSON array and a MiniSearch index for fast lookup.
- 2.2 Querying: `/match` takes any subset of the four inputs and returns the best profile, with fuzzy/fallback logic to keep match rate high even with messy inputs.
- Validation: I exercise `API-input-sample.csv` in the integration test and via the UI table.

## Trade‑offs and alternatives I considered
- Full‑text server (Elasticsearch/Solr/Algolia) would be great at scale. I chose MiniSearch for zero‑infra and interview speed. The API boundary makes swapping the backend straightforward.
- Headless browser (Playwright/Puppeteer) could raise fill rates (JS‑rendered pages), but it increases time and resource cost; I stayed with HTTP + Cheerio for 10‑minute scale.
- I picked a heuristic, additive scorer. For production, I’d turn this into a learned ranker or at least calibrate weights on labeled data.

## Measuring accuracy
- The score is an interpretable proxy for confidence. The integration test enforces a floor on the number of rows with positive scores from the sample CSV.
- Next steps could include:
  - Track precision@1 on a labeled subset.
  - Log top‑k candidates to a CSV to facilitate manual QA and weight tuning.

## Performance optimizations applied
- Precomputed per‑profile features (AugProfile): canonical website host/path, domain tokens, normalized name + tokens, last‑10 digits set for phones, canonicalized Facebook handles.
- Built fast lookup maps: by canonical site, by phone last‑10, by Facebook handle, and by domain token.
- Fast scoring path that operates on precomputed features to avoid repeated allocations and parsing during requests.
- Workload caps: `MAX_CANDIDATES` to bound candidate expansion and `MAX_BRUTE_FORCE` to limit last‑resort scoring on large indexes (with sampling when needed).
- Timing metadata (gather/finalize/total ms) returned for the HTML UI to monitor performance.

## Security hardening and clean‑code refactor
- CSRF protection for browser form POSTs (cookie + hidden field); JSON API clients are unaffected.
- Strict CORS via `ORIGINS` allowlist; disabled by default.
- Security headers including CSP (allows Tailwind CDN script), HSTS in production, X‑Content‑Type‑Options, and others.
- Output link sanitization in EJS templates (`sanitizeHref`) to avoid `javascript:`/other schemes.
- Input validation via Zod with field length caps and safe parsing; central error and 404 handlers.
- In‑memory IP rate limiting with configurable window and max requests.
- Body size limit to reduce risk on large payloads.
- Clean‑code refactors across modules: clarified naming, small helpers for canonicalization/tokenization, and consistent structure. Behavior preserved; readability improved.

## Environment flags overview
- Scraper: `SCRAPE_INPUT`, `SCRAPED_OUT`, `CONCURRENCY`, `LIMIT`, `REQUEST_TIMEOUT_MS`, `DEBUG_SCRAPE`, `INSECURE_TLS`, optional `HTTPS_PROXY`/`HTTP_PROXY`.
- Merge/Index: `NAMES_INPUT`, `PROFILES_OUT`, `INDEX_PATH`.
- API: `PORT`, `ORIGINS` (CORS), `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `MAX_CANDIDATES`, `MAX_BRUTE_FORCE`, `API_INPUT_SAMPLE` for the demo UI.

## How to run
- Configure `.env` (copy from `.env.example`). Key knobs: `LIMIT`, `CONCURRENCY`, `REQUEST_TIMEOUT_MS`, `INDEX_PATH`, `PORT`.
- Pipeline: `npm run pipeline` (scrape → merge → index), then `npm start`.
- Dev server (auto‑reload API): `npm run dev`.
- Tests: `npm test` (unit + integration). For a richer integration run, execute the pipeline first.

## What I’d add with more time
- A lightweight coverage/fill‑rates report with CSV export.
- Smarter social and address extraction; add geocoding to normalize addresses.
- Replace fallback heuristics with a learned matching model; add calibration so scores map to probabilities.
- Optional: switch to an external search engine for large data volumes and add pagination APIs.

## AI assistance (controlled)
- I used AI in VS Code to speed up scaffolding (tests, small utilities, README snippets, and the demo EJS markup).
- I defined the architecture, data model, scoring, canonicalization, and scraper logic; I reviewed and edited every AI-suggested change.
- I avoided proprietary or licensed content; dependencies are open source and listed in `package.json`.
- Where AI was unsure or off, I wrote the code and debugging myself. The rationale and trade-offs are documented here.
- My aim was a scalable, fast solution; I guided AI to keep code minimal, typed, and production-pragmatic.

---
In short, I optimized for correctness under messy inputs, quick feedback, and simplicity: a robust scraper, a compact index, a pragmatic matching heuristic, and tests (plus a tiny demo UI) to validate the behavior expected by the brief.
