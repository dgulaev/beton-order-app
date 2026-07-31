/**
 * Победитель из публичных HTML-карточек ЕИС (zakupki.gov.ru):
 * 1) извещение → вкладка «Результаты определения поставщика»
 * 2) ссылка на контракт (reestrNumber)
 * 3) карточка контракта → блок «Информация о поставщиках»
 */
import { formatPhoneInput } from '@/lib/phone';
import { normalizeInn } from '@/lib/callout/parseContacts';
import { fetchGovHtml } from '@/lib/tender/fetchGovHtml';
import type { WinnerEnrichment } from '@/lib/callout/fetchContractWinner';

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Телефон из ячейки «Телефон, электронная почта».
 * Не берём подряд цифры из адреса (индекс 241007 + дом → ложный номер).
 */
function formatSupplierPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw);

  // Явные шаблоны: «7 9605601616», «+7 (960) 560-16-16», «8-960-...»
  const patterns = [
    /(?:\+?\s*7|8)\s*[\s(-]*(\d{3})[\s)-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})/,
    /(?:\+?\s*7|8)\s*(\d{10})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const digits =
      m.length >= 5
        ? `7${m[1]}${m[2]}${m[3]}${m[4]}`
        : m[1].length === 10
          ? `7${m[1]}`
          : null;
    if (!digits || digits.length !== 11 || !digits.startsWith('7')) continue;
    return formatPhoneInput(digits);
  }
  return null;
}

