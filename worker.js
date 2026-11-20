// Wisp v1 relay (https://github.com/MercuryWorkshop/wisp-protocol) running on Cloudflare Workers.
// Scramjet's transport opens one WebSocket to /wisp/ and multiplexes every TCP connection over it.
// shortcut: Workers can't open sockets to Cloudflare-hosted IPs, so those sites fail here;
// point the "Wisp server" setting at a Node wisp-js server to reach them.
import { connect } from 'cloudflare:sockets';

const CONNECT = 1, DATA = 2, CONTINUE = 3, CLOSE = 4;
const TCP = 1;
const BUFFER = 128; // packets a client may send per stream before waiting for CONTINUE
const enc = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/wisp/' && request.headers.get('Upgrade') === 'websocket') return relay(request);
    return env.ASSETS.fetch(request);
  },
};

export function packet(type, id, payload = new Uint8Array(0)) {
  const p = new Uint8Array(5 + payload.byteLength);
  const v = new DataView(p.buffer);
  v.setUint8(0, type);
  v.setUint32(1, id, true);
  p.set(payload, 5);
  return p;
}
const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };

function relay(request) {
  const [client, ws] = Object.values(new WebSocketPair());
  ws.accept();
  ws.binaryType = 'arraybuffer'; // newer runtimes default to Blob
  const streams = new Map();
  const send = p => { try { ws.send(p); } catch {} };

  function close(id, reason, notify = true) {
    const s = streams.get(id);
    if (!s) return;
    streams.delete(id);
    try { s.socket.close(); } catch {}
    if (notify) send(packet(CLOSE, id, new Uint8Array([reason])));
  }

  function open(id, payload) {
    const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const type = v.getUint8(0), port = v.getUint16(1, true);
    const hostname = enc.decode(payload.subarray(3));
    if (type !== TCP || !port || !hostname) return send(packet(CLOSE, id, new Uint8Array([0x41])));

    let socket;
    try { socket = connect({ hostname, port }); } catch { return send(packet(CLOSE, id, new Uint8Array([0x42]))); }
    const s = { socket, writer: socket.writable.getWriter(), acked: 0 };
    streams.set(id, s);

    (async () => {
      try {
        await socket.opened;
        for await (const chunk of socket.readable) send(packet(DATA, id, chunk));
        close(id, 0x02);
      } catch {
        close(id, 0x03);
      }
    })();
  }

  ws.addEventListener('message', ({ data }) => {
    if (typeof data === 'string') return;
    const bytes = new Uint8Array(data);
    if (bytes.length < 5) return;
    const type = bytes[0];
    const id = new DataView(bytes.buffer).getUint32(1, true);
    const payload = bytes.subarray(5);

    if (type === CONNECT) open(id, payload);
    else if (type === DATA) {
      const s = streams.get(id);
      if (!s) return;
      s.writer.write(payload).then(() => {
        // hand out more credit once half the buffer has drained
        if (++s.acked % (BUFFER / 2) === 0) send(packet(CONTINUE, id, u32(BUFFER)));
      }, () => close(id, 0x03));
    } else if (type === CLOSE) close(id, 0, false);
  });

  const closeAll = () => { for (const id of [...streams.keys()]) close(id, 0, false); };
  ws.addEventListener('close', closeAll);
  ws.addEventListener('error', closeAll);

  // v1 handshake: the first packet is CONTINUE on stream 0 with the per-stream buffer size
  send(packet(CONTINUE, 0, u32(BUFFER)));

  // browsers fail the handshake unless one requested subprotocol is echoed back
  const proto = request.headers.get('Sec-WebSocket-Protocol');
  const headers = proto ? { 'Sec-WebSocket-Protocol': proto.split(',')[0].trim() } : {};
  return new Response(null, { status: 101, webSocket: client, headers });
}
