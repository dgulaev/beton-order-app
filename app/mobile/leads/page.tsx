'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ChevronRight, ExternalLink, Phone, Plus, Radar, RefreshCw, X } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { canActOnAssignedLeadWork, parseIdList } from '@/lib/leadAssigneeIds';
import { formatPhoneInput } from '@/lib/phone';
import {
  canManagerRejectOrSpamLead,
  formatLeadDateRu,
  getLeadDateHints,
  isLeadWorkOpenToAll,
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
  leadToOrderInitialData,
  type Lead,
  type LeadStatus,
} from '@/lib/leads';
import { useRealtimeLeads } from '@/hooks/useRealtimeLeads';
import { shouldDeferWakeNetworkWork, useWakeRefresh } from '@/hooks/useWakeReload';
import {
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '@/app/adminCifra/cardStyles';
import { appConfirm } from '@/app/adminCifra/components/appDialog';
import ProcessLeadModal from '@/app/adminCifra/leads/ProcessLeadModal';
import MobileNewOrderModal from '../components/MobileNewOrderModal';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { useUserRole } from '../../providers/UserRoleProvider';

const MOBILE_STATUS_FILTERS: Array<LeadStatus | ''> = [
  '',
  'new',
  'in_progress',
  'converted',
  'fulfilled',
  'rejected',
  'spam',
];

type LeadShipmentsInfo = {
  plan_m3: number | null;
  ordered_m3: number;
  shipped_m3: number;
  remaining_m3: number | null;
  percent: number | null;
  orders: Array<{ order_id: number; shipped_m3: number; volume: number | null }>;
};

type Employee = {
  user_id: number;
  full_name: string | null;
  organization_name: string | null;
  role: string;
};

function empLabel(emp: Employee): string {
  return (
    (emp.organization_name && emp.organization_name.trim()) ||
    emp.full_name ||
    `Сотрудник #${emp.user_id}`
  );
}

const selectStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#E2E8F0',
  fontSize: 13,
};

