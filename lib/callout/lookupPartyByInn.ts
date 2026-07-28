import { extractPhoneFromText } from '@/lib/callout/parseContacts';

/** Подтягивание названия организации по ИНН через DaData (уже есть в проекте). */

export type PartyLookup = {
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

function pickPhoneValue(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return extractPhoneFromText(raw) || raw.trim() || null;
  if (typeof raw === 'object') {
    const v = (raw as { value?: string; source?: string }).value
      || (raw as { source?: string }).source;
    if (v) return extractPhoneFromText(v) || String(v).trim() || null;
  }
  return null;
}

export async function lookupPartyByInn(inn: string | null | undefined): Promise<PartyLookup | null> {
  const digits = String(inn || '').replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 12) return null;

  const token = process.env.DADATA_API_KEY?.trim();
  if (!token) {
    console.warn('[callout] DADATA_API_KEY не задан — название по ИНН недоступно');
    return null;
  }

  try {
    const res = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({ query: digits, count: 1 }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn('[callout] DaData HTTP', res.status);
      return null;
    }
    const data = (await res.json()) as {
      suggestions?: Array<{
        value?: string;
        unrestricted_value?: string;
        data?: {
          name?: { short_with_opf?: string; full_with_opf?: string; short?: string };
          phones?: Array<{ value?: string } | string> | null;
          emails?: Array<{ value?: string } | string> | null;
          address?: { value?: string; unrestricted_value?: string; source?: string } | null;
        };
      }>;
    };
    const s = data.suggestions?.[0];
    if (!s) return null;

    const d = s.data;
    const organization_name =
      d?.name?.short_with_opf ||
      d?.name?.full_with_opf ||
      d?.name?.short ||
      s.value ||
      s.unrestricted_value ||
      null;

    let phone: string | null = null;
    if (Array.isArray(d?.phones)) {
      for (const p of d.phones) {
        phone = pickPhoneValue(p);
        if (phone) break;
      }
    }

    const emailRaw = d?.emails?.[0];
    const email =
      typeof emailRaw === 'string'
        ? emailRaw
        : emailRaw && typeof emailRaw === 'object'
          ? String((emailRaw as { value?: string }).value || '') || null
          : null;

    const address =
      d?.address?.unrestricted_value ||
      d?.address?.value ||
      d?.address?.source ||
      null;

    // DaData часто кладёт «тел/факс(4832) …» прямо в адрес, а phones[] пустой
    if (!phone && address) {
      phone = extractPhoneFromText(address);
    }
    if (!phone && s.unrestricted_value) {
      phone = extractPhoneFromText(s.unrestricted_value);
    }

    return {
      organization_name: organization_name ? String(organization_name).trim() : null,
      phone: phone ? String(phone).trim() : null,
      email: email ? String(email).trim() : null,
      address: address ? String(address).trim() : null,
    };
  } catch (e) {
    console.warn('[callout] DaData lookup failed', e);
    return null;
  }
}

export function isWeakOrgName(name: string | null | undefined, inn?: string | null): boolean {
  const s = String(name || '').trim();
  if (!s) return true;
  if (/^победитель\s+инн\b/i.test(s)) return true;
  if (inn && s === inn) return true;
  return false;
}
