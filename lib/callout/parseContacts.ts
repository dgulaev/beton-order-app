/** Парсинг свободного текста контактов победителя (как в Excel / ЕИС). */

export function normalizeInn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 12) return digits;
  return null;
}

export function extractInnFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m =
    String(text).match(/ИНН\s*[\/:]?\s*КПП\s*[\/:]?\s*(\d{10}|\d{12})/i) ||
    String(text).match(/ИНН\s*[\/:]?\s*(\d{10}|\d{12})/i) ||
    String(text).match(/\b(\d{12}|\d{10})\b/);
  return m ? normalizeInn(m[1]) : null;
}

export function extractEmailFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

export function extractPhoneFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = String(text);

  const toPlus7 = (raw: string): string | null => {
    let n = raw.replace(/\D/g, '');
    if (n.length === 11 && n.startsWith('8')) n = `7${n.slice(1)}`;
    if (n.length === 10) n = `7${n}`;
    if (n.length !== 11 || !n.startsWith('7')) return null;
    return `+${n}`;
  };

  // Мобильный / федеральный: +7 9xx … / 8 9xx …
  const mobile = s.match(
    /(?:\+7|8|7)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/,
  );
  if (mobile) {
    // Отсекаем ложные срабатывания на «8 (4832) …» — код города не 3 цифры как у мобильного
    const dig = mobile[0].replace(/\D/g, '');
    if (!(dig.length >= 5 && dig[1] === '4' && /8\s*\(\s*4/.test(mobile[0]))) {
      const ok = toPlus7(mobile[0]);
      if (ok) return ok;
    }
  }

  // Городской: «Тел./факс. : 8 (4832 ) 32-13-03», «тел/факс(4832) 58-77-87», «8 (48336) 5-41-85»
  const cityPatterns = [
    /(?:тел\.?\s*\/\s*факс|тел\.?(?:ефон)?|т\/ф|факс)[\s.:]*[78]?\s*\(\s*(\d{3,5})\s*\)\s*(\d{1,3})[\s.\-]*(\d{2})[\s.\-]*(\d{2})/i,
    /(?:тел\.?\s*\/\s*факс|тел\.?(?:ефон)?|т\/ф|факс)[\s.:]*\(?\s*(\d{3,5})\s*\)?[\s.\-]*(\d{1,3})[\s.\-]*(\d{2})[\s.\-]*(\d{2})/i,
    /[78]\s*\(\s*(\d{3,5})\s*\)\s*(\d{1,3})[\s.\-]*(\d{2})[\s.\-]*(\d{2})/,
    /\(\s*(\d{3,5})\s*\)\s*(\d{2,3})[\s.\-]*(\d{2})[\s.\-]*(\d{2})/,
  ];
  for (const re of cityPatterns) {
    const m = s.match(re);
    if (!m) continue;
    const ok = toPlus7(`${m[1]}${m[2]}${m[3]}${m[4]}`);
    if (ok) return ok;
  }

  return null;
}

export function extractAddressFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = String(text).trim();
  if (!s || /^нет\s+сведений$/i.test(s)) return null;
  const withoutContacts = s
    .replace(/ИНН[\s\S]*$/i, '')
    .replace(/[Tt]ел\.?[\s\S]*$/i, '')
    .replace(/E-?mail[\s\S]*$/i, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .trim();
  return withoutContacts.slice(0, 500) || s.slice(0, 500);
}

export function parseContactsBlob(raw: string | null | undefined): {
  inn: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
} {
  const text = String(raw || '').trim();
  if (!text || /^нет\s+сведений$/i.test(text)) {
    return { inn: null, phone: null, email: null, address: null };
  }
  return {
    inn: extractInnFromText(text),
    phone: extractPhoneFromText(text),
    email: extractEmailFromText(text),
    address: extractAddressFromText(text),
  };
}

export function isEmptyWinnerName(name: string | null | undefined): boolean {
  const s = String(name || '').trim();
  if (!s) return true;
  return /^(нет\s+сведений|ни одной заявки|все поданные заявки отклонены)/i.test(s);
}

/** Достаёт regNumber извещения из URL ЕИС (не путать с reestrNumber контракта). */
export function extractPurchaseNumberFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = String(url);
  // Карточка контракта — номер извещения только из явного regNumber=
  if (/reestrNumber=/i.test(s) || /\/epz\/contract\//i.test(s)) {
    return s.match(/regNumber=(\d{11,25})/i)?.[1] || null;
  }
  const m =
    s.match(/regNumber=(\d{11,25})/i)?.[1] ||
    s.match(/purchaseNoticeNumber=(\d{11,25})/i)?.[1] ||
    s.match(/noticeInfoId=(\d+)/i)?.[1] ||
    s.match(/\b(0?\d{18,20})\b/)?.[1] ||
    null;
  return m || null;
}

/** Реестровый номер контракта из URL карточки ЕИС. */
export function extractContractReestrFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = String(url);
  const fromQuery = s.match(/reestrNumber=(\d{11,25})/i)?.[1];
  if (fromQuery) return fromQuery;
  if (/\/epz\/contract\//i.test(s) || /contractCard/i.test(s)) {
    return s.match(/\b(\d{18,25})\b/)?.[1] || null;
  }
  return null;
}

export function detectLawFromUrl(url: string | null | undefined): 'fz44' | 'fz223' | null {
  if (!url) return null;
  const s = String(url);
  if (/notice223|\/223\//i.test(s)) return 'fz223';
  if (/\/epz\/contract\//i.test(s) || /reestrNumber=/i.test(s)) return 'fz44';
  if (/ea20|epz\/order\/notice/i.test(s)) return 'fz44';
  return null;
}