/** Основная кнопка в сетке 2 колонки — не сжимается до каши. */
const btnPrimary: CSSProperties = {
  width: '100%',
  minWidth: 0,
  padding: '11px 10px',
  borderRadius: 10,
  fontWeight: 700,
  fontSize: 13,
  lineHeight: 1.2,
  textAlign: 'center',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  textDecoration: 'none',
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** Вторичные действия — чипы в ряд с переносом. */
const btnChip: CSSProperties = {
  flex: '0 0 auto',
  padding: '8px 11px',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1.2,
  textAlign: 'center',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  textDecoration: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  background: 'transparent',
  border: '1px solid #334155',
  color: '#CBD5E1',
};

const btnAmber: CSSProperties = { ...btnPrimary, background: '#CA8A04', color: '#1F2937' };
const btnProcess: CSSProperties = {
  ...btnPrimary,
  background: 'linear-gradient(135deg, #B45309, #D97706)',
  color: '#FFF7ED',
};
const btnBlue: CSSProperties = { ...btnPrimary, background: '#2563EB', color: '#fff' };
const btnDangerChip: CSSProperties = {
  ...btnChip,
  border: '1px solid #7F1D1D',
  color: '#FCA5A5',
};
const btnGhostChip: CSSProperties = { ...btnChip };

const EMPTY_FORM = {
  name: '',
  phone: '+7',
  grade: 'М300',
  volume_m3: '',
  address: '',
  city: 'Брянск',
  raw_text: '',
};

export default function MobileLeadsPage() {
  const { user, isAdmin: isAdminRole } = useUserRole();
  const userRole = user?.role;
  const userName = user?.full_name;
  const isAdmin = isAdminRole || (userRole || '').toLowerCase() === 'admin';
  const allowTenderProcess = canProcessTenders(user);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [initialData, setInitialData] = useState<any>(null);
  const [activeLeadId, setActiveLeadId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [processLead, setProcessLead] = useState<Lead | null>(null);
  const [detailLeadId, setDetailLeadId] = useState<number | null>(null);
  const [sendingWorkId, setSendingWorkId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('new');
  const [mineOnly, setMineOnly] = useState(() => !allowTenderProcess && !isAdmin);
  const [shipmentsByLead, setShipmentsByLead] = useState<Record<number, LeadShipmentsInfo>>({});
  const loadSeqRef = useRef(0);

  const detailLead = useMemo(
    () =>
      detailLeadId != null ? leads.find((l) => l.id === detailLeadId) ?? null : null,
    [detailLeadId, leads],
  );

  useEffect(() => {
    if (detailLeadId != null && !detailLead) setDetailLeadId(null);
  }, [detailLeadId, detailLead]);

  useEffect(() => {
    const raw = localStorage.getItem('userId');
    const id = raw ? Number(raw) : NaN;
    setCurrentUserId(Number.isFinite(id) && id > 0 ? id : null);
  }, []);

  useEffect(() => {
    if (!allowTenderProcess) return;
    void (async () => {
      try {
        const res = await fetchWithTimeout('/api/adminCifra/employees', {
          headers: adminCifraAuthHeaders(),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success) setEmployees(json.employees || []);
      } catch {
        /* ignore */
      }
    })();
  }, [allowTenderProcess]);

  const loadShipments = useCallback(async (leadList: Lead[]) => {
    const ids = leadList
      .filter((l) => l.status === 'converted' || l.status === 'fulfilled' || l.order_id != null)
      .map((l) => l.id);
    if (ids.length === 0) {
      setShipmentsByLead({});
      return;
    }
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetchWithTimeout(`/api/adminCifra/leads/${id}/shipments`, {
            headers: adminCifraAuthHeaders(),
          });
          const json = await res.json();
          if (!res.ok || !json.success) return null;
          return [
            id,
            {
              plan_m3: json.plan_m3 ?? null,
              ordered_m3: json.ordered_m3 ?? 0,
              shipped_m3: json.shipped_m3 ?? 0,
              remaining_m3: json.remaining_m3 ?? null,
              percent: json.percent ?? null,
              orders: json.orders || [],
            } as LeadShipmentsInfo,
          ] as const;
        } catch {
          return null;
        }
      }),
    );
    const map: Record<number, LeadShipmentsInfo> = {};
    for (const row of entries) {
      if (row) map[row[0]] = row[1];
    }
    setShipmentsByLead(map);
  }, []);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const seq = ++loadSeqRef.current;
    if (!opts?.quiet) setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: mineOnly ? '300' : '100' });
      if (statusFilter) qs.set('status', statusFilter);
      if (mineOnly) qs.set('mine', '1');
      const res = await fetchWithTimeout(`/api/adminCifra/leads?${qs}`, {
        headers: adminCifraAuthHeaders(),
        cache: 'no-store',
      });
      const json = await res.json();
      if (seq !== loadSeqRef.current) return;
      if (json.success) {
        const list = (json.leads || []) as Lead[];
        setLeads(list);
        void loadShipments(list);
      }
    } finally {
      if (seq === loadSeqRef.current && !opts?.quiet) setLoading(false);
    }
  }, [statusFilter, mineOnly, loadShipments]);

  useEffect(() => {
    void load();
  }, [load]);

  // После простоя догоняем список (сокет поднимает layout; missed events не восстанавливаются).
  useWakeRefresh(() => {
    if (shouldDeferWakeNetworkWork()) return;
    void load({ quiet: true });
  });

  const statusFilterArr = useMemo(
    () => (statusFilter ? [statusFilter as LeadStatus] : undefined),
    [statusFilter],
  );

  useRealtimeLeads(setLeads, {
    enabled: true,
    statusFilter: statusFilterArr,
    mineOnly,
    currentUserId,
  });

  const patchStatus = async (
    id: number,
    status: LeadStatus,
    opts?: { keepInList?: boolean },
  ) => {
    const res = await fetch(`/api/adminCifra/leads/${id}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      alert(json.error || 'Не удалось обновить статус');
      return false;
    }
    if (statusFilter && status !== statusFilter && !opts?.keepInList) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
    } else {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    }
    return true;
  };

  const deleteLead = async (lead: Lead) => {
    if (!allowTenderProcess) return;
    const ok = await appConfirm(
      [
        `Удалить лид #${lead.id} безвозвратно?`,
        '',
        'Удалится лид, история и контракты.',
        'Заявки останутся — ссылка на лид снимется.',
      ].join('\n'),
      { title: 'Удаление лида', okLabel: 'Удалить', cancelLabel: 'Отмена', variant: 'danger' },
    );
    if (!ok) return;

    const res = await fetch(`/api/adminCifra/leads/${lead.id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      alert(json.error || 'Не удалось удалить лид');
      return;
    }

    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
    if (activeLeadId === lead.id) setActiveLeadId(null);
    if (processLead?.id === lead.id) setProcessLead(null);
    if (detailLeadId === lead.id) setDetailLeadId(null);
  };

  const openConvert = async (lead: Lead) => {
    setActiveLeadId(lead.id);
    let working = lead;
    if (lead.status === 'new') {
      const ok = await patchStatus(lead.id, 'in_progress', { keepInList: true });
      if (!ok) {
        setActiveLeadId(null);
        return;
      }
      working = { ...lead, status: 'in_progress' };
    }
    let remaining: number | null = null;
    if (working.status === 'converted' || working.order_id != null) {
      try {
        const res = await fetchWithTimeout(`/api/adminCifra/leads/${working.id}/shipments`, {
          headers: adminCifraAuthHeaders(),
        });
        const json = await res.json();
        if (res.ok && json.success && json.plan_m3 != null) {
          remaining =
            json.remaining_m3 != null
              ? Math.max(0, Number(json.remaining_m3))
              : Math.max(0, Number(json.plan_m3) - Number(json.ordered_m3 ?? json.shipped_m3 ?? 0));
        }
      } catch {
        /* ignore */
      }
    }
    setInitialData(leadToOrderInitialData(working, { remainingVolumeM3: remaining }));
    setShowModal(true);
  };

  const assignLead = async (
    leadId: number,
    patch: { assigned_to?: string | null; co_assignees?: number[] },
  ) => {
    const body: Record<string, unknown> = {};
    if (patch.assigned_to !== undefined) body.assigned_to = patch.assigned_to || null;
    if (patch.co_assignees !== undefined) body.co_assignees = patch.co_assignees;
    const res = await fetch(`/api/adminCifra/leads/${leadId}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      alert(json.error || 'Не удалось обновить назначение');
      return;
    }
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, ...json.lead } : l)),
    );
  };

  /** Админ / Екатерина: задание назначенным, без самоназначения. */
  const sendLeadToWork = async (lead: Lead) => {
    if (sendingWorkId != null) return;
    setSendingWorkId(lead.id);
    try {
      const res = await fetch(`/api/adminCifra/leads/${lead.id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ send_to_work: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось отправить в работу');
        return;
      }
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, ...json.lead } : l)),
      );
      if (json.already) {
        alert('Задание уже отправлялось недавно');
      } else {
        alert('Задание отправлено назначенным исполнителям');
      }
    } finally {
      setSendingWorkId(null);
    }
  };

  const submitCreate = async () => {
    const name = createForm.name.trim();
    const phone = createForm.phone.trim();
    const rawText = createForm.raw_text.trim();
    if (!name && !phone && !rawText) {
      alert('Укажите имя, телефон или текст обращения');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/adminCifra/leads', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: name || null,
          phone: phone && phone !== '+7' ? phone : null,
          grade: createForm.grade.trim() || null,
          volume_m3: createForm.volume_m3 ? Number(createForm.volume_m3) : null,
          address: createForm.address.trim() || null,
          city: createForm.city.trim() || null,
          raw_text: rawText || [name, phone].filter(Boolean).join(', '),
          source: 'manual',
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || 'Не удалось создать лид');
        return;
      }
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      void load();
    } catch {
      alert('Ошибка соединения с сервером');
    } finally {
      setCreating(false);
    }
  };

  const buildLeadActions = (lead: Lead) => {
    const payload =
      lead.raw_payload && typeof lead.raw_payload === 'object'
        ? (lead.raw_payload as Record<string, unknown>)
        : null;
    const etpUrl = String(payload?.etp_url ?? lead.chat_url ?? '').trim();
    const docsUrl = String(payload?.docs_url ?? '').trim();
    const tenderLike = !isLeadWorkOpenToAll(lead.source);
    const canWork =
      allowTenderProcess || canActOnAssignedLeadWork(lead, currentUserId);
    const canReject =
      allowTenderProcess || canManagerRejectOrSpamLead(lead.source);
    const canCreateOrder =
      canWork &&
      lead.status !== 'spam' &&
      lead.status !== 'rejected' &&
      lead.status !== 'fulfilled';
    const canMarkFulfilled =
      canWork &&
      (lead.status === 'converted' ||
        (lead.status === 'in_progress' && lead.order_id != null));

    const primaryActions: ReactNode[] = [];
    const secondaryActions: ReactNode[] = [];

    if (allowTenderProcess && lead.status !== 'fulfilled') {
      primaryActions.push(
        <button
          key="process"
          type="button"
          onClick={() => setProcessLead(lead)}
          style={btnProcess}
        >
          Обработать
        </button>,
      );
    }
    if (allowTenderProcess && tenderLike && lead.status === 'new') {
      primaryActions.push(
        <button
          key="send"
          type="button"
          disabled={sendingWorkId === lead.id}
          onClick={() => void sendLeadToWork(lead)}
          style={{
            ...btnAmber,
            opacity: sendingWorkId === lead.id ? 0.7 : 1,
          }}
        >
          {sendingWorkId === lead.id ? '…' : 'В работу'}
        </button>,
      );
    }
    if (
      lead.status === 'new' &&
      !(allowTenderProcess && tenderLike) &&
      canWork
    ) {
      primaryActions.push(
        <button
          key="take"
          type="button"
          onClick={() => void patchStatus(lead.id, 'in_progress')}
          style={btnAmber}
        >
          В работу
        </button>,
      );
    }
    if (canCreateOrder) {
      primaryActions.push(
        <button
          key="order"
          type="button"
          onClick={() => void openConvert(lead)}
          style={btnBlue}
        >
          {lead.status === 'converted' || lead.order_id != null
            ? 'Ещё заявка'
            : 'Создать заказ'}
        </button>,
      );
    }
    if (canMarkFulfilled) {
      primaryActions.push(
        <button
          key="done"
          type="button"
          onClick={() => void patchStatus(lead.id, 'fulfilled')}
          style={{ ...btnPrimary, background: '#16A34A', color: '#fff' }}
        >
          Исполнен
        </button>,
      );
    }
    if (allowTenderProcess && (lead.status === 'rejected' || lead.status === 'spam')) {
      primaryActions.push(
        <button
          key="to-new"
          type="button"
          onClick={() => void patchStatus(lead.id, 'new')}
          style={{
            ...btnPrimary,
            background: 'rgba(234,179,8,0.25)',
            color: '#FEF08A',
            border: '1px solid #FACC15',
          }}
        >
          В новые
        </button>,
      );
      primaryActions.push(
        <button
          key="to-work"
          type="button"
          onClick={() => void patchStatus(lead.id, 'in_progress')}
          style={{
            ...btnPrimary,
            background: 'rgba(37,99,235,0.25)',
            color: '#BFDBFE',
            border: '1px solid #3B82F6',
          }}
        >
          В работу
        </button>,
      );
    }
    if (allowTenderProcess && lead.status === 'fulfilled') {
      primaryActions.push(
        <button
          key="to-ship"
          type="button"
          onClick={() => void patchStatus(lead.id, 'converted')}
          style={{
            ...btnPrimary,
            background: 'rgba(37,99,235,0.25)',
            color: '#BFDBFE',
            border: '1px solid #3B82F6',
          }}
        >
          В отгрузку
        </button>,
      );
    }

    if (etpUrl || lead.chat_url) {
      secondaryActions.push(
        <a
          key="etp"
          href={etpUrl || lead.chat_url || '#'}
          target="_blank"
          rel="noreferrer"
          style={btnGhostChip}
        >
          <ExternalLink size={12} /> ЭТП
        </a>,
      );
    }
    if (docsUrl) {
      secondaryActions.push(
        <a key="docs" href={docsUrl} target="_blank" rel="noreferrer" style={btnGhostChip}>
          Документы
        </a>,
      );
    }
    if (
      canReject &&
      lead.status !== 'rejected' &&
      lead.status !== 'converted' &&
      lead.status !== 'fulfilled' &&
      lead.status !== 'spam'
    ) {
      secondaryActions.push(
        <button
          key="reject"
          type="button"
          onClick={() => void patchStatus(lead.id, 'rejected')}
          style={btnDangerChip}
        >
          Отказ
        </button>,
      );
    }
    if (
      canReject &&
      lead.status !== 'spam' &&
      lead.status !== 'converted' &&
      lead.status !== 'fulfilled'
    ) {
      secondaryActions.push(
        <button
          key="spam"
          type="button"
          onClick={() => void patchStatus(lead.id, 'spam')}
          style={btnGhostChip}
        >
          Спам
        </button>,
      );
    }
    if (allowTenderProcess) {
      secondaryActions.push(
        <button
          key="del"
          type="button"
          onClick={() => void deleteLead(lead)}
          style={btnDangerChip}
        >
          Удалить
        </button>,
      );
    }

    return { primaryActions, secondaryActions };
  };

  return (
    <div style={{ padding: '16px 14px 100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 }}>
        <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 22 }}>Лиды</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            onClick={() => {
              setCreateForm(EMPTY_FORM);
              setShowCreate(true);
            }}
            style={{ background: 'none', border: 'none', color: '#60A5FA', padding: 8 }}
            aria-label="Создать лид"
          >
            <Plus size={22} />
          </button>
          <Link
            href="/mobile/demand"
            style={{ color: '#6EE7B7', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, textDecoration: 'none', padding: 8 }}
          >
            <Radar size={18} /> Спрос
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            style={{ background: 'none', border: 'none', color: '#93C5FD', padding: 8 }}
            aria-label="Обновить"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {MOBILE_STATUS_FILTERS.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              fontSize: 12,
              color: '#E2E8F0',
              border: statusFilter === s ? '1px solid #60A5FA' : '1px solid #334155',
              background: statusFilter === s ? '#1E3A5F' : '#0F172A',
            }}
          >
            {s ? LEAD_STATUS_LABEL[s] : 'Все'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMineOnly((v) => !v)}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            fontSize: 12,
            border: mineOnly ? '1px solid #FACC15' : '1px solid #334155',
            background: mineOnly ? 'rgba(234, 179, 8, 0.2)' : '#0F172A',
            color: mineOnly ? '#FEF08A' : '#E2E8F0',
          }}
        >
          Мои
        </button>
      </div>

      {loading && <p style={{ color: '#94A3B8' }}>Загрузка…</p>}
      {!loading && leads.length === 0 && (
        <div style={volumeCardSoftStyle({ padding: 18, color: '#94A3B8' })}>
          Лидов нет. Можно создать вручную кнопкой «+».
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {leads.map((lead) => {
          const payload =
            lead.raw_payload && typeof lead.raw_payload === 'object'
              ? (lead.raw_payload as Record<string, unknown>)
              : null;
          const assigneeName = String(payload?.assigned_to_name ?? '').trim();
          const dateHints = getLeadDateHints(lead);
          const shipments = shipmentsByLead[lead.id];
          const preview = (lead.raw_text || '—').replace(/\s+/g, ' ').trim();

          return (
            <div
              key={lead.id}
              role="button"
              tabIndex={0}
              onClick={() => setDetailLeadId(lead.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDetailLeadId(lead.id);
                }
              }}
              style={volumeCardSoftStyle({
                padding: '10px 12px',
                overflow: 'hidden',
                minWidth: 0,
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                border: '1px solid #1E293B',
              })}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: '#F8FAFC',
                    fontWeight: 700,
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: '1 1 auto',
                    minWidth: 0,
                  }}
                >
                  #{lead.id} · {LEAD_SOURCE_LABEL[lead.source] || lead.source}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#93C5FD',
                    background: '#1E3A5F',
                    padding: '2px 7px',
                    borderRadius: 7,
                    flexShrink: 0,
                  }}
                >
                  {LEAD_STATUS_LABEL[lead.status] || lead.status}
                </span>
                <ChevronRight size={16} color="#64748B" style={{ flexShrink: 0 }} />
              </div>

              <div
                style={{
                  color: '#94A3B8',
                  fontSize: 12,
                  lineHeight: 1.35,
                  marginBottom: 6,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {preview}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '4px 10px',
                  flexWrap: 'wrap',
                  fontSize: 12,
                  color: '#64748B',
                  alignItems: 'center',
                }}
              >
                {lead.name && (
                  <span
                    style={{
                      color: '#E2E8F0',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                    }}
                  >
                    {lead.name}
                  </span>
                )}
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      color: '#93C5FD',
                      display: 'inline-flex',
                      gap: 3,
                      alignItems: 'center',
                      textDecoration: 'none',
                    }}
                  >
                    <Phone size={12} /> {lead.phone}
                  </a>
                )}
                {lead.volume_m3 != null && <span>{lead.volume_m3} м³</span>}
                {dateHints.deliveryDate && (
                  <span
                    style={{
                      color: dateHints.deliveryOverdue ? '#FCA5A5' : '#FDE68A',
                      fontWeight: dateHints.deliveryOverdue ? 700 : 500,
                    }}
                  >
                    {formatLeadDateRu(dateHints.deliveryDate)}
                    {dateHints.deliveryOverdue ? ' · просрочена' : ''}
                  </span>
                )}
                {shipments?.percent != null && (
                  <span style={{ color: '#86EFAC' }}>отгр. {shipments.percent}%</span>
                )}
                {!lead.name && !assigneeName && lead.assigned_to && (
                  <span style={{ color: '#FDE68A' }}>#{lead.assigned_to}</span>
                )}
                {(assigneeName || (!lead.assigned_to && allowTenderProcess)) && (
                  <span style={{ color: '#FDE68A' }}>
                    {assigneeName || 'не назначен'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {detailLead && (() => {
        const lead = detailLead;
        const payload =
          lead.raw_payload && typeof lead.raw_payload === 'object'
            ? (lead.raw_payload as Record<string, unknown>)
            : null;
        const coIds = parseIdList(payload?.co_assignees).filter(
          (id) => id !== lead.assigned_to,
        );
        const dateHints = getLeadDateHints(lead);
        const shipments = shipmentsByLead[lead.id];
        const { primaryActions, secondaryActions } = buildLeadActions(lead);
        const assigneeName = String(payload?.assigned_to_name ?? '').trim();
        const coNames = Array.isArray(payload?.co_assignee_names)
          ? (payload.co_assignee_names as unknown[])
              .map((n) => String(n || '').trim())
              .filter(Boolean)
          : [];
        const takenBy = String(payload?.taken_by_name ?? '').trim();
        const takenAtRaw = String(payload?.taken_at ?? '').trim();
        const takenAt = takenAtRaw
          ? new Date(takenAtRaw).toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';

        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.78)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
            onClick={() => setDetailLeadId(null)}
          >
            <div
              style={volumeModalStyle({
                width: '100%',
                maxHeight: '88dvh',
                overflow: 'auto',
                padding: '12px 14px 20px',
                borderRadius: '16px 16px 0 0',
                color: '#E2E8F0',
                WebkitOverflowScrolling: 'touch',
              })}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 999,
                  background: '#334155',
                  margin: '0 auto 12px',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        color: '#F8FAFC',
                        fontWeight: 700,
                        fontSize: 16,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%',
                      }}
                    >
                      #{lead.id} · {LEAD_SOURCE_LABEL[lead.source] || lead.source}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#93C5FD',
                        background: '#1E3A5F',
                        padding: '3px 8px',
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    >
                      {LEAD_STATUS_LABEL[lead.status] || lead.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    {new Date(lead.created_at).toLocaleString('ru-RU')}
                  </div>
                </div>
                <button
                  type="button"
                  style={modalCloseButtonStyle()}
                  onClick={() => setDetailLeadId(null)}
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>

              <div
                style={{
                  color: '#CBD5E1',
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  marginBottom: 12,
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  maxHeight: '32dvh',
                  overflowY: 'auto',
                  lineHeight: 1.4,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(15, 23, 42, 0.45)',
                  border: '1px solid #1E293B',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {lead.raw_text || '—'}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '6px 10px',
                  flexWrap: 'wrap',
                  marginBottom: 12,
                  fontSize: 13,
                  color: '#94A3B8',
                  minWidth: 0,
                }}
              >
                {lead.name && (
                  <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{lead.name}</span>
                )}
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone}`}
                    style={{
                      color: '#93C5FD',
                      display: 'inline-flex',
                      gap: 4,
                      alignItems: 'center',
                    }}
                  >
                    <Phone size={14} /> {lead.phone}
                  </a>
                )}
                {lead.grade && <span>{lead.grade}</span>}
                {lead.volume_m3 != null && <span>{lead.volume_m3} м³</span>}
                {lead.city && <span>{lead.city}</span>}
                {dateHints.submissionDeadline && (
                  <span>
                    Подача до: {formatLeadDateRu(dateHints.submissionDeadline)}
                  </span>
                )}
                {dateHints.deliveryDate && (
                  <span
                    style={{
                      color: dateHints.deliveryOverdue ? '#FCA5A5' : '#FDE68A',
                      fontWeight: dateHints.deliveryOverdue ? 700 : 500,
                    }}
                  >
                    Поставка: {formatLeadDateRu(dateHints.deliveryDate)}
                    {dateHints.deliveryOverdue ? ' · просрочена' : ''}
                  </span>
                )}
              </div>

              {shipments && (shipments.orders.length > 0 || shipments.plan_m3 != null) && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 10,
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid #334155',
                    fontSize: 12,
                    color: '#CBD5E1',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                      gap: 8,
                    }}
                  >
                    <span>
                      Отгрузка: {shipments.shipped_m3}
                      {shipments.plan_m3 != null ? ` / ${shipments.plan_m3}` : ''} м³
                      {shipments.plan_m3 != null
                        ? ` · в заявках ${shipments.ordered_m3 ?? 0}`
                        : ''}
                      {shipments.remaining_m3 != null
                        ? ` · остаток ${shipments.remaining_m3}`
                        : ''}
                    </span>
                    {shipments.percent != null && (
                      <span style={{ color: '#86EFAC' }}>{shipments.percent}%</span>
                    )}
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: '#1E293B',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, shipments.percent ?? 0)}%`,
                        background:
                          (shipments.percent ?? 0) >= 100 ? '#22C55E' : '#2563EB',
                      }}
                    />
                  </div>
                  {shipments.orders.length > 0 && (
                    <div style={{ marginTop: 6, color: '#94A3B8' }}>
                      {shipments.orders.map((o) => (
                        <Link
                          key={o.order_id}
                          href={`/adminCifra/zayavki?orderId=${o.order_id}`}
                          style={{
                            display: 'block',
                            color: '#93C5FD',
                            textDecoration: 'none',
                            fontWeight: 600,
                            padding: '2px 0',
                          }}
                        >
                          #{o.order_id}: {o.shipped_m3}
                          {o.volume != null ? ` / ${o.volume}` : ''} м³ →
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(!allowTenderProcess ||
                (lead.status !== 'new' && (takenBy || takenAt))) && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    marginBottom: 12,
                    fontSize: 12,
                    color: '#FDE68A',
                  }}
                >
                  {!allowTenderProcess && (
                    <>
                      <span>
                        Исполнитель:{' '}
                        {assigneeName ||
                          (lead.assigned_to ? `#${lead.assigned_to}` : 'не назначен')}
                      </span>
                      <span>
                        Соисполнители: {coNames.length ? coNames.join(', ') : 'нет'}
                      </span>
                    </>
                  )}
                  {lead.status !== 'new' && (takenBy || takenAt) && (
                    <span style={{ color: '#86EFAC' }}>
                      Взял в работу: {takenBy || '—'}
                      {takenAt ? ` · ${takenAt}` : ''}
                    </span>
                  )}
                </div>
              )}

              {allowTenderProcess && (
                <div
                  style={{
                    marginBottom: 14,
                    paddingTop: 12,
                    borderTop: '1px solid #1E293B',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr',
                      gap: 8,
                    }}
                  >
                    <label style={{ display: 'block', minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>
                        Исполнитель
                      </div>
                      <select
                        value={lead.assigned_to ? String(lead.assigned_to) : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          void assignLead(lead.id, {
                            assigned_to: v,
                            co_assignees: coIds.filter((id) => String(id) !== v),
                          });
                        }}
                        style={selectStyle}
                      >
                        <option value="">Не назначен</option>
                        {employees.map((emp) => (
                          <option key={emp.user_id} value={emp.user_id}>
                            {empLabel(emp)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'block', minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>
                        Соисполнители
                      </div>
                      <select
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          void assignLead(lead.id, {
                            co_assignees: Array.from(new Set([...coIds, Number(v)])),
                          });
                        }}
                        style={selectStyle}
                      >
                        <option value="">Добавить…</option>
                        {employees
                          .filter(
                            (emp) =>
                              emp.user_id !== lead.assigned_to &&
                              !coIds.includes(emp.user_id),
                          )
                          .map((emp) => (
                            <option key={emp.user_id} value={emp.user_id}>
                              {empLabel(emp)}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  {coIds.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 5,
                        marginTop: 8,
                      }}
                    >
                      {coIds.map((uid) => {
                        const emp = employees.find((e) => e.user_id === uid);
                        return (
                          <span
                            key={uid}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              color: '#E2E8F0',
                              background: '#1E293B',
                              border: '1px solid #334155',
                              borderRadius: 999,
                              padding: '3px 8px',
                            }}
                          >
                            {emp ? empLabel(emp) : `#${uid}`}
                            <button
                              type="button"
                              aria-label="Убрать"
                              onClick={() =>
                                void assignLead(lead.id, {
                                  co_assignees: coIds.filter((x) => x !== uid),
                                })
                              }
                              style={{
                                border: 'none',
                                background: 'none',
                                color: '#FCA5A5',
                                fontSize: 13,
                                padding: 0,
                                lineHeight: 1,
                              }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {primaryActions.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      primaryActions.length === 1 ? '1fr' : '1fr 1fr',
                    gap: 8,
                    marginBottom: secondaryActions.length > 0 ? 8 : 0,
                  }}
                >
                  {primaryActions}
                </div>
              )}
              {secondaryActions.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  {secondaryActions}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <ProcessLeadModal
        open={Boolean(processLead)}
        lead={processLead}
        onClose={() => setProcessLead(null)}
        onSaved={(updated) => {
          setLeads((prev) => {
            const next = prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l));
            void loadShipments(next);
            return next;
          });
          setProcessLead(null);
        }}
      />

      <MobileNewOrderModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setInitialData(null);
          setActiveLeadId(null);
        }}
        onSuccess={(_order, meta) => {
          setShowModal(false);
          if (activeLeadId && (meta?.leadConverted || meta?.leadOrderAdded) && !meta?.warning) {
            setLeads((prev) => {
              if (statusFilter && statusFilter !== 'converted' && statusFilter !== '') {
                return prev.filter((l) => l.id !== activeLeadId);
              }
              return prev.map((l) =>
                l.id === activeLeadId ? { ...l, status: 'converted' as LeadStatus } : l,
              );
            });
          }
          setActiveLeadId(null);
          void load();
        }}
        initialData={initialData}
        currentRole={userRole || undefined}
        currentUserName={userName || undefined}
      />

      {showCreate && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            style={volumeModalStyle({
              width: '100%',
              maxHeight: '78dvh',
              overflow: 'auto',
              padding: 14,
              borderRadius: '16px 16px 0 0',
              color: '#E2E8F0',
            })}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16, color: '#F8FAFC' }}>Новый лид</h2>
              <button type="button" style={modalCloseButtonStyle()} onClick={() => setShowCreate(false)} aria-label="Закрыть">
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                placeholder="Имя"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                style={modalFieldStyle({ padding: '10px 12px', fontSize: 14 })}
              />
              <input
                placeholder="Телефон"
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: formatPhoneInput(e.target.value) }))}
                style={modalFieldStyle({ padding: '10px 12px', fontSize: 14 })}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <input
                  placeholder="Марка"
                  value={createForm.grade}
                  onChange={(e) => setCreateForm((f) => ({ ...f, grade: e.target.value }))}
                  style={modalFieldStyle({ padding: '10px 12px', fontSize: 14 })}
                />
                <input
                  placeholder="Объём, м³"
                  type="number"
                  value={createForm.volume_m3}
                  onChange={(e) => setCreateForm((f) => ({ ...f, volume_m3: e.target.value }))}
                  style={modalFieldStyle({ padding: '10px 12px', fontSize: 14 })}
                />
              </div>
              <input
                placeholder="Город"
                value={createForm.city}
                onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))}
                style={modalFieldStyle({ padding: '10px 12px', fontSize: 14 })}
              />
              <input
                placeholder="Адрес"
                value={createForm.address}
                onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                style={modalFieldStyle({ padding: '10px 12px', fontSize: 14 })}
              />
              <textarea
                placeholder="Текст обращения"
                rows={2}
                value={createForm.raw_text}
                onChange={(e) => setCreateForm((f) => ({ ...f, raw_text: e.target.value }))}
                style={modalFieldStyle({ resize: 'vertical', padding: '10px 12px', fontSize: 14 })}
              />
              <button
                type="button"
                disabled={creating}
                onClick={() => void submitCreate()}
                style={{
                  marginTop: 4,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#2563EB',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {creating ? 'Создание…' : 'Создать лид'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
