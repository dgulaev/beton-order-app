/**
 * Парсеры прайсов конкурентов Брянска.
 * Каждый адаптер возвращает нормализованные строки grade_key + filler + price.
 */

import type { CompetitorFiller } from '@/lib/competitors';
import { BRYANSK_COMPETITORS } from '@/lib/competitorsCatalog';

export type ParsedPriceRow = {
  grade_key: string;
  filler: CompetitorFiller;
  price: number;
  source_url: string;
};

export type ParseResult = {
  parser_key: string;
  rows: ParsedPriceRow[];
  error?: string;
};

const FETCH_TIMEOUT_MS = 20000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGrade(raw: string): string | null {
  const s = raw.replace(/\s+/g, '').toUpperCase().replace('M', 'М');
  const m = s.match(/М-?(\d{2,3})/);
  if (!m) return null;
  return `М${m[1]}`;
}

/** Класс прочности B/В → ориентировочная марка М. */
function classToGrade(raw: string): string | null {
  const s = raw.replace(/\s+/g, '').toUpperCase().replace('B', 'В');
  const m = s.match(/В(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const cls = Number(String(m[1]).replace(',', '.'));
  const map: [number, string][] = [
    [7.5, 'М100'],
    [10, 'М150'],
    [12.5, 'М150'],
    [15, 'М200'],
    [20, 'М250'],
    [22.5, 'М300'],
    [25, 'М350'],
    [27.5, 'М350'],
    [30, 'М400'],
    [35, 'М450'],
    [40, 'М500'],
  ];
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const [v, g] of map) {
    const d = Math.abs(v - cls);
    if (d < bestDiff) {
      bestDiff = d;
      best = g;
    }
  }
  return bestDiff <= 1.5 ? best : null;
}

function parseMoney(raw: string): number | null {
  const cleaned = raw
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d.,\s]/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  // 6 332 / 6332 / 6332.00
  const m = cleaned.match(/(\d{3,6}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1000 && n <= 50000 ? Math.round(n) : null;
}

function detectFiller(text: string): CompetitorFiller | null {
  const t = text.toLowerCase();
  if (/раствор|р-?р\b|цпр|кладочн/.test(t) && !/бетон/.test(t)) return 'mortar';
  if (/гранит/.test(t)) return 'granite';
  if (/известняк|доломит|гравий/.test(t)) return 'dolomite';
  return null;
}

/**
 * ЕКСОН /pricelist:
 * «М-100 … известняк 5040 руб. гранит 6150 руб.»
 * «М-300 … гранит 7100 руб.»
 * «Раствор цементный М-50 … 3590 руб. М-75 …»
 */
function parseEcson(html: string, source_url: string): ParsedPriceRow[] {
  const text = stripHtml(html);
  const rows: ParsedPriceRow[] = [];

  // Обрезаем прайс до песка/ФБС, чтобы не цеплять чужие М
  const betonStart = text.search(/Бетон\s+товарный|щебень\s+фракции/i);
  const mortarStart = text.search(/Раствор\s+цементный/i);
  const afterMortar = text.search(/Песок\s+строительный|Сухая\s+смесь|Фундаментн/i);
  const betonChunk =
    betonStart >= 0
      ? text.slice(betonStart, mortarStart > betonStart ? mortarStart : betonStart + 4000)
      : text;
  const mortarChunk =
    mortarStart >= 0
      ? text.slice(mortarStart, afterMortar > mortarStart ? afterMortar : mortarStart + 800)
      : '';

  const dual =
    /М-?\s*(\d{2,3})[\s\S]{0,120}?известняк\s*(\d{4,5})\s*руб\.?[\s\S]{0,40}?гранит\s*(\d{4,5})\s*руб/gi;
  let m: RegExpExecArray | null;
  while ((m = dual.exec(betonChunk))) {
    rows.push({
      grade_key: `М${m[1]}`,
      filler: 'dolomite',
      price: Number(m[2]),
      source_url,
    });
    rows.push({
      grade_key: `М${m[1]}`,
      filler: 'granite',
      price: Number(m[3]),
      source_url,
    });
  }

  // Строки только с гранитом (М300+); first-wins — у М350 есть В25 и В27.5
  const onlyGran = /М-?\s*(\d{2,3})[\s\S]{0,80}?гранит\s*(\d{4,5})\s*руб/gi;
  while ((m = onlyGran.exec(betonChunk))) {
    const grade = `М${m[1]}`;
    if (!rows.some((r) => r.grade_key === grade && r.filler === 'granite')) {
      rows.push({
        grade_key: grade,
        filler: 'granite',
        price: Number(m[2]),
        source_url,
      });
    }
  }

  const mortarRe = /М-?\s*(\d{2,3})[\s\S]{0,40}?(\d{4,5})\s*руб/gi;
  while ((m = mortarRe.exec(mortarChunk))) {
    const price = Number(m[2]);
    if (price >= 2000 && price <= 20000) {
      rows.push({
        grade_key: `М${m[1]}`,
        filler: 'mortar',
        price,
        source_url,
      });
    }
  }

  return dedupeRows(rows);
}

/**
 * Мегаполис / МегаБетон (главная):
 * «Бетонная смесь на гравийном/гранитном щебне … М100 B7,5… 6620 …»
 * первая цена = без ПМД с НДС; гравий → dolomite.
 * «Растворы М100 4710 …»
 */
function parseMegapolis(html: string, source_url: string): ParsedPriceRow[] {
  const text = stripHtml(html);
  const rows: ParsedPriceRow[] = [];

  const gravelIdx = text.search(/на\s+гравийном\s+щебне/i);
  const graniteIdx = text.search(/на\s+гранитном\s+щебне/i);
  const mortarIdx = text.search(/Растворы\s+М\s*\d{2,3}/i);

  const parseBetonChunk = (chunk: string, filler: CompetitorFiller) => {
    // М100 B7,5П3F50W2 6620 … или М100 B7,5 6620 … → первая цена (без ПМД)
    const re = /М\s*(\d{2,3})\s*B[\d,.]{1,6}(?:П\d[A-Z0-9,]*)?\s+(\d{4,5})/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) {
      const price = Number(m[2]);
      if (price >= 3000 && price <= 20000) {
        rows.push({ grade_key: `М${m[1]}`, filler, price, source_url });
      }
    }
  };

  if (gravelIdx >= 0) {
    const end = graniteIdx > gravelIdx ? graniteIdx : gravelIdx + 2500;
    parseBetonChunk(text.slice(gravelIdx, end), 'dolomite');
  }
  if (graniteIdx >= 0) {
    const end = mortarIdx > graniteIdx ? mortarIdx : graniteIdx + 3000;
    parseBetonChunk(text.slice(graniteIdx, end), 'granite');
  }
  if (mortarIdx >= 0) {
    const chunk = text.slice(mortarIdx, mortarIdx + 400);
    const re = /М\s*(\d{2,3})\s+(\d{4,5})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) {
      const price = Number(m[2]);
      if (price >= 2000 && price <= 15000) {
        rows.push({
          grade_key: `М${m[1]}`,
          filler: 'mortar',
          price,
          source_url,
        });
      }
    }
  }

  return dedupeRows(rows);
}

