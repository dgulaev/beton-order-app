/**
 * Скачивает дома/участки всех СО Брянска с bryansk.ginfo.ru
 * → lib/data/bryanskGardenPlots.json
 *
 * Запуск: node scripts/scrape-bryansk-garden-plots.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../lib/data/bryanskGardenPlots.json');
const UA = 'Mozilla/5.0 (compatible; concrete-beton-app/1.0; +garden-plots)';

const nearBryansk = (lat, lon) =>
  lat >= 52.9 && lat <= 53.7 && lon >= 33.5 && lon <= 35.2;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Стабильный id для кода: so_im_frunze → im_frunze; aeroflot slug → aeroflot */
function societyIdFromSlug(slug) {
  if (slug === 'sadovodcheskoe_obedinenie_aeroflot') return 'aeroflot';
  return slug.replace(/^so_/, '');
}

function foldName(name) {
  return String(name || '')
    .replace(/ё/gi, 'е')
    .toLowerCase()
    .replace(/^со\s+/i, '')
    .replace(/^садоводческое\s+объединение\s+/i, '')
    .replace(/^им\.?\s*/i, '')
    .replace(/^имени\s+/i, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePlotKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, '')
    .replace(/\\/g, '/')
    .replace(/-/g, '/');
}

async function listSoSlugs() {
  const html = await fetchText('https://bryansk.ginfo.ru/ulicy/?letter=%D0%A1');
  const slugs = new Set(
    [...html.matchAll(/href="\/ulicy\/(so_[^"/]+)\//g)].map((m) => m[1]),
  );
  slugs.add('sadovodcheskoe_obedinenie_aeroflot');
  return [...slugs].sort();
}

async function scrapeSociety(slug) {
  const listUrl = `https://bryansk.ginfo.ru/ulicy/${slug}/`;
  let listHtml;
  try {
    listHtml = await fetchText(listUrl);
  } catch (e) {
    return { slug, error: String(e.message || e), plots: {} };
  }

  const houseIds = [
    ...new Set(
      [...listHtml.matchAll(new RegExp(`href="/ulicy/${slug}/([^"/]+)/"`, 'g'))].map(
        (m) => m[1],
      ),
    ),
  ].filter((h) => h && h !== slug);

  const plots = {};
  let displayName = null;

  for (const house of houseIds) {
    const url = `https://bryansk.ginfo.ru/ulicy/${slug}/${encodeURIComponent(house)}/`;
    try {
      const dom = await fetchText(url);
      const coord = dom.match(/id=coord_dom value="([0-9.]+),([0-9.]+)"/);
      if (!coord) continue;
      const lat = parseFloat(coord[1]);
      const lon = parseFloat(coord[2]);
      if (!nearBryansk(lat, lon)) continue;
      const key = normalizePlotKey(house);
      if (!key) continue;
      plots[key] = { lat, lon };
      if (!displayName) {
        const t = dom.match(/<h1>([\s\S]*?)<\/h1>/);
        if (t) {
          displayName = t[1]
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .replace(/\s*в Брянске\s*$/i, '')
            .replace(/,\s*[\dА-ЯA-Za-zЁё/-]+$/u, '')
            .trim();
        }
      }
    } catch {
      // skip missing house pages
    }
    await sleep(40);
  }

  const id = societyIdFromSlug(slug);
  const niceName = displayName
    ? displayName
        .replace(/^СО\s+/i, '')
        .replace(/^садоводческое объединение\s+/i, '')
        .trim()
    : id.replace(/_/g, ' ');

  return {
    id,
    slug,
    name: niceName,
    nameKey: foldName(niceName),
    plotCount: Object.keys(plots).length,
    plots,
  };
}

async function main() {
  console.log('Listing СО…');
  const slugs = await listSoSlugs();
  console.log(`Found ${slugs.length} slugs`);

  const societies = {};
  let totalPlots = 0;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    process.stdout.write(`[${i + 1}/${slugs.length}] ${slug}… `);
    const s = await scrapeSociety(slug);
    if (s.error) {
      console.log(`FAIL ${s.error}`);
      continue;
    }
    if (s.plotCount === 0) {
      console.log('0 plots — skip');
      continue;
    }
    societies[s.id] = {
      name: s.name,
      nameKey: s.nameKey,
      slug: s.slug,
      plots: s.plots,
    };
    totalPlots += s.plotCount;
    console.log(`${s.plotCount} plots (${s.name})`);
    await sleep(80);
  }

  const payload = {
    source: 'https://bryansk.ginfo.ru/',
    updatedAt: new Date().toISOString(),
    societyCount: Object.keys(societies).length,
    plotCount: totalPlots,
    societies,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nWrote ${OUT}`);
  console.log(`Societies: ${payload.societyCount}, plots: ${payload.plotCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
