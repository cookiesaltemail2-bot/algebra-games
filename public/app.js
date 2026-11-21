// ---------- storage ----------
const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---------- settings ----------
const ACCENTS = ['#f3b562', '#e8744f', '#f4f4f5', '#f87171', '#facc15', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6'];
const FONTS = {
  Sora: 'Sora:wght@200;400;500;600;700;800',
  Outfit: 'Outfit:wght@200;400;500;700;800',
  Lexend: 'Lexend:wght@200;400;500;700;800',
  Inter: 'Inter:wght@200;400;500;700;800',
  'Space Grotesk': 'Space+Grotesk:wght@300;400;500;700',
  'JetBrains Mono': 'JetBrains+Mono:wght@200;400;500;700;800',
  System: null,
};
const ENGINES = {
  duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q=%s'],
  google: ['Google', 'https://www.google.com/search?q=%s'],
  bing: ['Bing', 'https://www.bing.com/search?q=%s'],
  brave: ['Brave', 'https://search.brave.com/search?q=%s'],
};
const DEFAULT_SETTINGS = {
  v: 3, accent: '#f3b562', matchAccent: false, interactive: true, density: 30, speed: 1, dim: 0, font: 'Sora', reduceMotion: false,
  showClock: true, clock24: false, hints: true, showBookmarks: true,
  engine: 'duckduckgo', proxy: true, relay: 'fly', wisp: '',
};
const SKEY = 'algebra.settings';
const stored = read(SKEY) || {};
if (!stored.v) {
  // saved before the redesign: the old defaults were stored too, so drop them to pick up the new look
  if (stored.accent === '#f4f4f5') delete stored.accent;
  if (stored.font === 'Outfit') delete stored.font;
}
if (stored.v === 2 && stored.accent === '#d4f55c') delete stored.accent; // last season's default lime
let settings = { ...DEFAULT_SETTINGS, ...stored, v: DEFAULT_SETTINGS.v };
const osReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const reduced = () => settings.reduceMotion || osReduce;
const FLY_WISP = 'wss://algebra-wisp.fly.dev/'; // wisp-server/ on Fly.io: reaches every site, Cloudflare-hosted ones too
const cloudflareRelay = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/wsproxy/`;

// ---------- animated wave background ----------
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
const STEP = 10;     // px between points along each strand
const MAX_PULL = 70; // px the cursor can drag the ribbon, keeps it from stretching
let W, H, t = 0, dirty = true;
const rest = () => ({ x: innerWidth * 0.7, y: innerHeight * 0.35 });
let mouse = rest();
const eased = { ...mouse };

function resize() {
  const dpr = devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dirty = true;
}
addEventListener('resize', resize);
addEventListener('pointermove', e => { mouse = { x: e.clientX, y: e.clientY }; });
document.addEventListener('pointerleave', () => { mouse = rest(); });

// y of strand p (0..1) at screen x: a ribbon rising bottom-left -> top-right.
// Its thickness never drops below 40%, so strands never pile into a bright blur.
function strandY(x, p) {
  const u = x / W;
  const center = H * (0.92 - 0.6 * u) + H * 0.06 * Math.sin(u * 4 + t * 0.5);
  const thick = H * 0.16 * (0.7 + 0.3 * Math.sin(u * 2.6 - t * 0.35));
  const drape = H * 0.035 * Math.sin(u * 6 + p * 2.4 + t * 0.8); // strands fan apart a little
  const y = center + thick * (p - 0.5) * 2 + drape;
  const d = (x - eased.x) / (W * 0.18);
  const pull = Math.max(-MAX_PULL, Math.min(MAX_PULL, (eased.y - y) * 0.35));
  return y + pull * Math.exp(-d * d);
}

function waveRGB() {
  if (!settings.matchAccent) return '255,255,255';
  const h = settings.accent.slice(1);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
}

function draw() {
  const lines = settings.density, rgb = waveRGB();
  ctx.clearRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  const cols = Math.ceil(W / STEP) + 1;
  const rows = [];
  for (let i = 0; i < lines; i++) {
    const p = i / (lines - 1);
    const row = new Float32Array(cols);
    ctx.beginPath();
    for (let j = 0; j < cols; j++) {
      row[j] = strandY(j * STEP, p);
      j ? ctx.lineTo(j * STEP, row[j]) : ctx.moveTo(0, row[j]);
    }
    ctx.strokeStyle = `rgba(${rgb},${0.08 + 0.2 * Math.sin(p * Math.PI)})`;
    ctx.stroke();
    rows.push(row);
  }
  // faint cross-strands give the mesh look
  ctx.strokeStyle = `rgba(${rgb},0.032)`;
  ctx.beginPath();
  for (let j = 0; j < cols; j += 3) {
    ctx.moveTo(j * STEP, rows[0][j]);
    for (let i = 1; i < lines; i++) ctx.lineTo(j * STEP, rows[i][j]);
  }
  ctx.stroke();
}

function frame() {
  // the wave belongs to home; everywhere else it is hidden and idle (keeps games smooth)
  const home = document.body.dataset.view === 'home';
  if (home && !document.body.classList.contains('browsing') && (dirty || !reduced())) {
    if (!reduced()) {
      t += 0.006 * settings.speed;
      const target = settings.interactive ? mouse : rest();
      eased.x += (target.x - eased.x) * 0.05;
      eased.y += (target.y - eased.y) * 0.05;
    }
    draw();
    dirty = false;
  }
  requestAnimationFrame(frame);
}

// ---------- clock + greeting ----------
const dayPart = (h = new Date().getHours()) =>
  h < 5 ? 'up late' : h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : 'good evening';
const clock = document.getElementById('clock');
const greet = document.getElementById('greet');
function tick() {
  const now = new Date();
  const h = now.getHours();
  clock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !settings.clock24 });
  const part = dayPart(h);
  greet.textContent = `${part} · ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase()}`;
}
setInterval(tick, 1000);

// ---------- toast ----------
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4000);
}

// ---------- search ----------
function toUrl(q, engine = 'duckduckgo') {
  if (/^https?:\/\//i.test(q)) return q;
  if (/^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(q)) return 'https://' + q;
  return (ENGINES[engine] || ENGINES.duckduckgo)[1].replace('%s', encodeURIComponent(q));
}
console.assert(toUrl('youtube.com') === 'https://youtube.com', 'domain');
console.assert(toUrl('https://a.io/x') === 'https://a.io/x', 'full url');
console.assert(toUrl('solve x^2', 'google') === 'https://www.google.com/search?q=solve%20x%5E2', 'engine');

const input = document.getElementById('q');
document.getElementById('search').addEventListener('submit', e => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) go(toUrl(q, settings.engine));
});
addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
});

const HINTS = ['search something here', 'type a url or a question', 'solve for x', 'press / to search anytime', 'what are we playing today'];
let hint = 0;
setInterval(() => {
  if (settings.hints && !input.value) input.placeholder = HINTS[hint = (hint + 1) % HINTS.length];
}, 4000);

// ---------- proxy browser (Scramjet) ----------
const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
  files: { wasm: '/scram/scramjet.wasm.wasm', all: '/scram/scramjet.all.js', sync: '/scram/scramjet.sync.js' },
});
scramjet.init();
const connection = new BareMux.BareMuxConnection('/baremux/worker.js');

const browser = document.getElementById('browser');
const frameWrap = document.getElementById('frame-wrap');
const barUrl = document.getElementById('bar-url');
let sjFrame, transportKey;

// Built-in relay: one WebSocket per connection (wsproxy), which dodges Cloudflare's
// 50-connections-per-invocation cap. A custom server is assumed to speak Wisp.
// A custom server wins; otherwise the Fly Wisp server, or the Cloudflare backup relay
// (one WebSocket per connection, which dodges Cloudflare's 50-connections-per-invocation cap).
const relayOptions = () => settings.wisp ? { websocket: settings.wisp }
  : settings.relay === 'cloudflare' ? { websocket: cloudflareRelay(), transport: 'wsproxy' }
  : { websocket: FLY_WISP };

async function ensureTransport() {
  const opts = relayOptions(), key = JSON.stringify(opts);
  if (transportKey === key) return;
  await connection.setTransport('/libcurl/index.mjs', [opts]);
  transportKey = key;
}

const setLoading = on => browser.classList.toggle('loading', on);

function go(url) {
  if (settings.proxy) browse(url);
  else location.href = url;
}

async function browse(url) {
  browser.hidden = false;
  document.body.classList.add('browsing');
  barUrl.value = url;
  setLoading(true);
  try {
    if (!navigator.serviceWorker) throw new Error('service workers are blocked here (the site needs https)');
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    await ensureTransport();
    if (!sjFrame) {
      sjFrame = scramjet.createFrame();
      const f = sjFrame.frame;
      f.className = 'proxy-frame';
      f.title = 'Proxied page';
      // lets videos autoplay and go fullscreen inside the frame
      f.allow = 'fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-read; clipboard-write';
      f.allowFullscreen = true;
      frameWrap.append(f);
      sjFrame.addEventListener('urlchange', e => { barUrl.value = e.url; });
      sjFrame.addEventListener('navigate', () => setLoading(true));
      f.addEventListener('load', () => setLoading(false));
    }
    sjFrame.go(url);
  } catch (err) {
    closeBrowser();
    toast(`Proxy failed: ${err.message}`);
  }
}

function closeBrowser() {
  if (browser.hidden) return;
  browser.hidden = true;
  document.body.classList.remove('browsing');
  setLoading(false);
  if (document.fullscreenElement) document.exitFullscreen();
  if (sjFrame) sjFrame.frame.src = 'about:blank'; // stops audio/video from the closed page
  dirty = true;
}

const barActions = {
  close: closeBrowser,
  back: () => sjFrame?.back(),
  forward: () => sjFrame?.forward(),
  reload: () => { setLoading(true); sjFrame?.reload(); },
  fullscreen: () => frameWrap.requestFullscreen?.(),
  popout: () => { if (barUrl.value) window.open(scramjet.encodeUrl(barUrl.value), '_blank'); },
};
document.getElementById('bar').addEventListener('submit', e => {
  e.preventDefault();
  const q = barUrl.value.trim();
  if (q) browse(toUrl(q, settings.engine));
});
document.querySelectorAll('.bar [data-act]').forEach(b => b.addEventListener('click', () => barActions[b.dataset.act]()));

// ---------- bookmarks ----------
const brand = (name, color) => ({ name, color, url: `https://${name}.com`, brand: name });
const DEFAULT_BOOKMARKS = [
  brand('discord', '#5865F2'), brand('reddit', '#FF4500'), brand('instagram', '#E4405F'),
  brand('tiktok', '#ffffff'), brand('youtube', '#FF0000'),
  { name: 'music', url: '#music', icon: 'music' },
  { name: 'games', url: '#games', icon: 'gamepad-2' },
  { name: 'ai', url: '#ai', icon: 'sparkles' },
  { name: 'settings', url: '#settings', icon: 'settings' },
];
const BKEY = 'algebra.bookmarks';
let bookmarks = read(BKEY) || DEFAULT_BOOKMARKS;

