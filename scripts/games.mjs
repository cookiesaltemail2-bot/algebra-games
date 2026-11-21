// Builds public/games.json from two publisher catalogs whose games are licensed for embedding on any site
// (developers are paid through the ads inside the games). Runs on every deploy, so the list stays fresh.
// Each entry: n = name, u = game url, i = thumbnail, c = category, s = source key.
import { writeFileSync, existsSync } from 'node:fs';

const GM_PAGES = 4;  // 1000 games per page, newest first
const GD_PAGES = 20; // 100 games per page
const OUT = 'public/games.json';

// the two catalogs name some categories differently
const CATEGORY = { 'Racing & Driving': 'Racing', Shooter: 'Shooting', '.IO': 'IO', Hypercasual: 'Casual', Battle: 'Action' };
const cat = c => CATEGORY[c] || c || 'Other';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt === 4) { console.warn(`games: gave up on ${url}: ${e.message}`); return []; }
      await sleep(attempt * 5000); // GameMonetize answers 429 when asked too fast
    }
  }
}

// one page at a time: the catalogs rate-limit parallel requests
async function pages(count, url) {
  const all = [];
  for (let p = 1; p <= count; p++) all.push(...await getJson(url(p)));
  return all;
}

const [gm, gd] = await Promise.all([
  pages(GM_PAGES, p => `https://gamemonetize.com/feed.php?format=0&num=1000&page=${p}`),
  pages(GD_PAGES, p => `https://catalog.api.gamedistribution.com/api/v2.0/rss/All/?collection=all&categories=All&type=all&amount=100&page=${p}&format=json`),
]);

const seen = new Set();
const games = [
  ...gm.map(g => ({ n: g.title?.trim(), u: g.url, i: g.thumb, c: cat(g.category), s: 'gm' })),
  ...gd.map(g => ({ n: g.Title?.trim(), u: g.Url, i: g.Asset?.[0], c: cat(g.Category?.[0]), s: 'gd' })),
].filter(g => g.n && /^https:\/\//.test(g.u || '') && !seen.has(g.u) && seen.add(g.u));

// self-check: both sources should contribute, and every entry needs a name and https link
const counts = { gm: games.filter(g => g.s === 'gm').length, gd: games.filter(g => g.s === 'gd').length };
console.log(`games: ${games.length} total (GameMonetize ${counts.gm}, GameDistribution ${counts.gd})`);
if (!games.length) {
  // keep the last good list rather than wiping the games page when both catalogs are down
  if (existsSync(OUT)) { console.warn('games: both catalogs failed, keeping the existing list'); process.exit(0); }
  console.warn('games: both catalogs failed, writing an empty list');
}
if (!counts.gm || !counts.gd) console.warn('games: one catalog returned nothing this build');
writeFileSync(OUT, JSON.stringify(games));
