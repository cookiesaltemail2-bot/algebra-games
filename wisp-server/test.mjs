// Self-check: start the server first (npm start), then run `node test.mjs [ws://127.0.0.1:8080/]`.
// Expects public sites (including Cloudflare-hosted discord.com) to answer, and blocked targets to be refused.
import { client as wisp } from '@mercuryworkshop/wisp-js/client';

const url = process.argv[2] || 'ws://127.0.0.1:8080/';
const cases = [
  ['discord.com', 80, true],
  ['www.google.com', 80, true],
  ['127.0.0.1', 80, false],   // your own machine
  ['192.168.1.1', 80, false], // your home network
  ['www.google.com', 22, false], // non-web port
];

const conn = new wisp.ClientConnection(url);
conn.onerror = () => { console.error('FAIL: could not connect to', url); process.exit(1); };
conn.onopen = async () => {
  const results = await Promise.all(cases.map(([host, port, shouldWork]) => new Promise(resolve => {
    const s = conn.create_stream(host, port);
    let reply = '';
    const done = ok => { clearTimeout(t); resolve({ host, port, shouldWork, ok, line: reply.split('\r\n')[0] }); };
    const t = setTimeout(() => done(false), 8000);
    s.onmessage = d => { reply += new TextDecoder().decode(d); if (reply.includes('\r\n')) done(true); };
    s.onclose = () => done(reply.startsWith('HTTP/'));
    s.send(new TextEncoder().encode(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
  })));
  let pass = true;
  for (const r of results) {
    const good = r.ok === r.shouldWork;
    pass &&= good;
    console.log(`${good ? 'PASS' : 'FAIL'} ${`${r.host}:${r.port}`.padEnd(20)} ${r.shouldWork ? 'reachable' : 'blocked'}${r.ok ? ` (${r.line})` : ''}`);
  }
  process.exit(pass ? 0 : 1);
};