/**
 * Мастер Бетон (master-beton32.ru):
 * «В 7.5 (М-100) М3 4800.00» — гранит
 * «М-50 М3 2250.00» — цементный раствор
 */
function parseMasterbeton(html: string, source_url: string): ParsedPriceRow[] {
  const text = stripHtml(html);
  const rows: ParsedPriceRow[] = [];

  const priceBlock =
    text.match(/Прайс-лист([\s\S]*?)(?:Как мы работаем|ЦЕМ\s*II|Ответы на частые|$)/i)?.[1] ||
    text;

  // Бетон на граните: В 7.5 (М-100) М3 4800.00
  const betonRe =
    /В\s*\d+(?:[.,]\d+)?\s*\(\s*М-?\s*(\d{2,3})\s*\)\s*М\s*3\s*(\d{4,5})(?:[.,]\d{2})?/gi;
  let m: RegExpExecArray | null;
  while ((m = betonRe.exec(priceBlock))) {
    const price = Number(m[2]);
    if (price >= 3000 && price <= 20000) {
      rows.push({
        grade_key: `М${m[1]}`,
        filler: 'granite',
        price,
        source_url,
      });
    }
  }

  // Раствор: секция начинается с М-50 после таблицы гранита
  const mortarStart = priceBlock.search(/М-?\s*50\s*М\s*3/i);
  const mortarChunk =
    mortarStart >= 0 ? priceBlock.slice(mortarStart, mortarStart + 300) : '';
  const mortarRe = /М-?\s*(\d{2,3})\s*М\s*3\s*(\d{4,5})(?:[.,]\d{2})?/gi;
  while ((m = mortarRe.exec(mortarChunk))) {
    const price = Number(m[2]);
    if (price >= 1500 && price <= 12000) {
      rows.push({
        grade_key: `М${m[1]}`,
        filler: 'mortar',
        price,
        source_url,
      });
    }
  }

  return dedupeRows(rows);
}

