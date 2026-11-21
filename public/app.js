// ---------- storage ----------
const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---------- settings ----------
const ACCENTS = ['#f4f4f5', '#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#60a5fa', '#c084fc', '#f472b6'];
const FONTS = {
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
  accent: '#f4f4f5', matchAccent: false, interactive: true, density: 30, speed: 1, dim: 0, font: 'Outfit', reduceMotion: false,
  showClock: true, clock24: false, hints: true, showBookmarks: true,
  engine: 'duckduckgo', proxy: true, wisp: '',
};
const SKEY = 'algebra.settings';
let settings = { ...DEFAULT_SETTINGS, ...read(SKEY) };
const osReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const reduced = () => settings.reduceMotion || osReduce;
const defaultRelay = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/wsproxy/`;

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
    ctx.strokeStyle = `rgba(${rgb},${0.14 + 0.3 * Math.sin(p * Math.PI)})`;
    ctx.stroke();
    rows.push(row);
  }
  // faint cross-strands give the mesh look
  ctx.strokeStyle = `rgba(${rgb},0.05)`;
  ctx.beginPath();
  for (let j = 0; j < cols; j += 3) {
    ctx.moveTo(j * STEP, rows[0][j]);
    for (let i = 1; i < lines; i++) ctx.lineTo(j * STEP, rows[i][j]);
  }
  ctx.stroke();
}

function frame() {
  // skip drawing while the proxy browser covers the page
  if (!document.body.classList.contains('browsing') && (dirty || !reduced())) {
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
const relayOptions = () => settings.wisp
  ? { websocket: settings.wisp }
  : { websocket: defaultRelay(), transport: 'wsproxy' };

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
  { name: 'profile', url: '#profile', icon: 'user' },
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
    { key: 'wisp', type: 'text', label: 'Wisp server', desc: 'Leave empty to use this site\'s built-in relay. Sites hosted on Cloudflare (like Discord) only work through your own Wisp server.', placeholder: () => 'empty = built-in relay' },
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
      toast(val ? 'Wisp server saved' : 'Using this site\'s relay');
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
  canvas.style.opacity = [1, 0.7, 0.45, 0.25][settings.dim];
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

// ---------- routing ----------
const views = { home: hero, games: document.getElementById('games'), ai: document.getElementById('ai'), settings: document.getElementById('settings') };
function route() {
  const view = { '#settings': 'settings', '#games': 'games', '#ai': 'ai' }[location.hash] || 'home';
  for (const [name, v] of Object.entries(views)) v.hidden = name !== view;
  document.body.dataset.view = view;
  document.querySelectorAll('.sidebar a').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href') === (view === 'home' ? '#' : `#${view}`)));
  closeBrowser();
  if (view === 'games') { loadGames(); fillGames(); }
  if (view === 'ai') { renderMessages(); renderChatList(); }
}
addEventListener('hashchange', route);
document.querySelector('.sidebar').addEventListener('click', closeBrowser);

renderSettings();
renderBookmarks();
apply();
route();
resize();
frame();