const grid = document.getElementById('grid');
const hero = document.getElementById('home');

function renderBookmarks() {
  grid.replaceChildren();
  bookmarks.forEach((b, i) => {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = b.url;
    a.style.setProperty('--i', i);
    if (b.color) a.style.setProperty('--c', b.color);
    const ic = document.createElement('span');
    ic.className = 'ic';
    if (b.brand) {
      const s = document.createElement('span');
      s.className = 'brand';
      s.style.setProperty('--u', `url(https://cdn.jsdelivr.net/npm/simple-icons@13.0.0/icons/${b.brand}.svg)`);
      ic.append(s);
    } else if (b.icon) {
      ic.innerHTML = `<i data-lucide="${b.icon}"></i>`;
    } else {
      ic.textContent = b.name[0].toUpperCase();
    }
    const label = document.createElement('span');
    label.textContent = b.name;
    const x = document.createElement('span');
    x.className = 'x';
    x.innerHTML = '<i data-lucide="x"></i>';
    a.append(ic, label, x);
    a.addEventListener('click', e => {
      if (hero.classList.contains('editing')) {
        e.preventDefault();
        bookmarks.splice(i, 1);
        write(BKEY, bookmarks);
        renderBookmarks();
      } else if (/^https?:/i.test(b.url) && settings.proxy) {
        e.preventDefault();
        browse(b.url);
      }
    });
    grid.append(a);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tile add';
  add.innerHTML = '<span class="ic"><i data-lucide="plus"></i></span><span>add</span>';
  add.addEventListener('click', () => {
    const name = prompt('Bookmark name')?.trim();
    if (!name) return;
    let url = prompt('Link', 'https://')?.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url; // blocks javascript: links
    bookmarks.push({ name, url });
    write(BKEY, bookmarks);
    renderBookmarks();
  });
  grid.append(add);
  lucide.createIcons();
}

document.getElementById('edit').addEventListener('click', e => {
  const on = hero.classList.toggle('editing');
  e.currentTarget.textContent = on ? 'done' : 'edit';
});

// ---------- settings page ----------
const SECTIONS = [
  ['appearance', 'palette', [
    { key: 'accent', type: 'swatch', label: 'Accent color', desc: 'Switches, focus rings, and the wave when it is tinted.' },
    { key: 'matchAccent', type: 'toggle', label: 'Tint the wave', desc: 'Draws the background ribbon in your accent color instead of white.' },
    { key: 'interactive', type: 'toggle', label: 'Wave follows your cursor', desc: 'The ribbon bends toward the mouse.' },
    { key: 'density', type: 'range', min: 12, max: 60, step: 2, label: 'Strands', desc: 'How many lines make up the ribbon.', fmt: v => v },
    { key: 'speed', type: 'range', min: 0, max: 2, step: 0.25, label: 'Wave speed', desc: 'Slide to 0 to hold it still.', fmt: v => `${v}×` },
    { key: 'dim', type: 'select', label: 'Dim background', desc: 'Fades the wave so pages are easier to read.', options: [[0, 'Off'], [1, 'Low'], [2, 'Medium'], [3, 'High']] },
    { key: 'font', type: 'select', label: 'Font', desc: 'Used for all text on the site.', options: Object.keys(FONTS).map(f => [f, f]) },
    { key: 'reduceMotion', type: 'toggle', label: 'Reduce motion', desc: 'Turns off animations and holds the wave still.' },
  ]],
  ['homepage', 'house', [
    { key: 'showClock', type: 'toggle', label: 'Clock', desc: 'The big clock and greeting above the search bar.' },
    { key: 'clock24', type: 'toggle', label: '24-hour time', desc: 'Show 21:30 instead of 9:30 PM.' },
    { key: 'hints', type: 'toggle', label: 'Search bar hints', desc: 'Rotating lines in the search bar before you type.' },
    { key: 'showBookmarks', type: 'toggle', label: 'Bookmarks', desc: 'Show your bookmarks under the search bar.' },
  ]],
  ['browsing', 'globe', [
    { key: 'engine', type: 'select', label: 'Search engine', desc: 'Used when what you type is not a web address.', options: Object.entries(ENGINES).map(([k, [n]]) => [k, n]) },
    { key: 'proxy', type: 'toggle', label: 'Open sites through the proxy', desc: 'Searches and bookmarks load inside algebra with Scramjet. Turn off to go to sites directly.' },
    { key: 'relay', type: 'select', label: 'Relay', desc: 'Carries the proxy\'s traffic. Fly reaches every site; the Cloudflare backup can\'t open Cloudflare-hosted sites like Discord.', options: [['fly', 'Fly.io (default)'], ['cloudflare', 'Cloudflare (backup)']] },
    { key: 'wisp', type: 'text', label: 'Custom Wisp server', desc: 'Overrides the relay above. Leave empty to use it.', placeholder: () => 'wss://your-server/' },
  ]],
];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function set(key, value) {
  settings[key] = value;
  write(SKEY, settings);
  apply();
}

function control(o) {
  const id = `set-${o.key}`, v = settings[o.key];
  if (o.type === 'toggle') {
    const b = el('button', 'switch');
    b.type = 'button'; b.id = id; b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', v);
    b.addEventListener('click', () => { set(o.key, !settings[o.key]); b.setAttribute('aria-checked', settings[o.key]); });
    return b;
  }
  if (o.type === 'select') {
    const s = el('select', 'select'); s.id = id;
    for (const [val, name] of o.options) s.append(new Option(name, val, false, String(val) === String(v)));
    s.addEventListener('change', () => set(o.key, typeof DEFAULT_SETTINGS[o.key] === 'number' ? Number(s.value) : s.value));
    return s;
  }
  if (o.type === 'range') {
    const wrap = el('div', 'range');
    const r = el('input'); r.type = 'range'; r.id = id; r.min = o.min; r.max = o.max; r.step = o.step; r.value = v;
    const out = el('output', '', o.fmt(v)); out.htmlFor = id;
    r.addEventListener('input', () => { out.textContent = o.fmt(r.value); set(o.key, Number(r.value)); });
    wrap.append(r, out);
    return wrap;
  }
  if (o.type === 'text') {
    const i = el('input', 'text'); i.id = id; i.value = v; i.placeholder = o.placeholder(); i.spellcheck = false;
    i.addEventListener('change', () => {
      const val = i.value.trim();
      if (val && !/^wss?:\/\/\S+$/i.test(val)) { toast('Wisp servers start with wss:// or ws://'); i.value = settings[o.key]; return; }
      set(o.key, val && !val.endsWith('/') ? val + '/' : val);
      i.value = settings[o.key];
      toast(val ? 'Custom Wisp server saved' : 'Using the relay above');
    });
    return i;
  }
  // swatch: preset colors plus a custom picker
  const g = el('div', 'swatches'); g.setAttribute('role', 'radiogroup'); g.id = id;
  const mark = () => g.querySelectorAll('[role=radio]').forEach(s => s.setAttribute('aria-checked', s.dataset.c === settings.accent));
  for (const c of ACCENTS) {
    const s = el('button', 'sw'); s.type = 'button'; s.setAttribute('role', 'radio'); s.dataset.c = c;
    s.style.background = c; s.setAttribute('aria-label', c);
    s.addEventListener('click', () => { set('accent', c); mark(); });
    g.append(s);
  }
  const custom = el('label', 'sw custom'); custom.title = 'Custom color';
  const pick = el('input'); pick.type = 'color'; pick.value = settings.accent; pick.setAttribute('aria-label', 'Custom accent color');
  pick.addEventListener('input', () => { set('accent', pick.value); mark(); });
  custom.append(pick);
  g.append(custom);
  mark();
  return g;
}

function renderSettings() {
  const body = document.getElementById('settings-body');
  const nav = document.getElementById('settings-nav');
  for (const [name, icon, rows] of [...SECTIONS].reverse()) {
    const card = el('section', 'card'); card.id = `sec-${name}`;
    const h = el('h2'); h.innerHTML = `<i data-lucide="${icon}"></i>`; h.append(name);
    card.append(h);
    for (const o of rows) {
      const row = el('div', 'row');
      const text = el('div', 'row-text');
      const label = el('label', 'row-label', o.label); label.htmlFor = `set-${o.key}`;
      text.append(label, el('p', 'row-desc', o.desc));
      row.append(text, control(o));
      card.append(row);
    }
    body.prepend(card);
  }
  for (const name of [...SECTIONS.map(s => s[0]), 'data']) {
    const b = el('button', '', name); b.type = 'button';
    b.addEventListener('click', () => document.getElementById(`sec-${name}`).scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }));
    nav.append(b);
  }
}

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Clear your bookmarks, settings and proxy cookies on this device? This cannot be undone.')) return;
  try { localStorage.clear(); } catch {}
  for (const db of (await indexedDB.databases?.()) || []) indexedDB.deleteDatabase(db.name);
  for (const k of await caches.keys()) await caches.delete(k);
  for (const r of (await navigator.serviceWorker?.getRegistrations()) || []) await r.unregister();
  location.reload();
});

