import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import crypto from 'node:crypto';
import cors from '@fastify/cors';
import view from '@fastify/view';
import formbody from '@fastify/formbody';
import ejs from 'ejs';
import MiniSearch from 'minisearch';
import { z } from 'zod';
import Fuse from 'fuse.js';
import { readCsv } from '../utils/csv.js';
import type { CompanyProfile as Profile } from '../types.d.ts';


// Augmented profile with precomputed fields for faster matching
interface AugProfile extends Profile {
  _id: number;
  _canonSite: string;
  _host: string;
  _domainTokens: string[];
  _nameNorm: string;
  _nameTokens: string[];
  _last10Phones: Set<string>;
  _fbHandles: Set<string>;
}

function loadIndexFrom(indexPath: string) {
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const miniSearch = MiniSearch.loadJSON(
    JSON.stringify(raw.index),
    { fields: ['name', 'website', 'address'], storeFields: ['website', 'name', 'phones', 'social', 'address'], searchOptions: { prefix: true, fuzzy: 0.2 } }
  );
  const baseProfiles: Profile[] = raw.profiles;

  // Precompute augmented profiles and lookup maps
  const byCanonSite = new Map<string, number[]>();
  const byPhone10 = new Map<string, number[]>();
  const byFacebook = new Map<string, number[]>();
  const byDomainToken = new Map<string, number[]>();

  function addToIndex(map: Map<string, number[]>, k: string, idx: number) {
    if (!k) return;
    const arr = map.get(k);
    if (arr) arr.push(idx); else map.set(k, [idx]);
  }

  const profiles: AugProfile[] = baseProfiles.map((p: Profile, i: number) => {
    const _canonSite = canonicalUrl(p.website || '');
    const _host = getHost(p.website || '');
    const _domainTokens = _host ? tokenizeDomain(_host) : [];
    const _nameNorm = p.name ? normalizeString(p.name) : '';
    const _nameTokens = _nameNorm ? tokenizeName(_nameNorm) : [];
    const _last10Phones = new Set<string>((p.phones || []).map(lastTenDigits).filter(Boolean));
    const _fbHandles = new Set<string>((p.social?.facebook || []).map(canonicalFacebook).filter(Boolean));

    addToIndex(byCanonSite, _canonSite, i);
    for (const t of _domainTokens) addToIndex(byDomainToken, t, i);
    for (const ph of _last10Phones) addToIndex(byPhone10, ph, i);
    for (const fb of _fbHandles) addToIndex(byFacebook, fb, i);

    return { _id: i, _canonSite, _host, _domainTokens, _nameNorm, _nameTokens, _last10Phones, _fbHandles, ...p };
  });

  const fuzzyIndex = new Fuse(profiles, {
    keys: [ 'website', 'name', 'phones', 'social.facebook' ],
    includeScore: true,
    threshold: 0.3,
  });
  const fuzzyIndexLoose = new Fuse(profiles, {
    keys: [ 'website', 'name', 'phones', 'social.facebook' ],
    includeScore: true,
    threshold: 0.6,
  });

  return { mini: miniSearch, profiles, fuse: fuzzyIndex, fuseLoose: fuzzyIndexLoose, maps: { byCanonSite, byPhone10, byFacebook, byDomainToken } };
}

