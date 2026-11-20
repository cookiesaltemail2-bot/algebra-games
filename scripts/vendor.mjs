// Copies the proxy libraries out of node_modules into public/ so Cloudflare serves them as static files.
import { cpSync, rmSync } from 'node:fs';

const copies = {
  'node_modules/@mercuryworkshop/scramjet/dist': 'public/scram',
  'node_modules/@mercuryworkshop/bare-mux/dist': 'public/baremux',
  'node_modules/@mercuryworkshop/libcurl-transport/dist': 'public/libcurl',
  'node_modules/lucide/dist/umd': 'public/lucide',
};
for (const [from, to] of Object.entries(copies)) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: f => !f.endsWith('.map') && !f.includes('types') });
  console.log(`copied ${from} -> ${to}`);
}
