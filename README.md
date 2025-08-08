# Veridion Company Data API (Setup)

This project scrapes basic company data from a list of websites, merges with provided names, builds a local search index, and exposes a REST API to match and return the best company profile.

AI usage note: I used AI within Visual Studio Code as a focused assistant (not “vibe coding”). I guided it with explicit goals from `meta/req.md`, manually debugged and adjusted code where needed, and wrote pieces myself when the model’s direction wasn’t satisfactory. Tests were also assisted by AI to codify expected behavior, serving as executable acceptance criteria.

## Pipeline
1) Scrape websites from `data/sample-websites.csv` and extract phones, socials, address.
2) Merge with `data/sample-websites-company-names.csv` into `out/profiles.json`.
3) Build MiniSearch index at `out/index.json`.

## Configure
1) Copy the example env file and adjust values as needed:

```powershell
Copy-Item .env.example .env
```

2) Key settings (override by editing `.env`):
- SCRAPE_INPUT: input CSV of websites (default: data/sample-websites.csv)
- SCRAPED_OUT: scraped JSON output (default: out/scraped.json)
- NAMES_INPUT: company names CSV (default: data/sample-websites-company-names.csv)
- PROFILES_OUT: merged profiles output (default: out/profiles.json)
- INDEX_PATH: index file path for search/API (default: out/index.json)
- CONCURRENCY: parallel HTTP fetches (default: 40)
- LIMIT: number of rows to process (0 = all)
- REQUEST_TIMEOUT_MS: per-request timeout (default: 20000)
- DEBUG_SCRAPE: '1' to log scraper debug output
- INSECURE_TLS: '1' to ignore TLS errors (dev only)
- HTTPS_PROXY / HTTP_PROXY: proxy URL, if needed
- PORT: API port (default: 3000)
 - ORIGINS: comma-separated CORS allowlist (empty disables CORS)
 - RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS: in-memory IP rate limiting
 - MAX_CANDIDATES / MAX_BRUTE_FORCE: workload caps to keep latency predictable
 - API_INPUT_SAMPLE: path to sample inputs for the demo UI

## Run
```powershell
# 1) Install deps
npm install

# 2) Run the pipeline (scrape -> merge -> index) using .env
npm run pipeline

# 3) Start the API
npm start
# API: http://localhost:3000/health
# POST http://localhost:3000/match  body: { name?, website?, phone?, facebook? }
```

## Notes
- Scraper concurrency is limited via p-limit to 20 parallel fetches; adjust in `src/scraper/scrape.ts`.
- If scraping sites time out or block requests, you may see low coverage. The merge+index still work with names.
- Matching uses exact/normalized signals for website, phone, and Facebook plus fuzzy text search fallback.

## Security & performance
- Security headers and CSP are set; CORS is strict and controlled by `ORIGINS`.
- CSRF is enforced for browser form POSTs via a cookie + hidden input; JSON API clients are unaffected.
- In-memory rate limiting is enabled (configure with `RATE_LIMIT_*`).
- Workload caps (`MAX_CANDIDATES`, `MAX_BRUTE_FORCE`) bound scoring to keep p95 latency stable on large indexes.
- The `/match` response includes simple timing meta when using the HTML UI (gather/finalize/total ms) to help spot regressions.

### Scraper troubleshooting
- Turn on debug: set `DEBUG_SCRAPE=1` in `.env`
- Limit input size: set `LIMIT=25` in `.env`
- Insecure TLS (dev only): set `INSECURE_TLS=1` in `.env`
- Proxy: set `HTTPS_PROXY` or `HTTP_PROXY` in `.env`

Optional one-offs (PowerShell, without editing .env):

```powershell
$env:DEBUG_SCRAPE='1'; $env:LIMIT='10'; npm run scrape
$env:HTTPS_PROXY='http://127.0.0.1:8080'; npm run scrape
$env:INSECURE_TLS='1'; npm run scrape
```
