import 'dotenv/config';
import fs from 'node:fs';
import { readCsv, writeJson } from '../utils/csv.js';
import { extractFromHtml } from './extractors.js';
import pLimit from 'p-limit';
import { fetch as undiciFetch, setGlobalDispatcher, ProxyAgent, Agent } from 'undici';
import cliProgress from 'cli-progress';
import { Worker } from 'node:worker_threads';
import * as cheerio from 'cheerio';

async function main() {
  configureHttp();
  const websitesCsvPath = process.env.SCRAPE_INPUT || process.argv[2] || 'data/sample-websites.csv';
  const scrapedOutPath = process.env.SCRAPED_OUT || 'out/scraped.json';
  const rows = await readCsv(websitesCsvPath);
  let websites = rows.map((r) => (r.website || r.url || r.domain || '').trim()).filter(Boolean);
  const limitEnv = Number(process.env.LIMIT || 0);
  if (limitEnv > 0) websites = websites.slice(0, limitEnv);

  const concurrency = Number(process.env.CONCURRENCY || 30);
  const limit = pLimit(Math.max(1, concurrency));
  const useWorkers = process.env.WORKERS === '1';
  const bar = new cliProgress.SingleBar({ hideCursor: true, format: '[{bar}] {value}/{total} | {percentage}% | crawled:{crawled} phones:{phones} socials:{socials} addr:{addresses}' }, cliProgress.Presets.shades_classic);
  bar.start(websites.length, 0, { crawled: 0, phones: 0, socials: 0, addresses: 0 });
  let crawled = 0, phonesFound = 0, socialsFound = 0, addressesFound = 0;

  const results = await Promise.all(
    websites.map((url) => limit(async () => {
      try {
        const primary = normalizeUrl(url);
        const page = await fetchWithFallbacks(primary);
        if (page) {
          debug(`Fetched ${page.url} len=${page.html.length}`);
          let extract = extractFromHtml(page.html, page.url);
          if (!hasSignals(extract)) {
            const secondary = pickSecondaryUrls(page.html, page.url);
            for (const u of secondary) {
              const p2 = await fetchWithFallbacks(u);
              if (p2) {
                debug(`Fetched secondary ${p2.url} len=${p2.html.length}`);
                const ex2 = extractFromHtml(p2.html, p2.url);
                extract = mergeExtracts(extract, ex2);
                if (hasSignals(extract)) break;
              }
            }
          }
      crawled++;
      phonesFound += extract.phones.length ? 1 : 0;
      socialsFound += Object.values(extract.social).some((a) => a.length) ? 1 : 0;
      addressesFound += extract.address ? 1 : 0;
      bar.increment(1, { crawled, phones: phonesFound, socials: socialsFound, addresses: addressesFound });
          return { website: page.url, ...extract };
        }
      } catch (e: any) {
        debug(`Error fetching ${url}: ${e?.message || e}`);
      }
    bar.increment(1, { crawled, phones: phonesFound, socials: socialsFound, addresses: addressesFound });
    return { website: normalizeUrl(url), phones: [], social: {}, address: undefined };
    }))
  );

  if (!fs.existsSync('out')) fs.mkdirSync('out');
  writeJson(scrapedOutPath, { stats: { totalWebsites: websites.length, crawled, phonesFound, socialsFound, addressesFound }, data: results });
  bar.stop();
  console.log(`Scraped ${crawled}/${websites.length} sites. Saved to ${scrapedOutPath}`);
}

function normalizeUrl(u: string) {
  try {
    const url = new URL(u.startsWith('http') ? u : `https://${u}`);
    url.hash = '';
    return url.toString();
  } catch {
    return u;
  }
}

function defaultHeaders() {
  const uas = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
  ];
  const ua = uas[Math.floor(Math.random() * uas.length)];
  return {
    'user-agent': ua,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'upgrade-insecure-requests': '1'
  } as Record<string, string>;
}

function pickSecondaryUrls(html: string, base: string) {
  const $ = cheerio.load(html);
  const candidates: string[] = [];
  const patterns = [/contact/i, /contacts?/i, /about/i, /impressum/i, /legal/i, /support/i, /company/i, /who-we-are/i, /team/i];
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    const text = $(el).text() || '';
    if (patterns.some((p) => p.test(href) || p.test(text))) {
      try { candidates.push(new URL(href, base).toString()); } catch {}
    }
  });
  // de-duplicate and cap
  return Array.from(new Set(candidates)).slice(0, 3);
}

function mergeExtracts(a: { phones: string[]; social: Record<string, string[]>; address?: string }, b: { phones: string[]; social: Record<string, string[]>; address?: string }) {
  const phones = Array.from(new Set([...(a.phones||[]), ...(b.phones||[])]));
  const social: Record<string, string[]> = {};
  const keys = new Set([...Object.keys(a.social||{}), ...Object.keys(b.social||{})]);
  for (const k of keys) {
    social[k] = Array.from(new Set([...(a.social[k]||[]), ...(b.social[k]||[])]));
  }
  const address = a.address || b.address;
  return { phones, social, address };
}

