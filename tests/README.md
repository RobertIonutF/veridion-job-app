# Tests (Vitest)

Purpose
- Enable fast, repeatable feedback while evolving the scraper, indexer, and matching API.
- Document the intended behavior of the matching algorithm (what should match and why).

Scope
- Unit: `extractors.test.ts`
  - Validates HTML signal extraction (phones/socials/address) on controlled snippets.
  - Keeps parsing logic stable across refactors.
- API (unit-ish): `api.test.ts`
  - Spins a tiny in‑memory index and asserts `/match` works via single signals:
    - exact website, phone last‑10 digits, facebook handle.
- Integration: `integration.api-input-sample.test.ts`
  - Reads `data/API-input-sample.csv`.
  - Posts up to 30 inputs to `/match` and asserts multiple rows produce non‑zero scores (robustness to noisy inputs like `https//`).
  - Uses `out/profiles.json` when present (real pipeline data) or a tiny synthetic fallback so CI remains deterministic.

TDD approach
- Start with a small failing test capturing the desired behavior.
- Implement the minimal change (scraper, index, or scoring) to pass.
- Refactor with confidence—tests verify we haven’t regressed.
- Prefer deterministic fixtures; avoid live network calls in tests.

Running tests
- Fast run:
  - `npm test`
- Watch mode:
  - `npm run test:watch`
- Optional: to validate integration against real data, run the pipeline first (respects `.env`):
  - `npm run pipeline`

Extending
- Add "golden" match cases with known correct targets to tighten acceptance.
- Cover additional signals/normalizers (domain tokens, name Jaccard, phone variants).
- Track match rate over time by asserting a floor on the number of positive‑score rows in the integration test.

AI usage note
- I used AI in VS Code to help draft test scaffolds and assertions, then refined them to reflect the project’s expected outcomes and `meta/req.md`. The intent was controlled assistance to speed up codifying acceptance criteria—not auto‑generated test noise.
