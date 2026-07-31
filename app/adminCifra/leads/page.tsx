'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  FileText,
  History,
  Inbox,
  ExternalLink,
  Phone,
  Plus,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  canActOnAssignedLeadWork,
  getLeadCoAssigneeIds,
  getLeadCoAssigneeNames,
} from '@/lib/leadAssigneeIds';
import type { LeadHistoryEntry } from '@/lib/leadHistory';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import {
  LEAD_CONTRACT_ACCEPT,
  isAllowedContractFile,
} from '@/lib/leadContracts';
import {
  canManagerRejectOrSpamLead,
  formatLeadDateRu,
  getLeadDateHints,
  isLeadWorkOpenToAll,
  LEAD_SOURCE_LABEL,
  leadToOrderInitialData,
  type Lead,
  type LeadStatus,
} from '@/lib/leads';
import { useRealtimeLeads } from '@/hooks/useRealtimeLeads';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import NewOrderModal from '../components/NewOrderModal';
import PageHelpButton from '../components/help/PageHelpButton';
import ModalSelect from '../components/ModalSelect';
import { appConfirm } from '../components/appDialog';
import { useUserRole } from '../../providers/UserRoleProvider';
import CreateLeadModal from './CreateLeadModal';
import ProcessLeadModal from './ProcessLeadModal';
import styles from './leads.module.css';

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  converted: 'В отгрузке',
  fulfilled: 'Исполнен',
  rejected: 'Отказ',
  spam: 'Спам',
};

const STATUS_FILTERS = [
  'new',
  'in_progress',
  'converted',
  'fulfilled',
  'rejected',
  'spam',
] as const;

type HistoryKind = '' | 'status' | 'assign' | 'processing' | 'contract' | 'order';
type HistoryPeriod = '' | 'today' | '7d';

const HISTORY_KIND_FILTERS: Array<{ id: HistoryKind; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'status', label: 'Статусы' },
  { id: 'assign', label: 'Назначения' },
  { id: 'processing', label: 'Обработка' },
  { id: 'contract', label: 'Контракты' },
  { id: 'order', label: 'Заказы' },
];

const HISTORY_PERIOD_FILTERS: Array<{ id: HistoryPeriod; label: string }> = [
  { id: '', label: 'Всё время' },
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
];

const HISTORY_PAGE_SIZE = 40;

function historySinceIso(period: HistoryPeriod): string | null {
  if (!period) return null;
  const d = new Date();
  if (period === 'today') {
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(d.getDate() - 7);
  }
  return d.toISOString();
}

type LeadShipmentsInfo = {
  plan_m3: number | null;
  ordered_m3: number;
  shipped_m3: number;
  remaining_m3: number | null;
  percent: number | null;
  orders: Array<{
    order_id: number;
    status: string;
    grade: string | null;
    volume: number | null;
    delivery_date: string | null;
    shipped_m3: number;
  }>;
};

type Employee = {
  user_id: number;
  full_name: string | null;
  organization_name: string | null;
  role: string;
};

type ContractMeta = {
  id: number;
  lead_id: number;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploaded_by_name?: string | null;
  created_at: string;
};

function leadActorName(lead: Lead): string | null {
  const payload =
    lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : null;
  if (!payload) return null;
  const name = String(
    (payload as Record<string, unknown>).created_by_name
      ?? (payload as Record<string, unknown>).createdByName
      ?? '',
  ).trim();
  return name || null;
}

function actorLabel(lead: Lead, actor: string): string {
  if (lead.source === 'demand') return `Одобрил: ${actor}`;
  if (lead.source === 'manual' || lead.source === 'tender' || lead.source === 'site') {
    return `Создал: ${actor}`;
  }
  return `Сотрудник: ${actor}`;
}

function leadAssigneeName(lead: Lead, employees: Employee[]): string | null {
  const payload =
    lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : null;
  const fromPayload = String(
    (payload as Record<string, unknown> | null)?.assigned_to_name ?? '',
  ).trim();
  if (fromPayload) return fromPayload;
  if (!lead.assigned_to) return null;
  const emp = employees.find((e) => e.user_id === lead.assigned_to);
  if (!emp) return `Сотрудник #${lead.assigned_to}`;
  return (
    (emp.organization_name && emp.organization_name.trim())
    || emp.full_name
    || `Сотрудник #${lead.assigned_to}`
  );
}

function leadPlatform(lead: Lead): string | null {
  const payload =
    lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : null;
  if (!payload) return null;
  const p = String(
    (payload as Record<string, unknown>).platform
      ?? (payload as Record<string, unknown>).platform_name
      ?? '',
  ).trim();
  return p || null;
}

/** Подпись кнопки внешней ссылки на карточке лида. */
function leadExternalLinkLabel(lead: Lead, url: string): string {
  const u = url.toLowerCase();
  if (lead.source === 'avito' || u.includes('avito.ru')) return 'Чат Авито';
  if (lead.source === 'tender' || lead.source === 'demand' || u.includes('zakupki.gov')) {
    return 'Открыть закупку';
  }
  if (lead.source === 'site') return 'Открыть сайт';
  return 'Открыть ссылку';
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatHistoryStatus(value: string | null | undefined): string {
  if (!value) return '—';
  if (value.startsWith('converted:#')) {
    return `В отгрузке ${value.slice('converted:'.length)}`;
  }
  return STATUS_LABEL[value as LeadStatus] || value;
}

function historyEntryDetail(entry: LeadHistoryEntry): string | null {
  if (entry.field_name === 'status') {
    if (!entry.old_value && !entry.new_value) return null;
    // Создание лида: статуса «до» ещё не было — не показываем «— → Новый».
    if (!entry.old_value && entry.new_value) {
      return formatHistoryStatus(entry.new_value);
    }
    return `${formatHistoryStatus(entry.old_value)} → ${formatHistoryStatus(entry.new_value)}`;
  }
  if (entry.field_name === 'assigned_to') {
    if (!entry.old_value && entry.new_value) return entry.new_value;
    return `${entry.old_value || '—'} → ${entry.new_value || '—'}`;
  }
  if (entry.field_name === 'co_assignees') {
    if (!entry.old_value && entry.new_value) return entry.new_value;
    return `${entry.old_value || '—'} → ${entry.new_value || '—'}`;
  }
  if (entry.field_name === 'send_to_work' && entry.new_value) {
    return entry.new_value;
  }
  if (entry.field_name === 'processing' && entry.new_value) {
    return entry.new_value;
  }
  return null;
}

function groupHistoryByLead(entries: LeadHistoryEntry[]): Record<number, LeadHistoryEntry[]> {
  const map: Record<number, LeadHistoryEntry[]> = {};
  for (const entry of entries) {
    if (!map[entry.lead_id]) map[entry.lead_id] = [];
    map[entry.lead_id].push(entry);
  }
  return map;
}

const btnPrimary: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  border: 'none',
  background: '#2563EB',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
};

