import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ALL_FEEDS = JSON.parse(fs.readFileSync(path.join(ROOT,'feeds.json'),'utf8'));
const SKIP = new Set(['NFT','Е-трговија','Мода','Подкасти','Патување','Храна','Книги','Дизајн','Уметност','Магазин','Забава','Гејминг','Музика','Карипи']);
const feeds = ALL_FEEDS.filter(f=>!SKIP.has(f.category));
console.log('Fetching',feeds.length,'feeds');
async function fetchWithTimeout(url,ms=10000){const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),ms);try{const r=await fetch(url,{signal:ctrl.signal,headers:{'User-Agent':'Mozilla/5.0'}});clearTimeout(t);return r;}catch(e){clearTimeout(t);throw e;}}
function parseXML(xml,feed){const res=[];const re=/<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;let m,n=0;while((m=re.exec(xml))&&n<8){const b=m[1]||m[2];const title=(b.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)||[])[1]?.trim();if(!title)continue;const link=(b.match(/<link[^>]*>([^<]+)<\/link>/i)||b.match(/<link[^>]+href=["']([^"']+)["']/i)||[])[1]?.trim();const desc=((b.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)||b.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)||[])[1]||'').replace(/<[^>]+>/g,'').trim().slice(0,300);const pubDate=(b.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i)||b.match(/<published[^>]*>(.*?)<\/published>/i)||b.match(/<updated[^>]*>(.*?)<\/updated>/i)||[])[1]?.trim();const imgM=b.match(/url=["']([^"']+\.(?:jpg|jpeg|png|gif|webp))/i)||b.match(/<img[^>]+src=["']([^"']+)["']/i);res.push({title:title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"),link:link||'',contentSnippet:desc,pubDate:pubDate||'',image:imgM?imgM[1]:null,source:feed.name,category:feed.category});n++;}return res;}
async function fetchFeed(feed){try{const r=await fetchWithTimeout(feed.url);if(!r.ok)return[];const t=await r.text();if(!t||t.length<50)return[];return parseXML(t,feed);}catch(e){return[];}}
async function main(){const all=[];let ok=0,fail=0;const B=15;for(let i=0;i<feeds.length;i+=B){const res=await Promise.allSettled(feeds.slice(i,i+B).map(f=>fetchFeed(f)));res.forEach(r=>{if(r.status==='fulfilled'&&r.value.length){all.push(...r.value);ok++;}else fail++;});process.stdout.write(`\r[${Math.min(i+B,feeds.length)}/${feeds.length}] ${all.length} articles`);await new Promise(r=>setTimeout(r,200));}
console.log(`\nDone: ${ok} OK, ${fail} fail, ${all.length} total`);
all.sort((a,b)=>{const da=a.pubDate?new Date(a.pubDate):new Date(0),db=b.pubDate?new Date(b.pubDate):new Date(0);return db-da;});
const dir=path.join(ROOT,'data');if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'feeds.json'),JSON.stringify(all));
fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({updated:new Date().toISOString(),total:all.length,ok,fail},null,2));
console.log('Saved',all.length,'articles to data/feeds.json');
if(all.length===0){console.error('0 articles!');process.exit(1);}}
main().catch(e=>{console.error(e);process.exit(1);});
