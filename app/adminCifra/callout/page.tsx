'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ExternalLink,
  Megaphone,
  Phone,
  RefreshCw,
  Trash2,
  Upload,
  Link2,
  MessageSquare,
  Hourglass,
  Users,
} from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  CALLOUT_STATUSES,
  CALLOUT_STATUS_LABEL,
  type CalloutStatus,
} from '@/lib/callout/labels';
import { formatPhoneDisplay, formatPhoneInput, normalizePhone } from '@/lib/phone';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import AdminPagination from '../components/AdminPagination';
import { appConfirm } from '../components/appDialog';
import styles from './callout.module.css';

type Prospect = {
  id: number;
  inn: string | null;
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: CalloutStatus;
  matched_client_id: number | null;
  source: string;
  updated_at: string;
};

type Tender = {
  id: number;
  prospect_id: number | null;
  lead_id?: number | null;
  purchase_url: string | null;
  purchase_number: string | null;
  object_info: string | null;
  contract_price: number | null;
  winner_status: string;
  import_batch: string | null;
  source: string;
};

type Comment = {
  id: number;
  body: string;
  user_name: string | null;
  created_at: string;
};

type MainTab = 'prospects' | 'pending';

const STATUS_FILTERS: Array<CalloutStatus | ''> = [
  '',
  'new',
  'in_progress',
  'called',
  'rejected',
  'converted',
];

const WINNER_LABEL: Record<string, string> = {
  pending: 'Ждём контракт',
  found: 'Победитель найден',
  missing: 'Нет данных',
  manual: 'Из импорта',
  failed: 'Ошибка',
};

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function displayOrgName(p: { organization_name?: string | null; inn?: string | null }): string {
  const name = String(p.organization_name || '').trim();
  if (name) return name;
  if (p.inn) return `Победитель ИНН ${p.inn}`;
  return 'Без названия';
}

function pickCell(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  for (const [hk, hv] of Object.entries(row)) {
    const h = hk.toLowerCase();
    if (keys.some((k) => h.includes(k.toLowerCase())) && hv != null && String(hv).trim()) {
      return String(hv).trim();
    }
  }
  return '';
}

