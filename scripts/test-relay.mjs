// Self-check for the relay: opens real HTTPS connections through /wsproxy/, in parallel, and reports each one.
// Usage: node scripts/test-relay.mjs [base url, e.g. ws://127.0.0.1:8787] [host ...]
// Tip: repeat a host 70 times to prove there's no per-session connection cap.
import tls from 'node:tls';
import { Duplex } from 'node:stream';

const base = (process.argv[2] || 'ws://127.0.0.1:8787').replace(/\/$/, '');
const hosts = process.argv.slice(3).length ? process.argv.slice(3) : ['www.google.com', 'www.tiktok.com', 'en.wikipedia.org'];

// a Duplex over one relay WebSocket, so Node's TLS can run through it
function relaySocket(host, port) {
  const ws = new WebSocket(`${base}/wsproxy/${host}:${port}`);
  ws.binaryType = 'arraybuffer';
  const pending = [];
  const d = new Duplex({
    read() {},
    write(chunk, _enc, cb) { ws.readyState === 1 ? ws.send(chunk) : pending.push(chunk); cb(); },
    destroy(err, cb) { try { ws.close(); } catch {} cb(err); },
  });
  ws.onopen = () => pending.splice(0).forEach(c => ws.send(c));
  ws.onmessage = ({ data }) => d.push(Buffer.from(data));
  ws.onclose = () => d.push(null);
  ws.onerror = () => d.destroy(new Error('websocket error'));
  return d;
}

function check(host) {
  const started = Date.now();
  return new Promise(resolve => {
    const s = tls.connect({ socket: relaySocket(host, 443), servername: host });
    let head = '', finished = false;
    const done = msg => {
      if (finished) return;
      finished = true;
      s.destroy();
      resolve(`${host.padEnd(22)} ${msg} (${Date.now() - started}ms)`);
    };
    s.on('secureConnect', () => s.write(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`));
    s.on('data', c => { head += c; if (head.includes('\r\n')) done('PASS ' + head.split('\r\n')[0]); });
    s.on('error', e => done(`FAIL ${e.code || e.message}`));
    s.on('close', () => done('FAIL closed'));
    setTimeout(() => done('FAIL timeout'), 15000);
  });
}

const results = await Promise.all(hosts.map(check));
console.log(results.join('\n'));
process.exit(results.every(r => r.includes('PASS')) ? 0 : 1);
