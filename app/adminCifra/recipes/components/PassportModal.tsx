'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { COLORS, overlayStyle, modalStyle, inputStyle, labelStyle, ghostButton, primaryButton } from '../labStyles';

interface Props {
  orderId?: number | null;
  specId?: number | null;
  initialDocKind?: 'concrete' | 'mortar';
  onClose: () => void;
  /** вызывается после сохранения паспорта (для обновления списка заявок) */
  onSaved?: (orderId: number | null) => void;
}

type PassportData = Record<string, any>;

// Формирует условное обозначение вида смеси по образцу паспорта:
//   Бетон:  БСТ В30 М400 F75 W8 П3 ГОСТ 7473-2010
//   Раствор: М150 Пк4 ГОСТ 28013-98
function composeDesignation(d: PassportData): string {
  if (d.doc_kind === 'mortar') {
    return [d.grade, d.slump, d.gost].filter(Boolean).join(' ');
  }
  return ['БСТ', d.strength_class, d.grade, d.frost_resistance, d.water_resistance, d.slump, d.gost]
    .filter(Boolean)
    .join(' ');
}

export default function PassportModal({ orderId, specId, initialDocKind = 'concrete', onClose, onSaved }: Props) {
  const [docKind, setDocKind] = useState<'concrete' | 'mortar'>(initialDocKind);
  const [data, setData] = useState<PassportData>({ doc_kind: initialDocKind });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // id уже сохранённого паспорта этого заказа — чтобы правки перезаписывали
  // существующую запись, а не создавали дубликат.
  const [recordId, setRecordId] = useState<number | null>(null);

  const loadAutofill = async (kind: 'concrete' | 'mortar') => {
    setLoading(true);
    try {
      if (orderId) {
        const res = await fetch(`/api/adminCifra/concrete-passports?autofill=${orderId}&doc_kind=${kind}`);
        if (res.ok) {
          const draft = await res.json();
          draft.designation = composeDesignation(draft);
          draft.issue_date = new Date().toLocaleDateString('ru-RU');
          if (!draft.decl_reg_date) draft.decl_reg_date = kind === 'mortar' ? '' : '18.12.2023';
          setData(draft);
        }
      } else {
        // Без заказа — тянем только реквизиты лаборатории.
        const res = await fetch('/api/adminCifra/lab-settings');
        const s = res.ok ? await res.json() : {};
        setData({
          doc_kind: kind,
          org_name: s.org_name || '',
          org_address: s.org_address || '',
          inn: s.inn || '',
          kpp: s.kpp || '',
          phone: s.phone || '',
          lab_head_name: s.lab_head_name || '',
          aeff_class: s.aeff_class || '',
          gost: kind === 'mortar' ? s.gost_mortar : s.gost_concrete,
          declaration_no: kind === 'mortar' ? s.declaration_mortar : s.declaration_concrete,
          fsa_url: kind === 'mortar' ? s.fsa_url_mortar : s.fsa_url_concrete,
          decl_reg_date: kind === 'mortar' ? '' : '18.12.2023',
          issue_date: new Date().toLocaleDateString('ru-RU'),
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // При открытии — если по заказу уже есть паспорт, загружаем именно его
  // (сохранённые данные + id для перезаписи). Иначе собираем черновик.
  const initPassport = async () => {
    setLoading(true);
    try {
      // Ищем уже сохранённый паспорт по заказу (или по спецификации).
      const q = orderId ? `order_id=${orderId}` : specId ? `spec_id=${specId}` : '';
      if (q) {
        const res = await fetch(`/api/adminCifra/concrete-passports?${q}`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            const rec = list[0]; // роут отдаёт по created_at desc — берём последний
            const kind = rec.doc_kind === 'mortar' ? 'mortar' : 'concrete';
            setRecordId(rec.id);
            setDocKind(kind);
            setData({ ...(rec.payload || {}), doc_kind: kind });
            setLoading(false);
            return;
          }
        }
      }
      await loadAutofill(initialDocKind);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  useEffect(() => {
    initPassport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Переключение Бетон/Раствор пересобирает черновик под нужный вид.
  // recordId сохраняется — сохранение всё равно обновит ту же запись.
  const changeKind = (kind: 'concrete' | 'mortar') => {
    if (kind === docKind) return;
    setDocKind(kind);
    loadAutofill(kind);
  };

  const set = (key: string, value: any) => setData((prev) => ({ ...prev, [key]: value }));

  const savePassport = async () => {
    setSaving(true);
    try {
      const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
      const isUpdate = recordId != null;
      const res = await fetch('/api/adminCifra/concrete-passports', {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isUpdate ? { id: recordId } : { created_by: userId ? Number(userId) : null }),
          passport_no: data.batch_no || null,
          doc_kind: docKind,
          order_id: orderId ?? null,
          spec_id: specId ?? null,
          payload: data,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      const saved = await res.json();
      if (!isUpdate && saved?.id) setRecordId(saved.id);
      // Сообщаем родителю (список заявок сразу пометит заказ «с паспортом»)
      // и закрываем модалку — кнопка тут же становится «Паспорт».
      onSaved?.(orderId ?? null);
      onClose();
    } catch (e) {
      alert('Ошибка сохранения');
      setSaving(false);
    }
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

    const isMortar = docKind === 'mortar';
    // Словоформы по виду документа (родительный падеж «смеси»).
    const mix = isMortar ? 'растворной' : 'бетонной';       // ... смеси
    const material = isMortar ? 'раствора' : 'бетона';       // ... прочность раствора/бетона
    const unit = isMortar ? 'кгс/см²' : 'МПа';
    const title = isMortar
      ? 'ДОКУМЕНТ О КАЧЕСТВЕ РАСТВОРНОЙ СМЕСИ'
      : 'ДОКУМЕНТ О КАЧЕСТВЕ БЕТОННОЙ СМЕСИ';

    // Марка по удобоукладываемости (бетон) / подвижности (раствор)
    const flowLabel = isMortar
      ? `Марка растворной смеси по подвижности или значение подвижности растворной смеси (по договору на поставку) на месте укладки у потребителя`
      : `Марка бетонной смеси по удобоукладываемости или значение удобоукладываемости бетонной смеси (по договору на поставку) на месте укладки у потребителя`;

    const strengthTitle = isMortar
      ? `Марка раствора по прочности и требуемая прочность раствора в партии:`
      : `Проектный класс бетона по прочности и требуемая прочность бетона в партии:`;
    const strengthClassLabel = isMortar ? '(марка прочности)' : '(класс прочности)';

    const esc = (v: any) => (v == null ? '' : String(v));
    const row = (label: string, value: any) =>
      `<tr><td class="l">${label}</td><td class="v">${esc(value)}</td></tr>`;

    // Составная строка прочности: 28 сут (проектный возраст) + промежуточный возраст.
    const strength28 = [esc(data.strength_class || data.grade), data.actual_strength_28 ? `${esc(data.actual_strength_28)} ${unit}` : '']
      .filter(Boolean)
      .join('&nbsp;&nbsp;&nbsp;');
    const strength7 = data.actual_strength_7 ? `${esc(data.actual_strength_7)} ${unit}` : `&nbsp;`;
    const strengthRow = `
    <tr>
      <td class="l">
        ${strengthTitle}<br/>
        &nbsp;&nbsp;– в проектном возрасте 28 сут ${strengthClassLabel};<br/>
        &nbsp;&nbsp;– в промежуточном возрасте (при необходимости)
      </td>
      <td class="v">
        <span class="dim">(требуемая прочность по договору на&nbsp;поставку)</span><br/>
        ${strength28}<br/>
        ${strength7}
      </td>
    </tr>`;

    const declBlock = `Декларация о соответствии ${esc(data.declaration_no)}${
      data.decl_reg_date ? `<br/>дата регистрации ${esc(data.decl_reg_date)}` : ''
    }`;

    // Верхняя техническая строка (как браузерный колонтитул, но своя — печатается
    // всегда): дата/время слева, «Паспорт №» справа. Нижний браузерный
    // колонтитул при этом убран через @page { margin: 0 }.
    const stamp = new Date().toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const topbar = `<div class="topbar"><span>${stamp}</span><span>Паспорт ${esc(data.batch_no)}</span></div>`;

    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Паспорт ${esc(data.batch_no)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; color: #000; margin: 20px 24px; font-size: 12.5px; }
  .topbar { display: flex; justify-content: space-between; font-size: 10.5px; color: #333; margin-bottom: 8px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
  .org { font-size: 12px; line-height: 1.45; }
  .org b { font-size: 27px; }
  .decl { margin-top: 8px; font-size: 11.5px; }
  .qr { text-align: center; font-size: 10px; }
  .qr img { width: 118px; height: 118px; display: block; }
  h1 { text-align: center; font-size: 14px; font-weight: bold; margin: 14px 0 2px; }
  .sub { text-align: center; font-size: 13px; font-weight: bold; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  td { border: 1px solid #000; padding: 4px 8px; vertical-align: top; line-height: 1.35; }
  td.l { width: 60%; }
  td.v { font-weight: bold; }
  td.v .dim { font-weight: normal; font-size: 10.5px; font-style: italic; }
  .note { margin-top: 14px; font-size: 11px; font-style: italic; text-align: justify; }
  .sign { margin-top: 26px; font-size: 12.5px; display: flex; justify-content: space-between; align-items: flex-end; }
  .sign-right { text-align: right; }
  .sign-line { white-space: nowrap; }
  .sign .cap { display: block; font-size: 10px; color: #000; margin-top: 2px; }
  /* margin:0 у @page убирает браузерные колонтитулы (дата, заголовок, URL сайта) */
  @page { size: A4; margin: 0; }
  @media print { body { margin: 10mm 12mm; } }
</style></head><body>
  ${topbar}
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

  <h1>${title}</h1>
  <div class="sub">ЗАДАННОГО КАЧЕСТВА ПАРТИИ №${esc(data.batch_no) || '_______'}</div>

  <table>
    ${row(`Производитель и поставщик ${mix} смеси`, data.org_name)}
    ${row('Потребитель, адрес', [data.consumer, data.consumer_address].filter(Boolean).join(', '))}
    ${row(`Дата и время отгрузки ${mix} смеси`, data.shipment_date)}
    ${row(`Вид ${mix} смеси и её условное обозначение`, data.designation || composeDesignation(data))}
    ${row(`Номер номинального состава ${mix} смеси`, data.mix_no)}
    ${row(`Объём ${mix} смеси в партии, м³`, data.volume)}
    ${row(flowLabel, data.slump)}
    ${row(`Другие нормируемые показатели качества на месте укладки у потребителя`, data.other_site_props)}
    ${row('Сохраняемость удобоукладываемости и других нормируемых показателей, ч-мин', data.keeping_min)}
    ${row('Наибольшая крупность заполнителя, мм', data.max_aggregate)}
    ${strengthRow}
    ${row(`Другие нормируемые показатели качества ${material}`, data.other_material_props)}
    ${row('Наименование, масса добавки (в расчёте на сухое вещество), кг/м³', data.additive)}
    ${row('Класс материалов по удельной эффективной активности естественных радионуклидов и значение Аэфф, Бк/кг', data.aeff_class)}
    ${row('Дата выдачи', data.issue_date)}
  </table>

  <div class="note">Примечание: Предприятие гарантирует соответствие продукции требованиям настоящего стандарта при условии соблюдения транспортными организациями правил транспортирования, а потребителем – условий применения.</div>

  <div class="sign">
    <div class="sign-role">Нач. лаборатории ${esc(data.org_name)}</div>
    <div class="sign-right">
      <div class="sign-line">_______________ / ${esc(data.lab_head_name)}</div>
      <span class="cap">подпись, фамилия, инициалы</span>
    </div>
  </div>
</body></html>`;

    // Печать через скрытый iframe. window.open('_blank') + w.print() в
    // Яндекс.Браузере часто блокируется попап-фильтром и намертво подвешивает
    // основную вкладку. iframe печатает надёжно и не трогает главное окно.
    const prev = document.getElementById('lab-print-frame');
    if (prev) prev.remove();

    const iframe = document.createElement('iframe');
    iframe.id = 'lab-print-frame';
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      opacity: '0',
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
        console.error('Print failed:', e);
      }
    };

    doc.open();
    doc.write(html);
    doc.close();

    // Печатаем после отрисовки (в т.ч. QR-картинки). onload + таймер-фолбэк,
    // guard printed предотвращает двойной вызов.
    if (iframe.contentWindow) iframe.contentWindow.onload = () => setTimeout(doPrint, 150);
    setTimeout(doPrint, 500);
  };

  const field = (label: string, key: string, type: string = 'text') => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        value={data[key] ?? ''}
        onChange={(e) => set(key, type === 'number' ? Number(e.target.value) : e.target.value)}
        style={inputStyle}
      />
    </div>
  );

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle(720)} onClick={(e) => e.stopPropagation()} className="scroll-hidden">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '20px', color: '#fff', margin: 0 }}>Паспорт качества</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => changeKind('concrete')}
              style={{ ...ghostButton, background: docKind === 'concrete' ? COLORS.accentDark : '#334155', color: '#fff' }}
            >
              Бетон
            </button>
            <button
              onClick={() => changeKind('mortar')}
              style={{ ...ghostButton, background: docKind === 'mortar' ? COLORS.accentDark : '#334155', color: '#fff' }}
            >
              Раствор
            </button>
          </div>
        </div>

        {loading ? (
          <p style={{ color: COLORS.muted }}>Загрузка данных...</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {field('Номер партии', 'batch_no')}
              {field('№ номинального состава', 'mix_no')}
              {field('Потребитель', 'consumer')}
              {field('Адрес потребителя', 'consumer_address')}
              {field('Дата отгрузки', 'shipment_date')}
              {field('Объём в партии, м³', 'volume', 'number')}
              {field('Марка (M)', 'grade')}
              {field('Класс (B)', 'strength_class')}
              {field('Морозостойкость (F)', 'frost_resistance')}
              {field('Водонепроницаемость (W)', 'water_resistance')}
              {field('Подвижность (П/Пк)', 'slump')}
              {field('Крупность заполнителя', 'max_aggregate')}
              {field('Сохраняемость', 'keeping_min')}
              {field('Добавка, кг/м³', 'additive')}
              {field('Требуемая прочность 28 сут', 'actual_strength_28', 'number')}
              {field('Прочность 7 сут', 'actual_strength_7', 'number')}
              {field('Дата выдачи', 'issue_date')}
              {field('Нач. лаборатории', 'lab_head_name')}
            </div>

            <div style={{ marginTop: '14px' }}>
              <label style={labelStyle}>Условное обозначение (для печати)</label>
              <input value={data.designation ?? ''} onChange={(e) => set('designation', e.target.value)} style={inputStyle} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '14px' }}>
              {field('Дата регистрации декларации', 'decl_reg_date')}
              {field('Номер партии (для заголовка)', 'batch_no')}
            </div>

            <div style={{ marginTop: '12px', color: COLORS.muted, fontSize: '13px' }}>
              Декларация: {data.declaration_no || '—'} · {data.gost || '—'} · QR: {data.fsa_url ? 'есть' : 'нет ссылки'}
            </div>

            <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  ...ghostButton,
                  background: 'transparent',
                  border: `1px solid ${COLORS.border}`,
                  color: '#E2E8F0',
                }}
              >
                Закрыть
              </button>
              <button
                onClick={savePassport}
                disabled={saving}
                style={{
                  ...primaryButton(COLORS.blue),
                  opacity: saving ? 0.6 : 1,
                  cursor: saving ? 'default' : 'pointer',
                }}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={printPassport} style={primaryButton()}>Печать</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