function extractEmail(text: string): string | null {
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

/** Типы извещений 44-ФЗ на zakupki (как в gosplanCollector). */
const FZ44_NOTICE_PATHS = [
  'ea20',
  'zk20',
  'ok20',
  'ezt20',
  'okou20',
  'okd20',
  'ea44',
  'zk44',
  'ok44',
] as const;

/** Кандидаты URL вкладки «Результаты определения поставщика». */
export function eisSupplierResultsUrls(
  purchaseNumber: string,
  law?: 'fz44' | 'fz223' | null,
): string[] {
  const pn = String(purchaseNumber || '').replace(/\D/g, '');
  if (!pn) return [];
  if (law === 'fz223') {
    return [
      `https://zakupki.gov.ru/epz/order/notice/notice223/supplier-results.html?regNumber=${encodeURIComponent(pn)}`,
      `https://zakupki.gov.ru/223/purchase/public/purchase/info/supplier-results.html?regNumber=${encodeURIComponent(pn)}`,
      `https://zakupki.gov.ru/223/purchase/public/purchase/info/common-info.html?regNumber=${encodeURIComponent(pn)}`,
    ];
  }
  return FZ44_NOTICE_PATHS.map(
    (path) =>
      `https://zakupki.gov.ru/epz/order/notice/${path}/view/supplier-results.html?regNumber=${encodeURIComponent(pn)}`,
  );
}

/** @deprecated используй eisSupplierResultsUrls */
export function eisSupplierResultsUrl(
  purchaseNumber: string,
  law?: 'fz44' | 'fz223' | null,
): string {
  return eisSupplierResultsUrls(purchaseNumber, law)[0] || '';
}

export function eisContractCardUrl(reestrNumber: string): string {
  const reg = String(reestrNumber || '').replace(/\D/g, '');
  return `https://zakupki.gov.ru/epz/contract/contractCard/common-info.html?reestrNumber=${encodeURIComponent(reg)}`;
}

export function eisContractParticipantsUrl(reestrNumber: string): string {
  const reg = String(reestrNumber || '').replace(/\D/g, '');
  return `https://zakupki.gov.ru/epz/contract/contractCard/participants.html?reestrNumber=${encodeURIComponent(reg)}`;
}

/**
 * Из HTML «Результатов определения поставщика» достаём реестровый номер контракта.
 * Ищем блок «Сведения о контракте из реестра контрактов» / ссылки reestrNumber=.
 */
export function extractContractReestrFromResultsHtml(html: string): string | null {
  if (!html) return null;

  // Приоритет: ссылка в секции сведений о контракте
  const sectionMatch = html.match(
    /Сведения о контракте из реестра контрактов[\s\S]{0,8000}?reestrNumber=(\d{15,25})/i,
  );
  if (sectionMatch?.[1]) return sectionMatch[1];

  const all = [...html.matchAll(/reestrNumber=(\d{15,25})/gi)].map((m) => m[1]);
  const uniq = [...new Set(all)];
  // Реестровый номер контракта 44-ФЗ обычно 19 цифр
  const preferred = uniq.find((n) => n.length >= 18 && n.length <= 25) || uniq[0];
  return preferred || null;
}

/**
 * Парсит таблицу «Информация о поставщиках» (common-info или participants.html).
 */
export function parseSuppliersTableFromContractHtml(html: string): {
  inn: string | null;
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
} | null {
  if (!html || !/Информация о поставщиках|participantsInnerHtml|tableBlock__col_first/i.test(html)) {
    return null;
  }

  // Первая строка tbody таблицы поставщиков
  const rowMatch =
    html.match(
      /<tbody[^>]*class="[^"]*tableBlock__body[^"]*"[^>]*>\s*<tr[^>]*>([\s\S]*?)<\/tr>/i,
    ) ||
    html.match(
      /Информация о поставщиках[\s\S]*?<tbody[^>]*>\s*<tr[^>]*>([\s\S]*?)<\/tr>/i,
    );
  const rowHtml = rowMatch?.[1] || html;

  const orgTd =
    rowHtml.match(
      /<td[^>]*tableBlock__col_first[^>]*>([\s\S]*?)<\/td>/i,
    )?.[1] || '';

  let organization_name: string | null = null;
  let inn: string | null = null;

  if (orgTd) {
    const orgDecoded = decodeEntities(orgTd);
    const isIp = /Индивидуальный\s*предприниматель/i.test(orgDecoded);
    const beforeInn = orgDecoded.split(/ИНН\s*:/i)[0] || orgDecoded;
    const nameRaw = stripTags(
      beforeInn.replace(/Индивидуальный\s*предприниматель/gi, ' '),
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (nameRaw) {
      organization_name =
        isIp && !/^ип\b/i.test(nameRaw) ? `ИП ${nameRaw}` : nameRaw;
    }
    // 12-значный ИНН ИП раньше 10-значного юрлица — иначе \d{10} обрежет ИП
    const innM =
      orgDecoded.match(/ИНН[\s\S]{0,120}?(\d{12}|\d{10})/i) ||
      stripTags(orgDecoded).match(/\b(\d{12}|\d{10})\b/);
    if (innM?.[1]) inn = normalizeInn(innM[1]);
  }

  const tds = [...rowHtml.matchAll(/<td[^>]*class="tableBlock__col[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)].map(
    (m) => stripTags(m[1]),
  );

  // Колонки: Организация | Страна | Адрес места нахождения | Почтовый адрес | Телефон, email | Статус
  let address: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;

  // Сначала ячейка с email — там же телефон в ЕИС
  for (const td of tds) {
    const em = extractEmail(td);
    if (em) {
      email = em;
      phone = formatSupplierPhone(td);
      break;
    }
  }

  for (const td of tds) {
    if (!address && /\d{6}/.test(td) && /(область|край|г\.|ул\.|город)/i.test(td)) {
      address = td;
    }
    if (!phone) {
      // Не вытаскивать «телефон» из адресной строки
      if (/(область|край|ул\.|город|д\.)/i.test(td) && !/@/.test(td)) continue;
      const ph = formatSupplierPhone(td);
      if (ph) phone = ph;
    }
    if (!email) {
      const em = extractEmail(td);
      if (em) email = em;
    }
  }

  if (!email) email = extractEmail(stripTags(rowHtml));
  if (!phone && email) {
    // В той же ячейке, что и email (по полному HTML строки)
    const contactTd = tds.find((td) => td.includes(email!));
    if (contactTd) phone = formatSupplierPhone(contactTd);
  }
  if (!inn) {
    const innM = stripTags(orgTd || rowHtml).match(/\b(\d{12}|\d{10})\b/);
    if (innM) inn = normalizeInn(innM[1]);
  }

  if (!organization_name && !inn && !phone && !email) return null;

  return { inn, organization_name, phone, email, address };
}

/** Цена контракта с карточки (если есть). */
function parseContractPriceFromHtml(html: string): number | null {
  const m =
    html.match(/Цена\s*контракта[\s\S]{0,200}?([\d\s\u00a0]+[.,]\d{2})\s*₽/i) ||
    html.match(/([\d\s\u00a0]+[.,]\d{2})\s*₽/);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseObjectInfoFromHtml(html: string): string | null {
  const m = html.match(
    /Предмет\s*контракта[\s\S]{0,80}?<[^>]+>([\s\S]{3,400}?)<\//i,
  );
  if (!m?.[1]) return null;
  const t = stripTags(m[1]);
  return t.length > 3 ? t.slice(0, 500) : null;
}

function parsePurchaseNumberFromContractHtml(html: string): string | null {
  const m =
    html.match(/Номер\s*закупки[\s\S]{0,120}?(\d{11,25})/i) ||
    html.match(/regNumber=(\d{11,25})/i);
  return m?.[1] ? m[1].replace(/\D/g, '') : null;
}

/** Карточка контракта → поставщик из HTML ЕИС. */
export async function fetchWinnerFromContractHtml(
  reestrNumber: string,
): Promise<WinnerEnrichment | null> {
  const reg = String(reestrNumber || '').replace(/\D/g, '');
  if (reg.length < 11) return null;

  // participants.html — компактная таблица поставщиков; common-info — полный бэкап
  let parsed: ReturnType<typeof parseSuppliersTableFromContractHtml> = null;
  let fullHtml = '';

  try {
    const partHtml = await fetchGovHtml(eisContractParticipantsUrl(reg), {
      timeoutMs: 25_000,
    });
    parsed = parseSuppliersTableFromContractHtml(partHtml);
    fullHtml = partHtml;
  } catch {
    /* common-info ниже */
  }

  if (!parsed?.organization_name && !parsed?.inn && !parsed?.phone) {
    try {
      fullHtml = await fetchGovHtml(eisContractCardUrl(reg), { timeoutMs: 30_000 });
      parsed = parseSuppliersTableFromContractHtml(fullHtml);
    } catch {
      return null;
    }
  } else if (!fullHtml || fullHtml.length < 5000) {
    // Для цены/предмета — common-info, если participants короткий
    try {
      fullHtml = await fetchGovHtml(eisContractCardUrl(reg), { timeoutMs: 30_000 });
      if (!parsed) parsed = parseSuppliersTableFromContractHtml(fullHtml);
      else {
        // доп. поля адреса, если в participants обрезано
        const again = parseSuppliersTableFromContractHtml(fullHtml);
        if (again) {
          parsed = {
            inn: parsed.inn || again.inn,
            organization_name: parsed.organization_name || again.organization_name,
            phone: parsed.phone || again.phone,
            email: parsed.email || again.email,
            address: parsed.address || again.address,
          };
        }
      }
    } catch {
      /* уже есть parsed */
    }
  }

  if (!parsed) return null;
  if (!parsed.inn && !parsed.organization_name && !parsed.phone) return null;

  const lawFromHtml: 'fz44' | 'fz223' = /223[\s-]*фз|закон\s*№?\s*223/i.test(fullHtml)
    ? 'fz223'
    : 'fz44';

  return {
    inn: parsed.inn,
    organization_name: parsed.organization_name,
    phone: parsed.phone,
    email: parsed.email,
    address: parsed.address,
    contract_reg_num: reg,
    contract_price: parseContractPriceFromHtml(fullHtml),
    object_info: parseObjectInfoFromHtml(fullHtml),
    purchase_number: parsePurchaseNumberFromContractHtml(fullHtml),
    law: lawFromHtml,
  };
}

/**
 * Извещение → результаты → reestrNumber → карточка контракта.
 */
export async function fetchWinnerFromNoticeResultsHtml(
  purchaseNumber: string,
  law?: 'fz44' | 'fz223' | null,
): Promise<WinnerEnrichment | null> {
  const pn = String(purchaseNumber || '').replace(/\D/g, '');
  if (pn.length < 11) return null;

  const order: Array<'fz44' | 'fz223'> =
    law === 'fz223' ? ['fz223', 'fz44'] : ['fz44', 'fz223'];

  for (const L of order) {
    const urls = eisSupplierResultsUrls(pn, L);
    for (const url of urls) {
      try {
        const html = await fetchGovHtml(url, { timeoutMs: 22_000 });
        const reestr = extractContractReestrFromResultsHtml(html);
        if (!reestr) continue;
        const winner = await fetchWinnerFromContractHtml(reestr);
        if (winner) {
          return {
            ...winner,
            purchase_number: winner.purchase_number || pn,
            law: winner.law || L,
          };
        }
      } catch {
        /* next url */
      }
    }
  }
  return null;
}
