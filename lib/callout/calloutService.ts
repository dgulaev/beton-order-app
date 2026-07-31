import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  detectLawFromUrl,
  extractContractReestrFromUrl,
  extractInnFromText,
  extractPhoneFromText,
  extractPurchaseNumberFromUrl,
  isEmptyWinnerName,
  normalizeInn,
  parseContactsBlob,
} from '@/lib/callout/parseContacts';
import { resolveWinnerFromEis } from '@/lib/callout/fetchContractWinner';
import { isWeakOrgName, lookupPartyByInn } from '@/lib/callout/lookupPartyByInn';
import {
  CALLOUT_STATUSES,
  CALLOUT_STATUS_LABEL,
  type CalloutStatus,
} from '@/lib/callout/labels';

export { CALLOUT_STATUSES, CALLOUT_STATUS_LABEL, type CalloutStatus };

export type CalloutProspect = {
  id: number;
  inn: string | null;
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: CalloutStatus;
  matched_client_id: number | null;
  source: string;
  assigned_to: number | null;
  created_at: string;
  updated_at: string;
};

export type CalloutTender = {
  id: number;
  prospect_id: number | null;
  lead_id: number | null;
  purchase_url: string | null;
  purchase_number: string | null;
  law: string | null;
  object_info: string | null;
  /** Заказчик торгов (не победитель). */
  customer_name: string | null;
  nmck: number | null;
  contract_price: number | null;
  deadline: string | null;
  contract_reg_num: string | null;
  raw_contacts: string | null;
  winner_status: string;
  winner_poll_after: string | null;
  winner_checked_at: string | null;
  winner_attempts: number;
  source: string;
  import_batch: string | null;
  created_at: string;
  updated_at: string;
};

const POLL_DELAY_DAYS = 15;
/** После уже сделанной попытки resolve — не ждать deadline+15, а через N дней. */
const POLL_AFTER_ATTEMPT_DAYS = 3;

export function pollAfterFromDeadline(deadline: string | null | undefined): string {
  const base = deadline ? new Date(`${deadline}T12:00:00+03:00`) : new Date();
  if (Number.isNaN(base.getTime())) {
    const d = new Date();
    d.setDate(d.getDate() + POLL_DELAY_DAYS);
    return d.toISOString();
  }
  base.setDate(base.getDate() + POLL_DELAY_DAYS);
  return base.toISOString();
}

/** Следующий опрос после неудачной/пустой попытки (контракт — сразу в очередь). */
function pollAfterAttempt(opts?: { immediate?: boolean }): string {
  if (opts?.immediate) return new Date().toISOString();
  const d = new Date();
  d.setDate(d.getDate() + POLL_AFTER_ATTEMPT_DAYS);
  return d.toISOString();
}

export async function findClientIdByInn(inn: string | null): Promise<number | null> {
  const n = normalizeInn(inn);
  if (!n) return null;
  const { data } = await supabaseAdmin
    .from('users')
    .select('user_id')
    .eq('role', 'client')
    .eq('inn', n)
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}

