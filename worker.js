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
    const m = new URL(request.url).pathname.match(/^\/wsproxy\/([a-z0-9.-]+):(\d{1,5})$/i);
    if (m && request.headers.get('Upgrade') === 'websocket') {
      const port = Number(m[2]);
      if (!ALLOWED_PORTS.has(port)) return new Response('port not allowed', { status: 403 });
      return tunnel(m[1], port);
    }
    return env.ASSETS.fetch(request);
  },
};

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
