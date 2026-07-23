'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { COLORS, overlayStyle, modalStyle, inputStyle, labelStyle, ghostButton, primaryButton } from '../labStyles';
import { useEscapeClose } from '../labUtils';
import ModalSelect from '../../components/ModalSelect';
import { appConfirm } from '../../components/appDialog';

interface Props {
  orderId?: number | null;
  specId?: number | null;
  initialDocKind?: 'concrete' | 'mortar';
  onClose: () => void;
  /** вызывается после сохранения паспорта (для обновления списка заявок) */
  onSaved?: (orderId: number | null) => void;
  /** Если передан — открываем именно эту запись паспорта (без доп. запроса) */
  existingRecord?: any | null;
  /** true = принудительно создаём новый, не загружаем существующий */
  isNewPassport?: boolean;
  /** сколько паспортов уже есть у этой заявки (для авто-суффикса номера) */
  passportCount?: number;
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

export default function PassportModal({ orderId, specId, initialDocKind = 'concrete', onClose, onSaved, existingRecord, isNewPassport, passportCount = 0 }: Props) {
  const [docKind, setDocKind] = useState<'concrete' | 'mortar'>(initialDocKind);
  const [data, setData] = useState<PassportData>({ doc_kind: initialDocKind });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // id уже сохранённого паспорта этого заказа — чтобы правки перезаписывали
  // существующую запись, а не создавали дубликат.
  const [recordId, setRecordId] = useState<number | null>(null);
  // Рейсы миксеров этой заявки (для dropdown в форме)
  const [orderMixers, setOrderMixers] = useState<any[]>([]);

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
          // Привязка к заявке: номер партии по умолчанию = № заявки.
          // Второй и далее — «429/2», «429/3»… (база = batch_no / mix_no / №заявки)
          if (!draft.batch_no) {
            if (passportCount > 0) {
              const raw = String(draft.mix_no || orderId || 'п').replace(/\/\d+$/, '');
              draft.batch_no = `${raw || orderId || 'п'}/${passportCount + 1}`;
            } else {
              draft.batch_no = String(orderId);
            }
          } else if (passportCount > 0) {
            const raw = String(draft.batch_no).replace(/\/\d+$/, '');
            draft.batch_no = `${raw || orderId}/${passportCount + 1}`;
          }
          draft.order_id = orderId;
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
          // Добавка по умолчанию: бетон — ПФМ-НЛК, раствор — ЛинамиксР.
          additive: kind === 'mortar' ? 'ЛинамиксР' : 'ПФМ-НЛК',
          max_aggregate: kind === 'mortar' ? '' : '20мм',
          issue_date: new Date().toLocaleDateString('ru-RU'),
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // При открытии — загружаем данные паспорта:
  // 1. Если передан existingRecord — открываем его напрямую (без запроса)
  // 2. Если isNewPassport — создаём новый черновик (autofill)
  // 3. Иначе — старое поведение: ищем последний сохранённый паспорт
  const initPassport = async () => {
    setLoading(true);
    try {
      if (existingRecord) {
        const kind = existingRecord.doc_kind === 'mortar' ? 'mortar' : 'concrete';
        setRecordId(existingRecord.id);
        setDocKind(kind);
        setData({
          ...(existingRecord.payload || {}),
          doc_kind: kind,
          // Сохраняем привязку к заявке даже если в payload её нет
          order_id: existingRecord.order_id ?? existingRecord.payload?.order_id ?? orderId ?? null,
        });
        setLoading(false);
        return;
      }

      if (isNewPassport) {
        // Явно сбрасываем id — иначе при переиспользовании модалки
        // второй паспорт может уйти в PUT и «перезаписать» первый.
        setRecordId(null);
        await loadAutofill(initialDocKind);
        return;
      }

      // Старое поведение: ищем последний сохранённый паспорт по заказу/спецификации
      const q = orderId ? `order_id=${orderId}` : specId ? `spec_id=${specId}` : '';
      if (q) {
        const res = await fetch(`/api/adminCifra/concrete-passports?${q}`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            const rec = list[0];
            const kind = rec.doc_kind === 'mortar' ? 'mortar' : 'concrete';
            setRecordId(rec.id);
            setDocKind(kind);
            setData({
              ...(rec.payload || {}),
              doc_kind: kind,
              order_id: rec.order_id ?? rec.payload?.order_id ?? orderId ?? null,
            });
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

  // Загружаем рейсы миксеров для этой заявки (если есть orderId)
  useEffect(() => {
    if (!orderId) return;
    fetch(`/api/adminCifra/order-mixers?orderId=${orderId}`)
      .then(r => r.ok ? r.json() : [])
      .then((list: any[]) => setOrderMixers(list))
      .catch(() => {});
  }, [orderId]);

  useEffect(() => {
    initPassport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEscapeClose(onClose);

  // Переключение Бетон/Раствор:
  // — для уже сохранённого паспорта только меняем вид/ГОСТ/декларацию (без autofill),
  //   чтобы не затереть данные и не перезаписать «чужой» черновик;
  // — для нового — пересобираем autofill, recordId остаётся null.
  const changeKind = async (kind: 'concrete' | 'mortar') => {
    if (kind === docKind) return;
    setDocKind(kind);
    if (recordId != null) {
      try {
        const res = await fetch('/api/adminCifra/lab-settings');
        const s = res.ok ? await res.json() : {};
        setData((prev) => {
          const next: PassportData = {
            ...prev,
            doc_kind: kind,
            gost: kind === 'mortar' ? s.gost_mortar : s.gost_concrete,
            declaration_no: kind === 'mortar' ? s.declaration_mortar : s.declaration_concrete,
            fsa_url: kind === 'mortar' ? s.fsa_url_mortar : s.fsa_url_concrete,
            max_aggregate: kind === 'mortar' ? '' : (prev.max_aggregate || '20мм'),
          };
          next.designation = composeDesignation(next);
          return next;
        });
      } catch (e) {
        console.error(e);
        setData((prev) => ({ ...prev, doc_kind: kind }));
      }
      return;
    }
    await loadAutofill(kind);
  };

  const set = (key: string, value: any) => setData((prev) => ({ ...prev, [key]: value }));

  const savePassport = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
      // Новый паспорт всегда INSERT, даже если recordId случайно остался от прошлой сессии.
      const isUpdate = !isNewPassport && recordId != null;
      const res = await fetch('/api/adminCifra/concrete-passports', {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isUpdate ? { id: recordId } : { created_by: userId ? Number(userId) : null }),
          passport_no: data.batch_no ? String(data.batch_no) : null,
          doc_kind: docKind,
          // Не затираем привязку: prop → payload → уже сохранённая запись
          order_id: orderId ?? data.order_id ?? existingRecord?.order_id ?? null,
          spec_id: specId ?? null,
          payload: { ...data, order_id: orderId ?? data.order_id ?? existingRecord?.order_id ?? null },
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      const saved = await res.json();
      if (!isUpdate && saved?.id) setRecordId(saved.id);
      // Сообщаем родителю (список заявок сразу пометит заказ «с паспортом»)
      // и закрываем модалку — кнопка тут же становится «Паспорт».
      onSaved?.(orderId ?? null);
      onClose();
    } catch (e: any) {
      alert(`Ошибка сохранения паспорта${e?.message ? `: ${e.message}` : ''}`);
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
    // Данные прочности приходят из испытаний в МПа — единицу не подменяем.
    const unit = 'МПа';
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
    // Слева в таблице уже подпись «требуемая прочность…» — в значении префиксы не нужны.
    const strength28 = [
      esc(data.strength_class || data.grade),
      data.required_strength_28 != null && data.required_strength_28 !== ''
        ? `${esc(data.required_strength_28)} ${unit}`
        : data.actual_strength_28 != null && data.actual_strength_28 !== ''
          ? `${esc(data.actual_strength_28)} ${unit}`
          : '',
    ]
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
    const orderLabel = orderId || data.order_id;
    const topbar = `<div class="topbar"><span>${stamp}</span><span>${
      orderLabel ? `Заявка №${esc(orderLabel)} · ` : ''
    }Паспорт ${esc(data.batch_no)}</span></div>`;

    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Паспорт ${esc(data.batch_no)}</title>
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
  h1 { text-align: center; font-size: 14.5px; font-weight: bold; margin: 12px 0 3px; flex-shrink: 0; }
  .sub { text-align: center; font-size: 13px; font-weight: bold; margin-bottom: 10px; flex-shrink: 0; }
  /* Чуть выше исходного, но без растягивания на весь лист */
  table {
    width: 100%;
    border-collapse: collapse;
    flex: 0 0 auto;
    margin: 0;
  }
  td {
    border: 1px solid #000;
    padding: 5.5px 9px;
    vertical-align: middle;
    line-height: 1.38;
  }
  td.l { width: 58%; }
  td.v { font-weight: bold; }
  td.v .dim { font-weight: normal; font-size: 10.5px; font-style: italic; }
  .note {
    margin-top: 12px;
    font-size: 11px;
    font-style: italic;
    text-align: justify;
    line-height: 1.4;
    flex-shrink: 0;
  }
  /* Место под подпись и круглую печать организации */
  .sign {
    margin-top: 28px;
    min-height: 72px;
    font-size: 12.5px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-shrink: 0;
  }
  .sign-right { text-align: right; }
  .sign-line { white-space: nowrap; }
  .sign .cap { display: block; font-size: 10px; color: #000; margin-top: 2px; }
  /* margin:0 у @page убирает браузерные колонтитулы (дата, заголовок, URL сайта) */
  @page { size: A4; margin: 0; }
  @media print {
    html, body { height: 297mm; }
    .page {
      min-height: 297mm;
      padding: 11mm 13mm 14mm;
    }
    td { padding: 5.5px 9px; }
    .sign { margin-top: 32px; min-height: 80px; }
  }
</style></head><body>
  <div class="page">
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
    ${isMortar ? '' : row('Наибольшая крупность заполнителя, мм', data.max_aggregate)}
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
          <h2 style={{ fontSize: '20px', color: '#fff', margin: 0 }}>
            {recordId ? 'Редактирование паспорта' : 'Новый паспорт качества'}
            {(orderId || data.order_id) && (
              <span style={{ color: COLORS.blue, fontSize: '15px', marginLeft: '10px' }}>
                Заявка №{orderId || data.order_id}
              </span>
            )}
            {data.batch_no && <span style={{ color: COLORS.muted, fontSize: '15px', marginLeft: '10px' }}>· партия {data.batch_no}</span>}
            {data.mixer_number && <span style={{ color: COLORS.blue, fontSize: '14px', marginLeft: '8px' }}>· {data.mixer_number}</span>}
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => changeKind('concrete')}
              style={{
                ...ghostButton,
                ...(docKind === 'concrete' ? { background: COLORS.accentDark } : {}),
                color: '#fff',
              }}
            >
              Бетон
            </button>
            <button
              onClick={() => changeKind('mortar')}
              style={{
                ...ghostButton,
                ...(docKind === 'mortar' ? { background: COLORS.accentDark } : {}),
                color: '#fff',
              }}
            >
              Раствор
            </button>
          </div>
        </div>

        {loading ? (
          <p style={{ color: COLORS.muted }}>Загрузка данных...</p>
        ) : (
          <>
            {/* Привязка к рейсу миксера — показываем только если есть рейсы */}
            {orderMixers.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <label style={labelStyle}>Миксер / рейс</label>
                <ModalSelect
                  value={data.mixer_number || ''}
                  onChange={(val) => {
                    if (!val) {
                      set('mixer_number', '');
                      return;
                    }
                    const trip = orderMixers.find((m: any) => String(m.mixer_name || m.number || '') === val);
                    setData((prev) => {
                      const time = trip?.time ? String(trip.time).slice(0, 5) : '';
                      const prevShip = String(prev.shipment_date || '');
                      const dateMatch = prevShip.match(/^(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})/);
                      const datePart = dateMatch?.[1] || '';
                      let shipment_date = prevShip;
                      if (time) {
                        shipment_date = datePart
                          ? `${datePart} ${time}`
                          : (prevShip && !/^\d{1,2}:\d{2}/.test(prevShip.trim())
                            ? `${prevShip} ${time}`
                            : time);
                      }
                      return {
                        ...prev,
                        mixer_number: val,
                        volume: trip?.volume ?? prev.volume,
                        shipment_date,
                      };
                    });
                  }}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  placeholder="— не привязан —"
                  options={[
                    { value: '', label: '— не привязан —' },
                    ...orderMixers.map((m: any, i: number) => {
                      const num = m.mixer_name || m.number || `Рейс ${i + 1}`;
                      const vol = m.volume ? ` · ${m.volume} м³` : '';
                      const t = m.time ? ` · ${String(m.time).slice(0, 5)}` : '';
                      const label = `${num}${vol}${t}`;
                      return { value: String(num), label, text: label };
                    }),
                  ]}
                />
              </div>
            )}

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
              {docKind !== 'mortar' && field('Крупность заполнителя', 'max_aggregate')}
              {field('Сохраняемость', 'keeping_min')}
              {field('Добавка, кг/м³', 'additive')}
              {field('Требуемая прочность 28 сут', 'required_strength_28', 'number')}
              {field('Фактическая прочность 28 сут', 'actual_strength_28', 'number')}
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
            </div>

            <div style={{ marginTop: '12px', color: COLORS.muted, fontSize: '13px' }}>
              Декларация: {data.declaration_no || '—'} · {data.gost || '—'} · QR: {data.fsa_url ? 'есть' : 'нет ссылки'}
            </div>

            <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {recordId != null && (
                <button
                  onClick={async () => {
                    if (!(await appConfirm('Удалить этот паспорт?', { variant: 'danger', okLabel: 'Удалить', title: 'Удаление' }))) return;
                    try {
                      const res = await fetch(`/api/adminCifra/concrete-passports?id=${recordId}`, { method: 'DELETE' });
                      if (!res.ok) throw new Error('delete failed');
                      onSaved?.(orderId ?? null);
                      onClose();
                    } catch {
                      alert('Ошибка удаления паспорта');
                    }
                  }}
                  style={{ ...ghostButton, color: COLORS.danger, marginRight: 'auto' }}
                >
                  Удалить паспорт
                </button>
              )}
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
                {saving ? 'Сохранение...' : (recordId ? 'Сохранить изменения' : 'Сохранить')}
              </button>
              <button onClick={printPassport} style={primaryButton()}>Печать</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
