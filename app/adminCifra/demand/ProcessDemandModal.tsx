'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { FileUp, X } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  DEMAND_CONTRACT_ACCEPT,
  DEMAND_CONTRACT_MAX_BYTES,
  isAllowedContractFile,
  type DemandContract,
} from '@/lib/demandContracts';
import { formatPhoneInput } from '@/lib/phone';
import { LEAD_LAW_OPTIONS, LEAD_PLATFORM_OPTIONS, sanitizeDesiredDateForForm } from '@/lib/leads';
import { extractFieldsFromStoredPayload, type ParsedTenderFields } from '@/lib/tender/parseTenderPage';
import { useNarrowViewport } from '@/hooks/useNarrowViewport';
import type { DemandItemRow } from '@/hooks/useRealtimeDemand';
import {
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeModalStyle,
} from '../cardStyles';
import ModalSelect from '../components/ModalSelect';

const GRID_COLS = 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))';

type SavedContract = DemandContract & { url?: string };

type Employee = {
  user_id: number;
  full_name: string | null;
  organization_name: string | null;
  role: string;
};

export type ProcessDemandForm = {
  platform: string;
  platform_custom: string;
  purchase_number: string;
  law: string;
  nmck: string;
  organization_name: string;
  inn: string;
  contact_name: string;
  phone: string;
  grade: string;
  volume_m3: string;
  city: string;
  address: string;
  desired_date: string;
  deadline: string;
  etp_url: string;
  docs_url: string;
  comment: string;
  assigned_to: string;
  co_assignees: string[];
};

const EMPTY_FORM: ProcessDemandForm = {
  platform: 'ЕИС (zakupki.gov.ru)',
  platform_custom: '',
  purchase_number: '',
  law: '223-ФЗ',
  nmck: '',
  organization_name: '',
  inn: '',
  contact_name: '',
  phone: '+7',
  grade: 'М300',
  volume_m3: '',
  city: 'Брянск',
  address: '',
  desired_date: '',
  deadline: '',
  etp_url: '',
  docs_url: '',
  comment: '',
  assigned_to: '',
  co_assignees: [],
};

const labelStyle: CSSProperties = { fontSize: 13, color: '#94A3B8', display: 'block' };
const sectionTitle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 14,
  fontWeight: 700,
  color: '#F8FAFC',
};

