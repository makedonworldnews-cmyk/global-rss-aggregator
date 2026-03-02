import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parser = new Parser({ timeout: 5000 });
const allItems = [];

// Читање на сите sources_part*.json фајлови од папката sources/
const sourcesFiles = await glob(path.join(__dirname, '..', 'sources', 'sources_part*.json'));
let allSources = [];

for (const file of sourcesFiles) {
  try {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    allSources = allSources.concat(content);
  } catch (e) {
    console.error(`❌ Грешка во ${file}: ${e.message}`);
  }
}

console.log(`📚 Вчитани ${allSources.length} извори.`);

async function fetchFeeds() {
  console.log('🚀 Почнување со собирање на вести...');
  
  for (const source of allSources) {
    try {
      if (!source.url) continue;
      
      console.log(`📡 Читање: ${source.name}`);
      const feed = await parser.parseURL(source.url);
      
      // Земаш само 3 најнови вести по извор
      feed.items.slice(0, 3).forEach(item => {
        allItems.push({
          title: item.title || 'Без наслов',
          link: item.link || '#',
          pubDate: item.pubDate || new Date().toISOString(),
          source: source.name,
          category: source.category || 'Global',
          contentSnippet: item.contentSnippet || item.description || ''
        });
      });
    } catch (error) {
      // Тивка грешка — не го стопира целиот процес
      console.warn(`⚠️ Прескокнато: ${source.name}`);
    }
  }
  
  // Сортирање по датум (најнови први)
  allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  
  // Креирање на папката data ако не постои
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }
  
  // Запишување во JSON
  const outputPath = path.join(dataDir, 'feeds.json');
  fs.writeFileSync(outputPath, JSON.stringify(allItems, null, 2));
  
  console.log(`✅ Успешно! Зачувани ${allItems.length} вести во ${outputPath}`);
}

fetchFeeds();