// ---------- apply settings ----------
const fontLink = document.getElementById('font');
function apply() {
  const root = document.documentElement.style;
  root.setProperty('--accent', settings.accent);
  root.setProperty('--font', settings.font === 'System' ? 'system-ui' : `"${settings.font}"`);
  const fontHref = FONTS[settings.font] && `https://fonts.googleapis.com/css2?family=${FONTS[settings.font]}&display=swap`;
  if (fontHref && fontLink.href !== fontHref) fontLink.href = fontHref;
  canvas.style.opacity = document.body.dataset.view === 'home' ? [1, 0.7, 0.45, 0.25][settings.dim] : 0;
  document.body.classList.toggle('reduce', reduced());
  clock.hidden = greet.hidden = !settings.showClock;
  grid.hidden = document.getElementById('bm-head').hidden = !settings.showBookmarks;
  if (!settings.hints) input.placeholder = 'search something here';
  tick();
  dirty = true;
}

// ---------- games ----------
const SOURCES = { gm: 'GameMonetize', gd: 'GameDistribution' };
const GAME_PAGE = 96; // cards added per scroll step; 6000 at once would freeze the page
const gameGrid = document.getElementById('game-grid');
const gameQ = document.getElementById('game-q');
const gameStatus = document.getElementById('game-status');
const gameMore = document.getElementById('game-more');
let allGames = null, gamesLoading = false, gameSource = 'all', gameCat = 'all', shownGames = [], renderedGames = 0;

