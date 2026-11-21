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
    if (pathname === '/img') return gameImage(request);
    const m = pathname.match(/^\/wsproxy\/([a-z0-9.-]+):(\d{1,5})$/i);
    if (m && request.headers.get('Upgrade') === 'websocket') {
      const port = Number(m[2]);
      if (!ALLOWED_PORTS.has(port)) return new Response('port not allowed', { status: 403 });
      return tunnel(m[1], port);
    }
    return env.ASSETS.fetch(request);
  },
};

// ---------- game thumbnails ----------
// Fallback for browsers whose ad blocker or tracking prevention blocks the catalogs' image hosts:
// the page retries a failed thumbnail here, same-origin. Only those two hosts, so it isn't an open proxy.
export const IMG_HOSTS = ['img.gamemonetize.com', 'img.gamedistribution.com'];

async function gameImage(request) {
  let url;
  try { url = new URL(new URL(request.url).searchParams.get('u')); } catch {}
  if (!url || url.protocol !== 'https:' || !IMG_HOSTS.includes(url.hostname)) return new Response('not allowed', { status: 400 });
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 604800 } });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) return new Response('not found', { status: 404 });
  return new Response(r.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800' } });
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

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
