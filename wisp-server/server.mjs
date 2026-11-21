// Wisp relay for the site's proxy, for hosting anywhere that isn't Cloudflare (a VPS, Render, your PC + a tunnel).
// Unlike the built-in Cloudflare relay, it can reach Cloudflare-hosted sites such as discord.com.
// Put its address (e.g. wss://wisp.example.com/) in the site's Settings -> Wisp server.
import http from 'node:http';
import { server as wisp, logging } from '@mercuryworkshop/wisp-js/server';

logging.set_level(logging.WARN); // don't log every site people visit

Object.assign(wisp.options, {
  allow_udp_streams: false,
  port_whitelist: [80, 443, 8080, 8443], // web only, so it can't be used as a general tunnel
  // wisp-js already refuses private and loopback IPs (checked after DNS), so your own network stays unreachable
});

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('wisp server is running\n');
})
  .on('upgrade', (req, socket, head) => wisp.routeRequest(req, socket, head))
  .listen(port, host, () => console.log(`wisp server on ws://${host}:${port}/`));
