import { extractGrades, extractVolume } from '@/lib/demand/extractFields';
import {
  extractEisLinkIds,
  extractContractReestrNumber,
  fetchFieldsFromEisContractReestrNumber,
} from '@/lib/tender/fetchEisContract';
import {
  extractPurchaseRegNumber,
  fetchFieldsFromEisRegNumber,
} from '@/lib/tender/fetchEisPurchase';
import { fetchGovHtml } from '@/lib/tender/fetchGovHtml';
import type { ParsedTenderFields } from '@/lib/tender/types';

export type { ParsedTenderFields } from '@/lib/tender/types';

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

function htmlToLines(html: string): string[] {
  let t = html;
  t = t.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '\n');
  t = decodeEntities(t);
  return t
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function valueAfterLabel(lines: string[], labels: string[]): string | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const line = norm(lines[i]);
    for (const label of labels) {
      const nl = norm(label);
      if (line === nl || line.startsWith(`${nl}:`) || line.startsWith(`${nl} `)) {
        const same = lines[i].replace(new RegExp(`^${label}\\s*:?\\s*`, 'i'), '').trim();
        if (same && norm(same) !== nl) return same;
        const next = lines[i + 1]?.trim();
        if (
          next &&
          !labels.some(
            (lb) => norm(next) === norm(lb) || norm(next).startsWith(`${norm(lb)}:`),
          )
        ) {
          return next;
        }
      }
    }
  }
  return null;
}

function parseNmck(text: string): string | null {
  const m = text.match(/(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[.,]\d{1,2})?)\s*руб/i);
  if (!m) return null;
  return m[1].replace(/\s|\u00a0/g, '').replace(',', '.');
}

function guessCityFromOrg(org: string | null | undefined): string | null {
  if (!org) return null;
  if (/брянск/i.test(org)) return 'Брянск';
  const m = org.match(/\bг\.?\s*([А-ЯЁA-Za-z][а-яёa-z-]+)/);
  return m ? m[1] : null;
}

function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('lot-online.ru')) return 'Lot-online (РАД)';
  if (u.includes('zakupki.gov.ru')) return 'ЕИС (zakupki.gov.ru)';
  if (u.includes('sberbank-ast') || u.includes('sberbankast')) return 'Сбербанк-АСТ';
  if (u.includes('rts-tender')) return 'РТС-тендер';
  if (u.includes('tektorg')) return 'ТЭК-Торг';
  if (u.includes('fabrikant')) return 'Фабрикант';
  if (u.includes('b2b-center')) return 'B2B-Center';
  return 'Другое';
}

function detectLaw(text: string): string | null {
  if (/223[\s-]*фз|закупки\s*223|notice223/i.test(text)) return '223-ФЗ';
  if (/44[\s-]*фз/i.test(text)) return '44-ФЗ';
  return null;
}

