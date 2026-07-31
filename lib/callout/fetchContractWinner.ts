import https from 'node:https';
import { URL } from 'node:url';
import { getIntegrationSettings } from '@/lib/integrations/settings';
import {
  extractContractReestrFromUrl,
  extractPurchaseNumberFromUrl,
  normalizeInn,
} from '@/lib/callout/parseContacts';
import {
  fetchWinnerFromContractHtml,
  fetchWinnerFromNoticeResultsHtml,
} from '@/lib/callout/fetchEisWinnerHtml';
import { formatPhoneInput } from '@/lib/phone';

const DEFAULT_BASE = 'https://v2test.gosplan.info';
const FALLBACK_BASES = [
  'https://v2test.gosplan.info',
  'https://v2.gosplan.info',
] as const;

const INDEX_TIMEOUT_MS = 20_000;
const DETAIL_TIMEOUT_MS = 20_000;

export type GosplanContractHit = {
  reg_num: string | null;
  purchase_number: string | null;
  subject: string | null;
  price: number | null;
  supplier_inns: string[];
  published_at: string | null;
  law: 'fz44' | 'fz223';
};

export type WinnerEnrichment = {
  inn: string | null;
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contract_reg_num: string | null;
  contract_price: number | null;
  object_info: string | null;
  purchase_number?: string | null;
  law?: 'fz44' | 'fz223' | null;
  raw?: unknown;
};

export type ContractSupplierInfo = {
  inn: string | null;
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function gosplanBaseAndKey(): Promise<{ base: string; apiKey: string | null }> {
  let base = (process.env.GOSPLAN_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  let apiKey = process.env.GOSPLAN_API_KEY?.trim() || null;
  try {
    const settings = await getIntegrationSettings();
    base = (settings.gosplan.baseUrl || base).replace(/\/$/, '');
    apiKey = settings.gosplan.apiKey || apiKey;
  } catch {
    /* env only */
  }
  return { base, apiKey };
}

function headers(apiKey: string | null): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

/**
 * Node fetch (undici) рвёт connect к ГосПлану за 10с — у них часто дольше.
 * Берём https.request с нормальным таймаутом + retry по хостам.
 */
function httpsGetJson(
  urlStr: string,
  hdrs: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const url = new URL(urlStr);
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: hdrs,
        servername: url.hostname,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const body = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          if (body) {
            try {
              json = JSON.parse(body);
            } catch {
              json = null;
            }
          }
          const status = res.statusCode || 0;
          resolve({ ok: status >= 200 && status < 300, status, json });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      if (!settled) {
        settled = true;
        reject(new Error(`Gosplan timeout ${timeoutMs}ms`));
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    req.end();
  });
}

async function gosplanGetJson(
  pathWithQuery: string,
  apiKey: string | null,
  preferredBase: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json: unknown; base: string } | null> {
  const bases = [
    preferredBase.replace(/\/$/, ''),
    ...FALLBACK_BASES.map((b) => b.replace(/\/$/, '')),
  ].filter((b, i, arr) => arr.indexOf(b) === i);

  const hdrs = headers(apiKey);
  let lastErr: unknown = null;

  // Параллельно по хостам: ГосПлан часто таймаутит connect на одном, второй отвечает
  for (let attempt = 0; attempt < 3; attempt++) {
    const settled = await Promise.allSettled(
      bases.map(async (base) => {
        const res = await httpsGetJson(`${base}${pathWithQuery}`, hdrs, timeoutMs);
        return { ...res, base };
      }),
    );

    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value.ok) return item.value;
      if (item.status === 'rejected') {
        lastErr = item.reason;
      } else if (item.status === 'fulfilled') {
        lastErr = new Error(`HTTP ${item.value.status} @ ${item.value.base}`);
      }
    }

    for (const item of settled) {
      if (item.status === 'rejected') {
        console.warn(
          '[gosplan]',
          pathWithQuery.slice(0, 60),
          item.reason instanceof Error ? item.reason.message : item.reason,
        );
      }
    }

    await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
  }

  if (lastErr) {
    console.error('[gosplan] all hosts failed', pathWithQuery.slice(0, 80), lastErr);
  }
  return null;
}

