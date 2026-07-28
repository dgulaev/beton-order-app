import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  detectLawFromUrl,
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

  // Только точное совпадение ключа (без «строй» → чужой клиент)
  if (hits.length === 1) return hits[0] as MatchedClient;
  if (hits.length > 1) {
    // Несколько одинаковых ключей — берём только если один с телефоном, иначе первый
    const withPhone = hits.filter((c) => String(c.phone || '').trim());
    return (withPhone[0] || hits[0]) as MatchedClient;
  }
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
}): Promise<CalloutProspect | null> {
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
      .maybeSingle();

    if (existing) {
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        matched_client_id: matchedId ?? existing.matched_client_id,
      };
      const existingWeak = isWeakOrgName(existing.organization_name, inn);
      if (existingWeak && name) patch.organization_name = name;
      else if (
        name &&
        !isWeakOrgName(name, inn) &&
        isWeakOrgName(existing.organization_name, inn)
      ) {
        patch.organization_name = name;
      }
      if (!existing.phone && (input.phone || phoneFromClient)) {
        patch.phone = input.phone || phoneFromClient;
      }
      if (input.email && !existing.email) patch.email = input.email;
      if (input.address && !existing.address) patch.address = input.address;
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
    const { data: existingByName } = await supabaseAdmin
      .from('callout_prospects')
      .select('*')
      .is('inn', null)
      .ilike('organization_name', `%${key.split(' ').sort((a, b) => b.length - a.length)[0]}%`)
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
      if (!hit.phone && (input.phone || phoneFromClient)) {
        patch.phone = input.phone || phoneFromClient;
      }
      if (input.email && !hit.email) patch.email = input.email;
      if (input.address && !hit.address) patch.address = input.address;
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
    law: lawHint,
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

  // Контакты из raw_contacts, если ЕИС не дал телефон
  const fromRaw = parseContactsBlob(tender.raw_contacts);
  const inn = winner.inn || fromRaw.inn;

  // ГосПлан в индексе даёт только ИНН — название тянем из DaData
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
  });

  if (!prospect) {
    await supabaseAdmin
      .from('callout_tenders')
      .update({
        winner_status: 'failed',
        winner_checked_at: now,
        winner_attempts: attempts,
        updated_at: now,
      })
      .eq('id', tenderId);
    return { ok: false, message: 'Не удалось создать карточку обзвона' };
  }

  await supabaseAdmin
    .from('callout_tenders')
    .update({
      prospect_id: prospect.id,
      contract_reg_num: winner.contract_reg_num,
      contract_price: winner.contract_price ?? tender.contract_price,
      object_info: tender.object_info || winner.object_info,
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

/** Cron: все pending, у которых poll_after наступил. */
export async function runCalloutWinnerPoll(limit = 40): Promise<{
  checked: number;
  found: number;
  pending: number;
  errors: string[];
}> {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from('callout_tenders')
    .select('id')
    .eq('winner_status', 'pending')
    .lte('winner_poll_after', nowIso)
    .order('winner_poll_after', { ascending: true })
    .limit(limit);

  if (error) {
    return { checked: 0, found: 0, pending: 0, errors: [error.message] };
  }

  let found = 0;
  let pending = 0;
  const errors: string[] = [];

  for (const row of rows || []) {
    try {
      const res = await refreshTenderWinner(row.id);
      if (res.ok) found += 1;
      else pending += 1;
      // Пауза под лимит ГосПлана
      await new Promise((r) => setTimeout(r, 700));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { checked: (rows || []).length, found, pending, errors };
}

/** Поставить тендер-лид на наблюдение (ожидание контракта / победителя). */
export async function watchLeadForCallout(input: {
  leadId: number;
  purchaseUrl?: string | null;
  purchaseNumber?: string | null;
  law?: string | null;
  objectInfo?: string | null;
  nmck?: number | null;
  deadline?: string | null;
}): Promise<{ ok: boolean; tender_id?: number; message: string }> {
  const purchaseNumber =
    String(input.purchaseNumber || '').replace(/\D/g, '') ||
    extractPurchaseNumberFromUrl(input.purchaseUrl) ||
    null;
  const purchaseUrl = String(input.purchaseUrl || '').trim() || null;
  if (!purchaseNumber && !purchaseUrl) {
    return { ok: false, message: 'Нет номера закупки или ссылки ЕИС' };
  }

  // Всегда дедуп по lead_id (даже без номера закупки)
  {
    const { data: existing } = await supabaseAdmin
      .from('callout_tenders')
      .select('id')
      .eq('lead_id', input.leadId)
      .maybeSingle();
    if (existing) {
      return { ok: true, tender_id: existing.id, message: 'Уже на наблюдении' };
    }
  }

  if (purchaseNumber) {
    const { data: byPn } = await supabaseAdmin
      .from('callout_tenders')
      .select('id, lead_id')
      .eq('purchase_number', purchaseNumber)
      .limit(1)
      .maybeSingle();
    if (byPn) {
      if (!byPn.lead_id) {
        await supabaseAdmin
          .from('callout_tenders')
          .update({ lead_id: input.leadId, updated_at: new Date().toISOString() })
          .eq('id', byPn.id);
        return { ok: true, tender_id: byPn.id, message: 'Связано с существующей закупкой' };
      }
      return {
        ok: true,
        tender_id: byPn.id,
        message: 'Закупка уже наблюдается (другой лид) — победитель общий',
      };
    }
  }

  const lawRaw = String(input.law || '');
  const law =
    /223/i.test(lawRaw) || /notice223/i.test(purchaseUrl || '')
      ? '223-ФЗ'
      : /44/i.test(lawRaw) || /notice(?!223)/i.test(purchaseUrl || '')
        ? '44-ФЗ'
        : null;

  const deadline = input.deadline ? String(input.deadline).slice(0, 10) : null;
  const { data, error } = await supabaseAdmin
    .from('callout_tenders')
    .insert({
      lead_id: input.leadId,
      purchase_url: purchaseUrl,
      purchase_number: purchaseNumber,
      law,
      object_info: String(input.objectInfo || '').trim() || null,
      nmck: input.nmck ?? null,
      deadline,
      winner_status: 'pending',
      winner_poll_after: pollAfterFromDeadline(deadline),
      source: 'lead:tender',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[callout watchLead]', error);
    return { ok: false, message: error.message };
  }
  return { ok: true, tender_id: data.id, message: 'Поставлено на наблюдение' };
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
