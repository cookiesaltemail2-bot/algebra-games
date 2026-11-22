// TCP relay for the proxy, in libcurl's "wsproxy" format: one WebSocket per connection at /wsproxy/<host>:<port>.
// One socket per WebSocket matters on Cloudflare: each Worker invocation may only open 50 outbound
// connections on the free plan, so multiplexing a whole browsing session over one socket (Wisp) breaks
// after 50 connections. Here every connection is its own invocation.
// shortcut: Workers can't open sockets to Cloudflare-hosted IPs (e.g. discord.com), so those sites fail here;
// point the "Wisp server" setting at a Node wisp-js server to reach them.
import { connect } from 'cloudflare:sockets';

// web ports only, so the relay can't be used as a general-purpose tunnel (SSH, mail, ...)
export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/chat') return chat(request, env);
    if (pathname === '/api/lyrics') return lyrics(request);
    if (pathname.startsWith('/api/music/')) return music(request);
    if (pathname === '/img') return proxyMedia(request, isImageHost, 'img');
    if (pathname === '/audio') return proxyMedia(request, isAudioHost, 'audio');
    const m = pathname.match(/^\/wsproxy\/([a-z0-9.-]+):(\d{1,5})$/i);
    if (m && request.headers.get('Upgrade') === 'websocket') {
      const port = Number(m[2]);
      if (!ALLOWED_PORTS.has(port)) return new Response('port not allowed', { status: 403 });
      return tunnel(m[1], port);
    }
    return env.ASSETS.fetch(request);
  },
};

// ---------- music API ----------
// TIDAL browse/search/artwork/stream come from the commonsensehealthcare.org
// music API. That server is same-origin only (no CORS on most routes), so the
// Worker relays just /api/music/* and forwards Range requests for seeking.
const MUSIC_API = 'https://commonsensehealthcare.org';

async function music(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 });
  }
  const incoming = new URL(request.url);
  const target = new URL(MUSIC_API + incoming.pathname + incoming.search);
  // path traversal (e.g. /api/music/../admin) must not reach other APIs
  if (!target.pathname.startsWith('/api/music/')) {
    return new Response('not allowed', { status: 400 });
  }

  const headers = new Headers();
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);

  let upstream;
  try {
    upstream = await fetch(target, { method: request.method, headers });
  } catch {
    return new Response('music server unreachable', { status: 502 });
  }

  const out = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set('cache-control', incoming.pathname === '/api/music/stream'
    ? 'public, max-age=3600'
    : 'public, max-age=60');

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

// ---------- same-origin media fallback ----------
// Edge Tracking Prevention and ad blockers block the catalog / music hosts.
// These endpoints retry the exact allowlisted hosts from our own origin, so
// they are not open proxies. /audio forwards Range requests so seeking works.
export const IMG_HOSTS = ['img.gamemonetize.com', 'img.gamedistribution.com', 'v.monophonic.digital'];
const IMAGE_SUFFIXES = ['.mzstatic.com', '.audius.co', '.tidal.com'];
const AUDIO_EXACT = new Set(['api.audius.co', 'audio-ssl.itunes.apple.com', 'commonsensehealthcare.org']);
const AUDIO_SUFFIXES = ['.audius.co', '.itunes.apple.com', '.mzstatic.com'];

function isImageHost(host) {
  return IMG_HOSTS.includes(host)
    || IMAGE_SUFFIXES.some(suffix => host.endsWith(suffix))
    || /^audius-content-[a-z0-9-]+\.(?:figment\.io|digitaloceanspaces\.com)$/.test(host);
}

function isAudioHost(host) {
  return AUDIO_EXACT.has(host) || AUDIO_SUFFIXES.some(suffix => host.endsWith(suffix));
}