/**
 * СпецБетон (главная):
 * «М - 100 (В 7.5) м 3 Гравий 5700 / Гранит 6100»
 * «М - 150 (В 12.5) м 3 5850 / 6200»
 * «М - 350 (В 25) м 3 - / 7200»
 * «Раствор цементный М - 50 м 3 3550 …»
 * Гравий → dolomite. Тощий бетон пропускаем.
 */
function parseSpecbeton(html: string, source_url: string): ParsedPriceRow[] {
  const text = stripHtml(html);
  const rows: ParsedPriceRow[] = [];

  const betonBlock =
    text.match(/Бетон\s+товарный([\s\S]*?)(?:Тощий\s+бетон|ФБС|Предприятие|$)/i)?.[1] ||
    text;

  const dual =
    /М\s*[-–]?\s*(\d{2,3})\s*\([^)]*\)[\s\S]{0,40}?(?:Гравий\s*)?(\d{4,5}|-)[\s\S]{0,15}?\/[\s\S]{0,15}?(?:Гранит\s*)?(\d{4,5})/gi;
  let m: RegExpExecArray | null;
  // first-wins: М350 В25 перед В27,5
  const seen = new Set<string>();
  while ((m = dual.exec(betonBlock))) {
    const grade_key = `М${m[1]}`;
    const gravel = m[2] === '-' ? null : Number(m[2]);
    const granite = Number(m[3]);
    if (gravel != null && Number.isFinite(gravel)) {
      const key = `${grade_key}|dolomite`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ grade_key, filler: 'dolomite', price: gravel, source_url });
      }
    }
    if (Number.isFinite(granite)) {
      const key = `${grade_key}|granite`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ grade_key, filler: 'granite', price: granite, source_url });
      }
    }
  }

  const mortarBlock =
    text.match(/Раствор\s+цементный([\s\S]*?)Бетон\s+товарный/i)?.[1] || '';
  const mr = /М\s*[-–]?\s*(\d{2,3})\s*м\s*3\s*(\d{4,5})/gi;
  let mm: RegExpExecArray | null;
  while ((mm = mr.exec(mortarBlock))) {
    rows.push({
      grade_key: `М${mm[1]}`,
      filler: 'mortar',
      price: Number(mm[2]),
      source_url,
    });
  }

  return dedupeRows(rows);
}

/**
 * Элит бетон:
 * /beton/ — «Бетон М-100 … от 5500»; «М-300 (на граните) … от 7150»
 *   все марки бетона — на граните; берём только П3 (не П4).
 * /rastvor/ — «Раствор М 100 от 4100» (штукатурный пропускаем).
 */
