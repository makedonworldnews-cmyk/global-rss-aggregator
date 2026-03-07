// scripts/fetch-rss.js — GitHub Actions RSS fetcher
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');  // repo root

// Load feeds.json from repo root
const feedsPath = path.join(ROOT, 'feeds.json');
console.log('Loading feeds from:', feedsPath);

let ALL_FEEDS;
try {
  ALL_FEEDS = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));
  console.log('Loaded', ALL_FEEDS.length, 'feeds');
} catch(e) {
  console.error('ERROR reading feeds.json:', e.message);
  console.error('Expected at:', feedsPath);
  console.error('Files in root:', fs.readdirSync(ROOT).join(', '));
  process.exit(1);
}

// Skip categories with fake/non-RSS URLs
const SKIP = new Set(['NFT','Е-трговија','Мода','Подкасти','Патување','Храна','Книги','Дизајн','Уметност','Магазин','Забава','Гејминг','Музика','Карипи']);
const feeds = ALL_FEEDS.filter(f => !SKIP.has(f.category));
console.log('Fetching', feeds.length, 'feeds (skipped', ALL_FEEDS.length - feeds.length, ')');

async function fetchWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 RSS Reader' }
    });
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

function parseXML(xml, feed) {
  const results = [];
  const re = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let m, count = 0;
  while ((m = re.exec(xml)) && count < 8) {
    const b = m[1] || m[2];
    const title = (b.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)||[])[1]?.trim();
    if (!title || title.includes('<?xml')) continue;
    const link = (b.match(/<link[^>]*>([^<]+)<\/link>/i)||b.match(/<link[^>]+href=["']([^"']+)["']/i)||[])[1]?.trim();
    const desc = ((b.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)||
                   b.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)||[])[1]||'').replace(/<[^>]+>/g,'').trim().slice(0,300);
    const pubDate = (b.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i)||
                     b.match(/<published[^>]*>(.*?)<\/published>/i)||
                     b.match(/<updated[^>]*>(.*?)<\/updated>/i)||[])[1]?.trim();
    const imgM = b.match(/url=["']([^"']+\.(?:jpg|jpeg|png|gif|webp)[^"']*)/i)||
                 b.match(/<img[^>]+src=["']([^"']+)["']/i);
    results.push({
      title: title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#\d+;/g,''),
      link: link||'', contentSnippet: desc, pubDate: pubDate||'',
      image: imgM?imgM[1]:null, source: feed.name, category: feed.category
    });
    count++;
  }
  return results;
}

async function fetchFeed(feed) {
  try {
    const r = await fetchWithTimeout(feed.url, 10000);
    if (!r.ok) return [];
    const text = await r.text();
    if (!text || text.length < 50) return [];
    return parseXML(text, feed);
  } catch(e) {
    return [];
  }
}

async function main() {
  const allItems = [];
  let ok = 0, fail = 0;
  const BATCH = 15;

  for (let i = 0; i < feeds.length; i += BATCH) {
    const batch = feeds.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(f => fetchFeed(f)));
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.length) {
        allItems.push(...r.value); ok++;
      } else { fail++; }
    });
    const pct = Math.round(Math.min(i+BATCH, feeds.length) / feeds.length * 100);
    process.stdout.write(`\r[${Math.min(i+BATCH,feeds.length)}/${feeds.length}] ${pct}% — ${allItems.length} articles`);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nResult: ${ok} OK, ${fail} failed, ${allItems.length} articles total`);

  allItems.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate) : new Date(0);
    const db = b.pubDate ? new Date(b.pubDate) : new Date(0);
    return db - da;
  });

  const dataDir = path.join(ROOT, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, 'feeds.json'), JSON.stringify(allItems));
  fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify({
    updated: new Date().toISOString(), total: allItems.length,
    feeds_ok: ok, feeds_fail: fail
  }, null, 2));

  const mb = (fs.statSync(path.join(dataDir,'feeds.json')).size/1024/1024).toFixed(2);
  console.log(`Saved data/feeds.json — ${allItems.length} articles (${mb} MB)`);
  if (allItems.length === 0) {
    console.error('WARNING: 0 articles saved!');
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
