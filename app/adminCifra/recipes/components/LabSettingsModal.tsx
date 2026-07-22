'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { COLORS, overlayStyle, modalStyle, inputStyle, labelStyle, ghostButton, primaryButton } from '../labStyles';
import { useEscapeClose } from '../labUtils';

interface Props {
  onClose: () => void;
}

type LabSettings = {
  org_name?: string;
  org_address?: string;
  inn?: string;
  kpp?: string;
  phone?: string;
  director_name?: string;
  lab_head_name?: string;
  lab_attestat?: string;
  aeff_class?: string;
  declaration_concrete?: string;
  declaration_mortar?: string;
  gost_concrete?: string;
  gost_mortar?: string;
  fsa_url_concrete?: string;
  fsa_url_mortar?: string;
};

const empty: LabSettings = {
  org_name: '',
  org_address: '',
  inn: '',
  kpp: '',
  phone: '',
  director_name: '',
  lab_head_name: '',
  lab_attestat: '',
  aeff_class: '',
  declaration_concrete: '',
  declaration_mortar: '',
  gost_concrete: '',
  gost_mortar: '',
  fsa_url_concrete: '',
  fsa_url_mortar: '',
};

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

function QrPreview({ url, title }: { url: string; title: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let cancelled = false;
    const u = url.trim();
    if (!u) {
      setSrc('');
      return;
    }
    QRCode.toDataURL(u, { margin: 1, width: 120 })
      .then((data) => {
        if (!cancelled) setSrc(data);
      })
      .catch(() => {
        if (!cancelled) setSrc('');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div
      style={{
        background: '#0F172A',
        borderRadius: 12,
        border: `1px solid ${COLORS.border}`,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        minHeight: 160,
        justifyContent: 'center',
      }}
    >
      <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 600 }}>{title}</div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="QR" width={120} height={120} style={{ display: 'block', borderRadius: 4 }} />
      ) : (
        <div style={{ color: COLORS.muted, fontSize: 12, textAlign: 'center', padding: '24px 8px' }}>
          {url.trim() ? 'Не удалось построить QR' : 'Укажите ссылку FSA — появится QR'}
        </div>
      )}
    </div>
  );
}

export default function LabSettingsModal({ onClose }: Props) {
  const [form, setForm] = useState<LabSettings>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEscapeClose(onClose);

  const set = (key: keyof LabSettings, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/adminCifra/lab-settings');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setForm({ ...empty, ...data });
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/lab-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_name: form.org_name || null,
          org_address: form.org_address || null,
          inn: form.inn || null,
          kpp: form.kpp || null,
          phone: form.phone || null,
          director_name: form.director_name || null,
          lab_head_name: form.lab_head_name || null,
          lab_attestat: form.lab_attestat || null,
          aeff_class: form.aeff_class || null,
          declaration_concrete: form.declaration_concrete || null,
          declaration_mortar: form.declaration_mortar || null,
          gost_concrete: form.gost_concrete || null,
          gost_mortar: form.gost_mortar || null,
          fsa_url_concrete: form.fsa_url_concrete || null,
          fsa_url_mortar: form.fsa_url_mortar || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      onClose();
    } catch (e: any) {
      alert(`Ошибка сохранения${e?.message ? `: ${e.message}` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle(720)} onClick={(e) => e.stopPropagation()} className="scroll-hidden">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#fff' }}>Реквизиты лаборатории</h2>
            <p style={{ margin: '6px 0 0', color: COLORS.muted, fontSize: 13, lineHeight: 1.4 }}>
              При обновлении в Росаккредитации замени номер декларации и ссылку FSA — QR пересоберётся сам.
              Новые паспорта и протоколы подхватят данные сразу; старые сохранённые паспорта не меняются.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ ...ghostButton, padding: '8px 14px' }}>✕</button>
        </div>

        {loading ? (
          <p style={{ color: COLORS.muted }}>Загрузка...</p>
        ) : (
          <>
            <h3 style={{ color: COLORS.blue, fontSize: 15, margin: '0 0 12px' }}>Организация</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Наименование" value={form.org_name || ''} onChange={(v) => set('org_name', v)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Адрес" value={form.org_address || ''} onChange={(v) => set('org_address', v)} />
              </div>
              <Field label="ИНН" value={form.inn || ''} onChange={(v) => set('inn', v)} />
              <Field label="КПП" value={form.kpp || ''} onChange={(v) => set('kpp', v)} />
              <Field label="Телефон" value={form.phone || ''} onChange={(v) => set('phone', v)} />
              <Field label="Директор" value={form.director_name || ''} onChange={(v) => set('director_name', v)} />
              <Field label="Нач. лаборатории" value={form.lab_head_name || ''} onChange={(v) => set('lab_head_name', v)} />
              <Field label="Класс Аэфф" value={form.aeff_class || ''} onChange={(v) => set('aeff_class', v)} placeholder="I класс, не более 370 Бк/кг" />
            </div>

            <h3 style={{ color: COLORS.blue, fontSize: 15, margin: '22px 0 12px' }}>Аттестация</h3>
            <Field
              label="Свидетельство об аттестации"
              value={form.lab_attestat || ''}
              onChange={(v) => set('lab_attestat', v)}
              placeholder="Свидетельство об аттестации №…, действует до ДД.ММ.ГГГГ"
            />

            <h3 style={{ color: COLORS.blue, fontSize: 15, margin: '22px 0 12px' }}>Бетон (декларация и QR)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 12 }}>
                <Field label="Номер декларации" value={form.declaration_concrete || ''} onChange={(v) => set('declaration_concrete', v)} />
                <Field label="ГОСТ" value={form.gost_concrete || ''} onChange={(v) => set('gost_concrete', v)} />
                <div>
                  <label style={labelStyle}>Ссылка FSA (для QR)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={form.fsa_url_concrete || ''}
                      onChange={(e) => set('fsa_url_concrete', e.target.value)}
                      placeholder="https://pub.fsa.gov.ru/rds/declaration/view/..."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    {!!form.fsa_url_concrete?.trim() && (
                      <a
                        href={form.fsa_url_concrete}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...ghostButton, padding: '0 14px', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                      >
                        Открыть
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <QrPreview url={form.fsa_url_concrete || ''} title="QR бетона" />
            </div>

            <h3 style={{ color: COLORS.blue, fontSize: 15, margin: '22px 0 12px' }}>Раствор (декларация и QR)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 12 }}>
                <Field label="Номер декларации" value={form.declaration_mortar || ''} onChange={(v) => set('declaration_mortar', v)} />
                <Field label="ГОСТ" value={form.gost_mortar || ''} onChange={(v) => set('gost_mortar', v)} />
                <div>
                  <label style={labelStyle}>Ссылка FSA (для QR)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={form.fsa_url_mortar || ''}
                      onChange={(e) => set('fsa_url_mortar', e.target.value)}
                      placeholder="https://pub.fsa.gov.ru/rds/declaration/view/..."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    {!!form.fsa_url_mortar?.trim() && (
                      <a
                        href={form.fsa_url_mortar}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...ghostButton, padding: '0 14px', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                      >
                        Открыть
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <QrPreview url={form.fsa_url_mortar || ''} title="QR раствора" />
            </div>

            <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={ghostButton}>Отмена</button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                style={{ ...primaryButton(), opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
