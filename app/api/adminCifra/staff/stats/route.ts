import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isLeadAssignee } from '@/lib/leadAssigneeIds';
import {
  getLeadDateHints,
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
  type Lead,
  type LeadStatus,
} from '@/lib/leads';

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) throw new Error('SUPABASE credentials not set');
  return createClient(supabaseUrl, supabaseServiceKey);
}

const OPEN_LEAD_STATUSES = new Set<LeadStatus>(['new', 'in_progress', 'converted']);

function leadDisplayTitle(lead: Pick<Lead, 'name' | 'phone' | 'raw_payload' | 'id'>): string {
  const payload =
    lead.raw_payload && typeof lead.raw_payload === 'object'
      ? (lead.raw_payload as Record<string, unknown>)
      : null;
  const org = String(payload?.organization_name ?? payload?.organizationName ?? '').trim();
  if (org) return org;
  if (lead.name?.trim()) return lead.name.trim();
  if (lead.phone?.trim()) return lead.phone.trim();
  return `Лид #${lead.id}`;
}

function buildStaffLeadsStats(leads: Lead[]) {
  const byStatus: Record<string, number> = {};
  for (const s of Object.keys(LEAD_STATUS_LABEL)) byStatus[s] = 0;

  let openCount = 0;
  let overdueCount = 0;
  let openVolumeM3 = 0;
  let totalVolumeM3 = 0;

  for (const lead of leads) {
    const st = lead.status as LeadStatus;
    byStatus[st] = (byStatus[st] || 0) + 1;
    const vol =
      lead.volume_m3 != null && Number.isFinite(Number(lead.volume_m3))
        ? Number(lead.volume_m3)
        : 0;
    totalVolumeM3 += vol;

    const isOpen = OPEN_LEAD_STATUSES.has(st);
    const dates = getLeadDateHints(lead);

    if (isOpen) {
      openCount += 1;
      openVolumeM3 += vol;
      if (dates.deliveryOverdue) overdueCount += 1;
    }
  }

  return {
    byStatus,
    openCount,
    overdueCount,
    openVolumeM3: Math.round(openVolumeM3 * 10) / 10,
    totalVolumeM3: Math.round(totalVolumeM3 * 10) / 10,
    total: leads.length,
  };
}

type StaffLeadRow = {
  id: number;
  status: LeadStatus;
  status_label: string;
  source: string;
  source_label: string;
  title: string;
  phone: string | null;
  volume_m3: number | null;
  nmck: number | null;
  /** Окончание подачи заявок (ЕИС) — не для просрочки работы. */
  submission_deadline: string | null;
  /** Дата поставки, если известна. */
  delivery_date: string | null;
  overdue: boolean;
  role: 'assignee' | 'co_assignee' | 'creator';
  created_at: string;
};

