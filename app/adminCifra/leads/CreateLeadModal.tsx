'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { FileUp, X } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  LEAD_CONTRACT_ACCEPT,
  LEAD_CONTRACT_MAX_BYTES,
  isAllowedContractFile,
} from '@/lib/leadContracts';
import { formatPhoneInput } from '@/lib/phone';
import {
  LEAD_LAW_OPTIONS,
  LEAD_MANUAL_CREATE_SOURCES,
  LEAD_PLATFORM_OPTIONS,
  LEAD_SOURCE_LABEL,
  type Lead,
  type LeadManualCreateSource,
} from '@/lib/leads';
import {
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeModalStyle,
} from '../cardStyles';
import ModalSelect from '../components/ModalSelect';

type Employee = {
  user_id: number;
  full_name: string | null;
  organization_name: string | null;
  role: string;
};

export type CreateLeadForm = {
  source: LeadManualCreateSource;
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

const EMPTY_FORM: CreateLeadForm = {
  source: 'tender',
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

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
};

export default function CreateLeadModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<CreateLeadForm>(EMPTY_FORM);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const busy = saving;

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setFiles([]);
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
  }, [open]);

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

  if (!open) return null;

  const set = <K extends keyof CreateLeadForm>(key: K, value: CreateLeadForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next: File[] = [...files];
    for (const file of Array.from(list)) {
      const bad = isAllowedContractFile(file);
      if (bad) {
        alert(`${file.name}: ${bad}`);
        continue;
      }
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      next.push(file);
    }
    setFiles(next.slice(0, 10));
  };

  const submit = async () => {
    const organization = form.organization_name.trim();
    const contact = form.contact_name.trim();
    const phone = form.phone.trim();
    const comment = form.comment.trim();
    const purchase = form.purchase_number.trim();

    if (!organization && !contact && (!phone || phone === '+7') && !comment && !purchase) {
      alert('Укажите заказчика, контакт, номер закупки или комментарий');
      return;
    }

    const platform =
      form.platform === 'Другое'
        ? form.platform_custom.trim() || 'Другое'
        : form.platform;

    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/leads', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          source: form.source,
          platform,
          purchase_number: purchase || null,
          law: form.law || null,
          nmck: form.nmck || null,
          organization_name: organization || null,
          inn: form.inn.trim() || null,
          contact_name: contact || null,
          name: contact || organization || null,
          phone: phone && phone !== '+7' ? phone : null,
          grade: form.grade.trim() || null,
          volume_m3: form.volume_m3 ? Number(form.volume_m3) : null,
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          desired_date: form.desired_date || null,
          deadline: form.deadline || null,
          etp_url: form.etp_url.trim() || null,
          docs_url: form.docs_url.trim() || null,
          comment: comment || null,
          assigned_to: form.assigned_to || null,
          co_assignees: form.co_assignees.map(Number).filter((n) => Number.isFinite(n)),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось создать лид');
        return;
      }

      const lead = json.lead as Lead;

      if (files.length > 0 && lead?.id) {
        const fd = new FormData();
        for (const file of files) fd.append('files', file);
        const up = await fetch(`/api/adminCifra/leads/${lead.id}/contracts`, {
          method: 'POST',
          headers: adminCifraAuthHeaders(),
          body: fd,
        });
        const upJson = await up.json().catch(() => ({}));
        if (!up.ok || !upJson.success) {
          alert(
            upJson.error
              || 'Лид создан, но файлы не загрузились. Проверьте SQL lead-contracts и Storage.',
          );
        }
      }

      onCreated(lead);
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
      onClick={() => !busy && onClose()}
    >
      <div
        style={volumeModalStyle({
          width: '100%',
          maxWidth: 760,
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '20px 22px',
          color: '#E2E8F0',
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#F8FAFC' }}>Новый лид с площадки</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94A3B8' }}>
              Для специалиста по торгам: площадка, реквизиты закупки, контракты и исполнитель
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={onClose}
            style={modalCloseButtonStyle()}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section>
            <h3 style={sectionTitle}>Источник и площадка</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 10,
                marginTop: 8,
              }}
            >
              <label style={labelStyle}>
                Тип источника
                <div style={{ marginTop: 4 }}>
                  <ModalSelect
                    value={form.source}
                    onChange={(v) => set('source', v as LeadManualCreateSource)}
                    options={LEAD_MANUAL_CREATE_SOURCES.map((s) => ({
                      value: s,
                      label: LEAD_SOURCE_LABEL[s] || s,
                      text: LEAD_SOURCE_LABEL[s] || s,
                    }))}
                  />
                </div>
              </label>
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
                    style={modalFieldStyle({ marginTop: 4 })}
                    placeholder="Например, региональный портал"
                  />
                </label>
              )}
              <label style={labelStyle}>
                № закупки / извещения
                <input
                  value={form.purchase_number}
                  onChange={(e) => set('purchase_number', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
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
                  style={modalFieldStyle({ marginTop: 4 })}
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
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 10,
                marginTop: 8,
              }}
            >
              <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
                Организация
                <input
                  value={form.organization_name}
                  onChange={(e) => set('organization_name', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
                  placeholder="ООО «…»"
                />
              </label>
              <label style={labelStyle}>
                ИНН
                <input
                  value={form.inn}
                  onChange={(e) => set('inn', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
                  placeholder="1234567890"
                />
              </label>
              <label style={labelStyle}>
                Контактное лицо
                <input
                  value={form.contact_name}
                  onChange={(e) => set('contact_name', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
                  placeholder="ФИО"
                />
              </label>
              <label style={labelStyle}>
                Телефон
                <input
                  value={form.phone}
                  onChange={(e) => set('phone', formatPhoneInput(e.target.value))}
                  style={modalFieldStyle({ marginTop: 4 })}
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
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 10,
                marginTop: 8,
              }}
            >
              <label style={labelStyle}>
                Марка
                <input
                  value={form.grade}
                  onChange={(e) => set('grade', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
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
                  style={modalFieldStyle({ marginTop: 4 })}
                />
              </label>
              <label style={labelStyle}>
                Город / регион
                <input
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
                />
              </label>
              <label style={labelStyle}>
                Дата поставки
                <input
                  type="date"
                  value={form.desired_date}
                  onChange={(e) => set('desired_date', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
                />
              </label>
              <label style={labelStyle}>
                Дедлайн задания
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => set('deadline', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
                />
              </label>
              <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
                Адрес поставки
                <input
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
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
                  style={modalFieldStyle({ marginTop: 4 })}
                  placeholder="https://…"
                />
              </label>
              <label style={labelStyle}>
                Ссылка на документацию
                <input
                  value={form.docs_url}
                  onChange={(e) => set('docs_url', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4 })}
                  placeholder="https://…"
                />
              </label>
              <label style={labelStyle}>
                Комментарий / суть поставки
                <textarea
                  value={form.comment}
                  onChange={(e) => set('comment', e.target.value)}
                  rows={3}
                  style={modalFieldStyle({ marginTop: 4, resize: 'vertical' })}
                  placeholder="Поставка бетона М200 B15…"
                />
              </label>
            </div>
          </section>

          <section>
            <h3 style={sectionTitle}>Исполнитель и соисполнители</h3>
            <p style={{ margin: '6px 0 8px', fontSize: 12, color: '#64748B' }}>
              Им придёт уведомление: «Вам необходимо взять лид в работу!»
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
              PDF, Word, Excel, изображения · до {Math.round(LEAD_CONTRACT_MAX_BYTES / (1024 * 1024))} МБ
              · до 10 файлов
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
              Выбрать файлы контрактов
              <input
                type="file"
                accept={LEAD_CONTRACT_ACCEPT}
                multiple
                disabled={busy}
                hidden
                onChange={(e) => {
                  onPickFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            {files.length > 0 && (
              <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
                {files.map((f) => (
                  <li
                    key={`${f.name}-${f.size}`}
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
                      {f.name}{' '}
                      <span style={{ color: '#64748B' }}>
                        ({Math.max(1, Math.round(f.size / 1024))} КБ)
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
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
          </section>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 18,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#CBD5E1',
              cursor: 'pointer',
            }}
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: busy ? '#1E40AF' : '#2563EB',
              color: '#fff',
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? 'Сохранение…' : 'Создать лид'}
          </button>
        </div>
      </div>
    </div>
  );
}
