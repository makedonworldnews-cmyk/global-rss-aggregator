// fetch-rss.js — GitHub Actions RSS fetcher
// Runs every 6 hours, saves to data/feeds.json
// Node.js 18+ (uses native fetch)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load feeds list from the HTML or directly
const feedsPath = path.join(__dirname, '..', 'feeds.json');
let ALL_FEEDS;
try {
  ALL_FEEDS = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));
  console.log(`Loaded ${ALL_FEEDS.length} feeds from feeds.json`);
} catch(e) {
  console.error('Cannot read feeds.json:', e.message);
  process.exit(1);
}

// Only fetch high-value categories (skip fake feeds like Netflix, HBO, etc.)
const SKIP_CATEGORIES = new Set([
  'NFT', 'Е-трговија', 'Мода', 'Подкасти', 'Патување', 'Храна',
  'Книги', 'Дизајн', 'Уметност', 'Магазин'
]);

const PRIORITY_CATEGORIES = [
  'Македонија', 'Балкан', 'Свет', 'Европа', 'Источна Европа',
  'Северна Европа', 'Балтик', 'Азија', 'Блиски Исток', 'Африка',
  'Океанија', 'Северна Америка', 'Јужна Америка', 'Централна Америка',
  'ОН', 'НАТО', 'ЕУ', 'ЕУ Политика', 'Министерства', 'Амбасади',
  'Think Tank', 'Технологија', 'AI', 'Наука', 'Екологија', 'Финансии',
  'Економија', 'НВО', 'Истражувачко', 'Универзитети', 'Спорт',
  'Сајбер Безбедност', 'Безбедност', 'Специјализирани', 'Дипломатија',
  'Енергија', 'Транспорт', 'Автомобили', 'Здравје', 'Фармација',
  'Криптовалути', 'Религија', 'Правда', 'Регионални Орг.', 'Глобални Орг.',
  'Карипи', 'Гејминг', 'Забава', 'Музика'
];

const filtered_feeds = ALL_FEEDS.filter(f => !SKIP_CATEGORIES.has(f.category));
console.log(`Fetching ${filtered_feeds.length} feeds (skipped ${ALL_FEEDS.length - filtered_feeds.length} low-value)`);

async function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MakedonWorldNews/3.0 RSS Reader' } });
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

function parseXML(xml, feed) {
  const results = [];
  // Simple regex-based parser (no DOM in Node)
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  let count = 0;
  while ((match = itemRe.exec(xml)) !== null && count < 8) {
    const block = match[1] || match[2];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim();
    if (!title) continue;
    const link = (block.match(/<link[^>]*>([^<]+)<\/link>/i) || block.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1]?.trim();
    const desc = ((block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || 
                   block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim().slice(0, 300);
    const pubDate = (block.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i) || 
                     block.match(/<published[^>]*>(.*?)<\/published>/i) || 
                     block.match(/<updated[^>]*>(.*?)<\/updated>/i) || [])[1]?.trim();
    const imgMatch = block.match(/url=["']([^"']+\.(?:jpg|jpeg|png|gif|webp))/i) ||
                     block.match(/<img[^>]+src=["']([^"']+)["']/i);
    const image = imgMatch ? imgMatch[1] : null;
    
    results.push({
      title: title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"),
      link: link || '',
      contentSnippet: desc,
      pubDate: pubDate || '',
      image,
      source: feed.name,
      category: feed.category
    });
    count++;
  }
  return results;
}

async function fetchFeed(feed) {
  try {
    const r = await fetchWithTimeout(feed.url, 12000);
    if (!r.ok) return [];
    const text = await r.text();
    // Check if it's JSON (rss2json style)
    if (text.trim().startsWith('{')) {
      try {
        const d = JSON.parse(text);
        if (d.items?.length) {
          return d.items.slice(0, 8).map(item => ({
            title: item.title || '',
            link: item.link || '',
            contentSnippet: (item.description || item.content || '').replace(/<[^>]+>/g,'').slice(0,300),
            pubDate: item.pubDate || '',
            image: item.thumbnail || null,
            source: feed.name,
            category: feed.category
          })).filter(i => i.title);
        }
      } catch(e) {}
    }
    return parseXML(text, feed);
  } catch(e) {
    return [];
  }
}

async function main() {
  const allItems = [];
  const BATCH = 20;
  let done = 0;
  let errors = 0;

  for (let i = 0; i < filtered_feeds.length; i += BATCH) {
    const batch = filtered_feeds.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(f => fetchFeed(f)));
    
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        allItems.push(...r.value);
        done++;
      } else {
        errors++;
      }
    });

    const total = filtered_feeds.length;
    const pct = Math.round((i + BATCH) / total * 100);
    process.stdout.write(`\r[${Math.min(i+BATCH, total)}/${total}] ${pct}% — ${allItems.length} articles`);
    
    // Small delay between batches to avoid rate limiting
    if (i + BATCH < filtered_feeds.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`\nDone: ${done} feeds OK, ${errors} failed, ${allItems.length} total articles`);

  // Sort by date descending
  allItems.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate) : new Date(0);
    const db = b.pubDate ? new Date(b.pubDate) : new Date(0);
    return db - da;
  });

  // Save
  const outDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const outPath = path.join(outDir, 'feeds.json');
  fs.writeFileSync(outPath, JSON.stringify(allItems, null, 0));
  
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`Saved ${allItems.length} articles to data/feeds.json (${sizeMB} MB)`);
  
  // Also save metadata
  const meta = {
    updated: new Date().toISOString(),
    total: allItems.length,
    feeds_fetched: done,
    feeds_failed: errors
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log('Saved meta.json:', meta);
}

main().catch(e => { console.error(e); process.exit(1); });
