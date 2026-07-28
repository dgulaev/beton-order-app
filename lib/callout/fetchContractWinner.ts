import https from 'node:https';
import { URL } from 'node:url';
import { getIntegrationSettings } from '@/lib/integrations/settings';
import { extractPurchaseNumberFromUrl, normalizeInn } from '@/lib/callout/parseContacts';

const DEFAULT_BASE = 'https://v2test.gosplan.info';
const FALLBACK_BASES = [
  'https://v2test.gosplan.info',
  'https://v2.gosplan.info',
] as const;

const INDEX_TIMEOUT_MS = 20_000;
const DETAIL_TIMEOUT_MS = 8_000;

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
  raw?: unknown;
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

/**
 * Деталка контракта (часто тормозит) — только best-effort для названия/телефона.
 */
export async function fetchContractDetailSupplier(
  regNum: string,
  law: 'fz44' | 'fz223',
): Promise<{
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
} | null> {
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

  let organization_name: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let address: string | null = null;

  const walk = (node: unknown, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const r = asRecord(node);
    if (!r) return;
    const fullName = r.fullName ?? r.organizationName ?? r.name ?? r.firmName;
    if (!organization_name && fullName && String(fullName).length > 3) {
      organization_name = String(fullName);
    }
    if (!phone && (r.phone || r.contactPhone)) {
      phone = String(r.phone || r.contactPhone);
    }
    if (!email && r.email) email = String(r.email);
    if (!address && (r.address || r.legalAddress || r.factualAddress)) {
      address = String(r.address || r.legalAddress || r.factualAddress);
    }
    for (const v of Object.values(r)) {
      if (typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(source || root);
  return { organization_name, phone, email, address };
}

/** Итог: победитель по номеру/URL закупки. */
export async function resolveWinnerFromEis(opts: {
  purchaseNumber?: string | null;
  purchaseUrl?: string | null;
  law?: 'fz44' | 'fz223' | null;
  /** Тянуть деталку (название/телефон). По умолчанию выкл. — индекс уже даёт ИНН. */
  enrichDetail?: boolean;
}): Promise<WinnerEnrichment | null> {
  const fromUrl = extractPurchaseNumberFromUrl(opts.purchaseUrl || '');
  const pn = String(opts.purchaseNumber || fromUrl || '').replace(/\D/g, '');
  if (pn.length < 11) return null;

  const hits = await searchContractsByPurchaseNumber(pn, opts.law);
  if (!hits.length) return null;

  const best = hits.find((h) => h.supplier_inns.length > 0) || hits[0];
  const inn = best.supplier_inns[0] || null;

  let organization_name: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let address: string | null = null;

  if (opts.enrichDetail === true && best.reg_num) {
    // Не блокируем карточку: деталка часто таймаутится
    try {
      const detail = await fetchContractDetailSupplier(best.reg_num, best.law);
      if (detail) {
        organization_name = detail.organization_name;
        phone = detail.phone;
        email = detail.email;
        address = detail.address;
      }
    } catch {
      /* ignore */
    }
  }

  return {
    inn,
    organization_name,
    phone,
    email,
    address,
    contract_reg_num: best.reg_num,
    contract_price: best.price,
    object_info: best.subject,
  };
}
