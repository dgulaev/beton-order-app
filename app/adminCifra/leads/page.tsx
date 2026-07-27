'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import {
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
  canManagerRejectOrSpamLead,
  isLeadWorkOpenToAll,
  LEAD_SOURCE_LABEL,
  leadToOrderInitialData,
  type Lead,
  type LeadStatus,
} from '@/lib/leads';
import { useRealtimeLeads } from '@/hooks/useRealtimeLeads';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import NewOrderModal from '../components/NewOrderModal';
import ModalSelect from '../components/ModalSelect';
import { useUserRole } from '../../providers/UserRoleProvider';
import CreateLeadModal from './CreateLeadModal';
import ProcessLeadModal from './ProcessLeadModal';
import styles from './leads.module.css';

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  converted: 'В заказ',
  rejected: 'Отказ',
  spam: 'Спам',
};

const STATUS_FILTERS = ['new', 'in_progress', 'converted', 'rejected', 'spam'] as const;

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

const btnPrimary: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: 'none',
  background: '#2563EB',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13,
};

const btnGhost: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: 'transparent',
  color: '#94A3B8',
  cursor: 'pointer',
  fontSize: 13,
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
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const initialStatus = searchParams.get('status');
  const initialSource = searchParams.get('source');
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus && (STATUS_FILTERS as readonly string[]).includes(initialStatus)
      ? initialStatus
      : 'new',
  );
  const [sourceFilter, setSourceFilter] = useState<string>(initialSource || '');
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderInitial, setOrderInitial] = useState<any>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [contractsByLead, setContractsByLead] = useState<Record<number, ContractMeta[]>>({});
  const [uploadingLeadId, setUploadingLeadId] = useState<number | null>(null);

  const statusFilterArr = useMemo(
    () => (statusFilter ? [statusFilter as LeadStatus] : undefined),
    [statusFilter],
  );

  const loadHistory = useCallback(async (leadId?: number | null) => {
    setHistoryLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (leadId) qs.set('leadId', String(leadId));
      const res = await fetch(`/api/adminCifra/leads/history?${qs}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setHistory([]);
        return;
      }
      setHistory(json.history || []);
    } catch (e) {
      console.error(e);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

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

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (sourceFilter) qs.set('source', sourceFilter);
      const res = await fetch(`/api/adminCifra/leads?${qs}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setLoadError(json.error || `Ошибка загрузки (${res.status})`);
        setLeads([]);
        return;
      }
      const next = (json.leads || []) as Lead[];
      setLeads(next);
      void loadContracts(next);
    } catch (e) {
      console.error(e);
      setLoadError('Ошибка соединения с сервером');
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, loadContracts]);

  useEffect(() => {
    void load();
  }, [load]);

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
  });

  const patchStatus = async (id: number, status: LeadStatus) => {
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
    // После возврата из отказа/спама — обратно в «Новые» / «В работе».
    if (
      allowTenderProcess &&
      (status === 'new' || status === 'in_progress') &&
      (statusFilter === 'rejected' || statusFilter === 'spam')
    ) {
      setStatusFilter(status);
      void loadHistory(selectedLeadId);
      return true;
    }

    setLeads((prev) => {
      if (statusFilter && status !== statusFilter) {
        return prev.filter((l) => l.id !== id);
      }
      return prev.map((l) => (l.id === id ? { ...l, ...json.lead, status } : l));
    });
    void loadHistory(selectedLeadId);
    return true;
  };

  const openConvert = async (lead: Lead) => {
    setConvertingId(lead.id);
    if (lead.status === 'new') {
      const ok = await patchStatus(lead.id, 'in_progress');
      if (!ok) {
        setConvertingId(null);
        return;
      }
    }
    setOrderInitial(leadToOrderInitialData(lead));
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
    setUploadingLeadId(leadId);
    try {
      const fd = new FormData();
      Array.from(list).forEach((f) => fd.append('files', f));
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
        {['', 'new', 'in_progress', 'converted', 'rejected', 'spam'].map((s) => (
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
                    <> Подключите webhook Авито или дождитесь лидов со Спроса.</>
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
                const longText = text.length > 280 || text.split('\n').length > 5;
                const expanded = !!expandedIds[lead.id];
                const payload =
                  lead.raw_payload && typeof lead.raw_payload === 'object'
                    ? (lead.raw_payload as Record<string, unknown>)
                    : null;
                const etpUrl = String(payload?.etp_url ?? lead.chat_url ?? '').trim();
                const docsUrl = String(payload?.docs_url ?? '').trim();
                const takenBy = String(payload?.taken_by_name ?? '').trim();
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
                      </div>

                      {actor && (
                        <p className={styles.actor}>
                          <UserRound size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                          {actorLabel(lead, actor)}
                        </p>
                      )}
                      {(assignee || coNames.length > 0 || platform || takenBy) && (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px 12px',
                            marginBottom: 8,
                            fontSize: 13,
                            color: '#CBD5E1',
                          }}
                        >
                          {platform && (
                            <span style={{ color: '#93C5FD' }}>Площадка: {platform}</span>
                          )}
                          {assignee && (
                            <span style={{ color: '#FDE68A' }}>
                              Исполнитель: {assignee}
                            </span>
                          )}
                          {coNames.length > 0 && (
                            <span style={{ color: '#FDE68A' }}>
                              Соисполнители: {coNames.join(', ')}
                            </span>
                          )}
                          {takenBy && lead.status !== 'new' && (
                            <span style={{ color: '#86EFAC' }}>
                              Взял в работу: {takenBy}
                            </span>
                          )}
                        </div>
                      )}

                      <p
                        className={`${styles.preview}${
                          longText && !expanded ? ` ${styles.previewClamped}` : ''
                        }`}
                      >
                        {text}
                      </p>
                      {longText && (
                        <button
                          type="button"
                          className={styles.expandBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedIds((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }));
                          }}
                        >
                          {expanded ? 'Свернуть' : 'Показать полностью'}
                        </button>
                      )}

                      <div className={styles.meta}>
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
                        <span>{new Date(lead.created_at).toLocaleString('ru-RU')}</span>
                      </div>

                      <div
                        style={{ marginTop: 10 }}
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
                      </div>

                      <div
                        style={{ marginTop: 10 }}
                        onClick={(e) => e.stopPropagation()}
                      >
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
                                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
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

                    <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                      {allowTenderProcess && lead.status !== 'converted' && (
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
                      {(allowTenderProcess ||
                        canActOnAssignedLeadWork(lead, currentUserId)) &&
                        lead.status !== 'converted' &&
                        lead.status !== 'spam' && (
                          <button
                            type="button"
                            onClick={() => void openConvert(lead)}
                            style={btnPrimary}
                          >
                            Создать заказ
                          </button>
                        )}
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
                          <ExternalLink size={14} /> ЭТП
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
                        lead.status !== 'converted' && (
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
                      {lead.order_id && (
                        <span style={{ color: '#86EFAC', fontSize: 13, textAlign: 'center' }}>
                          Заявка #{lead.order_id}
                        </span>
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
                onClick={() => setSelectedLeadId(null)}
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

          <div className={styles.historyScroll}>
            {historyLoading ? (
              <p style={{ color: '#94A3B8', fontSize: 13, margin: 0 }}>Загрузка…</p>
            ) : history.length === 0 ? (
              <p style={{ color: '#64748B', fontSize: 13, margin: 0, lineHeight: 1.45 }}>
                Пока нет записей. История появится после действий по лидам.
              </p>
            ) : (
              <div className={styles.timeline}>
                <div className={styles.timelineRail} />
                {history.map((entry) => {
                  const statusChange =
                    entry.field_name === 'status' && (entry.old_value || entry.new_value);
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
                      {statusChange && (
                        <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 2 }}>
                          {STATUS_LABEL[entry.old_value as LeadStatus] || entry.old_value || '—'}
                          {' → '}
                          {STATUS_LABEL[entry.new_value as LeadStatus] || entry.new_value || '—'}
                        </div>
                      )}
                      <div style={{ color: '#64748B', fontSize: 11, marginTop: 3 }}>
                        {new Date(entry.created_at).toLocaleString('ru-RU')}
                      </div>
                    </div>
                  );
                })}
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
            if (convertingId && meta?.leadConverted && !meta?.warning) {
              setLeads((prev) => {
                if (statusFilter && statusFilter !== 'converted') {
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
            return next;
          });
          setProcessLead(null);
          void loadHistory(selectedLeadId === updated.id ? updated.id : selectedLeadId);
        }}
      />
    </div>
  );
}
