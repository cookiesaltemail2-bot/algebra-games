// Builds public/charts.json: Apple's top 50 songs with their official 30-second previews.
// Done at build time because Apple's chart feed has no CORS and refuses requests from Workers.
import { writeFileSync, existsSync } from 'node:fs';

const OUT = 'public/charts.json';

// Apple's feed sometimes answers 502 for a moment, so retry a few times
async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url).catch(e => ({ ok: false, status: e.message }));
    if (r.ok) return r.json();
    if (attempt === 4) throw new Error(`${url} ${r.status}`);
    await new Promise(res => setTimeout(res, attempt * 3000));
  }
}

try {
  const feed = await getJson('https://rss.marketingtools.apple.com/api/v2/us/music/most-played/50/songs.json');
  const ids = feed.feed.results.map(r => r.id);
  const look = await getJson(`https://itunes.apple.com/lookup?id=${ids.join(',')}&entity=song`);
  const byId = new Map(look.results.filter(r => r.previewUrl).map(r => [String(r.trackId), r]));
  const tracks = ids.map(id => byId.get(id)).filter(Boolean).map(r => ({
    id: `apple-${r.trackId}`, t: r.trackName, a: r.artistName,
    art: r.artworkUrl100?.replace('100x100bb', '600x600bb') || '', src: r.previewUrl,
    e: r.trackExplicitness === 'explicit', preview: true,
  }));
  // self-check: a real chart has dozens of songs, each with a preview
  if (tracks.length < 10 || !tracks.every(t => t.src.startsWith('https://'))) throw new Error(`only ${tracks.length} usable songs`);
  writeFileSync(OUT, JSON.stringify(tracks));
  console.log(`charts: ${tracks.length} songs`);
} catch (e) {
  // keep the last good chart rather than failing the deploy
  console.warn(`charts: ${e.message}${existsSync(OUT) ? ', keeping the existing list' : ', writing an empty list'}`);
  if (!existsSync(OUT)) writeFileSync(OUT, '[]');
}