function toIsoDateRu(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function preferGrade(grades: string[]): string | null {
  const clean = grades.map((g) => g.trim()).filter(Boolean);
  return clean.find((g) => /^М\d/i.test(g)) || clean[0] || null;
}

/** HTML карточки контракта ЕИС (fallback). */
export function parseEisContractHtml(lines: string[], url: string): ParsedTenderFields {
  const blob = lines.join('\n');
  const reestr =
    extractContractReestrNumber(url) ||
    valueAfterLabel(lines, ['Реестровый номер контракта']) ||
    blob.match(/№\s*(\d{18,25})/)?.[1] ||
    null;
  const organization =
    valueAfterLabel(lines, ['Заказчик', 'Наименование заказчика']) || null;
  const title =
    valueAfterLabel(lines, ['Объекты закупки', 'Предмет контракта', 'Наименование объекта закупки']) ||
    lines.find((l) => /бетон|раствор|ремонт|поставк/i.test(l)) ||
    null;
  const priceRaw =
    valueAfterLabel(lines, ['Цена контракта', 'Цена']) || null;
  const nmck = priceRaw
    ? priceRaw.replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.')
    : parseNmck(blob);
  const address =
    valueAfterLabel(lines, ['Место поставки', 'Место выполнения работ', 'Адрес']) || null;
  const exeEnd =
    valueAfterLabel(lines, ['Срок исполнения', 'Дата окончания исполнения']) || null;
  const purchaseFromText =
    blob.match(/извещен[^\d]*(\d{11,20})/i)?.[1] ||
    blob.match(/notificationNumber["\s:=]+(\d{11,20})/i)?.[1] ||
    null;
  const law = detectLaw(`${url}\n${blob}`) || '44-ФЗ';
  const grades = extractGrades(`${title || ''} ${blob}`);
  const volume = extractVolume(blob);

  return {
    platform: 'ЕИС (zakupki.gov.ru)',
    purchase_number: purchaseFromText,
    law,
    nmck,
    organization_name: organization,
    inn: valueAfterLabel(lines, ['ИНН']),
    contact_name: valueAfterLabel(lines, ['Контактное лицо']),
    phone: valueAfterLabel(lines, ['Контактный телефон', 'Телефон']),
    grade: preferGrade(grades),
    volume_m3: volume,
    city: guessCityFromOrg(organization || address || ''),
    address,
    deadline: null,
    desired_date: toIsoDateRu(exeEnd),
    etp_url: url,
    docs_url: url,
    comment: [
      title ? `Контракт: ${title}` : null,
      reestr ? `Реестр контракта № ${reestr}` : null,
      purchaseFromText ? `Извещение № ${purchaseFromText}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    title,
  };
}

/** HTML карточки ЕИС (fallback, если ГосПлан недоступен). */
export function parseEisHtml(lines: string[], url: string): ParsedTenderFields {
  const blob = lines.join('\n');
  const purchase =
    valueAfterLabel(lines, ['Реестровый номер извещения', 'Реестровый номер']) ||
    extractPurchaseRegNumber(url).regNumber;
  const organization =
    valueAfterLabel(lines, ['Наименование организации']) ||
    valueAfterLabel(lines, ['Заказчик']);
  const inn = valueAfterLabel(lines, ['ИНН']);
  const title =
    valueAfterLabel(lines, ['Наименование закупки']) ||
    lines.find((l) => /бетон|раствор/i.test(l)) ||
    null;
  const contact_name = valueAfterLabel(lines, ['Контактное лицо']);
  const phoneRaw = valueAfterLabel(lines, ['Контактный телефон']);
  const address =
    valueAfterLabel(lines, ['Почтовый адрес', 'Место нахождения']) || null;
  const deadlineRaw =
    valueAfterLabel(lines, [
      'Дата и время окончания срока подачи заявок (по местному времени заказчика)',
      'Дата и время окончания срока подачи заявок',
      'Окончание подачи заявок',
    ]) || null;
  const etpName = valueAfterLabel(lines, [
    'Наименование электронной площадки в информационно-телекоммуникационной сети «Интернет»',
    'Наименование электронной площадки',
  ]);
  const etpLink = valueAfterLabel(lines, [
    'Адрес электронной площадки в информационно-телекоммуникационной сети «Интернет»',
    'Адрес электронной площадки',
  ]);
  const grades = extractGrades(`${title || ''} ${blob}`);
  const volume = extractVolume(blob);
  const nmck = parseNmck(blob);

  let platform = 'ЕИС (zakupki.gov.ru)';
  if (/лот-онлайн|аукционный дом|lot-online|рад/i.test(`${etpName || ''} ${etpLink || ''}`)) {
    platform = 'Lot-online (РАД)';
  }

  const law = detectLaw(`${url}\n${blob}`) || '223-ФЗ';
  const docsUrl =
    purchase != null
      ? /44/i.test(law)
        ? `https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=${purchase}`
        : `https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?regNumber=${purchase}`
      : url;

  return {
    platform,
    purchase_number: purchase,
    law,
    nmck,
    organization_name: organization,
    inn,
    contact_name,
    phone: phoneRaw,
    grade: preferGrade(grades),
    volume_m3: volume,
    city: guessCityFromOrg(organization || address || ''),
    address,
    deadline: toIsoDateRu(deadlineRaw),
    etp_url: docsUrl,
    docs_url: etpLink?.startsWith('http') ? etpLink : docsUrl,
    comment: [title ? `Закупка: ${title}` : null, purchase ? `№ ${purchase}` : null]
      .filter(Boolean)
      .join('\n'),
    title,
  };
}

/** Парсинг текста карточки (HTML уже в lines) — lot-online / общие ЭТП. */
export function parseTenderText(lines: string[], url: string): ParsedTenderFields {
  if (
    /\/epz\/contract\//i.test(url) ||
    /reestrNumber=/i.test(url) ||
    lines.some((l) => /Карточка контракта|Реестр контрактов/i.test(l))
  ) {
    return parseEisContractHtml(lines, url);
  }
  if (/zakupki\.gov\.ru/i.test(url) || lines.some((l) => /Реестровый номер извещения/i.test(l))) {
    return parseEisHtml(lines, url);
  }

  const blob = lines.join('\n');
  const organization = valueAfterLabel(lines, ['Заказчик', 'Организатор']) || null;
  const purchase =
    valueAfterLabel(lines, ['Реестровый номер', 'Номер извещения', 'Номер закупки']) ||
    valueAfterLabel(lines, ['Номер процедуры']) ||
    null;
  const title = valueAfterLabel(lines, ['Наименование закупки', 'Наименование']) || null;
  const lotSubject =
    lines.find(
      (l) =>
        /бетон|раствор|бст/i.test(l) && /(М\s*\d{2,3}|M\s*\d{2,3}|В\s*\d)/i.test(l),
    ) || title;
  const nmckLine = lines.find((l) => /руб/i.test(l) && /\d/.test(l)) || '';
  const nmck = parseNmck(nmckLine) || parseNmck(blob);
  const grades = extractGrades(`${title || ''} ${lotSubject || ''} ${blob}`);
  const volume = extractVolume(blob);
  const deadlineRaw =
    valueAfterLabel(lines, ['Окончание подачи заявок', 'Окончание приема заявок']) || null;
  const innMatch = blob.match(/ИНН\s*[:№]?\s*(\d{10}|\d{12})/i);
  const contact = valueAfterLabel(lines, ['Контакт', 'Контактное лицо', 'Ответственный']);

  const commentBits = [
    title ? `Закупка: ${title}` : null,
    lotSubject && lotSubject !== title ? `Лот: ${lotSubject}` : null,
    purchase ? `№ ${purchase}` : null,
  ].filter(Boolean);

  return {
    platform: detectPlatform(url),
    purchase_number: purchase?.replace(/\s*ЕИС\s*$/i, '').trim() || null,
    law: detectLaw(blob),
    nmck,
    organization_name: organization,
    inn: innMatch?.[1] || null,
    contact_name: contact,
    phone: null,
    grade: preferGrade(grades),
    volume_m3: volume,
    city: guessCityFromOrg(organization),
    address: null,
    deadline: deadlineRaw,
    etp_url: url,
    docs_url: null,
    comment: commentBits.length ? commentBits.join('\n') : null,
    title,
  };
}

async function fetchHtml(url: string): Promise<string> {
  // zakupki.gov.ru — через insecure TLS (гос. сертификаты); остальные — обычный fetch.
  if (/zakupki\.gov\.ru|\.gov\.ru/i.test(url)) {
    return fetchGovHtml(url);
  }
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Не удалось открыть страницу (${res.status})`);
  }
  const html = await res.text();
  if (!html || html.length < 200) {
    throw new Error('Пустой ответ площадки');
  }
  return html;
}

/**
 * Главный вход:
 * 1) карточка контракта ЕИС (reestrNumber) → ГосПлан /contracts + извещение;
 * 2) извещение (regNumber) → ГосПлан /purchases;
 * 3) HTML ЕИС (с обходом SSL) / ЭТП.
 */
export async function fetchAndParseTenderUrl(url: string): Promise<ParsedTenderFields> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Укажи корректную ссылку (https://…)');
  }

  const ids = extractEisLinkIds(trimmed);
  let regNumber = ids.purchaseNumber;
  let law = ids.law;
  let htmlFallback: ParsedTenderFields | undefined;

  // Карточка контракта: https://zakupki.gov.ru/epz/contract/…?reestrNumber=…
  if (ids.contractReestrNumber) {
    const fromContract = await fetchFieldsFromEisContractReestrNumber(
      ids.contractReestrNumber,
      { originalUrl: trimmed, preferredLaw: law },
    );
    if (fromContract) return fromContract;

    try {
      const html = await fetchHtml(trimmed);
      return parseEisContractHtml(htmlToLines(html), trimmed);
    } catch {
      /* continue to generic path */
    }
  }

  // Если вставили lot-online / нет номера — достанем реестровый номер со страницы.
  if (!regNumber || /lot-online\.ru/i.test(trimmed)) {
    try {
      const html = await fetchHtml(trimmed);
      const lines = htmlToLines(html);
      const fromPage =
        valueAfterLabel(lines, ['Реестровый номер', 'Реестровый номер извещения']) ||
        extractPurchaseRegNumber(lines.join('\n')).regNumber;
      if (fromPage) {
        regNumber = String(fromPage).replace(/\D/g, '') || fromPage;
        if (!law) law = 'fz223';
      }
      htmlFallback = parseTenderText(lines, trimmed);
    } catch {
      /* ignore */
    }
  }

  if (regNumber) {
    const eis = await fetchFieldsFromEisRegNumber(
      regNumber,
      law === 'fz44' ? 'fz44' : law === 'fz223' ? 'fz223' : null,
    );
    if (eis) {
      if (/lot-online\.ru/i.test(trimmed)) {
        eis.docs_url = trimmed;
      }
      return eis;
    }

    try {
      const noticePath =
        law === 'fz44'
          ? 'ea20/view/common-info.html'
          : 'notice223/common-info.html';
      const eisUrl = `https://zakupki.gov.ru/epz/order/notice/${noticePath}?regNumber=${encodeURIComponent(regNumber)}`;
      const html = await fetchHtml(eisUrl);
      return parseEisHtml(htmlToLines(html), eisUrl);
    } catch {
      /* Если закон неизвестен — пробуем альтернативный путь */
      if (law !== 'fz44') {
        try {
          const alt = `https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=${encodeURIComponent(regNumber)}`;
          const html = await fetchHtml(alt);
          return parseEisHtml(htmlToLines(html), alt);
        } catch {
          /* continue */
        }
      }
    }
  }

  if (htmlFallback) return htmlFallback;

  const html = await fetchHtml(trimmed);
  const parsed = parseTenderText(htmlToLines(html), trimmed);
  if (
    !parsed.organization_name &&
    !parsed.purchase_number &&
    !parsed.grade &&
    !parsed.nmck &&
    !parsed.title
  ) {
    throw new Error(
      'Не удалось разобрать карточку ЕИС. Проверь ссылку или заполни поля вручную.',
    );
  }
  return parsed;
}

/**
 * Достаёт поля из raw_payload спроса/лида + текста body
 * (то, что уже сохранено радаром / обработкой).
 */
export function extractFieldsFromStoredPayload(opts: {
  raw?: Record<string, unknown> | null;
  body?: string | null;
  title?: string | null;
  externalUrl?: string | null;
  volumeM3?: number | null;
  grades?: string[] | null;
  region?: string | null;
}): ParsedTenderFields {
  const raw = opts.raw && typeof opts.raw === 'object' ? opts.raw : {};
  const processing =
    raw.processing && typeof raw.processing === 'object'
      ? (raw.processing as Record<string, unknown>)
      : {};
  const body = String(opts.body || processing.comment || raw.body || '');
  const title = String(opts.title || raw.title || '');
  const text = `${title}\n${body}`;

  const customerFromBody = body.match(
    /Заказчик:\s*([^\n(]+?)(?:\s*\(ИНН\s*(\d+)\))?/i,
  );
  const nmckFromBody = body.match(/НМЦК\s+([\d\s.,]+)/i);
  const volFromBody = extractVolume(text) ?? opts.volumeM3 ?? null;
  const grades = opts.grades?.length ? opts.grades : extractGrades(text);

  const org =
    String(
      processing.organization_name || raw.customerName || raw.organization_name || '',
    ).trim() ||
    customerFromBody?.[1]?.trim() ||
    null;
  const inn =
    String(processing.inn || raw.customerInn || raw.inn || '').trim() ||
    customerFromBody?.[2] ||
    null;

  const etp =
    String(processing.etp_url || raw.etp_url || opts.externalUrl || '').trim() || null;
  const docs = String(processing.docs_url || raw.docs_url || '').trim() || null;
  const purchase =
    String(processing.purchase_number || raw.purchase_number || '').trim() ||
    (body.match(/№\s*([A-ZА-Я0-9/-]+)/i)?.[1] ?? null);

  let lawVal = String(processing.law || raw.law || '').trim() || null;
  if (!lawVal) lawVal = detectLaw(text);
  if (lawVal === 'fz44') lawVal = '44-ФЗ';
  if (lawVal === 'fz223') lawVal = '223-ФЗ';

  const nmck =
    processing.nmck != null && processing.nmck !== ''
      ? String(processing.nmck)
      : nmckFromBody
        ? nmckFromBody[1].replace(/\s/g, '').replace(',', '.')
        : raw.max_price != null
          ? String(raw.max_price)
          : null;

  return {
    platform:
      String(processing.platform || raw.platform || '').trim() ||
      (etp ? detectPlatform(etp) : null),
    purchase_number: purchase,
    law: lawVal,
    nmck,
    organization_name: org,
    inn,
    contact_name:
      String(processing.contact_name || '').trim() ||
      (body.match(/Контакт:\s*([^\n,]+)/i)?.[1]?.trim() ?? null),
    phone: String(processing.phone || '').trim() || null,
    grade: preferGrade([String(processing.grade || '').trim(), ...grades].filter(Boolean)),
    volume_m3:
      processing.volume_m3 != null && processing.volume_m3 !== ''
        ? Number(processing.volume_m3)
        : volFromBody,
    city:
      String(processing.city || opts.region || '').trim() ||
      guessCityFromOrg(org) ||
      null,
    address: String(processing.address || '').trim() || null,
    deadline: String(processing.deadline || '').trim() || null,
    etp_url: etp,
    docs_url: docs,
    comment: body || null,
    title: title || null,
  };
}
