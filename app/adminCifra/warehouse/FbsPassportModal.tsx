'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X } from 'lucide-react';
import {
  CARD_BORDER,
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';
import ModalSelect from '../components/ModalSelect';
import { appConfirm } from '../components/appDialog';

type PassportData = Record<string, any>;

interface Props {
  fbsOptions: Array<{ id: number; name: string; current?: number }>;
  existingRecord?: any | null;
  userName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function field(
  label: string,
  key: string,
  data: PassportData,
  setData: (fn: (d: PassportData) => PassportData) => void,
  opts?: { wide?: boolean; type?: string },
) {
  return (
    <div style={{ gridColumn: opts?.wide ? '1 / -1' : undefined }}>
      <label style={{ display: 'block', color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>{label}</label>
      <input
        type={opts?.type || 'text'}
        value={data[key] ?? ''}
        onChange={(e) => setData((d) => ({ ...d, [key]: e.target.value }))}
        style={modalFieldStyle({ padding: '10px 12px', fontSize: 14 })}
      />
    </div>
  );
}

export default function FbsPassportModal({ fbsOptions, existingRecord, userName, onClose, onSaved }: Props) {
  const [data, setData] = useState<PassportData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recordId, setRecordId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (existingRecord) {
          setRecordId(existingRecord.id);
          setData({
            ...(existingRecord.payload || {}),
            passport_no: existingRecord.passport_no || existingRecord.payload?.passport_no || '',
          });
        } else {
          const res = await fetch('/api/adminCifra/fbs-passports?defaults=1');
          const draft = res.ok ? await res.json() : {};
          setRecordId(null);
          setData(draft);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [existingRecord]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        id: recordId,
        passport_no: data.passport_no,
        payload: data,
        user_name: userName || null,
        created_by_name: userName || null,
      };
      const res = await fetch('/api/adminCifra/fbs-passports', {
        method: recordId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || 'Ошибка сохранения');
        return;
      }
      if (json.id) setRecordId(json.id);
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      alert('Ошибка соединения');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!recordId) return;
    if (!(await appConfirm('Удалить паспорт и вернуть блоки на склад?', {
      variant: 'danger',
      okLabel: 'Удалить',
      title: 'Удаление',
    }))) return;
    const qs = new URLSearchParams({ id: String(recordId) });
    if (userName) qs.set('user_name', userName);
    const res = await fetch(`/api/adminCifra/fbs-passports?${qs}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error || 'Ошибка удаления');
      return;
    }
    onSaved();
    onClose();
  };

  const printPassport = async () => {
    let qrDataUrl = '';
    if (data.fsa_url) {
      try {
        qrDataUrl = await QRCode.toDataURL(String(data.fsa_url), { margin: 1, width: 140 });
      } catch (e) {
        console.warn('QR generation failed:', e);
      }
    }

    const esc = (v: any) => (v == null ? '' : String(v));
    const row = (label: string, value: any) =>
      `<tr><td class="l">${label}</td><td class="v">${esc(value)}</td></tr>`;

    const stamp = new Date().toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const markQty = [esc(data.fbs_mark), data.quantity ? `${esc(data.quantity)} шт` : '']
      .filter(Boolean)
      .join('&nbsp;&nbsp;&nbsp;');

    const declBlock = `Декларация о соответствии ${esc(data.declaration_no)}${
      data.decl_reg_date ? `<br/>дата регистрации ${esc(data.decl_reg_date)}` : ''
    }`;

    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Паспорт ФБС ${esc(data.passport_no)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: 'Times New Roman', serif;
    color: #000;
    margin: 0;
    font-size: 12.5px;
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 18px 22px 16px;
    min-height: 100%;
  }
  .topbar { display: flex; justify-content: space-between; font-size: 10.5px; color: #333; margin-bottom: 8px; flex-shrink: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; flex-shrink: 0; }
  .org { font-size: 12px; line-height: 1.45; }
  .org b { font-size: 26px; }
  .decl { margin-top: 8px; font-size: 11.5px; line-height: 1.4; }
  .qr { text-align: center; font-size: 10px; }
  .qr img { width: 112px; height: 112px; display: block; }
  h1 { text-align: center; font-size: 15px; font-weight: bold; margin: 12px 0 2px; flex-shrink: 0; }
  .sub { text-align: center; font-size: 13px; font-weight: bold; margin-bottom: 10px; flex-shrink: 0; }
  table { width: 100%; border-collapse: collapse; flex: 0 0 auto; margin: 0; }
  td { border: 1px solid #000; padding: 5.5px 9px; vertical-align: middle; line-height: 1.38; }
  td.l { width: 58%; }
  td.v { font-weight: bold; }
  .note {
    margin-top: 12px; font-size: 11px; font-style: italic;
    text-align: justify; line-height: 1.4; flex-shrink: 0;
  }
  .sign {
    margin-top: 28px; min-height: 72px; font-size: 12.5px;
    display: flex; justify-content: space-between; align-items: flex-end; flex-shrink: 0;
  }
  .sign-right { text-align: right; }
  .sign .cap { display: block; font-size: 10px; margin-top: 2px; }
  @page { size: A4; margin: 0; }
  @media print {
    html, body { height: 297mm; }
    .page { min-height: 297mm; padding: 11mm 13mm 14mm; }
    .sign { margin-top: 32px; min-height: 80px; }
  }
</style></head><body>
  <div class="page">
  <div class="topbar"><span>${stamp}</span><span>Паспорт ${esc(data.passport_no)}</span></div>
  <div class="head">
    <div class="org">
      <b>${esc(data.org_name)}</b><br/>
      ${esc(data.org_address)}<br/>
      ИНН ${esc(data.inn)} / КПП ${esc(data.kpp)}<br/>
      тел. ${esc(data.phone)}
      <div class="decl">${declBlock}</div>
    </div>
    <div class="qr">
      ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR"/><div>Росаккредитация</div>` : ''}
    </div>
  </div>

  <h1>ТЕХНИЧЕСКИЙ ПАСПОРТ № ${esc(data.passport_no) || '_______'}</h1>
  <div class="sub">на железобетонное изделие / партию изделий</div>

  <table>
    ${row('Выдан', [data.consumer, data.issue_date].filter(Boolean).join(', '))}
    ${row('Наименование изделия', data.product_name)}
    ${row('Марка и число изделий', markQty)}
    ${row('Дата изготовления изделий', data.manufacture_date)}
    ${row('Марка (класс) бетона', data.concrete_grade)}
    ${row('Отпускная прочность бетона', data.release_strength_pct)}
    ${row('Требуемая отпускная прочность бетона при фактическом коэффициенте вариации прочности бетона', data.required_release_strength)}
    ${row('Фактическая отпускная прочность бетона', data.actual_release_strength)}
    ${row('Марка бетона по морозостойкости', data.frost_resistance)}
    ${row('Марка бетона по водонепроницаемости', data.water_resistance)}
    ${row('Средняя плотность (объемная масса) бетона', data.avg_density)}
    ${row('Марка стали закладных изделий и выпусков арматуры', data.embedded_steel)}
    ${row('Марка стали арматурного каркаса', data.rebar_steel)}
    ${row('Класс материалов по удельной эффективной активности естественных радионуклидов и значение Аэфф, Бк/кг', data.aeff_class)}
    ${row('Категория лицевых бетонных поверхностей', data.surface_category)}
    ${row('Обозначение стандарта', data.gost)}
  </table>

  <div class="note">Примечание: Предприятие гарантирует, что прочность бетона (при хранении контрольных образцов в нормальных условиях по ГОСТ 10180-2012) достигает требуемой прочности, соответствующей проектной марке в возрасте бетона 28 суток со дня изготовления изделия.</div>

  <div class="sign">
    <div>Нач. лаборатории ${esc(data.org_name)}</div>
    <div class="sign-right">
      <div>_______________ / ${esc(data.lab_head_name)}</div>
      <span class="cap">подпись, фамилия, инициалы</span>
    </div>
  </div>
  </div>
</body></html>`;

    const prev = document.getElementById('lab-print-frame');
    if (prev) prev.remove();
    const iframe = document.createElement('iframe');
    iframe.id = 'lab-print-frame';
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, {
      position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0',
    });
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      alert('Не удалось подготовить документ для печати');
      return;
    }
    let printed = false;
    const doPrint = () => {
      if (printed) return;
      printed = true;
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error(e);
      }
    };
    doc.open();
    doc.write(html);
    doc.close();
    if (iframe.contentWindow) iframe.contentWindow.onload = () => setTimeout(doPrint, 150);
    setTimeout(doPrint, 500);
  };

  const selectedStock = fbsOptions.find((b) => b.name === data.fbs_mark);

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
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={volumeModalStyle({
          width: 'min(720px, 100%)',
          maxHeight: '92vh',
          borderRadius: 22,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>
            {recordId ? 'Паспорт ФБС' : 'Выписка ФБС'}
          </h2>
          <button type="button" title="Закрыть" onClick={onClose} style={modalCloseButtonStyle()}>
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div style={{ color: '#94A3B8', padding: 24, textAlign: 'center' }}>Загрузка…</div>
        ) : (
          <div className="scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {field('Номер партии', 'passport_no', data, setData)}
              {field('Дата выдачи', 'issue_date', data, setData)}

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>
                  Организация (кому выдан)
                </label>
                <input
                  value={data.consumer ?? ''}
                  onChange={(e) => setData((d) => ({ ...d, consumer: e.target.value }))}
                  placeholder="ООО «…»"
                  style={modalFieldStyle({ padding: '10px 12px', fontSize: 14 })}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>
                  Марка ФБС
                </label>
                <ModalSelect
                  value={data.fbs_mark || ''}
                  onChange={(v) => setData((d) => ({ ...d, fbs_mark: v }))}
                  placeholder="Выберите тип…"
                  options={fbsOptions.map((b) => ({
                    value: b.name,
                    label: `${b.name} (${Number(b.current || 0)} шт)`,
                    text: b.name,
                  }))}
                />
                {selectedStock != null && (
                  <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
                    На складе: {Number(selectedStock.current || 0)} шт
                  </div>
                )}
              </div>

              {field('Количество, шт', 'quantity', data, setData, { type: 'number' })}
              {field('Наименование изделия', 'product_name', data, setData, { wide: true })}
              {field('Дата изготовления', 'manufacture_date', data, setData)}
              {field('Марка (класс) бетона', 'concrete_grade', data, setData)}
              {field('Отпускная прочность', 'release_strength_pct', data, setData)}
              {field('Требуемая отпускная прочность', 'required_release_strength', data, setData)}
              {field('Фактическая отпускная прочность', 'actual_release_strength', data, setData)}
              {field('Морозостойкость', 'frost_resistance', data, setData)}
              {field('Водонепроницаемость', 'water_resistance', data, setData)}
              {field('Средняя плотность', 'avg_density', data, setData)}
              {field('Сталь закладных', 'embedded_steel', data, setData)}
              {field('Арматурный каркас', 'rebar_steel', data, setData)}
              {field('Аэфф', 'aeff_class', data, setData, { wide: true })}
              {field('Категория поверхности', 'surface_category', data, setData)}
              {field('Стандарт', 'gost', data, setData)}
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 16,
            paddingTop: 14,
            borderTop: CARD_BORDER,
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          {recordId ? (
            <button
              type="button"
              onClick={remove}
              style={volumeCardSoftStyle({
                padding: '10px 16px',
                borderRadius: 12,
                color: '#F87171',
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid rgba(248,113,113,0.35)',
              })}
            >
              Удалить
            </button>
          ) : null}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={volumeCardSoftStyle({
              padding: '10px 16px',
              borderRadius: 12,
              color: '#94A3B8',
              fontWeight: 600,
              cursor: 'pointer',
            })}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={printPassport}
            disabled={loading}
            style={volumeCardSoftStyle({
              padding: '10px 16px',
              borderRadius: 12,
              color: '#E2E8F0',
              fontWeight: 600,
              cursor: 'pointer',
            })}
          >
            Печать
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            style={{
              padding: '10px 18px',
              borderRadius: 12,
              border: 'none',
              background: '#10B981',
              color: '#fff',
              fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Сохранение…' : recordId ? 'Сохранить' : 'Выписать и списать'}
          </button>
        </div>
      </div>
    </div>
  );
}
