import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone, phonesMatch, toStoredPhone } from '@/lib/phone';

export type ClientUserRow = {
  user_id: number;
  phone: string | null;
  organization_name: string | null;
  full_name: string | null;
  role: string | null;
  inn?: string | null;
};

/**
 * Ищет клиента (role=client) по телефону без опасного широкого ilike.
 * Сначала точные варианты записи, затем узкий хвост + phonesMatch в памяти.
 */
export async function findClientByPhone(
  supabase: SupabaseClient,
  phoneRaw: string | null | undefined,
): Promise<ClientUserRow | null> {
  const stored = toStoredPhone(phoneRaw);
  const norm = normalizePhone(phoneRaw);
  if (!stored || norm.length < 11) return null;

  const variants = Array.from(new Set([
    stored,
    norm,
    `+${norm}`,
    `8${norm.slice(1)}`,
    `+8${norm.slice(1)}`,
  ]));

  const { data: exactRows, error: exactError } = await supabase
    .from('users')
    .select('user_id, phone, organization_name, full_name, role, inn')
    .eq('role', 'client')
    .in('phone', variants)
    .limit(10);

  if (exactError) {
    console.error('findClientByPhone exact:', exactError);
  }

  const exactHit = (exactRows || []).find((u) => phonesMatch(u.phone, phoneRaw));
  if (exactHit) return exactHit as ClientUserRow;

  // Хвост 10 цифр — узкий фильтр; финальная сверка только через phonesMatch
  const tail = norm.slice(-10);
  const { data: fuzzyRows, error: fuzzyError } = await supabase
    .from('users')
    .select('user_id, phone, organization_name, full_name, role, inn')
    .eq('role', 'client')
    .ilike('phone', `%${tail}`)
    .limit(30);

  if (fuzzyError) {
    console.error('findClientByPhone fuzzy:', fuzzyError);
  }

  const fuzzyHit = (fuzzyRows || []).find((u) => phonesMatch(u.phone, phoneRaw));
  return (fuzzyHit as ClientUserRow) || null;
}

/** Любая запись users с этим телефоном (для register: не отдавать staff как клиента). */
export async function findAnyUserByPhone(
  supabase: SupabaseClient,
  phoneRaw: string | null | undefined,
): Promise<ClientUserRow | null> {
  const stored = toStoredPhone(phoneRaw);
  const norm = normalizePhone(phoneRaw);
  if (!stored || norm.length < 11) return null;

  const variants = Array.from(new Set([
    stored,
    norm,
    `+${norm}`,
    `8${norm.slice(1)}`,
    `+8${norm.slice(1)}`,
  ]));

  const { data: rows } = await supabase
    .from('users')
    .select('user_id, phone, organization_name, full_name, role, inn')
    .in('phone', variants)
    .limit(20);

  const hit = (rows || []).find((u) => phonesMatch(u.phone, phoneRaw));
  if (hit) return hit as ClientUserRow;

  const tail = norm.slice(-10);
  const { data: fuzzyRows } = await supabase
    .from('users')
    .select('user_id, phone, organization_name, full_name, role, inn')
    .ilike('phone', `%${tail}`)
    .limit(30);

  return ((fuzzyRows || []).find((u) => phonesMatch(u.phone, phoneRaw)) as ClientUserRow) || null;
}

export async function findClientByInn(
  supabase: SupabaseClient,
  inn: string | null | undefined,
): Promise<ClientUserRow | null> {
  const value = String(inn || '').trim();
  if (!value) return null;

  const { data, error } = await supabase
    .from('users')
    .select('user_id, phone, organization_name, full_name, role, inn')
    .eq('role', 'client')
    .eq('inn', value)
    .limit(2);

  if (error) {
    console.error('findClientByInn:', error);
    return null;
  }
  if (!data?.length) return null;
  if (data.length > 1) {
    console.warn('findClientByInn: несколько клиентов с одним ИНН, берём первого', value);
  }
  return data[0] as ClientUserRow;
}

/** Точное совпадение названия (case-insensitive), только client — без %wildcard%. */
export async function findClientByOrganizationExact(
  supabase: SupabaseClient,
  organizationName: string | null | undefined,
): Promise<ClientUserRow | null> {
  const name = String(organizationName || '').trim();
  if (name.length < 3) return null;

  const { data, error } = await supabase
    .from('users')
    .select('user_id, phone, organization_name, full_name, role, inn')
    .eq('role', 'client')
    .ilike('organization_name', name)
    .limit(2);

  if (error) {
    console.error('findClientByOrganizationExact:', error);
    return null;
  }
  if (!data?.length) return null;
  if (data.length > 1) {
    console.warn('findClientByOrganizationExact: несколько совпадений, берём первое', name);
  }
  return data[0] as ClientUserRow;
}