async function loadGames() {
  if (allGames || gamesLoading) return;
  gamesLoading = true;
  try {
    const r = await fetch('/games.json');
    if (!r.ok) throw new Error(r.status);
    allGames = await r.json();
    renderChips();
    filterGames();
  } catch {
    gameStatus.textContent = 'Couldn\'t load the games list. Reload the page to try again.';
  }
  gamesLoading = false;
}

function chip(label, count, active, onClick) {
  const b = el('button', 'chip', label);
  b.type = 'button';
  b.setAttribute('aria-pressed', active);
  if (count != null) b.append(el('span', 'chip-count', count.toLocaleString()));
  b.addEventListener('click', onClick);
  return b;
}

function renderChips() {
  document.getElementById('game-sources').replaceChildren(
    chip('All', allGames.length, gameSource === 'all', () => setGameFilter('all', gameCat)),
    ...Object.entries(SOURCES).map(([key, name]) =>
      chip(name, allGames.filter(g => g.s === key).length, gameSource === key, () => setGameFilter(key, gameCat))));
  const counts = {};
  for (const g of allGames) if (gameSource === 'all' || g.s === gameSource) counts[g.c] = (counts[g.c] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 16);
  document.getElementById('game-cats').replaceChildren(
    chip('All categories', null, gameCat === 'all', () => setGameFilter(gameSource, 'all')),
    ...top.map(([c, n]) => chip(c, n, gameCat === c, () => setGameFilter(gameSource, c))));
}

function setGameFilter(source, category) {
  gameSource = source;
  gameCat = category;
  renderChips();
  filterGames();
}

function filterGames() {
  const q = gameQ.value.trim().toLowerCase();
  shownGames = allGames.filter(g =>
    (gameSource === 'all' || g.s === gameSource) && (gameCat === 'all' || g.c === gameCat) && (!q || g.n.toLowerCase().includes(q)));
  gameQ.placeholder = `search ${allGames.length.toLocaleString()} games`;
  gameStatus.textContent = 'No games match that.';
  gameStatus.hidden = shownGames.length > 0;
  gameGrid.replaceChildren();
  renderedGames = 0;
  fillGames();
}

const playUrl = g => `/play?g=${encodeURIComponent(g.u)}&t=${encodeURIComponent(g.n)}`;

