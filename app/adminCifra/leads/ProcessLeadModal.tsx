'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { FileUp, X } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  LEAD_CONTRACT_ACCEPT,
  LEAD_CONTRACT_MAX_BYTES,
  isAllowedContractFile,
  type LeadContract,
} from '@/lib/leadContracts';
import { formatPhoneInput } from '@/lib/phone';
import { LEAD_LAW_OPTIONS, LEAD_PLATFORM_OPTIONS, sanitizeDesiredDateForForm, type Lead } from '@/lib/leads';
import { extractFieldsFromStoredPayload, type ParsedTenderFields } from '@/lib/tender/parseTenderPage';
import { useNarrowViewport } from '@/hooks/useNarrowViewport';
import {
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeModalStyle,
} from '../cardStyles';
import ModalSelect from '../components/ModalSelect';

const GRID_COLS = 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))';

type ProcessLeadForm = {
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
};

type SavedContract = LeadContract & { url?: string };

const EMPTY_FORM: ProcessLeadForm = {
  platform: 'ЕИС (zakupki.gov.ru)',
  platform_custom: '',
  purchase_number: '',
  law: '223-ФЗ',
  nmck: '',
  organization_name: '',
  inn: '',
  contact_name: '',
  phone: '+7',
  // Марка/объём — только из ЕИС или вручную; не подставляем «М300» по умолчанию
  grade: '',
  volume_m3: '',
  city: '',
  address: '',
  desired_date: '',
  deadline: '',
  etp_url: '',
  docs_url: '',
  comment: '',
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
  base: ProcessLeadForm,
  parsed: ParsedTenderFields,
  opts?: { overwrite?: boolean },
): ProcessLeadForm {
  const o = opts?.overwrite === true;
  const keep = (cur: string, next: string | null | undefined) => {
    if (next == null || !String(next).trim()) return cur;
    if (o || !cur.trim() || cur === '+7') {
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

  const hasGrade = parsed.grade != null && String(parsed.grade).trim() !== '';
  const hasVolume =
    parsed.volume_m3 != null && Number.isFinite(Number(parsed.volume_m3));

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
    // Марка/объём только из ЕИС; при «Заполнить из ЕИС» без данных — очищаем, не оставляем М300
    grade: hasGrade ? keep(base.grade, parsed.grade) : o ? '' : base.grade,
    volume_m3: hasVolume
      ? keep(base.volume_m3, String(parsed.volume_m3))
      : o
        ? ''
        : base.volume_m3,
    city: keep(base.city, parsed.city),
    address: keep(base.address, parsed.address),
    desired_date: keep(
      base.desired_date,
      parsed.desired_date ? String(parsed.desired_date).slice(0, 10) : null,
    ),
    deadline: keep(base.deadline, parsed.deadline?.slice(0, 10)),
    etp_url: keep(base.etp_url, parsed.etp_url),
    docs_url: keep(base.docs_url, parsed.docs_url),
    comment: keep(base.comment, parsed.comment),
  };
}

function formFromLead(lead: Lead): ProcessLeadForm {
  const p =
    lead.raw_payload && typeof lead.raw_payload === 'object'
      ? lead.raw_payload
      : {};

  const extracted = extractFieldsFromStoredPayload({
    raw: p as Record<string, unknown>,
    body: String(p.comment || lead.raw_text || ''),
    title: lead.name,
    externalUrl: lead.chat_url,
    volumeM3: lead.volume_m3,
    grades: lead.grade ? [lead.grade] : null,
    region: lead.city,
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

  return {
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
      String(p.contact_name || p.full_name || ''),
      extracted.contact_name || undefined,
      // lead.name часто = организация — в «контакт» не подставляем
      lead.name && lead.name.length < 40 && !/унитарн|обществ|муницип/i.test(lead.name)
        ? lead.name
        : undefined,
    ),
    phone: pickStr(lead.phone || undefined, String(p.phone || ''), extracted.phone || undefined, '+7'),
    grade: pickStr(
      lead.grade || undefined,
      String(p.grade || ''),
      extracted.grade || undefined,
    ),
    volume_m3: pickStr(
      lead.volume_m3 != null ? String(lead.volume_m3) : '',
      p.volume_m3 != null && p.volume_m3 !== '' ? String(p.volume_m3) : '',
      extracted.volume_m3 != null ? String(extracted.volume_m3) : '',
    ),
    city: pickStr(
      lead.city || undefined,
      String(p.city || ''),
      extracted.city || undefined,
    ),
    address: pickStr(lead.address || undefined, String(p.address || ''), extracted.address || undefined),
    desired_date: sanitizeDesiredDateForForm(
      lead.desired_date || p.desired_date,
      pickStr(String(p.deadline || ''), extracted.deadline || undefined),
    ),
    deadline: pickStr(String(p.deadline || ''), extracted.deadline || undefined).slice(0, 10),
    etp_url: pickStr(
      String(p.etp_url || ''),
      lead.chat_url || undefined,
      extracted.etp_url || undefined,
    ),
    docs_url: pickStr(String(p.docs_url || ''), extracted.docs_url || undefined),
    comment: pickStr(String(p.comment || ''), lead.raw_text || undefined, extracted.comment || undefined),
  };
}

type Props = {
  open: boolean;
  lead: Lead | null;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
};

export default function ProcessLeadModal({ open, lead, onClose, onSaved }: Props) {
  const narrow = useNarrowViewport();
  const [form, setForm] = useState<ProcessLeadForm>(EMPTY_FORM);
  const [savedFiles, setSavedFiles] = useState<SavedContract[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const busy = saving || uploading || parsing;
  const fieldPad = narrow ? { padding: '10px 12px', fontSize: 14 } : {};

  useEffect(() => {
    if (!open || !lead) return;
    const initial = formFromLead(lead);
    setForm(initial);
    setSavedFiles([]);
    void (async () => {
      try {
        const res = await fetch(`/api/adminCifra/leads/${lead.id}/contracts`, {
          headers: adminCifraAuthHeaders(),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success) {
          setSavedFiles((json.contracts || []) as SavedContract[]);
        }
      } catch {
        /* ignore */
      }

      const parseUrl = initial.etp_url || initial.docs_url;
      const sparse =
        !initial.organization_name ||
        !initial.purchase_number ||
        !initial.nmck ||
        !initial.address;
      // Если в лиде висит дефолтная М300 без объёма — перепроверим по ЕИС
      const suspectDefaultGrade =
        /^м\s*300$/i.test(initial.grade.trim()) && !initial.volume_m3.trim();
      if (parseUrl && (sparse || suspectDefaultGrade)) {
        try {
          setParsing(true);
          const res = await fetch('/api/adminCifra/tender/parse', {
            method: 'POST',
            headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ url: parseUrl }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json.success && json.fields) {
            const fields = json.fields as ParsedTenderFields;
            setForm((f) => {
              const overwriteAll =
                (sparse && (!initial.organization_name || !initial.purchase_number)) ||
                suspectDefaultGrade;
              let next = applyParsedToForm(f, fields, { overwrite: overwriteAll });
              // Марка/объём — только то, что реально есть в ЕИС (не дефолт М300)
              if (!fields.grade || suspectDefaultGrade) {
                next = {
                  ...next,
                  grade: fields.grade ? String(fields.grade).trim() : '',
                };
              }
              if (fields.volume_m3 == null || suspectDefaultGrade) {
                next = {
                  ...next,
                  volume_m3:
                    fields.volume_m3 != null && Number.isFinite(Number(fields.volume_m3))
                      ? String(fields.volume_m3)
                      : '',
                };
              }
              return next;
            });
          }
        } catch {
          /* ignore */
        } finally {
          setParsing(false);
        }
      }
    })();
  }, [open, lead]);

  if (!open || !lead) return null;

  const set = <K extends keyof ProcessLeadForm>(key: K, value: ProcessLeadForm[K]) => {
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
    };
  };

  const fillFromEtpUrl = async (overwrite = false) => {
    const url = form.etp_url.trim() || form.docs_url.trim();
    if (!url) {
      alert('Сначала укажи ссылку на закупку / контракт ЕИС');
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
      const fd = new FormData();
      for (const file of picked.slice(0, 10)) fd.append('files', file);
      const res = await fetch(`/api/adminCifra/leads/${lead.id}/contracts`, {
        method: 'POST',
        headers: adminCifraAuthHeaders(),
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось загрузить файлы');
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

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/adminCifra/leads/${lead.id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ processing: payloadBody() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось сохранить');
        return;
      }
      if (json.callout_watch?.prospect_id && json.callout_watch?.message) {
        alert(`${json.callout_watch.message}\nКарточка — в разделе «Обзвон».`);
      }
      onSaved(json.lead as Lead);
    } catch {
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
              Обработка лида #{lead.id}
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: narrow ? 12 : 13,
                color: '#94A3B8',
                overflowWrap: 'anywhere',
              }}
            >
              {narrow
                ? 'Реквизиты, ссылки и документы'
                : 'Реквизиты закупки, ссылки и документы. Исполнителей назначайте на карточке лида.'}
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
                  />
                </label>
              )}
              <label style={labelStyle}>
                № закупки / извещения
                <input
                  value={form.purchase_number}
                  onChange={(e) => set('purchase_number', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
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
                />
              </label>
              <label style={labelStyle}>
                ИНН
                <input
                  value={form.inn}
                  onChange={(e) => set('inn', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
              <label style={labelStyle}>
                Контактное лицо
                <input
                  value={form.contact_name}
                  onChange={(e) => set('contact_name', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
              <label style={labelStyle}>
                Телефон
                <input
                  value={form.phone}
                  onChange={(e) => set('phone', formatPhoneInput(e.target.value))}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
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
                Марка бетона
                <input
                  value={form.grade}
                  onChange={(e) => set('grade', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="если есть в закупке, напр. М300"
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
                  placeholder="если указан в спецификации"
                />
              </label>
              <label style={labelStyle}>
                Город / регион
                <input
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="из адреса поставки"
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
                Ссылка на закупку / контракт ЕИС
                <input
                  value={form.etp_url}
                  onChange={(e) => set('etp_url', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                  placeholder="https://zakupki.gov.ru/epz/… или ЭТП"
                />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  disabled={busy || !(form.etp_url.trim() || form.docs_url.trim())}
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
                  disabled={busy || !(form.etp_url.trim() || form.docs_url.trim())}
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
              {parsing && (
                <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>
                  Подтягиваю данные лота из ЕИС…
                </p>
              )}
              <label style={labelStyle}>
                Ссылка на документацию
                <input
                  value={form.docs_url}
                  onChange={(e) => set('docs_url', e.target.value)}
                  style={modalFieldStyle({ marginTop: 4, ...fieldPad })}
                />
              </label>
              <label style={labelStyle}>
                Комментарий / суть поставки
                <textarea
                  value={form.comment}
                  onChange={(e) => set('comment', e.target.value)}
                  rows={3}
                  style={modalFieldStyle({ marginTop: 4, resize: 'vertical', ...fieldPad })}
                />
              </label>
            </div>
          </section>

          <section>
            <h3 style={sectionTitle}>Контракты и документы</h3>
            <p style={{ margin: '6px 0 8px', fontSize: 12, color: '#64748B' }}>
              PDF и архивы (zip, rar, 7z…) · до{' '}
              {Math.round(LEAD_CONTRACT_MAX_BYTES / (1024 * 1024))} МБ · до 10 за раз
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
                accept={LEAD_CONTRACT_ACCEPT}
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
                      )}
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
            gap: 8,
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
              padding: narrow ? '7px 12px' : '10px 14px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#CBD5E1',
              cursor: 'pointer',
              fontSize: narrow ? 12 : 14,
            }}
          >
            Закрыть
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            style={{
              padding: narrow ? '7px 14px' : '10px 16px',
              borderRadius: 8,
              border: 'none',
              background: busy ? '#B45309' : '#D97706',
              color: '#fff',
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              fontSize: narrow ? 12 : 14,
            }}
          >
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