const btnGhost: CSSProperties = {
  padding: '7px 10px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: 'transparent',
  color: '#94A3B8',
  cursor: 'pointer',
  fontSize: 12,
};

const btnDanger: CSSProperties = {
  ...btnGhost,
  border: '1px solid #7F1D1D',
  color: '#FCA5A5',
};

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className={styles.page} style={{ color: '#94A3B8' }}>Загрузка…</div>}>
      <LeadsPageInner />
    </Suspense>
  );
}

function LeadsPageInner() {
  const { user, isAdmin: isAdminRole } = useUserRole();
  const searchParams = useSearchParams();
  const userRole = user?.role;
  const userName = user?.full_name;
  // role из API/кэша иногда в другом регистре — сравниваем мягко
  const isAdmin = isAdminRole || (userRole || '').toLowerCase() === 'admin';
  const allowTenderProcess = canProcessTenders(user);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [processLead, setProcessLead] = useState<Lead | null>(null);
  const [sendingWorkId, setSendingWorkId] = useState<number | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('userId');
    const id = raw ? Number(raw) : NaN;
    setCurrentUserId(Number.isFinite(id) && id > 0 ? id : null);
  }, []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<LeadHistoryEntry[]>([]);
  const [historyByLead, setHistoryByLead] = useState<Record<number, LeadHistoryEntry[]>>({});
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyKind, setHistoryKind] = useState<HistoryKind>('');
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('');
  const [historyMine, setHistoryMine] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [detailsOpenIds, setDetailsOpenIds] = useState<Record<number, boolean>>({});
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const initialStatus = searchParams.get('status');
  const initialSource = searchParams.get('source');
  const initialLeadIdRaw = searchParams.get('leadId');
  const initialLeadId =
    initialLeadIdRaw && Number.isFinite(Number(initialLeadIdRaw)) && Number(initialLeadIdRaw) > 0
      ? Number(initialLeadIdRaw)
      : null;
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(initialLeadId);
  const [statusFilter, setStatusFilter] = useState<string>(
    initialLeadId != null
      ? ''
      : initialStatus && (STATUS_FILTERS as readonly string[]).includes(initialStatus)
        ? initialStatus
        : 'new',
  );
  const [sourceFilter, setSourceFilter] = useState<string>(initialSource || '');
  // Менеджеры без прав торгов — сразу «Мои», без мигания чужих лидов.
  // Deep-link leadId — не сужаем фильтр заранее, иначе карточка может не попасть в выдачу.
  const [mineOnly, setMineOnly] = useState(
    () => !allowTenderProcess && !isAdmin && initialLeadId == null,
  );
  const deepLinkLeadDoneRef = useRef(false);
  const deepLinkFetchRef = useRef(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderInitial, setOrderInitial] = useState<any>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [contractsByLead, setContractsByLead] = useState<Record<number, ContractMeta[]>>({});
  const [uploadingLeadId, setUploadingLeadId] = useState<number | null>(null);
  const [shipmentsByLead, setShipmentsByLead] = useState<Record<number, LeadShipmentsInfo>>({});
  const loadSeqRef = useRef(0);

  const statusFilterArr = useMemo(
    () => (statusFilter ? [statusFilter as LeadStatus] : undefined),
    [statusFilter],
  );

  const refreshHistoryFeed = useCallback(async () => {
    try {
      const res = await fetch(`/api/adminCifra/leads/history?limit=${HISTORY_PAGE_SIZE}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) return;
      setHistoryByLead(groupHistoryByLead((json.history || []) as LeadHistoryEntry[]));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const buildHistoryQs = useCallback(
    (leadId: number | null | undefined, offset: number) => {
      const qs = new URLSearchParams({
        limit: String(HISTORY_PAGE_SIZE),
        offset: String(offset),
      });
      if (leadId) qs.set('leadId', String(leadId));
      if (historyKind) qs.set('kind', historyKind);
      const since = historySinceIso(historyPeriod);
      if (since) qs.set('since', since);
      if (historyMine) qs.set('mine', '1');
      return qs;
    },
    [historyKind, historyPeriod, historyMine],
  );

  const loadHistory = useCallback(
    async (leadId?: number | null) => {
      setHistoryLoading(true);
      try {
        const qs = buildHistoryQs(leadId, 0);
        const res = await fetch(`/api/adminCifra/leads/history?${qs}`, {
          headers: adminCifraAuthHeaders(),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          setHistory([]);
          setHistoryHasMore(false);
          return;
        }
        const list = (json.history || []) as LeadHistoryEntry[];
        setHistory(list);
        setHistoryHasMore(Boolean(json.hasMore));
        if (!leadId) {
          setHistoryByLead((prev) => ({ ...prev, ...groupHistoryByLead(list) }));
        } else {
          setHistoryByLead((prev) => ({ ...prev, [leadId]: list }));
        }
        if (historyScrollRef.current) historyScrollRef.current.scrollTop = 0;
      } catch (e) {
        console.error(e);
        setHistory([]);
        setHistoryHasMore(false);
      } finally {
        setHistoryLoading(false);
      }
    },
    [buildHistoryQs],
  );

  const loadMoreHistory = useCallback(async () => {
    if (historyLoadingMore || historyLoading || !historyHasMore) return;
    setHistoryLoadingMore(true);
    try {
      const qs = buildHistoryQs(selectedLeadId, history.length);
      const res = await fetch(`/api/adminCifra/leads/history?${qs}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) return;
      const list = (json.history || []) as LeadHistoryEntry[];
      setHistory((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const merged = [...prev];
        for (const row of list) {
          if (!seen.has(row.id)) merged.push(row);
        }
        return merged;
      });
      setHistoryHasMore(Boolean(json.hasMore));
      if (selectedLeadId) {
        setHistoryByLead((prev) => {
          const cur = prev[selectedLeadId] || [];
          const seen = new Set(cur.map((e) => e.id));
          const next = [...cur];
          for (const row of list) {
            if (!seen.has(row.id)) next.push(row);
          }
          return { ...prev, [selectedLeadId]: next };
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [
    buildHistoryQs,
    historyHasMore,
    historyLoading,
    historyLoadingMore,
    history.length,
    selectedLeadId,
  ]);

  const loadContracts = useCallback(async (leadList: Lead[]) => {
    const ids = leadList.map((l) => l.id);
    if (ids.length === 0) {
      setContractsByLead({});
      return;
    }
    try {
      const res = await fetch(`/api/adminCifra/leads/contracts?leadIds=${ids.join(',')}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) return;
      const map: Record<number, ContractMeta[]> = {};
      for (const row of (json.contracts || []) as ContractMeta[]) {
        if (!map[row.lead_id]) map[row.lead_id] = [];
        map[row.lead_id].push(row);
      }
      setContractsByLead(map);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadShipments = useCallback(async (leadList: Lead[]) => {
    const ids = leadList
      .filter(
        (l) =>
          l.status === 'converted' ||
          l.status === 'fulfilled' ||
          l.order_id != null,
      )
      .map((l) => l.id);
    if (ids.length === 0) {
      setShipmentsByLead({});
      return;
    }
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/adminCifra/leads/${id}/shipments`, {
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

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (sourceFilter) qs.set('source', sourceFilter);
      if (mineOnly) qs.set('mine', '1');
      qs.set('limit', mineOnly ? '300' : '100');
      const res = await fetch(`/api/adminCifra/leads?${qs}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (seq !== loadSeqRef.current) return;
      if (!res.ok || !json.success) {
        setLoadError(json.error || `Ошибка загрузки (${res.status})`);
        setLeads([]);
        return;
      }
      const next = (json.leads || []) as Lead[];
      setLeads(next);
      void loadContracts(next);
      void loadShipments(next);
      void refreshHistoryFeed();
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      console.error(e);
      setLoadError('Ошибка соединения с сервером');
      setLeads([]);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [statusFilter, sourceFilter, mineOnly, loadContracts, loadShipments, refreshHistoryFeed]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep-link /adminCifra/leads?leadId=N — догрузить карточку, если её нет в списке
  useEffect(() => {
    if (!initialLeadId || deepLinkLeadDoneRef.current || loading) return;

    const activate = (leadId: number) => {
      deepLinkLeadDoneRef.current = true;
      setSelectedLeadId(leadId);
      setDetailsOpenIds((d) => ({ ...d, [leadId]: true }));
      const el = document.getElementById(`lead-card-${leadId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/adminCifra/leads');
      }
    };

    if (leads.some((l) => l.id === initialLeadId)) {
      activate(initialLeadId);
      return;
    }

    if (deepLinkFetchRef.current) return;
    deepLinkFetchRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/adminCifra/leads/${initialLeadId}`, {
          headers: adminCifraAuthHeaders(),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json.success || !json.lead) {
          deepLinkLeadDoneRef.current = true;
          return;
        }
        const lead = json.lead as Lead;
        setStatusFilter('');
        setMineOnly(false);
        setLeads((prev) => (prev.some((l) => l.id === lead.id) ? prev : [lead, ...prev]));
        // Дать React отрисовать карточку, затем проскроллить
        requestAnimationFrame(() => activate(lead.id));
      } catch {
        deepLinkLeadDoneRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialLeadId, leads, loading]);

  useEffect(() => {
    void loadHistory(selectedLeadId);
  }, [loadHistory, selectedLeadId]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/adminCifra/employees', {
          headers: adminCifraAuthHeaders(),
        });
        const json = await res.json();
        setEmployees(json.employees || []);
      } catch {
        setEmployees([]);
      }
    })();
  }, []);

  useRealtimeLeads(setLeads, {
    enabled: true,
    statusFilter: statusFilterArr,
    sourceFilter: sourceFilter || undefined,
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
      alert(json.error || 'Не удалось обновить статус лида');
      return false;
    }
    if (json.clientSpamMarked) {
      alert('Клиент помечен как спам в базе');
    }

    // После отказа/спама — сразу на фильтр, где видны кнопки возврата.
    if (
      allowTenderProcess &&
      (status === 'rejected' || status === 'spam') &&
      statusFilter !== status
    ) {
      setStatusFilter(status);
      void loadHistory(selectedLeadId);
      return true;
    }
    // После возврата из отказа/спама / исполненных — на нужный фильтр.
    if (
      allowTenderProcess &&
      (status === 'new' || status === 'in_progress' || status === 'converted') &&
      (statusFilter === 'rejected' || statusFilter === 'spam' || statusFilter === 'fulfilled')
    ) {
      setStatusFilter(status);
      void loadHistory(selectedLeadId);
      return true;
    }

    setLeads((prev) => {
      if (statusFilter && status !== statusFilter && !opts?.keepInList) {
        return prev.filter((l) => l.id !== id);
      }
      return prev.map((l) => (l.id === id ? { ...l, ...json.lead, status } : l));
    });
    void loadHistory(selectedLeadId);
    return true;
  };

  const deleteLead = async (lead: Lead) => {
    if (!allowTenderProcess) return;
    const ok = await appConfirm(
      [
        `Удалить лид #${lead.id} безвозвратно?`,
        '',
        'Будет удалено:',
        '• сам лид, история и прикреплённые контракты',
        '',
        'Останется:',
        '• связанные заявки (ссылка на лид снимется)',
        '• карточки обзвона / спрос (ссылка на лид снимется)',
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
    setContractsByLead((prev) => {
      const next = { ...prev };
      delete next[lead.id];
      return next;
    });
    setShipmentsByLead((prev) => {
      const next = { ...prev };
      delete next[lead.id];
      return next;
    });
    if (selectedLeadId === lead.id) setSelectedLeadId(null);
    if (processLead?.id === lead.id) setProcessLead(null);
  };

  const openConvert = async (lead: Lead) => {
    setConvertingId(lead.id);
    let working = lead;
    if (lead.status === 'new') {
      const ok = await patchStatus(lead.id, 'in_progress', { keepInList: true });
      if (!ok) {
        setConvertingId(null);
        return;
      }
      working = { ...lead, status: 'in_progress' };
    }
    let remaining: number | null = null;
    if (working.status === 'converted' || working.order_id != null) {
      try {
        const res = await fetch(`/api/adminCifra/leads/${working.id}/shipments`, {
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
    setOrderInitial(leadToOrderInitialData(working, { remainingVolumeM3: remaining }));
    setShowOrderModal(true);
  };

  const openCreateModal = () => setShowCreateModal(true);

  const assignLead = async (
    leadId: number,
    patch: { assigned_to?: string | null; co_assignees?: number[] },
  ) => {
    const body: Record<string, unknown> = {};
    if (patch.assigned_to !== undefined) {
      body.assigned_to = patch.assigned_to || null;
    }
    if (patch.co_assignees !== undefined) {
      body.co_assignees = patch.co_assignees;
    }
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
    void loadHistory(selectedLeadId);
  };

  const takeLeadInWork = async (lead: Lead) => {
    const ok = await patchStatus(lead.id, 'in_progress');
    if (ok && statusFilter === 'new') {
      // карточка уйдёт из «Новые» через patchStatus / фильтр
    }
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
      void loadHistory(selectedLeadId);
      if (json.already) {
        alert('Задание уже отправлялось недавно');
      } else {
        alert('Задание отправлено назначенным исполнителям');
      }
    } finally {
      setSendingWorkId(null);
    }
  };

  const uploadContracts = async (leadId: number, list: FileList | null) => {
    if (!list?.length) return;
    const picked: File[] = [];
    for (const file of Array.from(list)) {
      const bad = isAllowedContractFile(file);
      if (bad) {
        alert(`${file.name}: ${bad}`);
        continue;
      }
      picked.push(file);
    }
    if (!picked.length) return;
    setUploadingLeadId(leadId);
    try {
      const fd = new FormData();
      picked.forEach((f) => fd.append('files', f));
      const res = await fetch(`/api/adminCifra/leads/${leadId}/contracts`, {
        method: 'POST',
        headers: adminCifraAuthHeaders(),
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось загрузить файлы. Выполните SQL lead-contracts.');
        return;
      }
      const uploaded = ((json.contracts || []) as ContractMeta[]).map((c) => ({
        id: c.id,
        lead_id: leadId,
        file_name: c.file_name,
        mime_type: c.mime_type,
        size_bytes: c.size_bytes,
        uploaded_by_name: c.uploaded_by_name,
        created_at: c.created_at,
      }));
      setContractsByLead((prev) => ({
        ...prev,
        [leadId]: [...uploaded, ...(prev[leadId] || [])],
      }));
      void loadHistory(selectedLeadId);
    } catch (e) {
      console.error(e);
      alert('Ошибка загрузки файлов');
    } finally {
      setUploadingLeadId(null);
    }
  };

  const openContract = async (leadId: number, contractId: number) => {
    try {
      const res = await fetch(`/api/adminCifra/leads/${leadId}/contracts`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось получить файлы');
        return;
      }
      const row = (json.contracts || []).find((c: { id: number }) => c.id === contractId);
      if (!row?.url) {
        alert('Ссылка на файл недоступна');
        return;
      }
      window.open(row.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error(e);
      alert('Ошибка открытия файла');
    }
  };

  const employeeOptions = useMemo(
    () => [
      { value: '', label: 'Не назначен', text: 'Не назначен' },
      ...employees.map((emp) => {
        const display =
          emp.organization_name && emp.organization_name.trim()
            ? emp.organization_name
            : emp.full_name || 'Без имени';
        const label = `${display} (${emp.role})`;
        return { value: String(emp.user_id), label, text: label };
      }),
    ],
    [employees],
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Inbox size={28} color="#60A5FA" style={{ flexShrink: 0, marginTop: 2 }} />
        <div className={styles.headerText}>
          <h1 className={styles.title}>Лиды</h1>
          <p className={styles.subtitle}>
            Торги и площадки → исполнитель, контракты, конверсия в заявку
          </p>
        </div>
        <div className={styles.headerActions}>
          <PageHelpButton title="Инструкция по продажам" />
          {allowTenderProcess && (
            <button type="button" onClick={openCreateModal} style={btnPrimary}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Plus size={16} /> Создать лид
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void load();
              void loadHistory(selectedLeadId);
            }}
            style={volumeCardSoftStyle({
              border: 'none',
              color: '#E2E8F0',
              padding: '10px 14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            })}
          >
            <RefreshCw size={16} /> Обновить
          </button>
        </div>
      </div>

      <div className={styles.filters}>
        {['', 'new', 'in_progress', 'converted', 'fulfilled', 'rejected', 'spam'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={styles.filterChip}
            style={{
              border: statusFilter === s ? '1px solid #60A5FA' : '1px solid #334155',
              background: statusFilter === s ? '#1E3A5F' : '#0F172A',
            }}
          >
            {s ? STATUS_LABEL[s as LeadStatus] : 'Все'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMineOnly((v) => !v)}
          className={styles.filterChip}
          style={{
            border: mineOnly ? '1px solid #FACC15' : '1px solid #334155',
            background: mineOnly ? 'rgba(234, 179, 8, 0.2)' : '#0F172A',
            color: mineOnly ? '#FEF08A' : '#E2E8F0',
          }}
        >
          Мои
        </button>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className={styles.sourceSelect}
        >
          <option value="">Все источники</option>
          <option value="public_form">Публичная форма</option>
          <option value="avito">Авито</option>
          <option value="demand">Спрос</option>
          <option value="manual">Вручную</option>
          <option value="site">Сайт</option>
          <option value="tender">Тендер</option>
        </select>
      </div>

      {allowTenderProcess &&
        (statusFilter === 'rejected' || statusFilter === 'spam' || statusFilter === '') && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.35)',
            color: '#FDE68A',
            fontSize: 13,
          }}
        >
          На карточках «Отказ» / «Спам» доступны «Вернуть в новые» и «В работу» (админ и специалист
          по торгам).
        </div>
      )}

      {loadError && (
        <div style={volumeCardStyle({ padding: 14, marginBottom: 12, color: '#FCA5A5' })}>
          {loadError}
        </div>
      )}

      <div className={styles.workspace}>
        <div className={styles.listCol}>
          {loading ? (
            <p style={{ color: '#94A3B8', margin: 0 }}>Загрузка…</p>
          ) : leads.length === 0 ? (
            <div style={volumeCardStyle({ padding: 28, color: '#94A3B8' })}>
              {loadError ? (
                'Не удалось загрузить лиды.'
              ) : (
                <>
                  Лидов пока нет.
                  {allowTenderProcess ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={openCreateModal}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#93C5FD',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 'inherit',
                          textDecoration: 'underline',
                        }}
                      >
                        Создайте лид вручную
                      </button>
                      {' '}или подключите webhook Авито.
                    </>
                  ) : (
                    <> Сообщения Авито сначала попадают в Спрос — оттуда отправляй в работу.</>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className={styles.cards}>
              {leads.map((lead) => {
                const selected = selectedLeadId === lead.id;
                const actor = leadActorName(lead);
                const assignee = leadAssigneeName(lead, employees);
                const coNames = getLeadCoAssigneeNames(lead);
                const coIds = getLeadCoAssigneeIds(lead);
                const platform = leadPlatform(lead);
                const contracts = contractsByLead[lead.id] || [];
                const text = lead.raw_text || '—';
                const longText = text.length > 160 || text.split('\n').length > 3;
                const expanded = !!expandedIds[lead.id];
                const detailsOpen = !!detailsOpenIds[lead.id];
                const payload =
                  lead.raw_payload && typeof lead.raw_payload === 'object'
                    ? (lead.raw_payload as Record<string, unknown>)
                    : null;
                const etpUrl = String(payload?.etp_url ?? lead.chat_url ?? '').trim();
                const docsUrl = String(payload?.docs_url ?? '').trim();
                const takenBy = String(payload?.taken_by_name ?? '').trim();
                const takenAt = formatDateTime(String(payload?.taken_at ?? '').trim());
                const cardHistory = (historyByLead[lead.id] || []).slice(0, 3);
                const shipments = shipmentsByLead[lead.id];
                const dateHints = getLeadDateHints(lead);
                const canCreateOrder =
                  (allowTenderProcess || canActOnAssignedLeadWork(lead, currentUserId)) &&
                  lead.status !== 'spam' &&
                  lead.status !== 'rejected' &&
                  lead.status !== 'fulfilled';
                const canMarkFulfilled =
                  (allowTenderProcess || canActOnAssignedLeadWork(lead, currentUserId)) &&
                  (lead.status === 'converted' ||
                    (lead.status === 'in_progress' && lead.order_id != null));
                const coAddOptions = employees
                  .filter((emp) => {
                    if (lead.assigned_to && emp.user_id === lead.assigned_to) return false;
                    if (coIds.includes(emp.user_id)) return false;
                    return true;
                  })
                  .map((emp) => {
                    const display =
                      emp.organization_name && emp.organization_name.trim()
                        ? emp.organization_name
                        : emp.full_name || 'Без имени';
                    const label = `${display} (${emp.role})`;
                    return { value: String(emp.user_id), label, text: label };
                  });

                return (
                  <div
                    key={lead.id}
                    id={`lead-card-${lead.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setSelectedLeadId((prev) => (prev === lead.id ? null : lead.id))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedLeadId((prev) => (prev === lead.id ? null : lead.id));
                      }
                    }}
                    className={`${styles.card}${selected ? ` ${styles.cardSelected}` : ''}`}
                    style={volumeCardSoftStyle()}
                  >
                    <div className={styles.cardBody}>
                      <div className={styles.cardTop}>
                        <span className={styles.cardTitle}>
                          #{lead.id} · {LEAD_SOURCE_LABEL[lead.source] || lead.source}
                        </span>
                        <span className={styles.badge}>
                          {STATUS_LABEL[lead.status] || lead.status}
                        </span>
                        {lead.score != null && lead.score > 0 && (
                          <span className={styles.score}>оценка {lead.score}</span>
                        )}
                        <button
                          type="button"
                          className={styles.toggleDetails}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailsOpenIds((prev) => ({
                              ...prev,
                              [lead.id]: !prev[lead.id],
                            }));
                          }}
                          aria-expanded={detailsOpen}
                        >
                          {detailsOpen ? 'Свернуть' : 'Подробнее'}
                          {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>

                      {detailsOpen && actor && (
                        <p className={styles.actor}>
                          <UserRound size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                          {actorLabel(lead, actor)}
                        </p>
                      )}
                      <div className={styles.peopleRow}>
                        {platform && (
                          <span className={styles.peopleChip} style={{ color: '#93C5FD' }}>
                            Площадка: {platform}
                          </span>
                        )}
                        <span className={styles.peopleChip} style={{ color: '#FDE68A' }}>
                          Исполнитель: {assignee || 'не назначен'}
                        </span>
                        {detailsOpen && (
                          <span className={styles.peopleChip} style={{ color: '#FDE68A' }}>
                            Соисполнители:{' '}
                            {coNames.length > 0 ? coNames.join(', ') : 'нет'}
                          </span>
                        )}
                        {detailsOpen && (takenBy || takenAt) && lead.status !== 'new' && (
                          <span className={styles.peopleChip} style={{ color: '#86EFAC' }}>
                            Взял в работу: {takenBy || '—'}
                            {takenAt ? ` · ${takenAt}` : ''}
                          </span>
                        )}
                      </div>

                      <p
                        className={`${styles.preview}${
                          !detailsOpen || (longText && !expanded)
                            ? ` ${styles.previewClamped}${
                                detailsOpen && longText && !expanded
                                  ? ` ${styles.previewClampedWide}`
                                  : ''
                              }`
                            : ''
                        }`}
                      >
                        {text}
                      </p>

                      {detailsOpen && longText && (
                        <button
                          type="button"
                          className={styles.expandBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedIds((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }));
                          }}
                        >
                          {expanded ? 'Свернуть текст' : 'Показать полностью'}
                        </button>
                      )}

                      <div className={detailsOpen ? styles.meta : styles.metaCompact}>
                        {lead.name && <span>{lead.name}</span>}
                        {lead.phone && (
                          <a
                            href={`tel:${lead.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              color: '#93C5FD',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Phone size={14} /> {lead.phone}
                          </a>
                        )}
                        {lead.grade && <span>{lead.grade}</span>}
                        {lead.volume_m3 != null && <span>{lead.volume_m3} м³</span>}
                        {lead.city && <span>{lead.city}</span>}
                        {detailsOpen && dateHints.submissionDeadline && (
                          <span style={{ color: '#94A3B8', fontWeight: 500 }}>
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
                        <span>
                          {detailsOpen
                            ? new Date(lead.created_at).toLocaleString('ru-RU')
                            : new Date(lead.created_at).toLocaleDateString('ru-RU')}
                        </span>
                        {!detailsOpen && cardHistory[0] && (
                          <span style={{ color: '#64748B' }}>
                            {cardHistory[0].action}
                          </span>
                        )}
                      </div>

                      {detailsOpen && cardHistory.length > 0 && (
                        <div className={styles.cardTimeline}>
                          {cardHistory.map((entry) => {
                            const detail = historyEntryDetail(entry);
                            return (
                              <div key={entry.id} className={styles.cardTimelineItem}>
                                <span className={styles.cardTimelineAction}>{entry.action}</span>
                                <span className={styles.cardTimelineMeta}>
                                  {entry.user_name || 'Сотрудник'}
                                  {' · '}
                                  {formatDateTime(entry.created_at)}
                                </span>
                                {detail && (
                                  <span className={styles.cardTimelineDetail}>{detail}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {detailsOpen &&
                        shipments &&
                        (shipments.orders.length > 0 || shipments.plan_m3 != null) && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 10,
                            borderRadius: 10,
                            background: 'rgba(15, 23, 42, 0.7)',
                            border: '1px solid #334155',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 8,
                              fontSize: 12,
                              color: '#CBD5E1',
                              marginBottom: 6,
                            }}
                          >
                            <span>
                              Отгрузка:{' '}
                              <strong style={{ color: '#F1F5F9' }}>
                                {shipments.shipped_m3}
                                {shipments.plan_m3 != null ? ` / ${shipments.plan_m3}` : ''} м³
                              </strong>
                              {shipments.plan_m3 != null && (
                                <span style={{ color: '#94A3B8', fontWeight: 400 }}>
                                  {' · '}в заявках {shipments.ordered_m3 ?? 0} м³
                                  {shipments.remaining_m3 != null
                                    ? ` · остаток ${shipments.remaining_m3} м³`
                                    : ''}
                                </span>
                              )}
                            </span>
                            {shipments.percent != null && (
                              <span style={{ color: '#86EFAC' }}>{shipments.percent}%</span>
                            )}
                          </div>
                          <div
                            style={{
                              height: 8,
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
                                  (shipments.percent ?? 0) >= 100
                                    ? '#22C55E'
                                    : 'linear-gradient(90deg, #2563EB, #38BDF8)',
                                transition: 'width 0.3s ease',
                              }}
                            />
                          </div>
                          {shipments.orders.length > 0 && (
                            <ul
                              style={{
                                margin: '8px 0 0',
                                padding: 0,
                                listStyle: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                              }}
                            >
                              {shipments.orders.map((o) => (
                                <li
                                  key={o.order_id}
                                  style={{
                                    fontSize: 12,
                                    color: '#94A3B8',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                    alignItems: 'center',
                                  }}
                                >
                                  <Link
                                    href={`/adminCifra/zayavki?orderId=${o.order_id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      color: '#93C5FD',
                                      textDecoration: 'none',
                                      fontWeight: 600,
                                      minWidth: 0,
                                    }}
                                    title={`Открыть заявку #${o.order_id}`}
                                  >
                                    Заявка #{o.order_id}
                                    {o.grade ? ` · ${o.grade}` : ''}
                                    {o.delivery_date
                                      ? ` · ${formatLeadDateRu(String(o.delivery_date).slice(0, 10))}`
                                      : ''}
                                  </Link>
                                  <span style={{ color: '#E2E8F0', whiteSpace: 'nowrap' }}>
                                    {o.shipped_m3}
                                    {o.volume != null ? ` / ${o.volume}` : ''} м³
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {detailsOpen && (
                      <div
                        className={styles.cardDetails}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {allowTenderProcess ? (
                          <>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                gap: 8,
                                alignItems: 'end',
                              }}
                            >
                              <label style={{ minWidth: 0, display: 'block' }}>
                                <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 3 }}>
                                  Исполнитель
                                </div>
                                <ModalSelect
                                  value={lead.assigned_to ? String(lead.assigned_to) : ''}
                                  onChange={(v) =>
                                    void assignLead(lead.id, {
                                      assigned_to: v,
                                      co_assignees: coIds.filter((id) => String(id) !== v),
                                    })
                                  }
                                  options={employeeOptions}
                                  placeholder="Не назначен"
                                  style={{ padding: '8px 10px', fontSize: 13 }}
                                />
                              </label>
                              <label style={{ minWidth: 0, display: 'block' }}>
                                <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 3 }}>
                                  Соисполнители
                                </div>
                                <ModalSelect
                                  value=""
                                  onChange={(v) => {
                                    if (!v) return;
                                    const next = Array.from(new Set([...coIds, Number(v)]));
                                    void assignLead(lead.id, { co_assignees: next });
                                  }}
                                  options={[
                                    { value: '', label: 'Добавить…', text: 'Добавить…' },
                                    ...coAddOptions,
                                  ]}
                                  placeholder="Добавить…"
                                  style={{ padding: '8px 10px', fontSize: 13 }}
                                />
                              </label>
                            </div>
                            {coIds.length > 0 && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 6,
                                  marginTop: 6,
                                }}
                              >
                                {coIds.map((uid, idx) => (
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
                                      padding: '2px 8px',
                                    }}
                                  >
                                    {coNames[idx] || `#${uid}`}
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
                                        cursor: 'pointer',
                                        fontSize: 12,
                                        lineHeight: 1,
                                        padding: 0,
                                      }}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.45 }}>
                            <div>
                              Исполнитель:{' '}
                              <span style={{ color: '#E2E8F0' }}>{assignee || 'не назначен'}</span>
                            </div>
                            {coNames.length > 0 && (
                              <div style={{ marginTop: 4 }}>
                                Соисполнители:{' '}
                                <span style={{ color: '#E2E8F0' }}>{coNames.join(', ')}</span>
                              </div>
                            )}
                          </div>
                        )}

                        <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <span style={{ fontSize: 12, color: '#94A3B8' }}>
                            Контракты ({contracts.length})
                          </span>
                          {allowTenderProcess && (
                            <label
                              style={{
                                fontSize: 12,
                                color: '#FDE68A',
                                cursor: uploadingLeadId === lead.id ? 'wait' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <FileText size={13} />
                              {uploadingLeadId === lead.id ? 'Загрузка…' : 'Добавить'}
                              <input
                                type="file"
                                multiple
                                accept={LEAD_CONTRACT_ACCEPT}
                                hidden
                                disabled={uploadingLeadId === lead.id}
                                onChange={(e) => {
                                  void uploadContracts(lead.id, e.target.files);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          )}
                        </div>
                        {contracts.length > 0 && (
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                            {contracts.slice(0, 5).map((c) => (
                              <li key={c.id} style={{ marginBottom: 4 }}>
                                <button
                                  type="button"
                                  onClick={() => void openContract(lead.id, c.id)}
                                  style={{
                                    border: 'none',
                                    background: 'none',
                                    color: '#93C5FD',
                                    cursor: 'pointer',
                                    padding: 0,
                                    fontSize: 12,
                                    textAlign: 'left',
                                  }}
                                >
                                  {c.file_name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        </div>
                      </div>
                      )}
                    </div>

                    <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                      {allowTenderProcess && lead.status !== 'fulfilled' && (
                        <button
                          type="button"
                          onClick={() => setProcessLead(lead)}
                          style={{
                            ...btnPrimary,
                            background: 'linear-gradient(135deg, #B45309, #D97706)',
                            color: '#FFF7ED',
                          }}
                        >
                          Обработать
                        </button>
                      )}
                      {/* Спрос/тендер/площадка: админ и Екатерина — «Отправить в работу» (не себе). */}
                      {allowTenderProcess &&
                        !isLeadWorkOpenToAll(lead.source) &&
                        lead.status === 'new' && (
                          <button
                            type="button"
                            disabled={sendingWorkId === lead.id}
                            onClick={() => void sendLeadToWork(lead)}
                            style={{
                              ...btnPrimary,
                              background: 'linear-gradient(135deg, #CA8A04, #EAB308)',
                              color: '#1F2937',
                              opacity: sendingWorkId === lead.id ? 0.7 : 1,
                              cursor: sendingWorkId === lead.id ? 'wait' : 'pointer',
                            }}
                          >
                            {sendingWorkId === lead.id ? 'Отправка…' : 'Отправить в работу'}
                          </button>
                        )}
                      {/* Авито/форма — всем; спрос/тендер — только назначенным менеджерам. */}
                      {lead.status === 'new' &&
                        !(allowTenderProcess && !isLeadWorkOpenToAll(lead.source)) &&
                        (allowTenderProcess ||
                          canActOnAssignedLeadWork(lead, currentUserId)) && (
                          <button
                            type="button"
                            onClick={() => void takeLeadInWork(lead)}
                            style={{
                              ...btnPrimary,
                              background: 'linear-gradient(135deg, #CA8A04, #EAB308)',
                              color: '#1F2937',
                            }}
                          >
                            Взять в работу
                          </button>
                        )}
                      {canCreateOrder && (
                          <button
                            type="button"
                            onClick={() => void openConvert(lead)}
                            style={btnPrimary}
                          >
                            {lead.status === 'converted' || lead.order_id != null
                              ? 'Ещё заявка'
                              : 'Создать заказ'}
                          </button>
                        )}
                      {canMarkFulfilled && (
                        <button
                          type="button"
                          onClick={() => void patchStatus(lead.id, 'fulfilled')}
                          style={{
                            ...btnPrimary,
                            background: 'linear-gradient(135deg, #15803D, #22C55E)',
                          }}
                        >
                          Исполнен
                        </button>
                      )}
                      {detailsOpen && (
                      <div className={styles.actionsSecondary}>
                      {(etpUrl || lead.chat_url) && (
                        <a
                          href={etpUrl || lead.chat_url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            ...btnGhost,
                            color: '#E2E8F0',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                          }}
                        >
                          <ExternalLink size={14} />{' '}
                          {leadExternalLinkLabel(lead, etpUrl || lead.chat_url || '')}
                        </a>
                      )}
                      {docsUrl && (
                        <a
                          href={docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            ...btnGhost,
                            color: '#E2E8F0',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            fontSize: 12,
                          }}
                        >
                          Документация
                        </a>
                      )}
                      {(allowTenderProcess || canManagerRejectOrSpamLead(lead.source)) &&
                        lead.status !== 'rejected' &&
                        lead.status !== 'converted' &&
                        lead.status !== 'fulfilled' &&
                        lead.status !== 'spam' && (
                          <button
                            type="button"
                            onClick={() => void patchStatus(lead.id, 'rejected')}
                            style={btnDanger}
                          >
                            Отказ
                          </button>
                        )}
                      {(allowTenderProcess || canManagerRejectOrSpamLead(lead.source)) &&
                        lead.status !== 'spam' &&
                        lead.status !== 'converted' &&
                        lead.status !== 'fulfilled' && (
                          <button
                            type="button"
                            onClick={() => void patchStatus(lead.id, 'spam')}
                            style={btnGhost}
                          >
                            Спам
                          </button>
                        )}
                      {allowTenderProcess &&
                        (lead.status === 'rejected' || lead.status === 'spam') && (
                        <>
                          <button
                            type="button"
                            onClick={() => void patchStatus(lead.id, 'new')}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid #FACC15',
                              background: 'rgba(234, 179, 8, 0.2)',
                              color: '#FEF08A',
                              fontWeight: 700,
                              cursor: 'pointer',
                              fontSize: 13,
                            }}
                          >
                            Вернуть в новые
                          </button>
                          <button
                            type="button"
                            onClick={() => void patchStatus(lead.id, 'in_progress')}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid #3B82F6',
                              background: 'rgba(37, 99, 235, 0.2)',
                              color: '#BFDBFE',
                              fontWeight: 700,
                              cursor: 'pointer',
                              fontSize: 13,
                            }}
                          >
                            В работу
                          </button>
                        </>
                      )}
                      {allowTenderProcess && lead.status === 'fulfilled' && (
                        <button
                          type="button"
                          onClick={() => void patchStatus(lead.id, 'converted')}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid #3B82F6',
                            background: 'rgba(37, 99, 235, 0.2)',
                            color: '#BFDBFE',
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontSize: 13,
                          }}
                        >
                          Вернуть в отгрузку
                        </button>
                      )}
                      {allowTenderProcess && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteLead(lead);
                          }}
                          style={btnDanger}
                          title="Удалить лид навсегда"
                        >
                          Удалить
                        </button>
                      )}
                      </div>
                      )}
                      {shipments && shipments.orders.length > 0 ? (
                        shipments.orders.length === 1 ? (
                          <Link
                            href={`/adminCifra/zayavki?orderId=${shipments.orders[0].order_id}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              color: '#86EFAC',
                              fontSize: 13,
                              textAlign: 'center',
                              textDecoration: 'none',
                              fontWeight: 600,
                            }}
                          >
                            Заявка #{shipments.orders[0].order_id} →
                          </Link>
                        ) : (
                          <span style={{ color: '#86EFAC', fontSize: 13, textAlign: 'center' }}>
                            Заявок: {shipments.orders.length}
                          </span>
                        )
                      ) : (
                        lead.order_id && (
                          <Link
                            href={`/adminCifra/zayavki?orderId=${lead.order_id}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              color: '#86EFAC',
                              fontSize: 13,
                              textAlign: 'center',
                              textDecoration: 'none',
                              fontWeight: 600,
                            }}
                          >
                            Заявка #{lead.order_id} →
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className={styles.history} style={volumeCardStyle()}>
          <div className={styles.historyHead}>
            <History size={18} color="#FACC15" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={styles.historyTitle}>История изменений</div>
              <div className={styles.historySub}>
                {selectedLeadId
                  ? `Лид #${selectedLeadId}`
                  : 'Все лиды · клик по карточке — фильтр'}
              </div>
            </div>
            {selectedLeadId != null && (
              <button
                type="button"
                onClick={() => {
                  setSelectedLeadId(null);
                  setDetailsOpenIds({});
                }}
                style={{
                  border: '1px solid #334155',
                  background: 'transparent',
                  color: '#94A3B8',
                  borderRadius: 8,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                Сброс
              </button>
            )}
          </div>

          <div className={styles.historyFilters}>
            {HISTORY_KIND_FILTERS.map((f) => (
              <button
                key={f.id || 'all'}
                type="button"
                className={`${styles.historyChip}${
                  historyKind === f.id ? ` ${styles.historyChipActive}` : ''
                }`}
                onClick={() => setHistoryKind(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className={styles.historyFilters}>
            {HISTORY_PERIOD_FILTERS.map((f) => (
              <button
                key={f.id || 'all-time'}
                type="button"
                className={`${styles.historyChip}${
                  historyPeriod === f.id ? ` ${styles.historyChipActive}` : ''
                }`}
                onClick={() => setHistoryPeriod(f.id)}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              className={`${styles.historyChip}${
                historyMine ? ` ${styles.historyChipActive}` : ''
              }`}
              onClick={() => setHistoryMine((v) => !v)}
            >
              Мои
            </button>
          </div>

          <div
            ref={historyScrollRef}
            className={styles.historyScroll}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
                void loadMoreHistory();
              }
            }}
          >
            {historyLoading ? (
              <p style={{ color: '#94A3B8', fontSize: 13, margin: 0 }}>Загрузка…</p>
            ) : history.length === 0 ? (
              <p style={{ color: '#64748B', fontSize: 13, margin: 0, lineHeight: 1.45 }}>
                Нет записей по выбранным фильтрам.
              </p>
            ) : (
              <div className={styles.timeline}>
                <div className={styles.timelineRail} />
                {history.map((entry) => {
                  const detail = historyEntryDetail(entry);
                  return (
                    <div key={entry.id} className={styles.timelineItem}>
                      <div className={styles.timelineDot} />
                      <div style={{ color: '#F1F5F9', fontSize: 13, fontWeight: 600 }}>
                        {entry.action}
                      </div>
                      <div style={{ color: '#CBD5E1', fontSize: 12, marginTop: 2 }}>
                        {entry.user_name || 'Сотрудник'}
                        {!selectedLeadId && (
                          <button
                            type="button"
                            onClick={() => setSelectedLeadId(entry.lead_id)}
                            style={{
                              marginLeft: 6,
                              border: 'none',
                              background: 'none',
                              color: '#93C5FD',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: 12,
                            }}
                          >
                            · лид #{entry.lead_id}
                          </button>
                        )}
                      </div>
                      {detail && (
                        <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 2 }}>
                          {detail}
                        </div>
                      )}
                      <div style={{ color: '#64748B', fontSize: 11, marginTop: 3 }}>
                        {formatDateTime(entry.created_at)}
                      </div>
                    </div>
                  );
                })}
                {historyHasMore && (
                  <button
                    type="button"
                    className={styles.historyLoadMore}
                    disabled={historyLoadingMore}
                    onClick={() => void loadMoreHistory()}
                  >
                    {historyLoadingMore ? 'Загрузка…' : 'Показать ещё'}
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {showOrderModal && (
        <NewOrderModal
          isOpen={showOrderModal}
          onClose={() => {
            setShowOrderModal(false);
            setOrderInitial(null);
            setConvertingId(null);
          }}
          onSuccess={(_order, meta) => {
            setShowOrderModal(false);
            setOrderInitial(null);
            if (convertingId && (meta?.leadConverted || meta?.leadOrderAdded) && !meta?.warning) {
              setLeads((prev) => {
                if (statusFilter && statusFilter !== 'converted' && statusFilter !== '') {
                  return prev.filter((l) => l.id !== convertingId);
                }
                return prev.map((l) =>
                  l.id === convertingId ? { ...l, status: 'converted' } : l,
                );
              });
            }
            setConvertingId(null);
            void load();
            void loadHistory(selectedLeadId);
          }}
          initialData={orderInitial}
          currentRole={userRole || undefined}
          currentUserName={userName || undefined}
        />
      )}

      <CreateLeadModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          setShowCreateModal(false);
          void loadHistory(selectedLeadId);
          if (statusFilter && statusFilter !== 'new') setStatusFilter('new');
          else void load();
        }}
      />

      <ProcessLeadModal
        open={Boolean(processLead)}
        lead={processLead}
        onClose={() => setProcessLead(null)}
        onSaved={(updated) => {
          setLeads((prev) => {
            const next = prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l));
            void loadContracts(next);
            void loadShipments(next);
            return next;
          });
          setProcessLead(null);
          void loadHistory(selectedLeadId === updated.id ? updated.id : selectedLeadId);
        }}
      />
    </div>
  );
}