// keep adding cards until the grid reaches past the bottom of the screen
function fillGames() {
  while (renderedGames < shownGames.length && gameMore.getBoundingClientRect().top < innerHeight + 800) {
    const frag = document.createDocumentFragment();
    shownGames.slice(renderedGames, renderedGames + GAME_PAGE).forEach((g, i) => {
      const a = el('a', 'game');
      a.href = playUrl(g);
      a.style.setProperty('--i', Math.min(i, 14)); // stagger the first cards of each batch
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('load', () => img.classList.add('loaded'));
      img.addEventListener('error', () => {
        // blocked image host (ad blocker / tracking prevention): retry through our own /img, then show a letter
        if (!img.dataset.retried && g.i) { img.dataset.retried = '1'; img.src = `/img?u=${encodeURIComponent(g.i)}`; }
        else img.replaceWith(el('span', 'game-ph', g.n[0].toUpperCase()));
      });
      if (g.i) img.src = g.i;
      else queueMicrotask(() => img.dispatchEvent(new Event('error')));
      a.append(img, el('span', 'game-name', g.n), el('span', 'game-src', `${SOURCES[g.s]} · ${g.c}`));
      frag.append(a);
    });
    renderedGames += GAME_PAGE;
    gameGrid.append(frag);
  }
}
addEventListener('scroll', fillGames, { passive: true });

let gameSearchTimer;
gameQ.addEventListener('input', () => {
  clearTimeout(gameSearchTimer);
  gameSearchTimer = setTimeout(() => allGames && filterGames(), 150);
});
document.getElementById('game-random').addEventListener('click', () => {
  const pool = shownGames.length ? shownGames : allGames;
  if (pool?.length) location.href = playUrl(pool[Math.floor(Math.random() * pool.length)]);
});

// ---------- ai chat ----------
// keep in sync with AI_MODELS in worker.js, which rejects anything else
const AI_MODELS = [
  ['@cf/google/gemma-4-26b-a4b-it', 'gemma 4'],
  ['@cf/mistralai/mistral-small-3.1-24b-instruct', 'mistral small'],
  ['@cf/meta/llama-3.1-8b-instruct-fp8-fast', 'llama 3.1 fast'],
];
const IDEAS = [
  ['lightbulb', 'explain it simply', 'Why is the sky blue?'],
  ['graduation-cap', 'math help', 'Walk me through solving 2x + 5 = 17 step by step.'],
  ['pencil', 'write something', 'Write a short poem about a cat who loves video games.'],
  ['code', 'fix my code', 'Why does my JavaScript for loop run one time too many?'],
];
const CKEY = 'algebra.chats';
const MAX_CHATS = 50;
const aiInput = document.getElementById('ai-input');
const aiMsgs = document.getElementById('ai-msgs');
const aiScroll = document.getElementById('ai-scroll');
const aiModel = document.getElementById('ai-model');
const aiSend = document.getElementById('ai-send');
let chats = read(CKEY) || [];
let chat = null;     // the open conversation, or null for a new one
let aiAbort = null;  // set while a reply is streaming

const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Tiny markdown: everything is escaped first, then only fixed tags are added, so model output can't inject HTML.
function md(text) {
  return text.split(/```[\w-]*\n?([\s\S]*?)(?:```|$)/g).map((part, i) => i % 2
    ? `<pre><code>${escapeHtml(part.replace(/\n$/, ''))}</code></pre>`
    : escapeHtml(part)
      .replace(/^#{1,4} (.+)$/gm, '<strong class="md-h">$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/^(\s*)[-*] /gm, '$1• ')).join('');
}
console.assert(md('<b>hi</b>') === '&lt;b&gt;hi&lt;/b&gt;', 'md escapes html');
console.assert(md('**a** `b`') === '<strong>a</strong> <code>b</code>', 'md inline');
console.assert(md('x\n```js\n<i>\n```') === 'x\n<pre><code>&lt;i&gt;</code></pre>', 'md code block');

// Workers AI streams either {response} (older models) or OpenAI-style {choices[0].delta.content}
function sseDelta(line) {
  if (!line.startsWith('data:')) return '';
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return '';
  try {
    const j = JSON.parse(data);
    return j.response ?? j.choices?.[0]?.delta?.content ?? '';
  } catch { return ''; }
}
console.assert(sseDelta('data: {"response":"hi"}') === 'hi', 'sse legacy');
console.assert(sseDelta('data: {"choices":[{"delta":{"content":"yo"}}]}') === 'yo', 'sse openai');
console.assert(sseDelta('data: [DONE]') === '', 'sse done');

function saveChats() {
  chats.sort((a, b) => b.updated - a.updated);
  chats = chats.slice(0, MAX_CHATS);
  write(CKEY, chats);
}

function renderChatList() {
  const q = document.getElementById('ai-find').value.trim().toLowerCase();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const list = document.getElementById('ai-list');
  list.replaceChildren();
  for (const [label, items] of [
    ['today', chats.filter(c => c.updated >= startOfToday)],
    ['earlier', chats.filter(c => c.updated < startOfToday)],
  ]) {
    const shown = items.filter(c => !q || c.title.toLowerCase().includes(q));
    if (!shown.length) continue;
    list.append(el('p', 'ai-group', label));
    for (const c of shown) {
      const row = el('div', 'ai-item' + (c === chat ? ' active' : ''));
      const open = el('button', 'ai-item-open', c.title);
      open.type = 'button';
      open.addEventListener('click', () => openChat(c));
      const del = el('button', 'ai-item-del');
      del.type = 'button';
      del.setAttribute('aria-label', `Delete chat "${c.title}"`);
      del.innerHTML = '<i data-lucide="trash-2"></i>';
      del.addEventListener('click', () => {
        if (!confirm(`Delete "${c.title}"?`)) return;
        chats = chats.filter(x => x !== c);
        saveChats();
        if (chat === c) openChat(null); else renderChatList();
      });
      row.append(open, del);
      list.append(row);
    }
  }
  lucide.createIcons();
}

function renderMessages() {
  document.getElementById('ai-empty').hidden = !!chat?.messages.length;
  document.getElementById('ai-title').textContent = chat?.title || 'new chat';
  document.getElementById('ai-greet').textContent = dayPart();
  aiMsgs.replaceChildren(...(chat?.messages || []).map(m => {
    const b = el('div', `ai-msg ${m.role}${m.error ? ' error' : ''}`);
    if (m.role === 'assistant') b.innerHTML = m.content ? md(m.content) : '<span class="ai-dots"><i></i><i></i><i></i></span>';
    else b.textContent = m.content;
    return b;
  }));
}

function openChat(c) {
  if (aiAbort) aiAbort.abort();
  chat = c;
  if (c) aiModel.value = c.model;
  if (matchMedia('(max-width: 640px)').matches) document.getElementById('ai').classList.remove('side-closed'); // close the phone overlay
  renderMessages();
  renderChatList();
  aiScroll.scrollTop = aiScroll.scrollHeight;
  aiInput.focus();
}

function setSending(on) {
  aiSend.setAttribute('aria-label', on ? 'Stop' : 'Send');
  aiSend.innerHTML = `<i data-lucide="${on ? 'square' : 'arrow-up'}"></i>`;
  lucide.createIcons();
}

async function sendChat(text) {
  text = text.trim();
  if (!text || aiAbort) return;
  if (!chat) {
    chat = { id: Date.now().toString(36), title: text.slice(0, 48), model: aiModel.value, messages: [], updated: Date.now() };
    chats.unshift(chat);
  }
  chat.model = aiModel.value;
  chat.messages.push({ role: 'user', content: text });
  const history = chat.messages.filter(m => !m.error);
  const reply = { role: 'assistant', content: '' };
  chat.messages.push(reply);
  chat.updated = Date.now();
  aiInput.value = '';
  aiInput.style.height = '';
  renderMessages();
  [...aiMsgs.children].slice(-2).forEach(m => m.classList.add('pop')); // only the new pair animates in
  renderChatList();
  aiScroll.scrollTop = aiScroll.scrollHeight;

  const current = chat;
  aiAbort = new AbortController();
  setSending(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: current.model, messages: history }),
      signal: aiAbort.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `The AI didn't answer (error ${res.status}).`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      reply.content += lines.map(sseDelta).join('');
      if (chat === current && reply.content) {
        const nearBottom = aiScroll.scrollHeight - aiScroll.scrollTop - aiScroll.clientHeight < 80;
        aiMsgs.lastElementChild.innerHTML = md(reply.content); // update just the streaming bubble
        if (nearBottom) aiScroll.scrollTop = aiScroll.scrollHeight;
      }
    }
    if (!reply.content) throw new Error('The AI sent an empty reply. Try again.');
  } catch (err) {
    if (err.name !== 'AbortError') {
      reply.content = err.message;
      reply.error = true;
    } else if (!reply.content) {
      current.messages.pop(); // stopped before any words arrived
    }
  }
  aiAbort = null;
  setSending(false);
  current.updated = Date.now();
  saveChats();
  if (chat === current) renderMessages();
  renderChatList();
}