function parseElitbeton(html: string, source_url: string): ParsedPriceRow[] {
  const text = stripHtml(html);
  const rows: ParsedPriceRow[] = [];

  // Только секция П3 до «Бетон товарный П4»
  const p3 =
    text.match(/Бетон\s+товарный\s+П3([\s\S]*?)(?:Бетон\s+товарный\s+П4|Удорожание|$)/i)?.[1] ||
    '';
  if (p3) {
    const re =
      /Бетон\s*М-?\s*(\d{2,3})(?:\s*\(на\s*граните\))?[\s\S]{0,60}?от\s*(\d{4,5})/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(p3))) {
      const grade_key = `М${m[1]}`;
      const price = Number(m[2]);
      const key = `${grade_key}|granite`;
      if (seen.has(key) || !Number.isFinite(price)) continue;
      seen.add(key);
      if (price >= 3000 && price <= 20000) {
        rows.push({ grade_key, filler: 'granite', price, source_url });
      }
    }
  }

  // Раствор
  const mortarChunk =
    text.match(/Цены\s+на\s+раствор([\s\S]*?)(?:Удорожание|Цементно-песчаная|$)/i)?.[1] ||
    text.match(/Раствор\s+М\s*\d{2,3}[\s\S]{0,800}/i)?.[0] ||
    '';
  const rr = /Раствор\s+М\s*(\d{2,3})(?!\s*штукатур)[\s\S]{0,30}?от\s*(\d{4,5})/gi;
  let rm: RegExpExecArray | null;
  const seenM = new Set<string>();
  while ((rm = rr.exec(mortarChunk || text))) {
    // доп. отсев штукатурных (lookahead не всегда срабатывает из‑за пробелов)
    const around = rm[0].toLowerCase();
    if (around.includes('штукатур')) continue;
    const grade_key = `М${rm[1]}`;
    if (seenM.has(grade_key)) continue;
    seenM.add(grade_key);
    const price = Number(rm[2]);
    if (price >= 1500 && price <= 15000) {
      rows.push({ grade_key, filler: 'mortar', price, source_url });
    }
  }

  return dedupeRows(rows);
}

const ELITBETON_PRICE_URLS = [
  'https://xn--32-9kcqnrrh7ac9i.xn--p1ai/beton/',
  'https://xn--32-9kcqnrrh7ac9i.xn--p1ai/rastvor/',
] as const;

/**
 * Деловой Бетон /caenad.html — таблицы:
 * растворы М50…М200 + бетон на граните М100…М500.
 * Цены вида «6 200,0»; кириллица часто в &#x…; entities.
 */
function parseDelobeton(html: string, source_url: string): ParsedPriceRow[] {
  const text = stripHtml(html);
  const rows: ParsedPriceRow[] = [];

  const priceNums = (chunk: string): number[] => {
    const out: number[] = [];
    const re = /(\d[\d\s]{2,5}),\d/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) {
      const n = Number(m[1].replace(/\s+/g, ''));
      if (Number.isFinite(n) && n >= 2000 && n <= 30000) out.push(n);
    }
    return out;
  };

  const mortarBlock = text.match(
    /Растворы\s+строительные([\s\S]*?)Смеси\s+бетонные/i
  )?.[1];
  if (mortarBlock) {
    const head = mortarBlock.split(/Цена/i)[0] || mortarBlock;
    // Без «M 100 штукатурный» (латиница + слово штукатур)
    const grades = [...head.matchAll(/М\s*(\d{2,3})/gi)].map((x) => `М${x[1]}`);
    const prices = priceNums(mortarBlock);
    for (let i = 0; i < Math.min(grades.length, prices.length); i++) {
      rows.push({
        grade_key: grades[i],
        filler: 'mortar',
        price: prices[i],
        source_url,
      });
    }
  }

  const betonBlock = text.match(
    /Смеси\s+бетонные([\s\S]*?)(?:Блоки\s+бетонные|\* При заказе|$)/i
  )?.[1];
  if (betonBlock) {
    const head = betonBlock.split(/Цена/i)[0] || betonBlock;
    const grades = [...head.matchAll(/[МM]\s*(\d{2,3})/gi)].map((x) => `М${x[1]}`);
    const prices = priceNums(betonBlock);
    // first-wins: М150 В10 перед В12,5; М350 В25 перед В27,5
    const seen = new Set<string>();
    for (let i = 0; i < Math.min(grades.length, prices.length); i++) {
      const grade_key = grades[i];
      if (seen.has(grade_key)) continue;
      seen.add(grade_key);
      rows.push({
        grade_key,
        filler: 'granite',
        price: prices[i],
        source_url,
      });
    }
  }

  return dedupeRows(rows);
}

/**
 * БЗКПД / БСК Индустрия (Tilda): кнопки заказа
 * `#order:Бетон М 100 (В7,5) П3 гранит =6100`
 * `#order:Раствор М 100 =4993`
 */