export default function CalloutPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mainTab, setMainTab] = useState<MainTab>('prospects');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [tendersByProspect, setTendersByProspect] = useState<Record<number, Tender[]>>({});
  const [commentCounts, setCommentCounts] = useState<Record<number, number>>({});
  const [pendingTenders, setPendingTenders] = useState<Tender[]>([]);
  const [importBatches, setImportBatches] = useState<string[]>([]);
  const [prospectTotal, setProspectTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const PAGE_SIZE = 50;
  const [status, setStatus] = useState<CalloutStatus | ''>('');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedPendingId, setSelectedPendingId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    prospect: Prospect;
    tenders: Tender[];
    comments: Comment[];
  } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [refreshingTenderId, setRefreshingTenderId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (q.trim()) qs.set('q', q.trim());
      qs.set('page', String(page));
      qs.set('limit', String(PAGE_SIZE));
      const res = await fetch(`/api/adminCifra/callout?${qs}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setLoadError(json.error || `Ошибка загрузки (${res.status})`);
        setProspects([]);
        return;
      }
      setProspects(json.prospects || []);
      setTendersByProspect(json.tendersByProspect || {});
      setCommentCounts(json.commentCounts || {});
      setPendingTenders(json.pendingTenders || []);
      setImportBatches(json.importBatches || []);
      setProspectTotal(Number(json.prospectTotal) || 0);
      setFilteredTotal(Number(json.filteredTotal) || 0);
      setTotalPages(Math.max(1, Number(json.totalPages) || 1));

      const needEnrich = (json.prospects || []).filter((p: Prospect) => {
        const name = String(p.organization_name || '').trim();
        const weak =
          !name ||
          /^победитель\s+инн\b/i.test(name) ||
          (p.inn != null && name === String(p.inn));
        const noPhone = !String(p.phone || '').trim();
        return weak || (noPhone && (p.inn || p.address));
      });
      if (needEnrich.length > 0) {
        // Тихо дозаполним названия по ИНН (DaData) для уже созданных «Без названия»
        void fetch('/api/adminCifra/callout', {
          method: 'POST',
          headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: 'enrich_names' }),
        })
          .then((r) => r.json())
          .then((en) => {
            if (en?.success && en.updated > 0) {
              // перезагрузить список с именами
              return fetch(`/api/adminCifra/callout?${qs}`, {
                headers: adminCifraAuthHeaders(),
              }).then((r) => r.json());
            }
            return null;
          })
          .then((again) => {
            if (again?.success) {
              setProspects(again.prospects || []);
              setTendersByProspect(again.tendersByProspect || {});
              setCommentCounts(again.commentCounts || {});
              setProspectTotal(Number(again.prospectTotal) || 0);
              setFilteredTotal(Number(again.filteredTotal) || 0);
              setTotalPages(Math.max(1, Number(again.totalPages) || 1));
            }
          })
          .catch(() => {});
      }
    } catch {
      setLoadError('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  }, [status, q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Поиск с задержкой — не дёргать API на каждый символ
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQ(qInput);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  // Сброс страницы при смене статуса
  useEffect(() => {
    setPage(1);
  }, [status]);

  const showBanner = (text: string, ok = true) => {
    setMessage(text);
    setMessageOk(ok);
  };

  const loadDetail = useCallback(async (id: number) => {
    setSelectedId(id);
    setSelectedPendingId(null);
    try {
      const res = await fetch(`/api/adminCifra/callout/${id}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showBanner(json.error || 'Не удалось открыть карточку', false);
        setDetail(null);
        return;
      }
      setDetail({
        prospect: json.prospect,
        tenders: json.tenders || [],
        comments: json.comments || [],
      });
      setPhoneDraft(
        json.prospect.phone ? formatPhoneInput(String(json.prospect.phone)) : '',
      );

      // Если телефона нет — дотянуть контакты (DaData / Excel / Клиенты)
      if (!String(json.prospect.phone || '').trim()) {
        void fetch('/api/adminCifra/callout', {
          method: 'POST',
          headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: 'enrich_names' }),
        })
          .then((r) => r.json())
          .then(async (en) => {
            if (!en?.success || !en.updated) return;
            const again = await fetch(`/api/adminCifra/callout/${id}`, {
              headers: adminCifraAuthHeaders(),
            });
            const againJson = await again.json();
            if (againJson.success) {
              setDetail({
                prospect: againJson.prospect,
                tenders: againJson.tenders || [],
                comments: againJson.comments || [],
              });
              setPhoneDraft(
                againJson.prospect.phone
                  ? formatPhoneInput(String(againJson.prospect.phone))
                  : '',
              );
            }
          })
          .catch(() => {});
      }
    } catch {
      showBanner('Ошибка загрузки карточки', false);
    }
  }, []);

  const switchTab = (tab: MainTab) => {
    setMainTab(tab);
    if (tab === 'prospects') {
      setSelectedPendingId(null);
    } else {
      setSelectedId(null);
      setDetail(null);
    }
  };

  const patchStatus = async (id: number, next: CalloutStatus) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/adminCifra/callout/${id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showBanner(json.error || 'Не удалось обновить статус', false);
        return;
      }
      await load();
      if (selectedId === id) await loadDetail(id);
    } finally {
      setBusy(false);
    }
  };

  const savePhone = async () => {
    if (!selectedId) return;
    const digits = normalizePhone(phoneDraft);
    const phone =
      digits.length >= 11 ? `+${digits}` : phoneDraft.trim() || null;
    setBusy(true);
    try {
      const res = await fetch(`/api/adminCifra/callout/${selectedId}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showBanner(json.error || 'Не удалось сохранить телефон', false);
        return;
      }
      showBanner(phone ? `Телефон сохранён: ${formatPhoneDisplay(phone)}` : 'Телефон очищен', true);
      await load();
      await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  };

  const sendComment = async () => {
    if (!selectedId || !commentText.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/adminCifra/callout/${selectedId}`, {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'comment', body: commentText.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showBanner(json.error || 'Не удалось сохранить комментарий', false);
        return;
      }
      setCommentText('');
      await loadDetail(selectedId);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const refreshTender = async (prospectId: number, tenderId: number) => {
    setRefreshingTenderId(tenderId);
    showBanner('Ищем победителя в реестре контрактов ЕИС…', true);
    try {
      const res = await fetch(`/api/adminCifra/callout/${prospectId}`, {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'refresh_tender', tender_id: tenderId }),
      });
      const json = await res.json();
      showBanner(
        json.message || (json.success ? 'Победитель найден' : 'Победитель не найден'),
        Boolean(json.success),
      );
      await load();
      if (selectedId) await loadDetail(selectedId);
    } catch {
      showBanner('Ошибка сети при запросе к ЕИС', false);
    } finally {
      setRefreshingTenderId(null);
    }
  };

  const refreshPendingTender = async (tenderId: number) => {
    setRefreshingTenderId(tenderId);
    showBanner('Ищем победителя в реестре контрактов ЕИС… Это может занять до минуты.', true);
    try {
      const res = await fetch('/api/adminCifra/callout/refresh', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tender_id: tenderId }),
      });
      const json = await res.json();
      showBanner(
        json.message || (json.success ? 'Победитель найден — смотри вкладку «К обзвону»' : 'Победитель пока не найден'),
        Boolean(json.success),
      );
      await load();
      if (json.success && json.prospect_id) {
        setMainTab('prospects');
        setStatus('');
        await loadDetail(json.prospect_id);
      }
    } catch {
      showBanner('Ошибка сети при запросе к ЕИС. Попробуй ещё раз.', false);
    } finally {
      setRefreshingTenderId(null);
    }
  };

  const deleteProspect = async (id: number) => {
    const tenders = tendersByProspect[id] || detail?.tenders || [];
    const tenderCount = tenders.length;
    const leadLinks = tenders.filter((t) => t.lead_id != null).length;
    const ok = await appConfirm(
      [
        'Удалить карточку обзвона?',
        '',
        'Будет удалено безвозвратно:',
        '• сама карточка (контакты, статус, комментарии)',
        tenderCount > 0
          ? `• её закупки и ссылки ЕИС (${tenderCount})`
          : '• связанные закупки/ссылки ЕИС (если есть)',
        leadLinks > 0
          ? `• связь с лидом в Обзвоне (${leadLinks}) — сам лид в «Лидах» останется`
          : '• связь закупки с лидом в Обзвоне (если была) — сам лид в «Лидах» останется',
        '',
        'Клиент в разделе «Клиенты» не трогается.',
      ].join('\n'),
      { title: 'Удаление', okLabel: 'Удалить', cancelLabel: 'Отмена', variant: 'danger' },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/adminCifra/callout/${id}`, {
        method: 'DELETE',
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showBanner(json.error || 'Не удалось удалить', false);
        return;
      }
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteBatch = async (batchId: string) => {
    if (
      !(await appConfirm(
        `Удалить импорт Excel «${batchId}»?\n\n` +
          `Останутся:\n` +
          `• карточки обзвона (контакты, статусы, комментарии)\n` +
          `• ссылки на торги ЕИС у этих карточек\n\n` +
          `Удалится только список «Без победителя» из этого файла.`,
        { title: 'Удаление импорта', okLabel: 'Удалить', cancelLabel: 'Отмена', variant: 'danger' },
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/adminCifra/callout', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'delete_batch', batch_id: batchId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showBanner(json.error || 'Не удалось удалить батч', false);
        return;
      }
      showBanner(
        `Импорт убран. Карточек: ${json.keptProspects ?? 0}, ссылок ЕИС сохранено: ${json.keptLinkedTenders ?? 0}, удалено без победителя: ${json.deletedTenders}`,
        true,
      );
      setSelectedId(null);
      setDetail(null);
      setSelectedPendingId(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const importExcel = async (file: File) => {
    setBusy(true);
    setMessage(null);
    setMessageOk(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        blankrows: false,
      });

      const mapped = rows
        .map((row) => ({
          purchase_url: pickCell(row, ['ССЫЛКА', 'ссылка', 'url', 'link']),
          object_info: pickCell(row, ['Объект', 'объект', 'object']),
          supplier_name: pickCell(row, ['Поставщик', 'поставщик', 'supplier', 'победитель']),
          contacts: pickCell(row, ['Контакты', 'контакты', 'contacts']),
          contract_price: pickCell(row, ['Цена контракта', 'цена', 'price', 'НМЦК']),
        }))
        .filter((r) => r.purchase_url || r.object_info || r.supplier_name);

      if (!mapped.length) {
        showBanner(
          'В файле не найдено строк (ожидаются колонки ССЫЛКА / Объект / Поставщик)',
          false,
        );
        return;
      }

      const res = await fetch('/api/adminCifra/callout', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'import',
          batch_id: `xlsx-${file.name.replace(/\.[^.]+$/, '').slice(0, 40)}-${Date.now()}`,
          rows: mapped,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showBanner(json.error || 'Ошибка импорта', false);
        return;
      }
      showBanner(
        `Импорт: карточек ${json.createdProspects}, закупок ${json.createdTenders}, пропущено ${json.skipped}`,
        true,
      );
      setMainTab('prospects');
      await load();
    } catch (e) {
      showBanner(e instanceof Error ? e.message : 'Ошибка чтения Excel', false);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const selectedTenders = useMemo(() => {
    if (!selectedId) return [];
    return tendersByProspect[selectedId] || detail?.tenders || [];
  }, [selectedId, tendersByProspect, detail]);

  const selectedPending = useMemo(
    () => pendingTenders.find((t) => t.id === selectedPendingId) || null,
    [pendingTenders, selectedPendingId],
  );

  const filteredPending = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || mainTab !== 'pending') return pendingTenders;
    return pendingTenders.filter((t) => {
      const hay = `${t.object_info || ''} ${t.purchase_number || ''} ${t.purchase_url || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [pendingTenders, q, mainTab]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>
            <Megaphone size={22} style={{ marginRight: 8, verticalAlign: -4 }} />
            Обзвон
          </h1>
          <p className={styles.subtitle}>
            Победители торгов, которых можно обзвонить. Это отдельный список от «Клиентов» —
            сюда попадают компании после закупки, даже если их ещё нет в базе. Телефон подтянется
            сам, когда найдётся; если нет — допиши вручную справа в карточке.
          </p>
        </div>
        <div className={styles.headerActions}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importExcel(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            style={btnPrimary}
          >
            <Upload size={16} /> Импорт Excel
          </button>
          <button type="button" disabled={busy || loading} onClick={() => void load()} style={btnGhost}>
            <RefreshCw size={16} /> Обновить
          </button>
        </div>
      </header>

      {message && (
        <div
          style={volumeCardSoftStyle({
            padding: '12px 14px',
            marginBottom: 12,
            color: messageOk ? '#bbf7d0' : '#fecaca',
            border: `1px solid ${messageOk ? '#166534' : '#7f1d1d'}`,
          })}
        >
          {message}
          <button
            type="button"
            onClick={() => setMessage(null)}
            style={{
              marginLeft: 12,
              color: '#94a3b8',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            закрыть
          </button>
        </div>
      )}

      {importBatches.length > 0 && (
        <div className={styles.batchBar}>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>
            Загруженные Excel (убрать файл — карточки и ссылки останутся):
          </span>
          {importBatches.map((b) => (
            <button
              key={b}
              type="button"
              disabled={busy}
              onClick={() => void deleteBatch(b)}
              style={btnDangerSoft}
              title="Убрать только файл импорта. Карточки, контакты и ссылки ЕИС сохранятся"
            >
              <Trash2 size={14} /> {b.slice(0, 36)}
              {b.length > 36 ? '…' : ''}
            </button>
          ))}
        </div>
      )}

      {/* Главные вкладки: два разных мира, не один список */}
      <div className={styles.mainTabs}>
        <button
          type="button"
          className={styles.mainTab}
          data-active={mainTab === 'prospects' ? '1' : '0'}
          onClick={() => switchTab('prospects')}
        >
          <Users size={16} />
          К обзвону
          <span className={styles.tabCount}>{prospectTotal}</span>
        </button>
        <button
          type="button"
          className={styles.mainTab}
          data-active={mainTab === 'pending' ? '1' : '0'}
          onClick={() => switchTab('pending')}
        >
          <Hourglass size={16} />
          Без победителя
          <span className={styles.tabCountAmber}>{pendingTenders.length}</span>
        </button>
      </div>

      <p className={styles.tabHint} style={{ marginTop: -4, marginBottom: 12 }}>
        {mainTab === 'prospects'
          ? 'Выбери компанию слева — справа телефон, объекты и комментарии по звонку.'
          : 'Закупки, где победитель ещё не известен. Выбери строку — справа можно подтянуть данные из ЕИС.'}
      </p>

      <div className={styles.filters}>
        {mainTab === 'prospects' &&
          STATUS_FILTERS.map((s) => (
            <button
              key={s || 'all'}
              type="button"
              className={styles.filterChip}
              onClick={() => setStatus(s)}
              style={{
                background: status === s ? '#1e3a5f' : '#0f172a',
                border: `1px solid ${status === s ? '#60a5fa' : '#334155'}`,
              }}
            >
              {s ? CALLOUT_STATUS_LABEL[s] : 'Все статусы'}
            </button>
          ))}
        <input
          className={styles.search}
          placeholder={
            mainTab === 'prospects'
              ? 'ИНН, название, телефон…'
              : 'Объект или № закупки…'
          }
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
      </div>

      {loadError && (
        <div style={{ color: '#fca5a5', marginBottom: 12 }}>
          {loadError}
          {/relation|does not exist|42P01/i.test(loadError) && (
            <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 13 }}>
              Нужно применить SQL: <code>scripts/callout-schema.sql</code> в Supabase SQL Editor.
            </div>
          )}
        </div>
      )}

      <div className={styles.workspace}>
        <div className={styles.listCol}>
          {loading ? (
            <div style={{ color: '#94a3b8' }}>Загрузка…</div>
          ) : mainTab === 'prospects' ? (
            <>
              {prospects.length === 0 ? (
                <div style={volumeCardSoftStyle({ padding: 20, color: '#94a3b8' })}>
                  Нет карточек к обзвону
                  {status ? ` со статусом «${CALLOUT_STATUS_LABEL[status]}»` : ''}.
                  {pendingTenders.length > 0 && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className={styles.inlineLink}
                        onClick={() => switchTab('pending')}
                      >
                        Открыть «Без победителя» ({pendingTenders.length})
                      </button>
                    </>
                  )}
                </div>
              ) : (
                prospects.map((p) => {
                  const tenders = tendersByProspect[p.id] || [];
                  const selected = selectedId === p.id;
                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => void loadDetail(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void loadDetail(p.id);
                      }}
                      style={volumeCardSoftStyle({
                        padding: '14px 16px',
                        cursor: 'pointer',
                        outline: selected ? '2px solid #60a5fa' : undefined,
                      })}
                    >
                      <div className={styles.cardTop}>
                        <div className={styles.cardTitle}>
                          {displayOrgName(p)}
                        </div>
                        <span className={styles.badge}>
                          {CALLOUT_STATUS_LABEL[p.status] || p.status}
                        </span>
                        {p.matched_client_id && (
                          <span className={styles.badgeGreen}>
                            <Link2 size={12} /> в Клиентах #{p.matched_client_id}
                          </span>
                        )}
                      </div>
                      <div className={styles.meta}>
                        {p.inn && <span>ИНН {p.inn}</span>}
                        {p.phone ? (
                          <a
                            href={`tel:+${normalizePhone(p.phone)}`}
                            className={styles.phoneLink}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone size={12} style={{ verticalAlign: -1 }} />{' '}
                            {formatPhoneDisplay(p.phone)}
                          </a>
                        ) : (
                          <span className={styles.noPhone}>нет телефона</span>
                        )}
                        {p.email && <span>{p.email}</span>}
                        <span>
                          <MessageSquare size={12} style={{ verticalAlign: -1 }} />{' '}
                          {commentCounts[p.id] || 0}
                        </span>
                        <span>{tenders.length} объект(ов)</span>
                      </div>
                      {tenders[0]?.object_info && (
                        <p className={styles.preview}>{tenders[0].object_info}</p>
                      )}
                    </div>
                  );
                })
              )}
              {filteredTotal > 0 && (
                <>
                  <div
                    style={{
                      color: '#64748B',
                      fontSize: 12,
                      textAlign: 'center',
                      marginTop: 4,
                    }}
                  >
                    Показано {prospects.length} из {filteredTotal}
                    {status || q.trim() ? ' по фильтру' : ''}
                    {totalPages > 1 ? ` · стр. ${page}/${totalPages}` : ''}
                  </div>
                  <AdminPagination
                    page={page}
                    totalPages={totalPages}
                    onPage={setPage}
                    style={{ marginTop: 8 }}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <p className={styles.tabHint}>
                Закупки без победителя (импорт Excel или лид торгов). Подтяни из ЕИС вручную или
                дождись ночного cron.
              </p>
              {filteredPending.length === 0 ? (
                <div style={volumeCardSoftStyle({ padding: 20, color: '#94a3b8' })}>
                  Нет закупок в ожидании контракта.
                </div>
              ) : (
                filteredPending.map((t) => {
                  const selected = selectedPendingId === t.id;
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedPendingId(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setSelectedPendingId(t.id);
                      }}
                      style={volumeCardSoftStyle({
                        padding: '12px 14px',
                        cursor: 'pointer',
                        outline: selected ? '2px solid #fbbf24' : undefined,
                      })}
                    >
                      <div className={styles.cardTop}>
                        <span className={styles.badgeAmber}>
                          {WINNER_LABEL[t.winner_status] || t.winner_status}
                        </span>
                        {t.purchase_number && (
                          <span className={styles.badge}>№ {t.purchase_number}</span>
                        )}
                      </div>
                      <p className={styles.preview}>{t.object_info || 'Без описания объекта'}</p>
                      <div className={styles.meta}>
                        {t.contract_price != null && <span>{money(t.contract_price)}</span>}
                        {t.purchase_url && (
                          <a
                            href={t.purchase_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: '#93c5fd' }}
                          >
                            ЕИС <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        <aside className={styles.detail} style={volumeCardStyle({ padding: 14 })}>
          {mainTab === 'pending' ? (
            !selectedPending ? (
              <div style={{ color: '#94a3b8', fontSize: 14 }}>
                Выбери закупку слева — справа можно подтянуть победителя из реестра контрактов.
              </div>
            ) : (
              <>
                <div className={styles.historyHead}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={styles.historyTitle}>Закупка без победителя</div>
                    <div className={styles.historySub}>
                      {selectedPending.purchase_number
                        ? `№ ${selectedPending.purchase_number}`
                        : 'Номер не указан'}
                    </div>
                  </div>
                </div>
                <p style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.45, margin: '8px 0' }}>
                  {selectedPending.object_info || 'Без описания'}
                </p>
                <div className={styles.meta} style={{ marginBottom: 12 }}>
                  <span>{money(selectedPending.contract_price)}</span>
                  <span>{WINNER_LABEL[selectedPending.winner_status]}</span>
                </div>
                {selectedPending.purchase_url && (
                  <a
                    href={selectedPending.purchase_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#93c5fd', fontSize: 13, marginBottom: 12 }}
                  >
                    Открыть в ЕИС <ExternalLink size={12} />
                  </a>
                )}
                <button
                  type="button"
                  disabled={refreshingTenderId === selectedPending.id}
                  onClick={() => void refreshPendingTender(selectedPending.id)}
                  style={{
                    ...btnPrimary,
                    width: '100%',
                    justifyContent: 'center',
                    marginTop: 8,
                    opacity: refreshingTenderId === selectedPending.id ? 0.7 : 1,
                  }}
                >
                  <RefreshCw
                    size={16}
                    className={
                      refreshingTenderId === selectedPending.id ? styles.spin : undefined
                    }
                  />
                  {refreshingTenderId === selectedPending.id
                    ? 'Ищем в ЕИС…'
                    : 'Подтянуть победителя'}
                </button>
                {refreshingTenderId === selectedPending.id && (
                  <p style={{ color: '#fde68a', fontSize: 13, marginTop: 10 }}>
                    Запрос ушёл. Подожди — ГосПлан иногда отвечает 20–60 секунд. Кнопка снова станет
                    активной, когда закончит.
                  </p>
                )}
                <p style={{ color: '#64748b', fontSize: 12, marginTop: 12, lineHeight: 1.4 }}>
                  Если контракт уже в реестре — создастся карточка во вкладке «К обзвону». Если ещё
                  нет — попробуем позже (cron).
                </p>
              </>
            )
          ) : !detail ? (
            <div style={{ color: '#94a3b8', fontSize: 14 }}>
              Выбери компанию слева — статус, объекты и комментарии по звонкам.
            </div>
          ) : (
            <>
              <div className={styles.historyHead}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.historyTitle}>
                    {displayOrgName(detail.prospect)}
                  </div>
                  <div className={styles.historySub}>
                    {detail.prospect.inn ? `ИНН ${detail.prospect.inn}` : 'ИНН не указан'}
                    {detail.prospect.matched_client_id
                      ? ` · клиент #${detail.prospect.matched_client_id}`
                      : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteProspect(detail.prospect.id)}
                  style={btnDangerSoft}
                  title="Удалить карточку вместе с закупками ЕИС"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className={styles.contactBlock}>
                <div className={styles.contactLabel}>Куда звонить</div>
                {detail.prospect.phone ? (
                  <a
                    href={`tel:+${normalizePhone(detail.prospect.phone)}`}
                    className={styles.phoneBig}
                  >
                    <Phone size={18} />
                    {formatPhoneDisplay(detail.prospect.phone)}
                  </a>
                ) : (
                  <div className={styles.noPhoneBig}>
                    Телефон пока не найден — можно вписать ниже
                  </div>
                )}
                {detail.prospect.email && (
                  <a href={`mailto:${detail.prospect.email}`} className={styles.emailLink}>
                    {detail.prospect.email}
                  </a>
                )}
                <div className={styles.phoneEditRow}>
                  <input
                    className={styles.phoneInput}
                    value={phoneDraft}
                    placeholder="+7 …"
                    onChange={(e) => setPhoneDraft(formatPhoneInput(e.target.value))}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void savePhone()}
                    style={btnGhost}
                  >
                    Сохранить
                  </button>
                </div>
                <p style={{ color: '#64748b', fontSize: 11, margin: '6px 0 0', lineHeight: 1.35 }}>
                  Если автоматом не нашёлся — впиши номер сюда и сохрани. Городские: +7 (код) …,
                  мобильные: +7 9xx ….
                </p>
              </div>

              {detail.prospect.address && (
                <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 10px' }}>
                  {detail.prospect.address}
                </p>
              )}

              <label style={{ color: '#94a3b8', fontSize: 12 }}>Статус</label>
              <select
                value={detail.prospect.status}
                disabled={busy}
                onChange={(e) =>
                  void patchStatus(detail.prospect.id, e.target.value as CalloutStatus)
                }
                className={styles.statusSelect}
              >
                {CALLOUT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CALLOUT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>

              <h3 className={styles.sectionTitle}>Объекты / закупки</h3>
              <div className={styles.tenderList}>
                {(detail.tenders.length ? detail.tenders : selectedTenders).map((t) => (
                  <div key={t.id} className={styles.tenderItem}>
                    <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
                      {t.object_info || t.purchase_number || `Закупка #${t.id}`}
                    </div>
                    <div className={styles.meta}>
                      <span>{WINNER_LABEL[t.winner_status] || t.winner_status}</span>
                      <span>{money(t.contract_price)}</span>
                      {t.purchase_url && (
                        <a
                          href={t.purchase_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#93c5fd' }}
                        >
                          ЕИС
                        </a>
                      )}
                    </div>
                    {(t.winner_status === 'pending' || t.winner_status === 'missing') && (
                      <button
                        type="button"
                        disabled={refreshingTenderId === t.id}
                        onClick={() => void refreshTender(detail.prospect.id, t.id)}
                        style={{ ...btnGhost, marginTop: 6, fontSize: 12 }}
                      >
                        <RefreshCw size={12} /> Обновить победителя
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <h3 className={styles.sectionTitle}>Комментарии</h3>
              <div className={styles.commentList}>
                {detail.comments.map((c) => (
                  <div key={c.id} className={styles.commentItem}>
                    <div className={styles.commentMeta}>
                      {c.user_name || 'Сотрудник'} ·{' '}
                      {new Date(c.created_at).toLocaleString('ru-RU')}
                    </div>
                    <div className={styles.commentBody}>{c.body}</div>
                  </div>
                ))}
                {detail.comments.length === 0 && (
                  <div style={{ color: '#64748b', fontSize: 13 }}>Пока нет комментариев</div>
                )}
              </div>
              <textarea
                className={styles.commentInput}
                rows={3}
                placeholder="Результат звонка…"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !commentText.trim()}
                onClick={() => void sendComment()}
                style={{ ...btnPrimary, marginTop: 8, width: '100%', justifyContent: 'center' }}
              >
                Сохранить комментарий
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const btnPrimary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #4ade80',
  background: 'rgba(74, 222, 128, 0.12)',
  color: '#bbf7d0',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
};

const btnGhost: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: 13,
};

const btnDangerSoft: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 10,
  border: '1px solid #7f1d1d',
  background: 'rgba(127, 29, 29, 0.35)',
  color: '#fecaca',
  cursor: 'pointer',
  fontSize: 12,
};