function pickStr(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function applyParsedToForm(
  base: ProcessDemandForm,
  parsed: ParsedTenderFields,
  opts?: { overwrite?: boolean },
): ProcessDemandForm {
  const o = opts?.overwrite === true;
  const keep = (cur: string, next: string | null | undefined) => {
    if (next == null || !String(next).trim()) return cur;
    if (o || !cur.trim() || cur === '+7' || cur === EMPTY_FORM.grade || cur === EMPTY_FORM.city) {
      return String(next).trim();
    }
    return cur;
  };

  const platformRaw = pickStr(parsed.platform);
  let platform = base.platform;
  let platform_custom = base.platform_custom;
  if (platformRaw) {
    if ((LEAD_PLATFORM_OPTIONS as readonly string[]).includes(platformRaw)) {
      platform = platformRaw;
      platform_custom = '';
    } else if (o || !base.platform || base.platform === EMPTY_FORM.platform) {
      platform = 'Другое';
      platform_custom = platformRaw;
    }
  }

  return {
    ...base,
    platform,
    platform_custom,
    purchase_number: keep(base.purchase_number, parsed.purchase_number),
    law: keep(base.law, parsed.law),
    nmck: keep(base.nmck, parsed.nmck),
    organization_name: keep(base.organization_name, parsed.organization_name),
    inn: keep(base.inn, parsed.inn),
    contact_name: keep(base.contact_name, parsed.contact_name),
    phone: keep(base.phone, parsed.phone),
    grade: keep(base.grade, parsed.grade),
    volume_m3: keep(
      base.volume_m3,
      parsed.volume_m3 != null ? String(parsed.volume_m3) : null,
    ),
    city: keep(base.city, parsed.city),
    address: keep(base.address, parsed.address),
    deadline: keep(base.deadline, parsed.deadline?.slice(0, 10)),
    etp_url: keep(base.etp_url, parsed.etp_url),
    docs_url: keep(base.docs_url, parsed.docs_url),
    comment: keep(base.comment, parsed.comment),
  };
}

function formFromItem(item: DemandItemRow): ProcessDemandForm {
  const raw = item.raw_payload && typeof item.raw_payload === 'object' ? item.raw_payload : {};
  const p =
    raw.processing && typeof raw.processing === 'object'
      ? (raw.processing as Record<string, unknown>)
      : {};

  const extracted = extractFieldsFromStoredPayload({
    raw,
    body: item.body,
    title: item.title,
    externalUrl: item.external_url,
    volumeM3: item.volume_m3,
    grades: item.grades,
    region: item.region,
  });

  const platformRaw = pickStr(
    String(p.platform || p.platform_name || ''),
    extracted.platform || undefined,
  );
  const knownPlatform = (LEAD_PLATFORM_OPTIONS as readonly string[]).includes(platformRaw)
    ? platformRaw
    : platformRaw
      ? 'Другое'
      : extracted.platform &&
          (LEAD_PLATFORM_OPTIONS as readonly string[]).includes(extracted.platform)
        ? extracted.platform
        : EMPTY_FORM.platform;

  const base: ProcessDemandForm = {
    platform: knownPlatform,
    platform_custom:
      knownPlatform === 'Другое' && platformRaw && platformRaw !== 'Другое' ? platformRaw : '',
    purchase_number: pickStr(String(p.purchase_number || ''), extracted.purchase_number || undefined),
    law: pickStr(String(p.law || ''), extracted.law || undefined, EMPTY_FORM.law),
    nmck: pickStr(
      p.nmck != null && p.nmck !== '' ? String(p.nmck) : '',
      extracted.nmck || undefined,
    ),
    organization_name: pickStr(
      String(p.organization_name || ''),
      extracted.organization_name || undefined,
    ),
    inn: pickStr(String(p.inn || ''), extracted.inn || undefined),
    contact_name: pickStr(
      String(p.contact_name || p.name || ''),
      extracted.contact_name || undefined,
    ),
    phone: pickStr(String(p.phone || ''), extracted.phone || undefined, '+7'),
    grade: pickStr(
      String(p.grade || ''),
      item.grades?.[0],
      extracted.grade || undefined,
      EMPTY_FORM.grade,
    ),
    volume_m3: pickStr(
      p.volume_m3 != null && p.volume_m3 !== '' ? String(p.volume_m3) : '',
      item.volume_m3 != null ? String(item.volume_m3) : '',
      extracted.volume_m3 != null ? String(extracted.volume_m3) : '',
    ),
    city: pickStr(
      String(p.city || ''),
      item.region || undefined,
      extracted.city || undefined,
      EMPTY_FORM.city,
    ),
    address: pickStr(String(p.address || ''), extracted.address || undefined),
    desired_date: sanitizeDesiredDateForForm(
      p.desired_date,
      pickStr(String(p.deadline || ''), extracted.deadline || undefined),
    ),
    deadline: pickStr(String(p.deadline || ''), extracted.deadline || undefined).slice(0, 10),
    etp_url: pickStr(
      String(p.etp_url || ''),
      item.external_url || undefined,
      extracted.etp_url || undefined,
    ),
    docs_url: pickStr(String(p.docs_url || ''), extracted.docs_url || undefined),
    comment: pickStr(String(p.comment || ''), item.body || undefined, extracted.comment || undefined),
    assigned_to: p.assigned_to != null && p.assigned_to !== '' ? String(p.assigned_to) : '',
    co_assignees: Array.isArray(p.co_assignees)
      ? p.co_assignees.map((id) => String(id)).filter(Boolean)
      : [],
  };
  return base;
}

type Props = {
  open: boolean;
  item: DemandItemRow | null;
  onClose: () => void;
  onSent: (leadId: number) => void;
  onDraftSaved: (item: DemandItemRow) => void;
};

export default function ProcessDemandModal({
  open,
  item,
  onClose,
  onSent,
  onDraftSaved,
}: Props) {
  const narrow = useNarrowViewport();
  const [form, setForm] = useState<ProcessDemandForm>(EMPTY_FORM);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [savedFiles, setSavedFiles] = useState<SavedContract[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fieldPad = narrow ? { padding: '10px 12px', fontSize: 14 } : {};
  const busy = saving || uploading || parsing;

  useEffect(() => {
    if (!open || !item) return;
    const initial = formFromItem(item);
    setForm(initial);
    setSavedFiles([]);
    void (async () => {
      try {
        const [contractsRes, empRes] = await Promise.all([
          fetch(`/api/adminCifra/demand/${item.id}/contracts`, {
            headers: adminCifraAuthHeaders(),
          }),
          fetch('/api/adminCifra/employees', { headers: adminCifraAuthHeaders() }),
        ]);
        const contractsJson = await contractsRes.json().catch(() => ({}));
        if (contractsRes.ok && contractsJson.success) {
          setSavedFiles((contractsJson.contracts || []) as SavedContract[]);
        }
        const empJson = await empRes.json().catch(() => ({}));
        setEmployees(empJson.employees || []);
      } catch {
        /* ignore */
      }

      // Если клиент пустой / нет номера закупки — подтянуть с ЕИС (даже по ссылке lot-online).
      if (initial.etp_url && (!initial.organization_name || !initial.purchase_number)) {
        try {
          setParsing(true);
          const res = await fetch('/api/adminCifra/tender/parse', {
            method: 'POST',
            headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ url: initial.etp_url }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json.success && json.fields) {
            setForm((f) =>
              applyParsedToForm(f, json.fields as ParsedTenderFields, { overwrite: true }),
            );
          }
        } catch {
          /* ignore */
        } finally {
          setParsing(false);
        }
      }
    })();
  }, [open, item]);

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

  const coAddOptions = useMemo(
    () =>
      employees
        .filter((emp) => {
          const id = String(emp.user_id);
          if (id === form.assigned_to) return false;
          if (form.co_assignees.includes(id)) return false;
          return true;
        })
        .map((emp) => {
          const display =
            emp.organization_name && emp.organization_name.trim()
              ? emp.organization_name
              : emp.full_name || 'Без имени';
          const label = `${display} (${emp.role})`;
          return { value: String(emp.user_id), label, text: label };
        }),
    [employees, form.assigned_to, form.co_assignees],
  );

  const empLabel = (id: string) =>
    employeeOptions.find((o) => o.value === id)?.text || `Сотрудник #${id}`;

  if (!open || !item) return null;

  const set = <K extends keyof ProcessDemandForm>(key: K, value: ProcessDemandForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const platformResolved =
    form.platform === 'Другое'
      ? form.platform_custom.trim() || 'Другое'
      : form.platform;

  const payloadBody = () => {
    const phone = form.phone.trim();
    return {
      platform: platformResolved,
      purchase_number: form.purchase_number.trim() || null,
      law: form.law || null,
      nmck: form.nmck || null,
      organization_name: form.organization_name.trim() || null,
      inn: form.inn.trim() || null,
      contact_name: form.contact_name.trim() || null,
      phone: phone && phone !== '+7' ? phone : null,
      grade: form.grade.trim() || null,
      volume_m3: form.volume_m3 ? Number(form.volume_m3) : null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      desired_date: form.desired_date || null,
      deadline: form.deadline || null,
      etp_url: form.etp_url.trim() || null,
      docs_url: form.docs_url.trim() || null,
      comment: form.comment.trim() || null,
      assigned_to: form.assigned_to || null,
      co_assignees: form.co_assignees.map(Number).filter((n) => Number.isFinite(n)),
    };
  };

  const fillFromEtpUrl = async (overwrite = false) => {
    const url = form.etp_url.trim();
    if (!url) {
      alert('Сначала укажи ссылку на закупку (ЭТП)');
      return;
    }
    setParsing(true);
    try {
      const res = await fetch('/api/adminCifra/tender/parse', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось разобрать страницу');
        return;
      }
      setForm((f) =>
        applyParsedToForm(f, json.fields as ParsedTenderFields, { overwrite }),
      );
    } catch {
      alert('Ошибка соединения при разборе ЭТП');
    } finally {
      setParsing(false);
    }
  };

  const onPickFiles = async (list: FileList | null) => {
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
    if (picked.length === 0) return;

    setUploading(true);
    try {
      // Сначала сохраняем черновик полей и статус processing — чтобы документ не «повис».
      await fetch(`/api/adminCifra/demand/${item.id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: 'processing', processing: payloadBody() }),
      });

      const fd = new FormData();
      for (const file of picked.slice(0, 10)) fd.append('files', file);
      const res = await fetch(`/api/adminCifra/demand/${item.id}/contracts`, {
        method: 'POST',
        headers: adminCifraAuthHeaders(),
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(
          json.error ||
            'Не удалось загрузить файлы. Выполните SQL demand-contracts-schema.sql в Supabase.',
        );
        return;
      }
      const uploaded = (json.contracts || []) as SavedContract[];
      setSavedFiles((prev) => [...uploaded, ...prev]);
    } catch {
      alert('Ошибка соединения при загрузке файлов');
    } finally {
      setUploading(false);
    }
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/adminCifra/demand/${item.id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          status: 'processing',
          processing: payloadBody(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось сохранить черновик');
        return;
      }
      onDraftSaved(json.item as DemandItemRow);
    } catch {
      alert('Ошибка соединения с сервером');
    } finally {
      setSaving(false);
    }
  };

  const sendToLeads = async () => {
    const organization = form.organization_name.trim();
    const contact = form.contact_name.trim();
    const phone = form.phone.trim();
    const comment = form.comment.trim();
    const purchase = form.purchase_number.trim();

    if (!organization && !contact && (!phone || phone === '+7') && !comment && !purchase) {
      alert('Укажите заказчика, контакт, номер закупки или комментарий');
      return;
    }
    if (!form.assigned_to && form.co_assignees.length === 0) {
      alert('Назначьте исполнителя или соисполнителя перед отправкой в работу');
      return;
    }

    setSaving(true);
    try {
      // Сохраняем черновик в статусе «Обработка», затем создаём лид и шлём задание.
      await fetch(`/api/adminCifra/demand/${item.id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          status: 'processing',
          processing: payloadBody(),
        }),
      });

      const res = await fetch(`/api/adminCifra/demand/${item.id}/take`, {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payloadBody()),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось отправить в работу');
        return;
      }
      if (json.warning) {
        alert(`Лид создан, но: ${json.warning}`);
      }

      const leadId = json.lead?.id as number | undefined;
      if (leadId) onSent(leadId);
      else alert('Лид создан, но id не получен');
    } catch (e) {
      console.error(e);
      alert('Ошибка соединения с сервером');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        zIndex: 10000,
        display: 'flex',
        alignItems: narrow ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: narrow ? 0 : 12,
      }}
      onClick={() => !busy && onClose()}
    >
      <div
        style={volumeModalStyle({
          width: '100%',
          maxWidth: narrow ? '100%' : 760,
          maxHeight: narrow ? '78dvh' : '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: narrow ? '12px 12px 10px' : '20px 22px',
          borderRadius: narrow ? '16px 16px 0 0' : 22,
          color: '#E2E8F0',
          minWidth: 0,
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 10,
            marginBottom: narrow ? 8 : 14,
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: narrow ? 16 : 18, color: '#F8FAFC' }}>
              Обработка заявки
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: narrow ? 12 : 13, color: '#94A3B8' }}>
              {narrow
                ? 'Документы → исполнители → отправить'
                : 'Торги → документы → назначьте исполнителей → «Отправить в работу».'}
            </p>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: narrow ? 12 : 13,
                color: '#CBD5E1',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                maxHeight: narrow ? 40 : undefined,
                overflow: narrow ? 'hidden' : undefined,
                display: narrow ? '-webkit-box' : undefined,
                WebkitLineClamp: narrow ? 2 : undefined,
                WebkitBoxOrient: narrow ? 'vertical' : undefined,
              }}
            >
              {item.title}
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={onClose}
            style={modalCloseButtonStyle()}
          >
            <X size={narrow ? 16 : 18} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: narrow ? 10 : 14,
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <section>
            <h3 style={sectionTitle}>Площадка и закупка</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLS,
                gap: narrow ? 8 : 10,
                marginTop: 8,
              }}
            >
              <label style={labelStyle}>
                Площадка
                <div style={{ marginTop: 4 }}>
                  <ModalSelect
                    value={form.platform}
                    onChange={(v) => set('platform', v)}
                    options={LEAD_PLATFORM_OPTIONS.map((p) => ({
                      value: p,
                      label: p,
                      text: p,
                    }))}
                  />
                </div>
              </label>
              {form.platform === 'Другое' && (
                <label style={labelStyle}>
                  Название площадки
                  <input
                    value={form.platform_custom}
                    onChange={(e) => set('platform_custom', e.target.value)}
                    style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                    placeholder="Например, региональный портал"
                  />
                </label>
              )}
              <label style={labelStyle}>
                № закупки / извещения
                <input
                  value={form.purchase_number}
                  onChange={(e) => set('purchase_number', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="32616135594"
                />
              </label>
              <label style={labelStyle}>
                Закон
                <div style={{ marginTop: 4 }}>
                  <ModalSelect
                    value={form.law}
                    onChange={(v) => set('law', v)}
                    options={LEAD_LAW_OPTIONS.map((l) => ({ value: l, label: l, text: l }))}
                  />
                </div>
              </label>
              <label style={labelStyle}>
                НМЦК, ₽
                <input
                  value={form.nmck}
                  onChange={(e) => set('nmck', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="184933"
                  inputMode="decimal"
                />
              </label>
            </div>
          </section>

          <section>
            <h3 style={sectionTitle}>Заказчик</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLS,
                gap: narrow ? 8 : 10,
                marginTop: 8,
              }}
            >
              <label style={{ ...labelStyle, gridColumn: '1 / -1', minWidth: 0 }}>
                Организация
                <input
                  value={form.organization_name}
                  onChange={(e) => set('organization_name', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="ООО «…»"
                />
              </label>
              <label style={labelStyle}>
                ИНН
                <input
                  value={form.inn}
                  onChange={(e) => set('inn', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="1234567890"
                />
              </label>
              <label style={labelStyle}>
                Контактное лицо
                <input
                  value={form.contact_name}
                  onChange={(e) => set('contact_name', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="ФИО"
                />
              </label>
              <label style={labelStyle}>
                Телефон
                <input
                  value={form.phone}
                  onChange={(e) => set('phone', formatPhoneInput(e.target.value))}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="+7…"
                />
              </label>
            </div>
          </section>

          <section>
            <h3 style={sectionTitle}>Поставка</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLS,
                gap: narrow ? 8 : 10,
                marginTop: 8,
              }}
            >
              <label style={labelStyle}>
                Марка
                <input
                  value={form.grade}
                  onChange={(e) => set('grade', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
              <label style={labelStyle}>
                Объём, м³
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={form.volume_m3}
                  onChange={(e) => set('volume_m3', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
              <label style={labelStyle}>
                Город / регион
                <input
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
              <label style={labelStyle}>
                Дата поставки
                <input
                  type="date"
                  value={form.desired_date}
                  onChange={(e) => set('desired_date', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
              <label style={labelStyle}>
                Окончание подачи заявок
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => set('deadline', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
              <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
                Адрес поставки
                <input
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
            </div>
          </section>

          <section>
            <h3 style={sectionTitle}>Ссылки и комментарий</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              <label style={labelStyle}>
                Ссылка на закупку (ЭТП)
                <input
                  value={form.etp_url}
                  onChange={(e) => set('etp_url', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="https://tender.lot-online.ru/…"
                />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  disabled={busy || !form.etp_url.trim()}
                  onClick={() => void fillFromEtpUrl(true)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #334155',
                    background: '#1E2937',
                    color: '#E2E8F0',
                    cursor: busy ? 'wait' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {parsing ? 'Читаю ЕИС…' : 'Заполнить из ЕИС'}
                </button>
                <button
                  type="button"
                  disabled={busy || !form.etp_url.trim()}
                  onClick={() => void fillFromEtpUrl(false)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #334155',
                    background: 'transparent',
                    color: '#94A3B8',
                    cursor: busy ? 'wait' : 'pointer',
                    fontSize: 13,
                  }}
                >
                  Дозаполнить пустые
                </button>
              </div>
              <label style={labelStyle}>
                Ссылка на документацию
                <input
                  value={form.docs_url}
                  onChange={(e) => set('docs_url', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="https://…"
                />
              </label>
              <label style={labelStyle}>
                Комментарий / суть поставки
                <textarea
                  value={form.comment}
                  onChange={(e) => set('comment', e.target.value)}
                  rows={3}
                  style={modalFieldStyle({ marginTop: 4, resize: 'vertical', ...fieldPad })}
                  placeholder="Поставка бетона М200 B15…"
                />
              </label>
            </div>
          </section>

          <section>
            <h3 style={sectionTitle}>Исполнитель и соисполнители</h3>
            <p style={{ margin: '6px 0 8px', fontSize: 12, color: '#64748B' }}>
              При отправке в работу им придёт: «Вам необходимо взять лид в работу!»
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={labelStyle}>
                Ответственный исполнитель
                <div style={{ marginTop: 4 }}>
                  <ModalSelect
                    value={form.assigned_to}
                    onChange={(v) => {
                      setForm((f) => ({
                        ...f,
                        assigned_to: v,
                        co_assignees: v
                          ? f.co_assignees.filter((id) => id !== v)
                          : f.co_assignees,
                      }));
                    }}
                    placeholder="Выберите сотрудника"
                    options={employeeOptions}
                  />
                </div>
              </label>
              <label style={labelStyle}>
                Добавить соисполнителя
                <div style={{ marginTop: 4 }}>
                  <ModalSelect
                    value=""
                    onChange={(v) => {
                      if (!v) return;
                      setForm((f) => ({
                        ...f,
                        co_assignees: f.co_assignees.includes(v)
                          ? f.co_assignees
                          : [...f.co_assignees, v],
                      }));
                    }}
                    placeholder="Выберите соисполнителя"
                    options={[
                      { value: '', label: 'Выберите…', text: 'Выберите…' },
                      ...coAddOptions,
                    ]}
                  />
                </div>
              </label>
              {form.co_assignees.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {form.co_assignees.map((id) => (
                    <li
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 0',
                        borderBottom: '1px solid #1E293B',
                        fontSize: 13,
                        color: '#E2E8F0',
                      }}
                    >
                      <span>{empLabel(id)}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            co_assignees: f.co_assignees.filter((x) => x !== id),
                          }))
                        }
                        style={{
                          border: 'none',
                          background: 'none',
                          color: '#FCA5A5',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        Убрать
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h3 style={sectionTitle}>Контракты и документы</h3>
            <p style={{ margin: '6px 0 8px', fontSize: 12, color: '#64748B' }}>
              Файлы сразу сохраняются в хранилище Supabase. Допустимы PDF и архивы (zip, rar, 7z,
              tar, gz) — до {Math.round(DEMAND_CONTRACT_MAX_BYTES / (1024 * 1024))} МБ, до 10 за раз.
              При отправке в лиды файлы переносятся на карточку лида.
            </p>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px 12px',
                borderRadius: 12,
                border: '1px dashed #475569',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#CBD5E1',
                cursor: busy ? 'wait' : 'pointer',
                fontSize: 14,
              }}
            >
              <FileUp size={18} color="#FACC15" />
              {uploading ? 'Загрузка…' : 'Загрузить документы'}
              <input
                type="file"
                accept={DEMAND_CONTRACT_ACCEPT}
                multiple
                disabled={busy}
                hidden
                onChange={(e) => {
                  void onPickFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            {savedFiles.length > 0 && (
              <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
                {savedFiles.map((f) => (
                  <li
                    key={f.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 0',
                      borderBottom: '1px solid #1E293B',
                      fontSize: 13,
                      color: '#E2E8F0',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer" style={{ color: '#93C5FD' }}>
                          {f.file_name}
                        </a>
                      ) : (
                        f.file_name
                      )}{' '}
                      <span style={{ color: '#64748B' }}>
                        ({Math.max(1, Math.round((f.size_bytes || 0) / 1024))} КБ)
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: narrow ? 10 : 18,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            flexShrink: 0,
            paddingTop: narrow ? 8 : 0,
            borderTop: narrow ? '1px solid #1E293B' : undefined,
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style={{
              padding: narrow ? '7px 10px' : '10px 14px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#CBD5E1',
              cursor: 'pointer',
              fontSize: narrow ? 11 : 14,
            }}
          >
            Закрыть
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveDraft()}
            style={{
              padding: narrow ? '7px 10px' : '10px 14px',
              borderRadius: 8,
              border: '1px solid #065F46',
              background: 'transparent',
              color: '#6EE7B7',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: narrow ? 11 : 14,
            }}
          >
            {busy ? '…' : narrow ? 'Черновик' : 'Сохранить черновик'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendToLeads()}
            style={{
              padding: narrow ? '7px 12px' : '10px 16px',
              borderRadius: 8,
              border: 'none',
              background: busy ? '#047857' : '#059669',
              color: '#fff',
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              fontSize: narrow ? 11 : 14,
            }}
          >
            {busy ? 'Отправка…' : narrow ? 'В работу' : 'Отправить в работу'}
          </button>
        </div>
      </div>
    </div>
  );
}