function mapContractRow(row: Record<string, unknown>, law: 'fz44' | 'fz223'): GosplanContractHit {
  const suppliersRaw = row.suppliers;
  const inns: string[] = [];
  if (Array.isArray(suppliersRaw)) {
    for (const s of suppliersRaw) {
      const inn = normalizeInn(String(s));
      if (inn) inns.push(inn);
    }
  } else if (typeof suppliersRaw === 'string') {
    const inn = normalizeInn(suppliersRaw);
    if (inn) inns.push(inn);
  }
  return {
    reg_num: row.reg_num != null ? String(row.reg_num) : null,
    purchase_number: row.purchase_number != null ? String(row.purchase_number) : null,
    subject: row.subject != null ? String(row.subject) : null,
    price: row.price != null && Number.isFinite(Number(row.price)) ? Number(row.price) : null,
    supplier_inns: inns,
    published_at: row.published_at != null ? String(row.published_at) : null,
    law,
  };
}

function purchaseMatches(hitPn: string | null, pn: string): boolean {
  if (!hitPn) return false;
  return hitPn === pn || hitPn.startsWith(pn) || pn.startsWith(hitPn);
}

/** Индекс контрактов по номеру закупки (или префиксу). */
export async function searchContractsByPurchaseNumber(
  purchaseNumber: string,
  preferredLaw?: 'fz44' | 'fz223' | null,
): Promise<GosplanContractHit[]> {
  const pn = String(purchaseNumber || '').replace(/\D/g, '');
  if (pn.length < 11) return [];

  const { base, apiKey } = await gosplanBaseAndKey();
  const order: Array<'fz44' | 'fz223'> =
    preferredLaw === 'fz223' ? ['fz223', 'fz44'] : ['fz44', 'fz223'];

  // Сначала точный номер; укороченные — только если пусто (битые ссылки в Excel)
  const variants = [pn];
  if (pn.length > 18) variants.push(pn.slice(0, 19), pn.slice(0, 18));

  for (const law of order) {
    const path = law === 'fz44' ? '/fz44/contracts' : '/fz223/contracts';
    for (const v of variants) {
      const res = await gosplanGetJson(
        `${path}?purchase_number=${encodeURIComponent(v)}&limit=20`,
        apiKey,
        base,
        INDEX_TIMEOUT_MS,
      );
      if (!res) continue;
      const rows = Array.isArray(res.json) ? res.json : [];
      const hits: GosplanContractHit[] = [];
      for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const hit = mapContractRow(rec, law);
        if (purchaseMatches(hit.purchase_number, pn)) hits.push(hit);
        else if (!hit.purchase_number && hit.supplier_inns.length) hits.push(hit);
      }
      if (hits.length) return hits;
      // Точный номер дал 200 и [] — не долбим укороченные зря для этого law
      if (v === pn && rows.length === 0) break;
    }
  }

  return [];
}

function formatSupplierPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  let n = digits;
  if (n.length === 11 && n.startsWith('8')) n = `7${n.slice(1)}`;
  else if (n.length === 10) n = `7${n}`;
  else if (n.startsWith('7') && n.length > 11) n = n.slice(0, 11);
  if (n.length !== 11 || !n.startsWith('7')) return null;
  return formatPhoneInput(n);
}

/**
 * Блок ЕИС «Информация о поставщиках» (suppliersInfo).
 * ИП / юрлицо: название, ИНН, телефон, почта, адрес.
 */