async function fetchAllowed(url, allowed, headers, method, depth = 0) {
  const response = await fetch(url, { method, headers, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    if (!location || depth >= 4) return new Response('bad upstream redirect', { status: 502 });
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || !allowed(next.hostname)) {
      return new Response('redirect not allowed', { status: 403 });
    }
    return fetchAllowed(next, allowed, headers, method, depth + 1);
  }
  return response;
}

async function proxyMedia(request, allowed, mode) {
  let url;
  try { url = new URL(new URL(request.url).searchParams.get('u')); } catch {}
  if (!url || url.protocol !== 'https:' || !allowed(url.hostname)) {
    return new Response('not allowed', { status: 400 });
  }

  const headers = new Headers();
  const range = request.headers.get('Range');
  if (mode === 'audio' && range) headers.set('Range', range);

  const response = await fetchAllowed(
    url,
    allowed,
    headers,
    request.method === 'HEAD' ? 'HEAD' : 'GET'
  );

  if (!response.ok) return new Response('not found', { status: 404 });

  const type = response.headers.get('content-type') || '';
  if (mode === 'img' && type && !type.startsWith('image/')) {
    return new Response('not an image', { status: 404 });
  }

  const out = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set('accept-ranges', 'bytes');
  out.set('cache-control', mode === 'audio' ? 'public, max-age=3600' : 'public, max-age=604800');

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers: out,
  });
}

// ---------- AI chat (Cloudflare Workers AI, free daily allowance) ----------
// Free-plan models only; keep in sync with AI_MODELS in public/app.js.
export const AI_MODELS = [
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
];
const MAX_HISTORY = 20;   // messages sent per request; older ones are dropped to save the daily allowance
const MAX_CHARS = 8000;   // per message
const SYSTEM = 'You are algebra ai, a friendly assistant on a games website. Many users are teens, so keep everything appropriate for them. Be clear and concise. You may use simple markdown: **bold**, lists, `code` and fenced code blocks.';

const json = (body, status, extra) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...(extra || {}) },
});

// ---------- lyrics (LRCLIB) ----------
// LRCLIB exposes its word-synced data as a YAML "lyricsfile" on get/search.
// We relay it same-origin (CORS + caching) and rank search results by title,
// artist and duration so remixes/live versions don't win.
const LRCLIB = 'https://lrclib.net/api';

const normLyricText = value => String(value || '')
  .toLowerCase()
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