aiModel.append(...AI_MODELS.map(([id, name]) => new Option(name, id)));
document.getElementById('ai-ideas').append(...IDEAS.map(([icon, title, prompt], i) => {
  const b = el('button', 'ai-idea');
  b.type = 'button';
  b.style.setProperty('--i', i);
  b.innerHTML = `<i data-lucide="${icon}"></i>`;
  const text = el('span');
  text.append(el('strong', '', title), el('span', '', prompt));
  b.append(text);
  b.addEventListener('click', () => sendChat(prompt));
  return b;
}));
document.getElementById('ai-form').addEventListener('submit', e => {
  e.preventDefault();
  if (aiAbort) aiAbort.abort();
  else sendChat(aiInput.value);
});
aiInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(aiInput.value); }
});
aiInput.addEventListener('input', () => {
  aiInput.style.height = '';
  aiInput.style.height = `${Math.min(aiInput.scrollHeight, 200)}px`;
});
document.getElementById('ai-new').addEventListener('click', () => openChat(null));
document.getElementById('ai-find').addEventListener('input', renderChatList);
document.getElementById('ai-toggle').addEventListener('click', () => document.getElementById('ai').classList.toggle('side-closed'));

// ---------- music ----------
// One source: TIDAL, through the commonsensehealthcare.org music API.
// Browse rows feed the shelves, search feeds the results, and the same API
// hands back the artwork and the full-length stream for every track.
const MUSIC = '/api/music';
const GENRES = [
  ['hits', 'top hits'], ['pop', 'pop'], ['hiphop', 'hip-hop'], ['rnb', 'r&b'],
  ['indie', 'indie'], ['rock', 'rock'], ['latin', 'latin'], ['electronic', 'electronic'],
  ['kpop', 'k-pop'], ['chill', 'chill'],
];
const audio = document.getElementById('audio');
const player = document.getElementById('player');
const PKEY = 'algebra.player';
let queue = [], qi = -1, shuffle = false, repeat = 'off', playFailures = 0; // repeat: off | all | one
let musicLoaded = false, genre = 'hits', trendingTracks = [], chartTracks = [];

const appImage = url => `/img?u=${encodeURIComponent(url)}`;
const tidalStream = t => `${MUSIC}/stream?${new URLSearchParams({
  id: String(t.id), source: t.source || 'tidal', title: t.title,
  artist: t.artist, duration: String(Math.round(t.duration || 0)),
})}`;
const tidalTrack = t => {
  const src = tidalStream(t);
  return {
    id: `tidal-${t.id}`, t: t.title, a: t.artist || 'unknown',
    art: t.artwork || '', src, e: !!t.explicit,
  };
};
const fmtTime = s => !isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
console.assert(fmtTime(170) === '2:50' && fmtTime(NaN) === '0:00', 'fmtTime');

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

function artImg(src, cls) {
  const img = el('img', cls);
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    // Edge Tracking Prevention / ad blockers can block the CDN directly.
    // Retry once through the same-origin image fallback, then show the tile.
    if (src && !img.dataset.proxied) {
      img.dataset.proxied = '1';
      img.src = appImage(src);
      return;
    }
    img.removeAttribute('src');
  });
  if (src) img.src = src;
  return img;
}