/** Нормализация названия для матча с Клиентами: без ОПФ, кавычек, лишних пробелов. */
export function normalizeOrgKey(name: string | null | undefined): string {
  let s = String(name || '').toLowerCase().replace(/["'«»„“]/g, ' ');
  // \b не работает с кириллицей в JS — режем ОПФ явно
  const opf = [
    'публичное акционерное общество',
    'акционерное общество',
    'общество с ограниченной ответственностью',
    'индивидуальный предприниматель',
    'пао',
    'ооо',
    'зао',
    'оао',
    'ао',
    'ип',
  ];
  for (const w of opf) {
    s = s.replace(new RegExp(`(^|\\s+)${w.replace(/\s+/g, '\\s+')}(?=\\s+|$)`, 'gi'), ' ');
  }
  return s
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

type MatchedClient = {
  user_id: number;
  phone: string | null;
  inn: string | null;
  organization_name: string | null;
};

/** Матч с операционными клиентами: сначала ИНН, потом название. */
export async function matchClientForCallout(opts: {
  inn?: string | null;
  organization_name?: string | null;
}): Promise<MatchedClient | null> {
  const inn = normalizeInn(opts.inn);
  if (inn) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('user_id, phone, inn, organization_name')
      .eq('role', 'client')
      .eq('inn', inn)
      .limit(1)
      .maybeSingle();
    if (data) return data as MatchedClient;
  }

  const rawName = String(opts.organization_name || '').trim();
  if (rawName.length < 3) return null;

  // Точное (без учёта регистра)
  {
    const { data } = await supabaseAdmin
      .from('users')
      .select('user_id, phone, inn, organization_name')
      .eq('role', 'client')
      .ilike('organization_name', rawName)
      .limit(2);
    if (data?.length === 1) return data[0] as MatchedClient;
  }

  const key = normalizeOrgKey(rawName);
  if (key.length < 4) return null;

  // Ключевой фрагмент (БРЯНСКАВТОДОР и т.п.)
  const token = key.split(' ').sort((a, b) => b.length - a.length)[0] || key;
  if (token.length < 4) return null;

  const { data: rows } = await supabaseAdmin
    .from('users')
    .select('user_id, phone, inn, organization_name')
    .eq('role', 'client')
    .ilike('organization_name', `%${token.slice(0, 48)}%`)
    .limit(25);

  const hits = (rows || []).filter((c) => {
    const ck = normalizeOrgKey(c.organization_name);
    if (!ck) return false;
    return ck === key;
  });

  // Только однозначное совпадение — иначе риск чужого телефона
  if (hits.length === 1) return hits[0] as MatchedClient;
  return null;
}

/** Найти или создать prospect по ИНН / названию. */
export async function upsertProspect(input: {
  inn?: string | null;
  organization_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source?: string;
  /** Перезаписать телефон/почту/адрес/имя из ЕИС (кнопка refresh / force). */
  forceOverwrite?: boolean;
}): Promise<CalloutProspect | null> {
  const force = Boolean(input.forceOverwrite);
  let inn = normalizeInn(input.inn);
  let name = String(input.organization_name || '').trim() || null;
  if (inn && isWeakOrgName(name, inn)) {
    name = `Победитель ИНН ${inn}`;
  }

  const matchedClient = await matchClientForCallout({
    inn,
    organization_name: name,
  });
  if (matchedClient) {
    if (!inn && matchedClient.inn) inn = normalizeInn(matchedClient.inn);
    if (isWeakOrgName(name, inn) && matchedClient.organization_name) {
      name = matchedClient.organization_name;
    }
  }
  const matchedId = matchedClient?.user_id ?? null;
  const phoneFromClient = matchedClient?.phone || null;

  if (inn) {
    const { data: existing } = await supabaseAdmin
      .from('callout_prospects')
      .select('*')
      .eq('inn', inn)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        matched_client_id: matchedId ?? existing.matched_client_id,
      };
      const existingWeak = isWeakOrgName(existing.organization_name, inn);
      if (force && name && !isWeakOrgName(name, inn)) {
        patch.organization_name = name;
      } else if (existingWeak && name) {
        patch.organization_name = name;
      } else if (
        name &&
        !isWeakOrgName(name, inn) &&
        (existingWeak || !existing.organization_name)
      ) {
        patch.organization_name = name;
      }
      if (force) {
        if (input.phone) patch.phone = input.phone;
        else if (!existing.phone && phoneFromClient) patch.phone = phoneFromClient;
        if (input.email) patch.email = input.email;
        if (input.address) patch.address = input.address;
      } else {
        if (input.phone && !existing.phone) patch.phone = input.phone;
        else if (!existing.phone && phoneFromClient) patch.phone = phoneFromClient;
        if (input.email && !existing.email) patch.email = input.email;
        if (input.address && !existing.address) patch.address = input.address;
      }
      const { data } = await supabaseAdmin
        .from('callout_prospects')
        .update(patch)
        .eq('id', existing.id)
        .select('*')
        .single();
      return data as CalloutProspect;
    }

    const { data, error } = await supabaseAdmin
      .from('callout_prospects')
      .insert({
        inn,
        organization_name: name || `Победитель ИНН ${inn}`,
        phone: input.phone || phoneFromClient || null,
        email: input.email || null,
        address: input.address || null,
        source: input.source || 'eis',
        matched_client_id: matchedId,
        status: 'new',
      })
      .select('*')
      .single();
    if (error) {
      console.error('[callout upsertProspect]', error);
      return null;
    }
    return data as CalloutProspect;
  }

  // Без ИНН — по названию (импорт); пытаемся сматчить Клиентов и подтянуть ИНН/телефон
  if (!name || isEmptyWinnerName(name)) return null;

  const key = normalizeOrgKey(name);
  if (key.length >= 4) {
    const token = key.split(' ').sort((a, b) => b.length - a.length)[0] || key;
    const { data: existingByName } = await supabaseAdmin
      .from('callout_prospects')
      .select('*')
      .is('inn', null)
      .ilike('organization_name', `%${token.replace(/[%_]/g, '')}%`)
      .limit(15);
    const hit = (existingByName || []).find(
      (p) => normalizeOrgKey(p.organization_name) === key,
    );
    if (hit) {
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        matched_client_id: matchedId ?? hit.matched_client_id,
      };
      if (inn) patch.inn = inn;
      if (force) {
        if (input.phone) patch.phone = input.phone;
        else if (!hit.phone && phoneFromClient) patch.phone = phoneFromClient;
        if (input.email) patch.email = input.email;
        if (input.address) patch.address = input.address;
        if (name) patch.organization_name = name;
      } else {
        if (!hit.phone && (input.phone || phoneFromClient)) {
          patch.phone = input.phone || phoneFromClient;
        }
        if (input.email && !hit.email) patch.email = input.email;
        if (input.address && !hit.address) patch.address = input.address;
      }
      const { data } = await supabaseAdmin
        .from('callout_prospects')
        .update(patch)
        .eq('id', hit.id)
        .select('*')
        .single();
      return data as CalloutProspect;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('callout_prospects')
    .insert({
      inn: inn || null,
      organization_name: name,
      phone: input.phone || phoneFromClient || null,
      email: input.email || null,
      address: input.address || null,
      source: input.source || 'import:xlsx',
      matched_client_id: matchedId,
      status: 'new',
    })
    .select('*')
    .single();
  if (error) {
    console.error('[callout upsertProspect no-inn]', error);
    return null;
  }
  return data as CalloutProspect;
}

export type ImportRow = {
  purchase_url?: string | null;
  object_info?: string | null;
  supplier_name?: string | null;
  contacts?: string | null;
  contract_price?: number | string | null;
};

export async function importCalloutRows(
  rows: ImportRow[],
  batchId: string,
): Promise<{ createdProspects: number; createdTenders: number; skipped: number }> {
  let createdProspects = 0;
  let createdTenders = 0;
  let skipped = 0;

  for (const row of rows) {
    const url = String(row.purchase_url || '').trim() || null;
    const objectInfo = String(row.object_info || '').trim() || null;
    const supplier = String(row.supplier_name || '').trim() || null;
    const contactsRaw = String(row.contacts || '').trim() || null;
    const priceRaw = row.contract_price;
    const price =
      priceRaw != null && String(priceRaw).trim() !== ''
        ? Number(String(priceRaw).replace(/\s/g, '').replace(',', '.'))
        : null;
    const contractPrice = Number.isFinite(price as number) ? (price as number) : null;

    if (!url && !objectInfo && !supplier) {
      skipped += 1;
      continue;
    }

    const parsed = parseContactsBlob(contactsRaw);
    // ИНН часто лежит в колонке «Поставщик», не только в «Контакты»
    const innFromSupplier = extractInnFromText(supplier);
    const inn = parsed.inn || innFromSupplier;
    const hasWinner = !isEmptyWinnerName(supplier) || !!inn;

    let prospectId: number | null = null;
    if (hasWinner) {
      const before = inn
        ? (
            await supabaseAdmin
              .from('callout_prospects')
              .select('id')
              .eq('inn', inn)
              .maybeSingle()
          ).data
        : null;
      const prospect = await upsertProspect({
        inn,
        organization_name: isEmptyWinnerName(supplier)
          ? inn
            ? `Победитель ИНН ${inn}`
            : null
          : supplier,
        phone: parsed.phone,
        email: parsed.email,
        address: parsed.address,
        source: 'import:xlsx',
      });
      if (prospect) {
        prospectId = prospect.id;
        if (!before) createdProspects += 1;
      }
    }

    const purchaseNumber = extractPurchaseNumberFromUrl(url);
    const law = detectLawFromUrl(url);

    // Повторный импорт той же закупки — не плодим дубли
    if (purchaseNumber) {
      const { data: existingTender } = await supabaseAdmin
        .from('callout_tenders')
        .select('id, prospect_id')
        .eq('purchase_number', purchaseNumber)
        .limit(1)
        .maybeSingle();
      if (existingTender) {
        if (prospectId && !existingTender.prospect_id) {
          await supabaseAdmin
            .from('callout_tenders')
            .update({
              prospect_id: prospectId,
              winner_status: 'manual',
              winner_poll_after: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingTender.id);
        }
        skipped += 1;
        continue;
      }
    }

    const { error } = await supabaseAdmin.from('callout_tenders').insert({
      prospect_id: prospectId,
      purchase_url: url,
      purchase_number: purchaseNumber,
      law: law === 'fz223' ? '223-ФЗ' : law === 'fz44' ? '44-ФЗ' : null,
      object_info: objectInfo,
      contract_price: contractPrice,
      raw_contacts: contactsRaw,
      winner_status: prospectId ? 'manual' : 'pending',
      // Excel уже «протухшие» торги — опрашивать сразу, не через 15 дней
      winner_poll_after: prospectId ? null : new Date().toISOString(),
      source: 'import:xlsx',
      import_batch: batchId,
    });
    if (error) {
      console.error('[callout import tender]', error);
      skipped += 1;
    } else {
      createdTenders += 1;
    }
  }

  return { createdProspects, createdTenders, skipped };
}

/** Подтянуть победителя по одной закупке (кнопка / cron). */
export async function refreshTenderWinner(tenderId: number): Promise<{
  ok: boolean;
  message: string;
  prospect_id?: number;
}> {
  const { data: tender, error } = await supabaseAdmin
    .from('callout_tenders')
    .select('*')
    .eq('id', tenderId)
    .maybeSingle();
  if (error || !tender) return { ok: false, message: 'Закупка не найдена' };

  const lawHint =
    /223/i.test(String(tender.law || '')) || /notice223/i.test(String(tender.purchase_url || ''))
      ? 'fz223'
      : 'fz44';

  const winner = await resolveWinnerFromEis({
    purchaseNumber: tender.purchase_number,
    purchaseUrl: tender.purchase_url,
    contractReestrNumber: tender.contract_reg_num,
    law: lawHint,
    enrichDetail: true,
  });

  const attempts = Number(tender.winner_attempts || 0) + 1;
  const now = new Date().toISOString();

  if (!winner?.inn && !winner?.organization_name) {
    // Повтор через 3 дня, макс ~10 попыток
    const next = new Date();
    next.setDate(next.getDate() + 3);
    await supabaseAdmin
      .from('callout_tenders')
      .update({
        winner_status: attempts >= 12 ? 'missing' : 'pending',
        winner_checked_at: now,
        winner_attempts: attempts,
        winner_poll_after: attempts >= 12 ? null : next.toISOString(),
        updated_at: now,
      })
      .eq('id', tenderId);
    return {
      ok: false,
      message:
        attempts >= 12
          ? 'Контракт так и не найден — статус «нет данных»'
          : 'Победитель пока не найден в реестре контрактов, попробуем позже',
    };
  }

  // Контакты: ЕИС «Информация о поставщиках» → raw_contacts → DaData
  const fromRaw = parseContactsBlob(tender.raw_contacts);
  const inn = winner.inn || fromRaw.inn;

  let orgName = winner.organization_name || null;
  let phone = winner.phone || fromRaw.phone;
  let email = winner.email || fromRaw.email;
  let address = winner.address || fromRaw.address;

  if (inn && isWeakOrgName(orgName, inn)) {
    const party = await lookupPartyByInn(inn);
    if (party?.organization_name) orgName = party.organization_name;
    if (!phone && party?.phone) phone = party.phone;
    if (!email && party?.email) email = party.email;
    if (!address && party?.address) address = party.address;
  }

  if (!orgName && inn) orgName = `Победитель ИНН ${inn}`;

  const prospect = await upsertProspect({
    inn,
    organization_name: orgName,
    phone,
    email,
    address,
    source: 'eis',
    forceOverwrite: true,
  });

  if (!prospect) {
    const nextFail = new Date();
    nextFail.setDate(nextFail.getDate() + 3);
    await supabaseAdmin
      .from('callout_tenders')
      .update({
        winner_status: attempts >= 12 ? 'failed' : 'pending',
        winner_checked_at: now,
        winner_attempts: attempts,
        winner_poll_after: attempts >= 12 ? null : nextFail.toISOString(),
        updated_at: now,
      })
      .eq('id', tenderId);
    return { ok: false, message: 'Не удалось создать карточку обзвона' };
  }

  await supabaseAdmin
    .from('callout_tenders')
    .update({
      prospect_id: prospect.id,
      purchase_number: tender.purchase_number || winner.purchase_number || null,
      contract_reg_num: winner.contract_reg_num || tender.contract_reg_num,
      contract_price: winner.contract_price ?? tender.contract_price,
      object_info: winner.object_info || tender.object_info,
      winner_status: 'found',
      winner_checked_at: now,
      winner_attempts: attempts,
      winner_poll_after: null,
      updated_at: now,
    })
    .eq('id', tenderId);

  return {
    ok: true,
    message: `Победитель: ${prospect.organization_name || prospect.inn || '—'}`,
    prospect_id: prospect.id,
  };
}

/** Cron: pending с наступившим poll_after + редкий retry для missing/failed. */
export async function runCalloutWinnerPoll(limit = 5): Promise<{
  checked: number;
  found: number;
  pending: number;
  reclaimed: number;
  errors: string[];
}> {
  const nowIso = new Date().toISOString();
  let reclaimed = 0;

  // Вернуть в очередь «нет данных» / failed (не чаще чем раз в ~7 дней по checked_at)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const reclaimSlots = Math.min(2, Math.max(1, Math.floor(limit / 2)));
  const { data: stale } = await supabaseAdmin
    .from('callout_tenders')
    .select('id')
    .in('winner_status', ['missing', 'failed'])
    .lt('winner_attempts', 18)
    .or(`winner_checked_at.is.null,winner_checked_at.lte.${weekAgo.toISOString()}`)
    .order('winner_checked_at', { ascending: true })
    .limit(reclaimSlots);
  if (stale?.length) {
    const ids = stale.map((r) => r.id);
    const { error: reclaimErr } = await supabaseAdmin
      .from('callout_tenders')
      .update({
        winner_status: 'pending',
        winner_poll_after: nowIso,
        updated_at: nowIso,
      })
      .in('id', ids);
    if (!reclaimErr) reclaimed = ids.length;
  }

  const { data: rows, error } = await supabaseAdmin
    .from('callout_tenders')
    .select('id')
    .eq('winner_status', 'pending')
    .lte('winner_poll_after', nowIso)
    .order('winner_poll_after', { ascending: true })
    .limit(limit);

  if (error) {
    return { checked: 0, found: 0, pending: 0, reclaimed, errors: [error.message] };
  }

  let found = 0;
  let pending = 0;
  const errors: string[] = [];

  for (const row of rows || []) {
    try {
      const res = await refreshTenderWinner(row.id);
      if (res.ok) found += 1;
      else pending += 1;
      // Пауза: ЕИС HTML + ГосПлан
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { checked: (rows || []).length, found, pending, reclaimed, errors };
}

/**
 * Поставить тендер-лид в «Обзвон»:
 * — ссылка на контракт (reestrNumber) → сразу карточка победителя из «Информация о поставщиках»;
 * — ссылка на извещение → если контракт уже есть, тоже сразу; иначе pending до появления победителя.
 */
export async function watchLeadForCallout(input: {
  leadId: number;
  purchaseUrl?: string | null;
  purchaseNumber?: string | null;
  contractReestrNumber?: string | null;
  law?: string | null;
  objectInfo?: string | null;
  /** Организация-заказчик (кто проводит торги). */
  customerName?: string | null;
  nmck?: number | null;
  deadline?: string | null;
}): Promise<{
  ok: boolean;
  tender_id?: number;
  prospect_id?: number;
  message: string;
}> {
  const purchaseUrl = String(input.purchaseUrl || '').trim() || null;
  const contractReestr =
    String(input.contractReestrNumber || '').replace(/\D/g, '') ||
    extractContractReestrFromUrl(purchaseUrl) ||
    null;
  let purchaseNumber =
    String(input.purchaseNumber || '').replace(/\D/g, '') ||
    extractPurchaseNumberFromUrl(purchaseUrl) ||
    null;
  const customerName = String(input.customerName || '').trim() || null;

  if (!purchaseNumber && !purchaseUrl && !contractReestr) {
    return { ok: false, message: 'Нет номера закупки, контракта или ссылки ЕИС' };
  }

  // Дедуп по lead_id — при смене № закупки/ссылки обновляем и перерезолвим победителя
  {
    const { data: existingRows } = await supabaseAdmin
      .from('callout_tenders')
      .select(
        'id, prospect_id, winner_status, purchase_number, purchase_url, contract_reg_num, object_info, nmck, deadline, law',
      )
      .eq('lead_id', input.leadId)
      .order('id', { ascending: true })
      .limit(5);
    const existing = existingRows?.[0];
    if (existing) {
      const nextPn = purchaseNumber;
      const nextUrl = purchaseUrl;
      const nextReg = contractReestr;
      const pnChanged =
        Boolean(nextPn) &&
        String(existing.purchase_number || '').replace(/\D/g, '') !== nextPn;
      const urlChanged =
        Boolean(nextUrl) && String(existing.purchase_url || '').trim() !== nextUrl;
      const regChanged =
        Boolean(nextReg) &&
        String(existing.contract_reg_num || '').replace(/\D/g, '') !== nextReg;
      const keysChanged = pnChanged || urlChanged || regChanged;

      if (keysChanged || customerName || !existing.prospect_id) {
        const lawRaw = String(input.law || '');
        const lawLabel =
          /223/i.test(lawRaw) || /notice223/i.test(nextUrl || '')
            ? '223-ФЗ'
            : /44/i.test(lawRaw) || /\/epz\/contract\//i.test(nextUrl || '')
              ? '44-ФЗ'
              : existing.law;
        const patch: Record<string, unknown> = {
          purchase_number: nextPn || existing.purchase_number,
          purchase_url: nextUrl || existing.purchase_url,
          contract_reg_num: nextReg || existing.contract_reg_num,
          object_info:
            String(input.objectInfo || '').trim() || existing.object_info,
          nmck: input.nmck ?? existing.nmck,
          deadline: input.deadline
            ? String(input.deadline).slice(0, 10)
            : existing.deadline,
          law: lawLabel,
          updated_at: new Date().toISOString(),
        };
        if (customerName) patch.customer_name = customerName;
        if (keysChanged) {
          // Смена закупки — отвязать старого победителя и искать заново
          patch.prospect_id = null;
          patch.winner_status = 'pending';
          patch.winner_poll_after = new Date().toISOString();
          patch.winner_attempts = 0;
          if (nextReg) patch.contract_reg_num = nextReg;
        }
        const { error: updErr } = await supabaseAdmin
          .from('callout_tenders')
          .update(patch)
          .eq('id', existing.id);
        if (updErr && customerName && /customer_name/i.test(updErr.message)) {
          delete patch.customer_name;
          await supabaseAdmin.from('callout_tenders').update(patch).eq('id', existing.id);
        }
      }

      if (!existing.prospect_id || keysChanged) {
        const refreshed = await refreshTenderWinner(existing.id);
        return {
          ok: true,
          tender_id: existing.id,
          prospect_id: refreshed.prospect_id,
          message: refreshed.ok
            ? refreshed.message
            : keysChanged
              ? 'Закупка в обзвоне обновлена — ждём победителя в ЕИС'
              : 'Уже на наблюдении (победитель пока не найден)',
        };
      }
      return {
        ok: true,
        tender_id: existing.id,
        prospect_id: existing.prospect_id ?? undefined,
        message: 'Уже на наблюдении',
      };
    }
  }

  if (contractReestr) {
    const { data: byRegRows } = await supabaseAdmin
      .from('callout_tenders')
      .select('id, lead_id, prospect_id, winner_status')
      .eq('contract_reg_num', contractReestr)
      .order('id', { ascending: true })
      .limit(1);
    const byReg = byRegRows?.[0];
    if (byReg) {
      if (byReg.lead_id && byReg.lead_id !== input.leadId) {
        if (!byReg.prospect_id) {
          const refreshed = await refreshTenderWinner(byReg.id);
          return {
            ok: true,
            tender_id: byReg.id,
            prospect_id: refreshed.prospect_id,
            message: refreshed.ok
              ? `${refreshed.message} (контракт также у лида #${byReg.lead_id})`
              : `Контракт уже наблюдается у лида #${byReg.lead_id}`,
          };
        }
        return {
          ok: true,
          tender_id: byReg.id,
          prospect_id: byReg.prospect_id ?? undefined,
          message: `Контракт уже в обзвоне у лида #${byReg.lead_id}`,
        };
      }
      if (!byReg.lead_id) {
        await supabaseAdmin
          .from('callout_tenders')
          .update({ lead_id: input.leadId, updated_at: new Date().toISOString() })
          .eq('id', byReg.id);
      }
      if (!byReg.prospect_id) {
        const refreshed = await refreshTenderWinner(byReg.id);
        return {
          ok: true,
          tender_id: byReg.id,
          prospect_id: refreshed.prospect_id,
          message: refreshed.ok
            ? refreshed.message
            : 'Контракт уже в обзвоне (ожидание победителя)',
        };
      }
      return {
        ok: true,
        tender_id: byReg.id,
        prospect_id: byReg.prospect_id ?? undefined,
        message: 'Контракт уже в обзвоне',
      };
    }
  }

  if (purchaseNumber) {
    const { data: byPnRows } = await supabaseAdmin
      .from('callout_tenders')
      .select('id, lead_id, prospect_id, winner_status')
      .eq('purchase_number', purchaseNumber)
      .order('id', { ascending: true })
      .limit(1);
    const byPn = byPnRows?.[0];
    if (byPn) {
      if (byPn.lead_id && byPn.lead_id !== input.leadId) {
        if (!byPn.prospect_id) {
          const refreshed = await refreshTenderWinner(byPn.id);
          return {
            ok: true,
            tender_id: byPn.id,
            prospect_id: refreshed.prospect_id,
            message: refreshed.ok
              ? `${refreshed.message} (закупка также у лида #${byPn.lead_id})`
              : `Закупка уже наблюдается у лида #${byPn.lead_id}`,
          };
        }
        return {
          ok: true,
          tender_id: byPn.id,
          prospect_id: byPn.prospect_id ?? undefined,
          message: `Закупка уже в обзвоне у лида #${byPn.lead_id}`,
        };
      }
      if (!byPn.lead_id) {
        await supabaseAdmin
          .from('callout_tenders')
          .update({ lead_id: input.leadId, updated_at: new Date().toISOString() })
          .eq('id', byPn.id);
      }
      if (!byPn.prospect_id) {
        const refreshed = await refreshTenderWinner(byPn.id);
        return {
          ok: true,
          tender_id: byPn.id,
          prospect_id: refreshed.prospect_id,
          message: refreshed.ok
            ? refreshed.message
            : 'Связано с существующей закупкой (ожидание победителя)',
        };
      }
      return {
        ok: true,
        tender_id: byPn.id,
        prospect_id: byPn.prospect_id ?? undefined,
        message: 'Закупка уже в обзвоне с победителем',
      };
    }
  }

  const lawHint: 'fz44' | 'fz223' | null =
    /223/i.test(String(input.law || '')) || /notice223/i.test(purchaseUrl || '')
      ? 'fz223'
      : /44/i.test(String(input.law || '')) ||
          /\/epz\/contract\//i.test(purchaseUrl || '') ||
          detectLawFromUrl(purchaseUrl) === 'fz44'
        ? 'fz44'
        : detectLawFromUrl(purchaseUrl);

  // Сразу ищем победителя: карточка контракта или уже заключённый контракт по извещению
  let winner = await resolveWinnerFromEis({
    purchaseNumber,
    purchaseUrl,
    contractReestrNumber: contractReestr,
    law: lawHint,
    enrichDetail: true,
  });

  if (winner?.purchase_number && !purchaseNumber) {
    purchaseNumber = String(winner.purchase_number).replace(/\D/g, '') || null;
  }

  const lawLabel =
    winner?.law === 'fz223' || lawHint === 'fz223'
      ? '223-ФЗ'
      : winner?.law === 'fz44' || lawHint === 'fz44'
        ? '44-ФЗ'
        : /223/i.test(String(input.law || ''))
          ? '223-ФЗ'
          : /44/i.test(String(input.law || ''))
            ? '44-ФЗ'
            : null;

  const deadline = input.deadline ? String(input.deadline).slice(0, 10) : null;
  const now = new Date().toISOString();

  if (winner?.inn || winner?.organization_name) {
    let orgName = winner.organization_name || null;
    let phone = winner.phone || null;
    let email = winner.email || null;
    let address = winner.address || null;
    const inn = winner.inn;

    if (inn && isWeakOrgName(orgName, inn)) {
      const party = await lookupPartyByInn(inn);
      if (party?.organization_name) orgName = party.organization_name;
      if (!phone && party?.phone) phone = party.phone;
      if (!email && party?.email) email = party.email;
      if (!address && party?.address) address = party.address;
    }
    if (!orgName && inn) orgName = `Победитель ИНН ${inn}`;

    const prospect = await upsertProspect({
      inn,
      organization_name: orgName,
      phone,
      email,
      address,
      source: contractReestr ? 'lead:contract' : 'lead:tender',
    });

    const insertFound: Record<string, unknown> = {
      lead_id: input.leadId,
      prospect_id: prospect?.id ?? null,
      purchase_url: purchaseUrl,
      purchase_number: purchaseNumber || winner.purchase_number || null,
      law: lawLabel,
      object_info:
        String(input.objectInfo || '').trim() || winner.object_info || null,
      customer_name: customerName,
      nmck: input.nmck ?? null,
      contract_price: winner.contract_price ?? null,
      deadline,
      contract_reg_num: winner.contract_reg_num || contractReestr,
      winner_status: prospect ? 'found' : 'pending',
      winner_checked_at: now,
      winner_attempts: 1,
      // Уже пробовали resolve — не откладывать до deadline+15
      winner_poll_after: prospect
        ? null
        : pollAfterAttempt({ immediate: Boolean(contractReestr) }),
      source: contractReestr ? 'lead:contract' : 'lead:tender',
    };
    let { data, error } = await supabaseAdmin
      .from('callout_tenders')
      .insert(insertFound)
      .select('id')
      .single();
    if (error && /customer_name/i.test(error.message)) {
      delete insertFound.customer_name;
      ({ data, error } = await supabaseAdmin
        .from('callout_tenders')
        .insert(insertFound)
        .select('id')
        .single());
    }

    if (error || !data) {
      console.error('[callout watchLead]', error);
      return { ok: false, message: error?.message || 'Не удалось сохранить закупку' };
    }

    return {
      ok: true,
      tender_id: data.id,
      prospect_id: prospect?.id,
      message: prospect
        ? `В обзвон: ${prospect.organization_name || prospect.inn || 'победитель'}`
        : 'Контракт найден, карточку обзвона создать не удалось — на наблюдении',
    };
  }

  // Контракта ещё нет — ждём победителя
  const insertPending: Record<string, unknown> = {
    lead_id: input.leadId,
    purchase_url: purchaseUrl,
    purchase_number: purchaseNumber,
    law: lawLabel,
    object_info: String(input.objectInfo || '').trim() || null,
    customer_name: customerName,
    nmck: input.nmck ?? null,
    deadline,
    contract_reg_num: contractReestr,
    winner_status: 'pending',
    winner_checked_at: now,
    winner_attempts: 1,
    // Resolve уже вызывали выше — следующий опрос через 3 дня (контракт — сразу)
    winner_poll_after: pollAfterAttempt({ immediate: Boolean(contractReestr) }),
    source: 'lead:tender',
  };
  let { data, error } = await supabaseAdmin
    .from('callout_tenders')
    .insert(insertPending)
    .select('id')
    .single();
  if (error && /customer_name/i.test(error.message)) {
    delete insertPending.customer_name;
    ({ data, error } = await supabaseAdmin
      .from('callout_tenders')
      .insert(insertPending)
      .select('id')
      .single());
  }

  if (error || !data) {
    console.error('[callout watchLead]', error);
    return { ok: false, message: error?.message || 'Не удалось сохранить закупку' };
  }
  return {
    ok: true,
    tender_id: data.id,
    message: contractReestr
      ? 'Контракт на наблюдении (данные поставщика пока не найдены)'
      : 'Поставлено на наблюдение — победитель появится после заключения контракта',
  };
}

/**
 * Удаление Excel-импорта:
 * - карточки обзвона (контакты, статусы, комментарии) — остаются;
 * - закупки со ссылкой ЕИС, уже привязанные к карточке — остаются
 *   (только снимаем метку import_batch);
 * - удаляем лишь «висячие» закупки без победителя (prospect_id is null).
 */
export async function deleteImportBatch(batchId: string): Promise<{
  deletedTenders: number;
  keptLinkedTenders: number;
  keptProspects: number;
}> {
  const { data: tenders } = await supabaseAdmin
    .from('callout_tenders')
    .select('id, prospect_id')
    .eq('import_batch', batchId);

  const linkedIds = (tenders || [])
    .filter((t) => t.prospect_id != null)
    .map((t) => t.id);
  const orphanIds = (tenders || [])
    .filter((t) => t.prospect_id == null)
    .map((t) => t.id);

  const prospectIds = Array.from(
    new Set((tenders || []).map((t) => t.prospect_id).filter(Boolean)),
  ) as number[];

  // Привязанные к карточкам — оставляем навсегда, только отвязываем от батча
  if (linkedIds.length) {
    await supabaseAdmin
      .from('callout_tenders')
      .update({ import_batch: null, updated_at: new Date().toISOString() })
      .in('id', linkedIds);
  }

  let deletedTenders = 0;
  if (orphanIds.length) {
    const { data: deleted } = await supabaseAdmin
      .from('callout_tenders')
      .delete()
      .in('id', orphanIds)
      .select('id');
    deletedTenders = (deleted || []).length;
  }

  return {
    deletedTenders,
    keptLinkedTenders: linkedIds.length,
    keptProspects: prospectIds.length,
  };
}

/** Дозаполнить название/телефон/адрес + матч с Клиентами (ИНН или название). */
export async function enrichNamelessProspects(limit = 50): Promise<{
  checked: number;
  updated: number;
  skipped: number;
}> {
  const { data: rows } = await supabaseAdmin
    .from('callout_prospects')
    .select('id, inn, organization_name, phone, email, address, matched_client_id')
    .order('updated_at', { ascending: false })
    .limit(300);

  const need = (rows || [])
    .filter((r) => {
      const weakName = isWeakOrgName(r.organization_name, r.inn);
      const noPhone = !String(r.phone || '').trim();
      // Не гоняем DaData только из‑за «нет matched_client_id» — большинство никогда не станут клиентами
      return weakName || (noPhone && (r.inn || r.address));
    })
    .slice(0, limit);

  let updated = 0;
  let skipped = 0;

  for (const row of need) {
    const weakName = isWeakOrgName(row.organization_name, row.inn);
    const noPhone = !String(row.phone || '').trim();

    // Сначала дешёвые источники (адрес / матч), DaData — только если ещё нужно
    let phone = row.phone ? String(row.phone) : null;
    let email = row.email || null;
    let address = row.address || null;
    let organization_name = row.organization_name;
    let inn = row.inn;
    let matched_client_id = row.matched_client_id;

    if (!phone && address) phone = extractPhoneFromText(address);

    const matched = await matchClientForCallout({
      inn: row.inn,
      organization_name: row.organization_name,
    });
    if (matched) {
      matched_client_id = matched_client_id || matched.user_id;
      if (!inn && matched.inn) inn = normalizeInn(matched.inn);
      if (!phone && matched.phone) phone = matched.phone;
      if (weakName && matched.organization_name) organization_name = matched.organization_name;
    }

    if ((!phone || weakName) && (inn || row.inn)) {
      const party = await lookupPartyByInn(inn || row.inn);
      if (party) {
        if (weakName && party.organization_name) organization_name = party.organization_name;
        if (!phone && party.phone) phone = party.phone;
        if (!email && party.email) email = party.email;
        if (!address && party.address) address = party.address;
        if (!phone && party.address) phone = extractPhoneFromText(party.address);
      }
      await new Promise((r) => setTimeout(r, 80));
    }

    if (weakName && inn && isWeakOrgName(organization_name, inn)) {
      organization_name = `Победитель ИНН ${inn}`;
    }

    if (!phone || !email) {
      const { data: tenders } = await supabaseAdmin
        .from('callout_tenders')
        .select('raw_contacts')
        .eq('prospect_id', row.id)
        .not('raw_contacts', 'is', null)
        .limit(5);
      for (const t of tenders || []) {
        const parsed = parseContactsBlob(t.raw_contacts);
        if (!phone && parsed.phone) phone = parsed.phone;
        if (!email && parsed.email) email = parsed.email;
        if (!address && parsed.address) address = parsed.address;
      }
    }

    // noPhone был нужен, но так и не нашли — всё равно можно обновить матч/имя
    void noPhone;

    const changed =
      organization_name !== row.organization_name ||
      phone !== row.phone ||
      email !== row.email ||
      address !== row.address ||
      inn !== row.inn ||
      matched_client_id !== row.matched_client_id;

    if (!changed) {
      skipped += 1;
      continue;
    }

    await supabaseAdmin
      .from('callout_prospects')
      .update({
        organization_name,
        phone,
        email,
        address,
        inn,
        matched_client_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    updated += 1;
  }

  return { checked: need.length, updated, skipped };
}

function phonesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (!da && !db) return true;
  if (!da || !db) return false;
  const norm = (d: string) => {
    if (d.length === 11 && (d.startsWith('7') || d.startsWith('8'))) return `7${d.slice(1)}`;
    if (d.length === 10) return `7${d}`;
    return d;
  };
  return norm(da) === norm(db);
}

/** Удалить наблюдения обзвона по лиду + сиротские карточки без других тендеров. */
export async function removeCalloutForLead(leadId: number): Promise<{
  deletedTenders: number;
  deletedProspects: number;
}> {
  const { data: tenders } = await supabaseAdmin
    .from('callout_tenders')
    .select('id, prospect_id')
    .eq('lead_id', leadId);
  const prospectIds = [
    ...new Set(
      (tenders || [])
        .map((t) => t.prospect_id)
        .filter((id): id is number => id != null && Number.isFinite(Number(id))),
    ),
  ];

  const { data: deleted } = await supabaseAdmin
    .from('callout_tenders')
    .delete()
    .eq('lead_id', leadId)
    .select('id');

  let deletedProspects = 0;
  for (const pid of prospectIds) {
    const { count } = await supabaseAdmin
      .from('callout_tenders')
      .select('id', { count: 'exact', head: true })
      .eq('prospect_id', pid);
    if ((count ?? 0) > 0) continue;
    const { error } = await supabaseAdmin
      .from('callout_prospects')
      .delete()
      .eq('id', pid);
    if (!error) deletedProspects += 1;
  }

  return { deletedTenders: (deleted || []).length, deletedProspects };
}

/**
 * Обновить телефон/почту/адрес из ЕИС по связанным закупкам/контрактам
 * (результаты торгов → реестр контракта → «Информация о поставщиках»).
 *
 * force=true (по кнопке): данные из ЕИС перезаписывают старые в карточке.
 * Городские номера (4832 и т.п.) — норма для ЕИС, если так указано у поставщика.
 */
export async function enrichProspectContactsFromEis(
  limit = 30,
  opts?: { force?: boolean; preferProspectId?: number | null },
): Promise<{
  checked: number;
  updated: number;
  skipped: number;
  errors: string[];
}> {
  const force = opts?.force !== false;
  const preferId = opts?.preferProspectId ?? null;

  const { data: rows } = await supabaseAdmin
    .from('callout_prospects')
    .select('id, inn, organization_name, phone, email, address')
    .order('updated_at', { ascending: false })
    .limit(400);

  // Сначала без контактов, потом остальные (чтобы force обновил и «старые» номера)
  const sorted = [...(rows || [])].sort((a, b) => {
    if (preferId != null) {
      if (a.id === preferId) return -1;
      if (b.id === preferId) return 1;
    }
    const aGap =
      (!String(a.phone || '').trim() ? 2 : 0) + (!String(a.email || '').trim() ? 1 : 0);
    const bGap =
      (!String(b.phone || '').trim() ? 2 : 0) + (!String(b.email || '').trim() ? 1 : 0);
    return bGap - aGap;
  });

  let updated = 0;
  let skipped = 0;
  let checked = 0;
  const errors: string[] = [];

  for (const row of sorted) {
    if (checked >= limit) break;

    const { data: tenders } = await supabaseAdmin
      .from('callout_tenders')
      .select(
        'id, purchase_number, purchase_url, contract_reg_num, law, winner_status',
      )
      .eq('prospect_id', row.id)
      .order('updated_at', { ascending: false })
      .limit(3);

    const linkable = (tenders || []).filter(
      (t) =>
        String(t.contract_reg_num || '').replace(/\D/g, '').length >= 11 ||
        String(t.purchase_number || '').replace(/\D/g, '').length >= 11 ||
        String(t.purchase_url || '').trim(),
    );
    if (!linkable.length) {
      skipped += 1;
      continue;
    }

    checked += 1;
    let winner = null as Awaited<ReturnType<typeof resolveWinnerFromEis>>;
    for (const t of linkable) {
      try {
        winner = await resolveWinnerFromEis({
          purchaseNumber: t.purchase_number,
          purchaseUrl: t.purchase_url,
          contractReestrNumber: t.contract_reg_num,
          law:
            /223/i.test(String(t.law || '')) ||
            /notice223/i.test(String(t.purchase_url || ''))
              ? 'fz223'
              : 'fz44',
          enrichDetail: true,
        });
        if (winner && (winner.phone || winner.email || winner.organization_name)) {
          break;
        }
      } catch (e) {
        errors.push(
          `#${row.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (!winner) {
      skipped += 1;
      continue;
    }

    // force: ЕИС перекрывает старые поля; иначе только дырки
    const phone = force
      ? winner.phone || row.phone || null
      : String(row.phone || '').trim() || winner.phone || null;
    const email = force
      ? winner.email || row.email || null
      : String(row.email || '').trim() || winner.email || null;
    const address = force
      ? winner.address || row.address || null
      : String(row.address || '').trim() || winner.address || null;
    const organization_name = force
      ? winner.organization_name || row.organization_name
      : (!isWeakOrgName(row.organization_name, row.inn) && row.organization_name) ||
        winner.organization_name ||
        row.organization_name;
    const inn = force
      ? winner.inn || normalizeInn(row.inn) || null
      : normalizeInn(row.inn) || winner.inn || null;

    const changed =
      !phonesEqual(phone, row.phone) ||
      String(email || '').trim().toLowerCase() !==
        String(row.email || '').trim().toLowerCase() ||
      String(address || '').trim() !== String(row.address || '').trim() ||
      String(organization_name || '').trim() !==
        String(row.organization_name || '').trim() ||
      String(inn || '') !== String(row.inn || '');

    if (!changed) {
      skipped += 1;
      continue;
    }

    await supabaseAdmin
      .from('callout_prospects')
      .update({
        phone,
        email,
        address,
        organization_name,
        inn,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (winner.contract_reg_num && linkable[0]) {
      await supabaseAdmin
        .from('callout_tenders')
        .update({
          contract_reg_num: winner.contract_reg_num,
          ...(winner.contract_price != null
            ? { contract_price: winner.contract_price }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', linkable[0].id);
    }

    updated += 1;
    await new Promise((r) => setTimeout(r, 500));
  }

  return { checked, updated, skipped, errors };
}