function bestLyricMatch(list, title, artist, duration) {
  const wantedTitle = normLyricText(title);
  const wantedArtist = normLyricText(artist);
  let best = null, bestScore = -Infinity;
  for (const item of list) {
    if (!item || (!item.lyricsfile && !item.syncedLyrics && !item.plainLyrics)) continue;
    const itemTitle = normLyricText(item.trackName);
    const itemArtist = normLyricText(item.artistName);
    let score = 0;
    if (itemTitle === wantedTitle) score += 8;
    else if (itemTitle.includes(wantedTitle) || wantedTitle.includes(itemTitle)) score += 5;
    if (itemArtist === wantedArtist) score += 4;
    else if (itemArtist.includes(wantedArtist) || wantedArtist.includes(itemArtist)) score += 2;
    if (duration && Number(item.duration)) {
      const diff = Math.abs(Number(item.duration) - duration);
      if (diff <= 2) score += 4;
      else if (diff <= 5) score += 2;
      else if (diff <= 12) score += 1;
      else score -= Math.min(diff / 20, 3);
    }
    if (item.hasWordSync) score += 0.5;
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return best;
}

async function lyrics(request) {
  const incoming = new URL(request.url);
  const title = (incoming.searchParams.get('title') || '').trim().slice(0, 200);
  const artist = (incoming.searchParams.get('artist') || '').trim().slice(0, 200);
  const album = (incoming.searchParams.get('album') || '').trim().slice(0, 200);
  const duration = Math.round(Number(incoming.searchParams.get('duration')) || 0);
  if (!title) return json({ error: 'title required' }, 400);

  const headers = {
    'user-agent': 'algebra-games/1.0 (https://github.com/cookiesaltemail2-bot/algebra-games)',
    accept: 'application/json',
  };
  const primary = artist.split(',')[0].trim();

  let track = null;
  try {
    const exact = new URLSearchParams({ track_name: title, artist_name: artist || primary, duration: String(duration) });
    if (album) exact.set('album_name', album);
    const response = await fetch(`${LRCLIB}/get?${exact}`, { headers });
    if (response.ok) track = await response.json();
  } catch {}

  if (!track) {
    const found = new Map();
    const queries = [
      { track_name: title, artist_name: artist },
      { track_name: title, artist_name: primary },
      { track_name: title },
    ];
    for (const query of queries) {
      if (!query.artist_name) delete query.artist_name;
      try {
        const response = await fetch(`${LRCLIB}/search?${new URLSearchParams(query)}`, { headers });
        if (!response.ok) continue;
        for (const item of await response.json()) {
          if (item?.id != null) found.set(item.id, item);
        }
      } catch {}
      if (found.size >= 12) break;
    }
    track = bestLyricMatch([...found.values()], title, artist || primary, duration);
  }

  if (!track || (!track.lyricsfile && !track.syncedLyrics && !track.plainLyrics)) {
    return json({ found: false }, 200, { 'cache-control': 'public, max-age=3600' });
  }

  return json({
    found: true,
    id: track.id,
    title: track.trackName || title,
    artist: track.artistName || artist,
    album: track.albumName || album,
    duration: track.duration || duration,
    instrumental: !!track.instrumental,
    hasWordSync: !!track.hasWordSync,
    yaml: track.lyricsfile || '',
    synced: track.syncedLyrics || '',
    plain: track.plainLyrics || '',
  }, 200, { 'cache-control': 'public, max-age=86400' });
}

async function chat(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  // Stops other websites from spending this site's allowance from their pages (not a defence against scripts).
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const model = AI_MODELS.includes(body?.model) ? body.model : AI_MODELS[0];
  const messages = (Array.isArray(body?.messages) ? body.messages : [])
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (messages.at(-1)?.role !== 'user') return json({ error: 'Send a message first.' }, 400);

  try {
    const options = { messages: [{ role: 'system', content: SYSTEM }, ...messages], stream: true, max_tokens: 1500 };
    // Gemma 4 thinks before answering by default: ~380 hidden tokens for a five-word reply. Off = faster, ~10x cheaper.
    if (model.includes('gemma-4')) options.chat_template_kwargs = { enable_thinking: false };
    const stream = await env.AI.run(model, options);
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
  } catch (e) {
    const used = /4006|allocation|neurons/i.test(String(e?.message || e));
    return used
      ? json({ error: 'The AI\'s free daily allowance is used up. It resets at midnight UTC.' }, 429)
      : json({ error: 'The AI had a problem answering. Try again in a moment.' }, 502);
  }
}

function tunnel(hostname, port) {
  const [client, ws] = Object.values(new WebSocketPair());
  ws.accept();
  ws.binaryType = 'arraybuffer'; // newer runtimes default to Blob

  let closed = false;
  let socket;
  const end = () => {
    if (closed) return;
    closed = true;
    try { ws.close(1000, 'closed'); } catch {}
    try { socket?.close(); } catch {}
  };

  try {
    socket = connect({ hostname, port });
  } catch {
    end();
    return new Response(null, { status: 101, webSocket: client });
  }
  const writer = socket.writable.getWriter();
  ws.addEventListener('message', ({ data }) => {
    if (typeof data !== 'string') writer.write(new Uint8Array(data)).catch(end);
  });
  ws.addEventListener('close', end);
  ws.addEventListener('error', end);

  (async () => {
    try {
      await socket.opened;
      for await (const chunk of socket.readable) ws.send(chunk);
    } catch {}
    end();
  })();

  return new Response(null, { status: 101, webSocket: client });
}