function scoreMatch(input: Partial<Profile>, candidate: AugProfile) {
  let score = 0;
  // Website exact canonical match
  if (input.website) {
    const wantCanon = canonicalUrl(input.website);
    if (wantCanon && wantCanon === candidate._canonSite) score += 5;
  }

  // Name exact or fuzzy match
  if (input.name && candidate.name) {
    const a = normalizeString(input.name);
    const b = candidate._nameNorm || normalizeString(candidate.name);
    if (a === b) {
      score += 3;
    } else {
      const j = jaccardSimilarity(tokenizeName(a), candidate._nameTokens || tokenizeName(b));
      if (j >= 0.8) score += 2;
      else if (j >= 0.5) score += 1.5;
      else if (j >= 0.3) score += 1;
      else if (j >= 0.25) score += 0.5;
      // light Levenshtein ratio as a tie-breaker (cheap for short names)
      const lev = levenshteinRatio(a, b);
      if (lev >= 0.9) score += 1.5;
      else if (lev >= 0.8) score += 1;
    }
  }

  // Website domain token overlap (helps when exact host doesn't exist in index)
  if (input.website) {
    const aHost = getHost(input.website);
    if (aHost) {
      const aTok = tokenizeDomain(aHost);
      const bTok = candidate._domainTokens;
      if (bTok && bTok.length) {
        const jw = jaccardSimilarity(aTok, bTok);
        if (jw >= 0.8) score += 2;
        else if (jw >= 0.6) score += 1.5;
        else if (jw >= 0.4) score += 1;
        else if (jw >= 0.25) score += 0.5;
      }
    }
  }

  // Phone last-10 match
  if (input.phones && input.phones.length) {
    for (const p of input.phones) { if (candidate._last10Phones.has(lastTenDigits(p))) { score += 3; break; } }
  }

  // Facebook handle match
  const inFb = input.social?.facebook?.[0] || (input as any).facebook;
  if (inFb) {
    const wantFb = canonicalFacebook(inFb);
    if (candidate._fbHandles.has(wantFb)) score += 4;
  }
  return score;
}

function normalizeText(s: string) { return s.toLowerCase().trim(); }
function digits(s: string) { return s.replace(/\D/g, ''); }
function last10(s: string) {
  const d = digits(s);
  return d.slice(-10); // compare by local 10 digits to ignore country code
}