async function fetchLeadsForStaff(
  supabase: ReturnType<typeof getSupabaseClient>,
  staffId: number,
): Promise<{
  leads_total: number;
  leads_open: number;
  leads_overdue: number;
  leads_volume_m3: number;
  leads_volume_all_m3: number;
  leads_by_status: Record<string, number>;
  leads: StaffLeadRow[];
}> {
  const select =
    'id, status, source, name, phone, volume_m3, desired_date, assigned_to, raw_payload, created_at, updated_at';

  const [asAssigneeRes, asCreatorRes] = await Promise.all([
    supabase
      .from('leads')
      .select(select)
      .or(`assigned_to.eq.${staffId},raw_payload->co_assignees.cs.[${staffId}]`)
      .order('updated_at', { ascending: false })
      .limit(300),
    supabase
      .from('leads')
      .select(select)
      .filter('raw_payload->>created_by', 'eq', String(staffId))
      .order('updated_at', { ascending: false })
      .limit(300),
  ]);

  if (asAssigneeRes.error) {
    console.error('[staff/stats] leads assignee query', asAssigneeRes.error);
  }
  if (asCreatorRes.error) {
    console.error('[staff/stats] leads creator query', asCreatorRes.error);
  }

  const map = new Map<number, Lead>();
  for (const row of [...(asAssigneeRes.data || []), ...(asCreatorRes.data || [])]) {
    map.set((row as Lead).id, row as Lead);
  }

  // Страховка: оставляем только реально связанные с сотрудником
  const leads = Array.from(map.values()).filter((l) => {
    if (isLeadAssignee(l, staffId)) return true;
    const payload =
      l.raw_payload && typeof l.raw_payload === 'object' ? l.raw_payload : null;
    const createdBy = Number(payload?.created_by);
    return Number.isFinite(createdBy) && createdBy === staffId;
  });

  const stats = buildStaffLeadsStats(leads);

  const openList = leads
    .filter((l) => OPEN_LEAD_STATUSES.has(l.status as LeadStatus))
    .map((lead) => {
      const payload =
        lead.raw_payload && typeof lead.raw_payload === 'object'
          ? (lead.raw_payload as Record<string, unknown>)
          : null;
      const dates = getLeadDateHints(lead);

      let role: 'assignee' | 'co_assignee' | 'creator' = 'creator';
      if (lead.assigned_to != null && Number(lead.assigned_to) === staffId) {
        role = 'assignee';
      } else if (isLeadAssignee(lead, staffId)) {
        role = 'co_assignee';
      } else {
        role = 'creator';
      }

      const vol =
        lead.volume_m3 != null && Number.isFinite(Number(lead.volume_m3))
          ? Number(lead.volume_m3)
          : null;

      return {
        id: lead.id,
        status: lead.status as LeadStatus,
        status_label: LEAD_STATUS_LABEL[lead.status as LeadStatus] || lead.status,
        source: String(lead.source || ''),
        source_label: LEAD_SOURCE_LABEL[lead.source] || String(lead.source || '—'),
        title: leadDisplayTitle(lead),
        phone: lead.phone,
        volume_m3: vol,
        submission_deadline: dates.submissionDeadline,
        delivery_date: dates.deliveryDate,
        overdue: dates.deliveryOverdue,
        role,
        created_at: lead.created_at,
        nmck:
          payload?.nmck != null && Number.isFinite(Number(payload.nmck))
            ? Number(payload.nmck)
            : null,
      };
    })
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const da = a.delivery_date || a.submission_deadline || '9999-99-99';
      const db = b.delivery_date || b.submission_deadline || '9999-99-99';
      if (da !== db) return da.localeCompare(db);
      return b.id - a.id;
    });

  return {
    leads_total: stats.total,
    leads_open: stats.openCount,
    leads_overdue: stats.overdueCount,
    leads_volume_m3: stats.openVolumeM3,
    leads_volume_all_m3: stats.totalVolumeM3,
    leads_by_status: stats.byStatus,
    leads: openList,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staffId');

    console.log("📥 Запрос staff stats, staffId =", staffId);

    if (staffId) {
      console.log(`[API] Запрос для staffId: ${staffId}`);

      const { data: staff } = await supabase
        .from('users')
        .select('user_id, full_name, phone, role, can_process_tenders')
        .eq('user_id', staffId)
        .single();

      if (!staff) return NextResponse.json({ error: 'Не найден' }, { status: 404 });

      const { data: clientsRaw } = await supabase
        .from('users')
        .select('user_id, full_name, organization_name, phone, created_at')
        .eq('curator_id', staffId)
        .eq('role', 'client')
        .order('organization_name', { ascending: true })
        .order('user_id');

      console.log(`[API] Найдено записей: ${clientsRaw?.length || 0}`);

      const clientMap = new Map();

      let newClients30d = 0;

      if (clientsRaw && clientsRaw.length > 0) {
        const clientIds = [...new Set(clientsRaw.map((c: any) => c.user_id))];

        const { data: orders } = await supabase
          .from('orders')
          .select('user_id, volume, created_at')
          .in('user_id', clientIds);

        const volumeMap = new Map();
        const orderCountMap = new Map();

        orders?.forEach((o: any) => {
          const uid = o.user_id;
          const currentVol = volumeMap.get(uid) || 0;
          volumeMap.set(uid, currentVol + parseFloat(o.volume || 0));

          const currentCount = orderCountMap.get(uid) || 0;
          orderCountMap.set(uid, currentCount + 1);
        });

        // Новые клиенты за 30 дней
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        clientsRaw.forEach((c: any) => {
          const createdAt = new Date(c.created_at);
          if (createdAt >= thirtyDaysAgo) newClients30d++;

          const key = `${c.organization_name || c.full_name}-${c.phone}`;
          if (!clientMap.has(key)) {
            const orderCount = orderCountMap.get(c.user_id) || 0;
            clientMap.set(key, {
              ...c,
              total_volume: Math.round(volumeMap.get(c.user_id) || 0),
              order_count: orderCount
            });
          }
        });
      }

      const finalClients = Array.from(clientMap.values());

      // Расчёт повторных заказов
      let totalOrders = 0;
      let repeatOrders = 0;

      finalClients.forEach(client => {
        const orders = client.order_count || 0;
        totalOrders += orders;
        if (orders > 1) repeatOrders += (orders - 1);
      });

      const repeatPercent = totalOrders > 0 
        ? Math.round((repeatOrders / totalOrders) * 100) 
        : 0;

      console.log(`[API] Финальных уникальных клиентов: ${finalClients.length}`);

      const leadsPayload = await fetchLeadsForStaff(supabase, Number(staffId));

      return NextResponse.json({
        ...staff,
        clients_count: finalClients.length,
        total_volume: finalClients.reduce((sum, c) => sum + (c.total_volume || 0), 0),
        clients: finalClients,
        
        // Динамические метрики
        new_clients_30d: newClients30d,
        repeat_order_percent: repeatPercent,
        attracted_clients: finalClients.length,

        // Лиды (исполнитель / соисполнитель / создатель)
        ...leadsPayload,
      });
    }

    // === СПИСОК ВСЕХ СОТРУДНИКОВ ===
    const { data: staffList } = await supabase
      .from('users')
      .select('user_id, full_name, phone, role, can_process_tenders')
      .in('role', ['admin', 'manager', 'dispatcher', 'operator', 'laborant', 'mehanik', 'guest'])
      .order('full_name', { ascending: true });

    if (!staffList) return NextResponse.json([]);

    const enrichedStaff = await Promise.all(
      staffList.map(async (staff: any) => {
        const { data: clientsRaw } = await supabase
          .from('users')
          .select('user_id')
          .eq('curator_id', staff.user_id)
          .eq('role', 'client');

        const clientIds = clientsRaw?.map((c: any) => c.user_id) || [];
        let totalVolume = 0;
        if (clientIds.length > 0) {
          const { data: orders } = await supabase
            .from('orders')
            .select('volume')
            .in('user_id', clientIds);
          totalVolume = orders?.reduce((sum: number, o: any) => sum + parseFloat(o.volume || 0), 0) || 0;
        }

        return {
          user_id: staff.user_id,
          full_name: staff.full_name || 'Без имени',
          phone: staff.phone,
          role: staff.role,
          can_process_tenders: staff.can_process_tenders === true,
          clients_count: clientsRaw?.length || 0,
          total_volume: Math.round(totalVolume)
        };
      })
    );

    

    return NextResponse.json(enrichedStaff);

  } catch (error: any) {
    console.error('Staff stats error:', error);
    return NextResponse.json([], { status: 500 });
  }
}