function parseBsk(html: string, source_url: string): ParsedPriceRow[] {
  const rows: ParsedPriceRow[] = [];
  const re =
    /#order:\s*((?:Бетон|Раствор|Керамзитобетон)[^="'<>#]*?)\s*=\s*(\d{3,6})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const label = m[1].trim();
    if (/керамзит/i.test(label)) continue;
    const price = Number(m[2]);
    if (!Number.isFinite(price) || price < 1000) continue;

    const gradeMatch =
      label.match(/М\s*[-–]?\s*(\d{2,3})/i) ||
      label.match(/(?:Бетон|Раствор)\s+(\d{2,3})/i);
    if (!gradeMatch) continue;
    const grade_key = `М${gradeMatch[1]}`;

    let filler: CompetitorFiller | null = null;
    if (/раствор/i.test(label)) filler = 'mortar';
    else if (/гранит/i.test(label)) filler = 'granite';
    else if (/известняк|гравий|доломит/i.test(label)) filler = 'dolomite';
    if (!filler) continue;

    rows.push({ grade_key, filler, price, source_url });
  }
  // Первое вхождение важнее (у М350 есть В25 и В27,5 — берём В25)
  const map = new Map<string, ParsedPriceRow>();
  for (const r of rows) {
    const key = `${r.grade_key}|${r.filler}`;
    if (!map.has(key)) map.set(key, r);
  }
  return Array.from(map.values());
}

const BSK_PRICE_URLS = [
  'https://bsk-industry.ru/tovarnyi_beton',
  'https://bsk-industry.ru/tovarnyi_rastvor',
] as const;

/**
 * Стройсервис:
 * бетон — «В15 П2 Т.Б. гр. 6 548 руб.» / «изв.» / «изв.+гр.»
 * раствор — «М100 Т.Р. 4 464 руб.»
 */
function parseStrojservis(html: string, source_url: string): ParsedPriceRow[] {
  const text = stripHtml(html);
  const rows: ParsedPriceRow[] = [];

  const betonRe =
    /В\s*(\d+(?:[.,]\d+)?)\s*П\d\s*Т\.?\s*Б\.?\s*(гр\.?|изв\.?(?:\s*\+\s*гр\.?)?|гранит|известняк)\s*(\d[\d\s]{2,8})\s*руб/gi;
  let m: RegExpExecArray | null;
  while ((m = betonRe.exec(text))) {
    const grade = classToGrade(`В${m[1]}`);
    if (!grade) continue;
    const fillerRaw = m[2].toLowerCase();
    const price = parseMoney(m[3]);
    if (!price) continue;
    // изв.+гр. — смешанный: пишем в обе колонки, иначе пустеет М250 гранит
    if (/изв/.test(fillerRaw) && /гр/.test(fillerRaw)) {
      rows.push({ grade_key: grade, filler: 'dolomite', price, source_url });
      rows.push({ grade_key: grade, filler: 'granite', price, source_url });
      continue;
    }
    const filler: CompetitorFiller = /изв|известняк/.test(fillerRaw) ? 'dolomite' : 'granite';
    rows.push({ grade_key: grade, filler, price, source_url });
  }

  const mortarRe = /М\s*(\d{2,3})\s*Т\.?\s*Р\.?\s*(\d[\d\s]{2,8})\s*руб/gi;
  let mm: RegExpExecArray | null;
  while ((mm = mortarRe.exec(text))) {
    const price = parseMoney(mm[2]);
    if (price) {
      rows.push({ grade_key: `М${mm[1]}`, filler: 'mortar', price, source_url });
    }
  }
  return dedupeRows(rows);
}

const STROJSERVIS_PRICE_URLS = [
  'https://strojservis.ru/catalog/tovarnyy_beton_i_rastvor/tovarnyy_beton/?show=100',
  'https://strojservis.ru/catalog/tovarnyy_beton_i_rastvor/tovarnyy_rastvor/?show=100',
] as const;