function preSanitizeUrl(u: string) {
  let s = (u || '').trim();
  // Fix duplicated protocol like: https://https//example.com or http://http//example.com
  if (/^https?:\/\/https?:\/\//i.test(s)) {
    s = 'https://' + s.replace(/^https?:\/\/https?:\/\//i, '');
  }
  // Fix mixed form like 'https://https//example.com' (second scheme missing colon)
  s = s.replace(/:\/\/https\/\//i, '://');
  s = s.replace(/:\/\/http\/\//i, '://');
  // Fix missing colon like https//example.com or http//example.com
  s = s.replace(/^https\/\//i, 'https://');
  s = s.replace(/^http\/\//i, 'http://');
  return s;
}

function canonicalUrl(u: string) {
  try {
    const fixed = preSanitizeUrl(u);
    const url = new URL(fixed.includes('://') ? fixed : `https://${fixed}`);
    let host = url.hostname.toLowerCase();
    host = host.replace(/^www\./, '');
  let pathname = url.pathname || '/';
  if (pathname === '/' || pathname === '') return host;
  if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  return `${host}${pathname}`;
  } catch {
    return (u || '').toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/^https\/\//, '')
      .replace(/^http\/\//, '')
      .replace(/\/$/, '');
  }
}

function canonicalFacebook(u: string) {
  try {
    const url = new URL(u.includes('://') ? u : `https://${u}`);
    let host = url.hostname.toLowerCase()
      .replace(/^m\./, '')
      .replace(/^www\./, '')
      .replace(/^fb\.com$/, 'facebook.com');
    if (host !== 'facebook.com') return canonicalUrl(u); // fallback to generic canonicalization
    // keep only the first path segment as the page handle, strip trailing slashes & query
    const seg = url.pathname.replace(/\/+/g, '/').split('/').filter(Boolean)[0] || '';
    return `facebook.com/${seg}`;
  } catch {
    return u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^m\./, '').replace(/^fb\.com/, 'facebook.com').replace(/\/$/, '');
  }
}

export async function buildApp(indexPath?: string): Promise<FastifyInstance> {
  const app = Fastify({
    // Enable trust proxy if behind a proxy in some deployments
    trustProxy: true,
    logger: process.env.DEBUG_API ? { level: 'info' } : false,
    bodyLimit: 64 * 1024
  });
  // CORS: restrict by env ORIGINS (comma-separated) or disable by default
  const allowOrigins = (process.env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  await app.register(cors, allowOrigins.length ? {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, allowOrigins.includes(origin));
    },
    credentials: false
  } : { origin: false });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(view, {
    engine: { ejs },
    root: path.join(process.cwd(), 'src', 'views'),
    viewExt: 'ejs',
  });

  // Basic security headers + CSP (allow tailwind CDN script)
  app.addHook('onSend', async (req, res, payload) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('Referrer-Policy', 'no-referrer');
    res.header('Permissions-Policy', 'geolocation=()');
    if (process.env.NODE_ENV === 'production') {
      res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    const csp = [
      "default-src 'self'",
      "script-src 'self' https://cdn.tailwindcss.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'"
    ].join('; ');
    res.header('Content-Security-Policy', csp);
    return payload as any;
  });

  // Simple in-memory IP rate limiter
  const RATE_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
  const RATE_WIN = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const buckets = new Map<string, { n: number; reset: number }>();
  app.addHook('onRequest', async (req, res) => {
    if (req.url === '/health') return;
    const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString();
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now > b.reset) { b = { n: 0, reset: now + RATE_WIN }; buckets.set(ip, b); }
    b.n++;
    if (b.n > RATE_MAX) {
      res.code(429).send({ error: 'Too Many Requests', retryAfterMs: Math.max(0, b.reset - now) });
    }
  });

  const resolvedIndexPath = indexPath || process.env.INDEX_PATH || 'out/index.json';
  const { mini: miniSearch, profiles, fuse: fuzzyIndex, fuseLoose: fuzzyIndexLoose, maps } = loadIndexFrom(String(resolvedIndexPath));
  const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || 2000);
  const MAX_BRUTE_FORCE = Number(process.env.MAX_BRUTE_FORCE || 5000);
  type Scored = { idx: number; profile: Profile; score: number };
  // Cache for on-demand fallback from names dataset
  let namesFallback: Array<{ website: string; name?: string }> | null = null;
  async function getNamesFallback() {
    if (namesFallback) return namesFallback;
    try {
      const namesPath = process.env.NAMES_INPUT || 'data/sample-websites-company-names.csv';
      const rows = await readCsv(namesPath);
      namesFallback = rows.map(r => ({ website: r.website || r.domain || r.url || '', name: r.name || r.company_name || '' }))
        .filter(r => r.website);
    } catch {
      namesFallback = [];
    }
    return namesFallback;
  }

  const limitStr = (max: number) => z.string().trim().max(max).optional();
  const QuerySchema = z.object({
    name: limitStr(256),
    website: limitStr(2048),
    phone: limitStr(64),
    facebook: limitStr(2048),
    page: z.union([z.string(), z.number()]).optional(),
    perPage: z.union([z.string(), z.number()]).optional(),
    sort: z.enum(['score','name','website']).optional(),
    dir: z.enum(['asc','desc']).optional(),
    minScore: z.union([z.string(), z.number()]).optional(),
    contains: limitStr(256),
    csrf: z.string().optional(),
  });

  // CSRF token helpers for forms
  const CSRF_COOKIE = '__Host-csrf';
  function newCsrf() { return crypto.randomBytes(32).toString('hex'); }
  function setCsrf(res: any, token: string) {
    res.setCookie(CSRF_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60
    });
  }
  function sanitizeHref(u: string) {
    try {
      const url = new URL(u);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
      return '#';
    } catch { return '#'; }
  }

  app.get('/health', async () => ({ ok: true }));

  // Centralized error handling
  app.setErrorHandler((err, req, res) => {
    const status = (err as any).statusCode || (err as any).status || 500;
    const message = (err as any).message || 'Internal Server Error';
    const wantsHtml = (req.headers['accept'] || '').includes('text/html');
    if (wantsHtml) {
      res.code(status).type('text/html').send(`<h1>${status}</h1><pre>${escapeHtml(message)}</pre>`);
    } else {
      res.code(status).send({ error: message, status });
    }
  });
  app.setNotFoundHandler((req, res) => {
    const wantsHtml = (req.headers['accept'] || '').includes('text/html');
    if (wantsHtml) return res.code(404).type('text/html').send('<h1>404 Not Found</h1>');
    return res.code(404).send({ error: 'Not Found', status: 404 });
  });

  // UI: Home form + sample inputs table
  app.get('/', async (req, res) => {
    let samples: Record<string, string>[] = [];
    try {
      const samplePath = process.env.API_INPUT_SAMPLE || 'data/API-input-sample.csv';
      samples = await readCsv(samplePath);
    } catch (e) {
      // ignore; show empty table
      samples = [];
    }
    const csrfToken = newCsrf();
    setCsrf(res, csrfToken);
    return res.view('index.ejs', { q: {}, samples, profileCount: profiles.length, csrfToken, sanitizeHref });
  });

  app.post('/match', async (req, res) => {
    const parsed = QuerySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }
    const body = parsed.data;
    if (!body.name && !body.website && !body.phone && !body.facebook) {
      return res.code(400).send({ error: 'Provide at least one of: name, website, phone, facebook' });
    }

    // CSRF validation for browser form posts
    const ctype = String(req.headers['content-type'] || '');
    const isForm = ctype.includes('application/x-www-form-urlencoded') || ctype.includes('multipart/form-data');
    if (isForm) {
      const cookieToken = (req.cookies || {})[CSRF_COOKIE];
      if (!cookieToken || !body.csrf || body.csrf !== cookieToken) {
        return res.code(403).send({ error: 'Invalid CSRF token' });
      }
    }

  const t0 = Date.now();

    const candidates = new Set<number>();

    if (body.name) {
      miniSearch.search(body.name).forEach(r => candidates.add((r as any).id));
      // Token-level search improves recall for short/compound names
      tokenizeName(body.name).forEach(tok => miniSearch.search(tok).forEach(r => candidates.add((r as any).id)));
    }
    if (body.website) {
      // text search
      miniSearch.search(body.website).forEach(r => candidates.add((r as any).id));
      // exact canonical host/path match via map
      const want = canonicalUrl(body.website);
      const exact = maps.byCanonSite.get(want);
      if (exact && exact.length) exact.forEach(i => candidates.add(i));
      // domain tokens -> lookup map and text search to improve recall
      const host = getHost(body.website);
      const toks = tokenizeDomain(host);
      for (const tok of toks) {
        const ids = maps.byDomainToken.get(tok);
        if (ids && ids.length) ids.forEach(i => candidates.add(i));
        miniSearch.search(tok).forEach(r => candidates.add((r as any).id));
      }
    }
    if (body.phone) {
      const d10 = lastTenDigits(body.phone);
      const ids = maps.byPhone10.get(d10);
      if (ids && ids.length) ids.forEach(i => candidates.add(i));
    }
    if (body.facebook) {
      const wantFb = canonicalFacebook(body.facebook);
      const ids = maps.byFacebook.get(wantFb);
      if (ids && ids.length) ids.forEach(i => candidates.add(i));
      // handle tokens from facebook URL (e.g., totalseal, pistonrings)
      try {
        const h = new URL(body.facebook).pathname.split('/').filter(Boolean)[0] || '';
        h.split(/[._-]+/).filter(x => x.length > 2).forEach(tok => miniSearch.search(tok).forEach(r => candidates.add((r as any).id)));
      } catch {}
    }

    if (candidates.size === 0 && (body.name || body.website || body.phone || body.facebook)) {
  const q = [body.name, body.website, body.phone, body.facebook].filter(Boolean)!.join(' ');
  const fuseRes = fuzzyIndex.search(q).slice(0, 20);
      fuseRes.forEach(r => candidates.add(r.refIndex));
    }

    // Bound candidate set to avoid pathological inputs
    if (candidates.size > MAX_CANDIDATES) {
      const pruned = Array.from(candidates).slice(0, MAX_CANDIDATES);
      candidates.clear();
      pruned.forEach(id => candidates.add(id));
    }

    // Precompute input features for faster scoring
    const pre = {
      canonSite: body.website ? canonicalUrl(body.website) : '',
      host: body.website ? extractHost(body.website) : '',
      domainTokens: body.website ? domainTokens(extractHost(body.website)) : [],
      nameNorm: body.name ? normalizeText(body.name) : '',
      nameTokens: body.name ? nameTokens(normalizeText(body.name)) : [],
      phone10: body.phone ? last10(body.phone) : '',
      fbHandle: body.facebook ? canonicalFacebook(body.facebook) : ''
    };

    function fastScore(c: AugProfile): number {
      let score = 0;
      if (pre.canonSite && pre.canonSite === c._canonSite) score += 5;
      if (pre.nameNorm && c._nameNorm) {
        if (pre.nameNorm === c._nameNorm) score += 3; else {
          const j = jaccard(pre.nameTokens, c._nameTokens || []);
          if (j >= 0.8) score += 2; else if (j >= 0.5) score += 1.5; else if (j >= 0.3) score += 1; else if (j >= 0.25) score += 0.5;
          const lev = levenshteinRatio(pre.nameNorm, c._nameNorm);
          if (lev >= 0.9) score += 1.5; else if (lev >= 0.8) score += 1;
        }
      }
      if (pre.domainTokens.length && c._domainTokens.length) {
        const jw = jaccard(pre.domainTokens, c._domainTokens);
        if (jw >= 0.8) score += 2; else if (jw >= 0.6) score += 1.5; else if (jw >= 0.4) score += 1; else if (jw >= 0.25) score += 0.5;
      }
      if (pre.phone10 && c._last10Phones.has(pre.phone10)) score += 3;
      if (pre.fbHandle && c._fbHandles.has(pre.fbHandle)) score += 4;
      return score;
    }

  let scored: Scored[] = Array.from(candidates).map(i => ({ idx: i, profile: profiles[i], score: fastScore(profiles[i] as AugProfile) }));
  const t1 = Date.now();

    // If nothing scored or everything scored 0, use fuzzy text as a safety net
    if ((scored.length === 0 || scored.every(s => s.score === 0)) && (body.name || body.website || body.phone || body.facebook)) {
      const q = [body.name, body.website, body.phone, body.facebook].filter(Boolean)!.join(' ');
      let fuseRes = fuzzyIndex.search(q).slice(0, 10);
      if (fuseRes.length === 0) {
        // Looser fallback for very small indexes or noisy input (prebuilt)
        fuseRes = fuzzyIndexLoose.search(q).slice(0, 10);
      }
      if (fuseRes.length) {
        scored = fuseRes.map(r => ({ idx: r.refIndex, profile: profiles[r.refIndex], score: Math.max(0.1, (1 - (r.score ?? 1)) * 0.5) }));
      } else {
        // Last resort: brute-force score across all profiles and surface the top few
        const inputForScore = {
          website: body.website,
          name: body.name,
          phones: body.phone ? [body.phone] : undefined,
          social: body.facebook ? { facebook: [body.facebook] } : undefined,
        } as Partial<Profile>;
        const N = profiles.length;
        const cap = Math.min(MAX_BRUTE_FORCE, N);
        // If very large, sample a window to bound runtime
        if (N > cap) {
          const step = Math.max(1, Math.floor(N / cap));
          const subset: number[] = [];
          for (let i = 0; i < N && subset.length < cap; i += step) subset.push(i);
          scored = subset.map((i) => ({ idx: i, profile: profiles[i], score: fastScore(profiles[i] as AugProfile) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
        } else {
          scored = profiles.map((p, i) => ({ idx: i, profile: p, score: fastScore(p as AugProfile) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
        }
      }
    }

    // Defaults for sort/filter/pagination
    const page = Math.max(1, Number((body as any).page ?? 1) || 1);
    const perPage = Math.min(50, Math.max(5, Number((body as any).perPage ?? 10) || 10));
    const sortKey = ((body as any).sort as 'score'|'name'|'website') || 'score';
    const dir = ((body as any).dir as 'asc'|'desc') || 'desc';
    const minScore = Number((body as any).minScore ?? '') || 0;
    const contains = ((body as any).contains || '').toString().toLowerCase().trim();

    // Apply filter
  let list: Scored[] = scored;
    if (minScore > 0) list = list.filter(s => (s.score || 0) >= minScore);
    if (contains) list = list.filter(s =>
      (s.profile.name || '').toLowerCase().includes(contains) ||
      (s.profile.website || '').toLowerCase().includes(contains)
    );

    // Sort
    list.sort((a, b) => {
      const mul = dir === 'asc' ? 1 : -1;
      if (sortKey === 'name') return mul * ((a.profile.name || '').localeCompare(b.profile.name || ''));
      if (sortKey === 'website') return mul * ((a.profile.website || '').localeCompare(b.profile.website || ''));
      return mul * (((a.score || 0) - (b.score || 0)));
    });

    // If still empty, search the names dataset as a last-resort UI helper (doesn't affect API JSON semantics)
    if (!scored.length) {
      const names = await getNamesFallback();
      if (names.length) {
        const namesFuse = new Fuse(names, { keys: ['name', 'website'], includeScore: true, threshold: 0.6 });
        const q = [body.name, body.website, body.phone, body.facebook].filter(Boolean)!.join(' ');
        const nf = namesFuse.search(q).slice(0, 10);
        if (nf.length) {
          list = nf.map((r, idx) => ({ idx, profile: { website: r.item.website, name: r.item.name, phones: [], social: {} }, score: Math.max(0.1, (1 - (r.score ?? 1)) * 0.4) }));
        }
      }
    }
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const pageClamped = Math.min(page, totalPages);
    const start = (pageClamped - 1) * perPage;
    const paged = list.slice(start, start + perPage);
    const best = list[0]?.profile || null;
  const t2 = Date.now();
  const timings = { gatherMs: t1 - t0, finalizeMs: t2 - t1, totalMs: t2 - t0 };
    // If the request is from browser form (HTML), render template; otherwise JSON
  const wantsHtml = (req.headers['accept'] || '').includes('text/html') || (req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
    if (wantsHtml) {
      const csrfToken = newCsrf();
      setCsrf(res, csrfToken);
      return res.view('results.ejs', { best, candidates: paged, input: body, profileCount: profiles.length, meta: { total, totalPages, page: pageClamped, perPage, sort: sortKey, dir, minScore, contains, timings }, csrfToken, sanitizeHref });
    }
    return res.send({ best, candidates: paged, meta: { total, totalPages, page: pageClamped, perPage, sort: sortKey, dir, minScore, contains, timings } });
  });

  return app;
}

async function main() {
  const app = await buildApp(process.env.INDEX_PATH);
  const port = Number(process.env.PORT || 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`API running on http://localhost:${port}`);
}

// Run main() only when executed directly (robust across tsx/Windows paths)
try {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const thisFile = fileURLToPath(import.meta.url);
  if (invoked && path.resolve(thisFile) === invoked) {
    main().catch((e) => { console.error(e); process.exit(1); });
  }
} catch (e) {
  // Fallback: if detection fails, don't auto-run (keeps tests/imports safe)
}

// Lightweight text utils for fuzzy scoring
const STOP = new Set(['inc','inc.','co','co.','llc','ltd','ltd.','pty','pty.','plc','corp','corp.','company','companies','gmbh','srl','sa','bv','nv','llp','pc','p.c.','lp','pllc','pte','ag','usa','us','the','and','&']);
function nameTokens(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map(t => t.trim())
    .filter(t => t.length > 1 && !STOP.has(t));
}
function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}
function extractHost(u: string) {
  try {
    const fixed = preSanitizeUrl(u);
    const url = new URL(fixed.includes('://') ? fixed : `https://${fixed}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return (u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}
const COMMON_TLDS = new Set(['com','org','net','io','co','us','uk','ca','de','fr','au','nz','in','info','biz','edu','gov','me']);
function domainTokens(host: string) {
  const parts = host.split('.');
  if (parts.length > 1 && COMMON_TLDS.has(parts[parts.length - 1])) parts.pop();
  const core = parts.join('.');
  return core
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map(t => t.trim())
    .filter(t => t.length > 1 && !STOP.has(t));
}
function levenshteinRatio(a: string, b: string) {
  const m = a.length, n = b.length;
  if (!m && !n) return 1;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  const dist = dp[m][n];
  const maxLen = Math.max(m, n);
  return maxLen ? 1 - dist / maxLen : 1;
}

export { scoreMatch, canonicalUrl, canonicalFacebook };

// Simple HTML escape for error messages
function escapeHtml(str: string) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Clean-code convenience aliases (backwards compatible)
function normalizeString(s: string) { return normalizeText(s); }
function lastTenDigits(s: string) { return last10(s); }
function tokenizeName(s: string) { return nameTokens(s); }
function tokenizeDomain(host: string) { return domainTokens(host); }
function getHost(u: string) { return extractHost(u); }
function jaccardSimilarity(a: string[], b: string[]) { return jaccard(a, b); }
