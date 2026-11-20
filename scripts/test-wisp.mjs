// Self-check for the Wisp relay: opens a stream to example.com:80 and expects an HTTP reply.
// Usage: node scripts/test-wisp.mjs [ws://localhost:8787/wisp/]
const url = process.argv[2] || 'ws://localhost:8787/wisp/';
const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';

const packet = (type, id, payload) => {
  const p = new Uint8Array(5 + payload.length);
  p[0] = type;
  new DataView(p.buffer).setUint32(1, id, true);
  p.set(payload, 5);
  return p;
};
const host = new TextEncoder().encode('example.com');
const connectPayload = new Uint8Array(3 + host.length);
connectPayload[0] = 1;
new DataView(connectPayload.buffer).setUint16(1, 80, true);
connectPayload.set(host, 3);

let gotContinue = false, reply = '';
const timer = setTimeout(() => fail('timed out'), 10000);
function fail(msg) { console.error('FAIL:', msg); process.exit(1); }

ws.onmessage = ({ data }) => {
  const b = new Uint8Array(data);
  const id = new DataView(b.buffer).getUint32(1, true);
  if (b[0] === 3 && id === 0) {
    gotContinue = true;
    ws.send(packet(1, 7, connectPayload));
    ws.send(packet(2, 7, new TextEncoder().encode('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n')));
  } else if (b[0] === 2 && id === 7) {
    reply += new TextDecoder().decode(b.subarray(5));
  } else if (b[0] === 4 && id === 7) {
    clearTimeout(timer);
    if (!gotContinue) fail('no handshake CONTINUE');
    if (!reply.startsWith('HTTP/1.1')) fail('no HTTP reply, got: ' + reply.slice(0, 80));
    console.log('PASS:', reply.split('\r\n')[0]);
    process.exit(0);
  }
};
ws.onerror = () => fail('websocket error');