export function parseSuppliersInfoFromSource(
  source: Record<string, unknown> | null,
): ContractSupplierInfo {
  const empty: ContractSupplierInfo = {
    inn: null,
    organization_name: null,
    phone: null,
    email: null,
    address: null,
  };
  if (!source) return empty;

  const suppliersInfo = asRecord(source.suppliersInfo);
  let supplierInfo = asRecord(suppliersInfo?.supplierInfo);
  if (!supplierInfo && Array.isArray(suppliersInfo?.supplierInfo)) {
    supplierInfo = asRecord(suppliersInfo.supplierInfo[0]);
  }
  if (!supplierInfo) supplierInfo = suppliersInfo;

  const pickOther = (node: Record<string, unknown> | null) => {
    const other = asRecord(node?.otherInfo) || {};
    const post = asRecord(other.postAddressInfo);
    return {
      phone: formatSupplierPhone(
        String(other.contactPhone || other.phone || ''),
      ),
      email:
        other.contactEMail || other.contactEmail || other.email
          ? String(other.contactEMail || other.contactEmail || other.email)
              .trim()
              .toLowerCase()
          : null,
      address:
        post?.mailingAdress || post?.mailingAddress || other.address
          ? String(post?.mailingAdress || post?.mailingAddress || other.address)
          : null,
      isIp: other.isIP === true || other.isIP === 'true',
    };
  };

  // ИП
  const ip =
    asRecord(supplierInfo?.individualPersonRFIndEntr) ||
    asRecord(supplierInfo?.individualPersonRF) ||
    asRecord(supplierInfo?.individualEntrepreneur);
  if (ip) {
    const egrip =
      asRecord(ip.EGRIPInfo) ||
      asRecord(ip.identityInfo) ||
      asRecord(ip.personInfo) ||
      ip;
    const other = pickOther(ip);
    const fio = [egrip.lastName, egrip.firstName, egrip.middleName]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const accounts = asRecord(supplierInfo?.supplierAccountsDetails);
    const acc = asRecord(accounts?.supplierAccountDetails);
    const fromAcc =
      acc?.counterparty160Name != null ? String(acc.counterparty160Name).trim() : null;
    // Приоритет: ФИО с пометкой ИП (как в ЕИС «Информация о поставщиках»)
    let organization_name: string | null = null;
    if (fio) {
      organization_name = /^ип\b/i.test(fio) ? fio : `ИП ${fio}`;
    } else if (fromAcc) {
      organization_name = fromAcc;
    }
    return {
      inn: normalizeInn(String(egrip.INN || egrip.inn || '')),
      organization_name,
      phone: other.phone,
      email: other.email,
      address:
        other.address ||
        (egrip.address != null ? String(egrip.address) : null),
    };
  }

  // Юрлицо РФ / иностранное
  const legal =
    asRecord(supplierInfo?.legalEntityRF) ||
    asRecord(supplierInfo?.legalEntityForeignState) ||
    asRecord(supplierInfo?.legalEntity);
  if (legal) {
    const main =
      asRecord(legal.EGRULInfo) ||
      asRecord(legal.legalEntityRFInfo) ||
      asRecord(legal.organizationInfo) ||
      legal;
    const other = pickOther(legal);
    const accounts = asRecord(supplierInfo?.supplierAccountsDetails);
    const acc = asRecord(accounts?.supplierAccountDetails);
    const organization_name =
      (main.fullName != null ? String(main.fullName) : null) ||
      (main.shortName != null ? String(main.shortName) : null) ||
      (main.organizationName != null ? String(main.organizationName) : null) ||
      (acc?.counterparty160Name != null ? String(acc.counterparty160Name) : null);
    return {
      inn: normalizeInn(String(main.INN || main.inn || '')),
      organization_name,
      phone: other.phone,
      email: other.email,
      address:
        other.address ||
        (main.address != null ? String(main.address) : null) ||
        (main.factualAddress != null ? String(main.factualAddress) : null),
    };
  }

  // Fallback: счёт контрагента + обход дерева только в suppliersInfo
  const accounts = asRecord(supplierInfo?.supplierAccountsDetails);
  const acc = asRecord(accounts?.supplierAccountDetails);
  let organization_name =
    acc?.counterparty160Name != null ? String(acc.counterparty160Name).trim() : null;
  let inn: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let address: string | null = null;

  const walk = (node: unknown, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const r = asRecord(node);
    if (!r) return;
    if (!inn && (r.INN || r.inn)) inn = normalizeInn(String(r.INN || r.inn));
    if (!phone && (r.contactPhone || r.phone)) {
      phone = formatSupplierPhone(String(r.contactPhone || r.phone));
    }
    if (!email && (r.contactEMail || r.contactEmail || r.email)) {
      email = String(r.contactEMail || r.contactEmail || r.email)
        .trim()
        .toLowerCase();
    }
    if (!address && (r.mailingAdress || r.mailingAddress || r.address)) {
      address = String(r.mailingAdress || r.mailingAddress || r.address);
    }
    if (!organization_name && (r.fullName || r.organizationName || r.firmName)) {
      organization_name = String(r.fullName || r.organizationName || r.firmName);
    }
    for (const v of Object.values(r)) {
      if (typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(supplierInfo || source.suppliersInfo);

  // Не брать заказчика из customer — только поставщик
  return { inn, organization_name, phone, email, address };
}

/**
 * Деталка контракта: поставщик из «Информация о поставщиках» + мета контракта.
 */
export async function fetchContractDetailSupplier(
  regNum: string,
  law: 'fz44' | 'fz223',
): Promise<(ContractSupplierInfo & {
  purchase_number: string | null;
  contract_price: number | null;
  object_info: string | null;
  contract_reg_num: string | null;
}) | null> {
  const { base, apiKey } = await gosplanBaseAndKey();
  const path = law === 'fz44' ? '/fz44/contracts' : '/fz223/contracts';
  const res = await gosplanGetJson(
    `${path}/${encodeURIComponent(regNum)}`,
    apiKey,
    base,
    DETAIL_TIMEOUT_MS,
  );
  if (!res?.ok) return null;
  const root = asRecord(res.json);
  if (!root) return null;
  const docs = Array.isArray(root.docs) ? root.docs : [];
  const source =
    asRecord(docs[0])?.source != null
      ? asRecord((docs[0] as Record<string, unknown>).source)
      : asRecord(root.source);

  const supplier = parseSuppliersInfoFromSource(source);
  // ИНН из индекса suppliers[], если в suppliersInfo нет
  if (!supplier.inn && Array.isArray(root.suppliers) && root.suppliers[0]) {
    supplier.inn = normalizeInn(String(root.suppliers[0]));
  }

  return {
    ...supplier,
    purchase_number:
      root.purchase_number != null ? String(root.purchase_number) : null,
    contract_price:
      root.price != null && Number.isFinite(Number(root.price))
        ? Number(root.price)
        : null,
    object_info: root.subject != null ? String(root.subject) : null,
    contract_reg_num: root.reg_num != null ? String(root.reg_num) : regNum,
  };
}

function mergeWinner(
  primary: WinnerEnrichment | null,
  secondary: WinnerEnrichment | null,
): WinnerEnrichment | null {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;
  return {
    inn: primary.inn || secondary.inn,
    organization_name: primary.organization_name || secondary.organization_name,
    phone: primary.phone || secondary.phone,
    email: primary.email || secondary.email,
    address: primary.address || secondary.address,
    contract_reg_num: primary.contract_reg_num || secondary.contract_reg_num,
    contract_price: primary.contract_price ?? secondary.contract_price,
    object_info: primary.object_info || secondary.object_info,
    purchase_number: primary.purchase_number || secondary.purchase_number,
    law: primary.law || secondary.law,
    raw: primary.raw ?? secondary.raw,
  };
}

function winnerHasContacts(w: WinnerEnrichment | null): boolean {
  if (!w) return false;
  return Boolean(String(w.phone || '').trim() || String(w.email || '').trim());
}

/** Победитель по реестровому номеру контракта (карточка epz/contract). */
export async function resolveWinnerFromContractReestr(
  reestrNumber: string,
  preferredLaw?: 'fz44' | 'fz223' | null,
): Promise<WinnerEnrichment | null> {
  const reg = String(reestrNumber || '').replace(/\D/g, '');
  if (reg.length < 11) return null;

  // 1) Публичная HTML-карточка ЕИС — полный блок «Информация о поставщиках»
  let fromHtml: WinnerEnrichment | null = null;
  try {
    fromHtml = await fetchWinnerFromContractHtml(reg);
  } catch {
    /* Gosplan ниже */
  }
  if (fromHtml && winnerHasContacts(fromHtml)) {
    return fromHtml;
  }

  // 2) ГосПлан API (suppliersInfo) — дополняет / запасной путь
  const order: Array<'fz44' | 'fz223'> =
    preferredLaw === 'fz223' ? ['fz223', 'fz44'] : ['fz44', 'fz223'];

  let fromApi: WinnerEnrichment | null = null;
  for (const law of order) {
    try {
      const detail = await fetchContractDetailSupplier(reg, law);
      if (!detail) continue;
      if (!detail.inn && !detail.organization_name && !detail.purchase_number) {
        continue;
      }
      fromApi = {
        inn: detail.inn,
        organization_name: detail.organization_name,
        phone: detail.phone,
        email: detail.email,
        address: detail.address,
        contract_reg_num: detail.contract_reg_num,
        contract_price: detail.contract_price,
        object_info: detail.object_info,
        purchase_number: detail.purchase_number,
        law,
      };
      break;
    } catch {
      /* next law */
    }
  }

  return mergeWinner(fromHtml, fromApi);
}

/** Итог: победитель по номеру/URL закупки или контракта. */
export async function resolveWinnerFromEis(opts: {
  purchaseNumber?: string | null;
  purchaseUrl?: string | null;
  contractReestrNumber?: string | null;
  law?: 'fz44' | 'fz223' | null;
  /** Тянуть деталку с контактами поставщика. По умолчанию true. */
  enrichDetail?: boolean;
}): Promise<WinnerEnrichment | null> {
  const reestr =
    String(opts.contractReestrNumber || '').replace(/\D/g, '') ||
    extractContractReestrFromUrl(opts.purchaseUrl) ||
    null;

  if (reestr) {
    const fromContract = await resolveWinnerFromContractReestr(reestr, opts.law);
    if (fromContract) return fromContract;
  }

  const fromUrl = extractPurchaseNumberFromUrl(opts.purchaseUrl || '');
  const pn = String(opts.purchaseNumber || fromUrl || '').replace(/\D/g, '');
  if (pn.length < 11) return null;

  const enrich = opts.enrichDetail !== false;

  // HTML-путь: результаты определения поставщика → реестр контракта → контакты
  let fromHtmlPath: WinnerEnrichment | null = null;
  if (enrich) {
    try {
      fromHtmlPath = await fetchWinnerFromNoticeResultsHtml(pn, opts.law);
    } catch {
      /* Gosplan ниже */
    }
    if (fromHtmlPath && winnerHasContacts(fromHtmlPath)) {
      return fromHtmlPath;
    }
  }

  const hits = await searchContractsByPurchaseNumber(pn, opts.law);
  if (!hits.length) return fromHtmlPath;

  const best = hits.find((h) => h.supplier_inns.length > 0) || hits[0];
  const inn = best.supplier_inns[0] || null;

  let organization_name: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let address: string | null = null;

  if (enrich && best.reg_num) {
    try {
      // Сначала HTML карточки контракта (телефон/почта), потом API
      const htmlDetail = await fetchWinnerFromContractHtml(best.reg_num);
      if (htmlDetail) {
        organization_name = htmlDetail.organization_name;
        phone = htmlDetail.phone;
        email = htmlDetail.email;
        address = htmlDetail.address;
      }
    } catch {
      /* ignore */
    }
    if (!phone && !email) {
      try {
        const detail = await fetchContractDetailSupplier(best.reg_num, best.law);
        if (detail) {
          organization_name = organization_name || detail.organization_name;
          phone = phone || detail.phone;
          email = email || detail.email;
          address = address || detail.address;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const fromApi: WinnerEnrichment = {
    inn: inn || fromHtmlPath?.inn || null,
    organization_name: organization_name || fromHtmlPath?.organization_name || null,
    phone: phone || fromHtmlPath?.phone || null,
    email: email || fromHtmlPath?.email || null,
    address: address || fromHtmlPath?.address || null,
    contract_reg_num: best.reg_num || fromHtmlPath?.contract_reg_num || null,
    contract_price: best.price ?? fromHtmlPath?.contract_price ?? null,
    object_info: best.subject || fromHtmlPath?.object_info || null,
    purchase_number: best.purchase_number || pn,
    law: best.law,
  };

  return mergeWinner(fromHtmlPath, fromApi) || fromApi;
}