// big square cards for the charts shelf
function renderShelf(box, tracks) {
  box.replaceChildren(...tracks.map((t, i) => {
    const b = el('button', 'album');
    b.type = 'button';
    b.style.setProperty('--i', Math.min(i, 10));
    const cover = el('span', 'album-cover');
    cover.append(artImg(t.art), el('span', 'album-rank', i + 1), el('span', 'album-play'));
    b.append(cover, el('strong', '', t.t), el('span', '', t.a));
    b.addEventListener('click', () => playList(tracks, i));
    return b;
  }));
}

// compact rows: art, title, artist, badge
function renderTracks(box, tracks) {
  if (!tracks.length) { box.replaceChildren(el('p', 'games-status', 'Nothing found.')); return; }
  box.replaceChildren(...tracks.map((t, i) => {
    const b = el('button', 'track');
    b.type = 'button';
    b.dataset.id = t.id;
    b.style.setProperty('--i', Math.min(i, 14));
    const text = el('span', 'track-text');
    const title = el('strong', '', t.t);
    if (t.e) title.append(el('span', 'explicit', 'E'));
    text.append(title, el('span', '', t.a));
    b.append(artImg(t.art, 'track-art'), text);
    b.addEventListener('click', () => playList(tracks, i));
    return b;
  }));
  markPlaying();
}

let browsePromise = null;
async function getBrowse() {
  if (!browsePromise) {
    browsePromise = getJson(`${MUSIC}/browse`).catch(e => { browsePromise = null; throw e; });
  }
  return browsePromise;
}

async function loadTrending() {
  const box = document.getElementById('trending');
  try {
    const rows = (await getBrowse()).rows || {};
    const list = rows[genre] || rows.hits || [];
    trendingTracks = list.map(tidalTrack);
    renderTracks(box, trendingTracks);
  } catch {
    box.replaceChildren(el('p', 'games-status', 'Couldn\'t load songs from TIDAL. Try again in a moment.'));
  }
}

async function loadMusic() {
  if (musicLoaded) return;
  musicLoaded = true;
  document.getElementById('music-genres').replaceChildren(...GENRES.map(([key, label]) =>
    chip(label, null, key === genre, () => { genre = key; renderGenreChips(); loadTrending(); })));
  loadTrending();
  try {
    const rows = (await getBrowse()).rows || {};
    chartTracks = (rows.hits || []).slice(0, 14).map(tidalTrack);
    renderShelf(document.getElementById('charts'), chartTracks);
  } catch {
    chartTracks = [];
    document.getElementById('charts').replaceChildren(el('p', 'games-status', 'Couldn\'t load the charts right now.'));
  }
}
function renderGenreChips() {
  document.querySelectorAll('#music-genres .chip').forEach((c, i) => c.setAttribute('aria-pressed', GENRES[i][0] === genre));
}

let musicSearchTimer;
document.getElementById('music-q').addEventListener('input', e => {
  clearTimeout(musicSearchTimer);
  musicSearchTimer = setTimeout(() => searchMusic(e.target.value.trim()), 300);
});
async function searchMusic(q) {
  document.getElementById('music-results').hidden = !q;
  document.getElementById('music-home').hidden = !!q;
  if (!q) return;
  const box = document.getElementById('music-search-list');
  box.replaceChildren(el('p', 'games-status', 'searching…'));
  let tracks = [];
  try {
    const j = await getJson(`${MUSIC}/search?q=${encodeURIComponent(q)}&limit=30&source=tidal`);
    tracks = (j.items || []).map(tidalTrack);
  } catch {
    // TIDAL search can hiccup; fall back to the API's default catalog (its streams work too)
    try {
      const j = await getJson(`${MUSIC}/search?q=${encodeURIComponent(q)}&limit=30`);
      tracks = (j.items || []).map(tidalTrack);
    } catch {}
  }
  if (document.getElementById('music-q').value.trim() === q) renderTracks(box, tracks);
}

document.getElementById('charts-play').addEventListener('click', () => chartTracks.length && playList(chartTracks, 0));
document.getElementById('trending-play').addEventListener('click', () => trendingTracks.length && playList(trendingTracks, 0));

// ----- playback -----
function playList(list, i) {
  playFailures = 0;
  queue = list.slice();
  qi = i;
  loadTrack();
}

function loadTrack() {
  const t = queue[qi];
  if (!t) return;
  audio.src = t.src;
  audio.play().catch(() => {});
  player.hidden = false;
  document.getElementById('pl-title').textContent = t.t;
  document.getElementById('pl-artist').textContent = t.a;
  document.getElementById('pl-line').style.width = '0%';
  const img = document.getElementById('pl-img');
  img.classList.toggle('none', !t.art);
  img.classList.remove('loaded');
  delete img.dataset.proxied;
  if (t.art) img.src = t.art; else img.removeAttribute('src');
  markPlaying();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.t, artist: t.a, artwork: t.art ? [{ src: new URL(appImage(t.art), location.href).href, sizes: '512x512' }] : [] });
  }
}