function hasSignals(ex: { phones: string[]; social: Record<string, string[]>; address?: string }) {
  return ex.phones.length > 0 || Object.values(ex.social).some(a => a?.length);
}

async function fetchWithFallbacks(u: string): Promise<{ html: string; url: string } | null> {
  const tried = new Set<string>();
  const variants = buildUrlVariants(u);
  for (const v of variants) {
    if (tried.has(v)) continue; tried.add(v);
    for (let attempt = 0; attempt < 2; attempt++) {
      debug(`TRY ${v} (attempt ${attempt + 1})`);
      try {
        const controller = new AbortController();
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
  const tId = setTimeout(() => controller.abort(), timeoutMs);
        const res = await undiciFetch(v, {
          method: 'GET',
          headers: defaultHeaders(),
          redirect: 'follow',
          signal: controller.signal
        } as any);
        clearTimeout(tId);
        const ct = res.headers.get('content-type') || '';
        if (!res.ok) {
          debug(`GET ${v} -> ${res.status} ${res.statusText}`);
          continue;
        }
        if (!/text\/html|application\/xhtml\+xml/i.test(ct)) {
          debug(`GET ${v} -> content-type ${ct}, skipping`);
          continue;
        }
        const html = await res.text();
        const len = html?.length || 0;
        debug(`GET ${v} -> ${res.status} len=${len}`);
        if (len > 100) return { html, url: res.url || v };
      } catch (err: any) {
        debug(`ERR ${v} -> ${err?.message || String(err)}`);
        // retry next attempt/variant
      }
    }
  }
  return null;
}

function buildUrlVariants(u: string) {
  let host = u;
  try { host = new URL(u).host; } catch {}
  const bare = host.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const variants = [
    `https://${bare}/`,
    `http://${bare}/`,
    `https://www.${bare}/`,
    `http://www.${bare}/`,
    `https://${bare}/index.html`,
    `http://${bare}/index.html`,
    `https://www.${bare}/index.html`,
    `http://www.${bare}/index.html`,
    `https://${bare}/contact`,
    `https://www.${bare}/contact`,
    `https://${bare}/about`,
    `https://www.${bare}/about`,
  ];
  // de-dup
  return Array.from(new Set(variants));
}

function debug(msg: string) {
  if (process.env.DEBUG_SCRAPE) {
    console.log(`[scrape] ${msg}`);
  }
}

function configureHttp() {
  try {
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxy) {
      setGlobalDispatcher(new ProxyAgent(proxy));
      debug(`Using proxy: ${proxy}`);
    } else if (process.env.INSECURE_TLS === '1') {
      setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } } as any));
      debug(`Using insecure TLS (rejectUnauthorized=false)`);
    }
  } catch (e: any) {
    debug(`configureHttp error: ${e?.message || e}`);
  }
}

// Optional: parse HTML in a worker to offload CPU work when WORKERS=1
function parseHtmlInWorker(html: string, baseUrl: string): Promise<{ phones: string[]; social: Record<string, string[]>; address?: string }>{
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        const cheerio = require('cheerio');
        const { findPhoneNumbersInText } = require('libphonenumber-js/max');
        function digits(s){ return s.replace(/\D/g,''); }
        function normalizeUrl(u){ try{ const url=new URL(u); url.hash=''; url.search=''; return url.toString(); }catch{ return u; } }
        function extract(html, base){
          const $ = cheerio.load(html);
          const text = $('body').text();
          const phones = Array.from(new Set((findPhoneNumbersInText(text,'US')||[]).map(p=>p.number.number)));
          $('a[href^="tel:"]').each((_,el)=>{ const raw=String($(el).attr('href')||'').replace(/^tel:/,''); if(raw) phones.push(raw); });
          const social = { facebook: [], linkedin: [], twitter: [], instagram: [], youtube: [] };
          $('a[href]').each((_,el)=>{ const href=String($(el).attr('href')||''); const abs=new URL(href, base).toString();
            if(/facebook\.com\//i.test(abs)) social.facebook.push(abs);
            if(/linkedin\.com\//i.test(abs)) social.linkedin.push(abs);
            if(/twitter\.com\//i.test(abs) || /x\.com\//i.test(abs)) social.twitter.push(abs);
            if(/instagram\.com\//i.test(abs)) social.instagram.push(abs);
            if(/youtube\.com\//i.test(abs) || /youtu\.be\//i.test(abs)) social.youtube.push(abs);
          });
          const addr = $('address').first().text().trim() || undefined;
          for(const k of Object.keys(social)) social[k] = Array.from(new Set(social[k].map(normalizeUrl)));
          return { phones: Array.from(new Set(phones)), social, address: addr };
        }
        parentPort.on('message', (msg)=>{ try{ const out=extract(msg.html, msg.baseUrl); parentPort.postMessage({ ok:true, out }); }catch(e){ parentPort.postMessage({ ok:false, err: e && e.message ? e.message : String(e) }); } });
      `,
      { eval: true }
    );
    worker.once('message', (m:any) => { m.ok ? resolve(m.out) : reject(new Error(m.err)); worker.terminate(); });
    worker.once('error', (e:any) => { reject(e); worker.terminate(); });
    worker.postMessage({ html, baseUrl });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