function dedupeRows(rows: ParsedPriceRow[]): ParsedPriceRow[] {
  const map = new Map<string, ParsedPriceRow>();
  for (const r of rows) {
    if (!r.grade_key || !Number.isFinite(r.price)) continue;
    const key = `${r.grade_key}|${r.filler}`;
    map.set(key, r);
  }
  return Array.from(map.values());
}

type ParserFn = (html: string, url: string) => ParsedPriceRow[];

const PARSERS: Record<string, { url: string; parse: ParserFn }> = {};

for (const c of BRYANSK_COMPETITORS) {
  if (!c.parser_key || !c.price_url) continue;
  const parseFn: ParserFn | undefined =
    c.parser_key === 'bzkpd'
      ? parseBsk
      : c.parser_key === 'delobeton'
        ? parseDelobeton
        : c.parser_key === 'ecson'
          ? parseEcson
          : c.parser_key === 'megapolis'
            ? parseMegapolis
            : c.parser_key === 'masterbeton'
              ? parseMasterbeton
              : c.parser_key === 'specbeton'
                ? parseSpecbeton
                : c.parser_key === 'elitbeton'
                  ? parseElitbeton
                  : c.parser_key === 'strojservis'
                    ? parseStrojservis
                    : undefined;
  if (parseFn) {
    PARSERS[c.parser_key] = { url: c.price_url, parse: parseFn };
  }
}

async function runMultiUrlParser(
  parser_key: string,
  urls: readonly string[],
  parse: ParserFn,
  opts?: { firstWins?: boolean }
): Promise<ParseResult> {
  try {
    const all: ParsedPriceRow[] = [];
    const errors: string[] = [];
    for (const url of urls) {
      try {
        const html = await fetchText(url);
        all.push(...parse(html, url));
      } catch (e: unknown) {
        errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    let rows: ParsedPriceRow[];
    if (opts?.firstWins) {
      const map = new Map<string, ParsedPriceRow>();
      for (const r of all) {
        const key = `${r.grade_key}|${r.filler}`;
        if (!map.has(key)) map.set(key, r);
      }
      rows = Array.from(map.values());
    } else {
      rows = dedupeRows(all);
    }
    if (rows.length === 0) {
      return {
        parser_key,
        rows: [],
        error: errors.length ? errors.join('; ') : 'Цены не найдены на странице',
      };
    }
    return {
      parser_key,
      rows,
      error: errors.length ? errors.join('; ') : undefined,
    };
  } catch (e: unknown) {
    return {
      parser_key,
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runCompetitorParser(parser_key: string): Promise<ParseResult> {
  if (parser_key === 'bzkpd') {
    return runMultiUrlParser(parser_key, BSK_PRICE_URLS, parseBsk, { firstWins: true });
  }
  if (parser_key === 'strojservis') {
    return runMultiUrlParser(parser_key, STROJSERVIS_PRICE_URLS, parseStrojservis);
  }
  if (parser_key === 'elitbeton') {
    return runMultiUrlParser(parser_key, ELITBETON_PRICE_URLS, parseElitbeton, {
      firstWins: true,
    });
  }
  const cfg = PARSERS[parser_key];
  if (!cfg) {
    return { parser_key, rows: [], error: 'Парсер не реализован' };
  }
  try {
    const html = await fetchText(cfg.url);
    const rows = cfg.parse(html, cfg.url);
    if (rows.length === 0) {
      return { parser_key, rows: [], error: 'Цены не найдены на странице' };
    }
    return { parser_key, rows };
  } catch (e: unknown) {
    return {
      parser_key,
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runAllCompetitorParsers(
  keys?: string[]
): Promise<ParseResult[]> {
  const list = keys?.length
    ? keys
    : Object.keys(PARSERS);
  const out: ParseResult[] = [];
  for (const key of list) {
    out.push(await runCompetitorParser(key));
  }
  return out;
}

export function listImplementedParsers(): string[] {
  return Object.keys(PARSERS);
}

// re-export helpers for tests
export const __test = {
  normalizeGrade,
  classToGrade,
  parseMoney,
  detectFiller,
  parseBsk,
  parseDelobeton,
  parseEcson,
  parseMegapolis,
  parseMasterbeton,
  parseSpecbeton,
  parseElitbeton,
  parseStrojservis,
};