function step(dir, auto = false) {
  if (!queue.length) return;
  if (auto && repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (dir < 0 && audio.currentTime > 3) { audio.currentTime = 0; return; }
  let n = shuffle && queue.length > 1 ? (qi + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length : qi + dir;
  if (n >= queue.length || n < 0) {
    if (repeat !== 'all' && auto) { audio.pause(); return; }
    n = (n + queue.length) % queue.length;
  }
  qi = n;
  loadTrack();
}

function markPlaying() {
  const id = queue[qi]?.id;
  document.querySelectorAll('.track').forEach(b => b.classList.toggle('now', b.dataset.id === id));
}

const togglePlay = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
const plImg = document.getElementById('pl-img');
plImg.addEventListener('load', () => plImg.classList.add('loaded'));
plImg.addEventListener('error', e => {
  const img = e.target;
  const art = queue[qi]?.art;
  if (art && !img.dataset.proxied) {
    img.dataset.proxied = '1';
    img.src = appImage(art);
    return;
  }
  img.classList.add('none');
  img.removeAttribute('src');
});

audio.addEventListener('play', () => { player.classList.add('playing'); setPlayLabel(); });
audio.addEventListener('playing', () => { playFailures = 0; });
audio.addEventListener('pause', () => { player.classList.remove('playing'); setPlayLabel(); });
audio.addEventListener('ended', () => step(1, true));
audio.addEventListener('error', () => {
  if (!audio.src || player.hidden) return;
  playFailures += 1;
  if (playFailures >= 3) {
    // Stop the skip loop: if every track fails, retrying forever just spams
    // toasts. Ask the user to unblock the site instead.
    audio.pause();
    toast('Playback keeps failing. Turn off tracking protection or ad blockers for this site, then try again.');
    return;
  }
  toast('That song couldn\'t play. Skipping to the next one.');
  setTimeout(() => step(1, true), 800);
});
audio.addEventListener('timeupdate', () => {
  if (seeking) return;
  document.getElementById('pl-cur').textContent = fmtTime(audio.currentTime);
  document.getElementById('pl-dur').textContent = fmtTime(audio.duration);
  document.getElementById('pl-seek').value = audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0;
  document.getElementById('pl-line').style.width = audio.duration ? `${(audio.currentTime / audio.duration) * 100}%` : '0%';
});
function setPlayLabel() {
  const label = audio.paused ? 'Play' : 'Pause';
  player.querySelector('.pl-play').setAttribute('aria-label', label);
  document.getElementById('pl-art').setAttribute('aria-label', label);
}

let seeking = false;
const seek = document.getElementById('pl-seek');
seek.addEventListener('input', () => { seeking = true; document.getElementById('pl-cur').textContent = fmtTime((seek.value / 1000) * audio.duration); });
seek.addEventListener('change', () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; seeking = false; });

const vol = document.getElementById('pl-vol');
const savedPlayer = read(PKEY) || {};
audio.volume = vol.value = savedPlayer.volume ?? 0.8;
vol.addEventListener('input', () => { audio.volume = vol.value; savePlayer({ volume: +vol.value }); });
function savePlayer(patch) { Object.assign(savedPlayer, patch); write(PKEY, savedPlayer); }

const playerActions = {
  toggle: togglePlay,
  next: () => step(1),
  prev: () => step(-1),
  shuffle: b => { shuffle = !shuffle; b.setAttribute('aria-pressed', shuffle); },
  repeat: b => {
    repeat = { off: 'all', all: 'one', one: 'off' }[repeat];
    b.setAttribute('aria-pressed', repeat !== 'off');
    b.setAttribute('aria-label', `Repeat: ${repeat}`);
    b.classList.toggle('one', repeat === 'one');
  },
  collapse: () => setBubble(true),
  expand: () => setBubble(false),
};
player.querySelectorAll('[data-pl]').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation();
  playerActions[b.dataset.pl](b);
}));
document.getElementById('pl-art').addEventListener('click', () => { if (!moved) togglePlay(); });

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
}

// ----- floating card / bubble: draggable anywhere except the music page, where it docks as a bar -----
function setBubble(on) {
  player.classList.toggle('bubble', on);
  savePlayer({ bubble: on });
  requestAnimationFrame(() => placePlayer(savedPlayer.x, savedPlayer.y));
}
function placePlayer(x, y) {
  // never dragged (or docked as a bar): sit in the CSS default spot, bottom right
  if (player.classList.contains('bar') || x == null) { player.style.left = player.style.top = player.style.right = player.style.bottom = ''; return; }
  const r = player.getBoundingClientRect();
  player.style.right = player.style.bottom = 'auto';
  player.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  player.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
}
let drag = null, moved = false;
player.addEventListener('pointerdown', e => {
  if (player.classList.contains('bar') || e.target.closest('input, [data-pl]')) return;
  const r = player.getBoundingClientRect();
  drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
  moved = false;
});
player.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return; // a tap, not a drag
  // capture only once it's really a drag; capturing on press would swallow taps on the cover
  if (!moved) player.setPointerCapture(e.pointerId);
  moved = true;
  player.classList.add('dragging');
  placePlayer(e.clientX - drag.dx, e.clientY - drag.dy);
});
player.addEventListener('pointercancel', () => { drag = null; player.classList.remove('dragging'); });
player.addEventListener('pointerup', () => {
  if (!drag) return;
  drag = null;
  player.classList.remove('dragging');
  if (moved) {
    const r = player.getBoundingClientRect();
    savePlayer({ x: r.left, y: r.top });
    setTimeout(() => { moved = false; }, 0); // let the click after a drag see it was a drag
  }
});
addEventListener('resize', () => placePlayer(savedPlayer.x, savedPlayer.y));
if (savedPlayer.bubble) player.classList.add('bubble');

// ---------- routing ----------
const views = { home: hero, games: document.getElementById('games'), music: document.getElementById('music'), ai: document.getElementById('ai'), settings: document.getElementById('settings') };
function route() {
  const view = { '#settings': 'settings', '#games': 'games', '#ai': 'ai', '#music': 'music' }[location.hash] || 'home';
  for (const [name, v] of Object.entries(views)) v.hidden = name !== view;
  document.body.dataset.view = view;
  canvas.style.opacity = view === 'home' ? [1, 0.7, 0.45, 0.25][settings.dim] : 0;
  dirty = true;
  scrollTo(0, 0);
  document.querySelectorAll('.dock a').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href') === (view === 'home' ? '#' : `#${view}`)));
  closeBrowser();
  if (view === 'games') { loadGames(); fillGames(); }
  if (view === 'ai') { renderMessages(); renderChatList(); }
  if (view === 'music') { loadMusic(); document.getElementById('music-greet').textContent = dayPart(); }
  player.classList.toggle('bar', view === 'music');
  placePlayer(savedPlayer.x, savedPlayer.y);
}
addEventListener('hashchange', route);
document.querySelector('.dock').addEventListener('click', closeBrowser);

renderSettings();
renderBookmarks();
apply();
route();
resize();
frame();
