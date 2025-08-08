# Views (EJS) – interview convenience only

These EJS templates exist solely to make the backend easy to test and demo during the interview:

- Provide a simple form to POST to `/match` without external tools.
- Show a table of sample inputs (from `data/API-input-sample.csv`) to one‑click exercise the API.
- Render results with basic sorting, filtering, and pagination to inspect the matching behavior quickly.

Notes
- This UI is not intended for production. In a real task (unless explicitly required), the backend would ship without server‑rendered views, or a separate frontend would be used (SPA/SSR) with proper build, routing, and tests.
- The templates are minimal on purpose: Tailwind via CDN, no build step, no client framework, no auth/session/state.
- API contracts are unchanged; the pages only submit forms to the same `/match` endpoint used by automated tests.
- Security: EJS escapes by default, but a production UI would still require a full security review (CSP, input validation, CSRF, etc.).

Reviewer guidance
- Treat this folder as a developer aid for quick manual testing and debugging.
- It can be ignored or removed without affecting the API functionality.

AI usage note
- I used AI in VS Code as a focused helper to speed up this minimal demo UI. I kept control of structure and behavior and avoided heavy “vibe coding.” The goal was purely to enhance backend testing and visualization for the interview context.
