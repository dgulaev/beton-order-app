'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, inputStyle, labelStyle, cardStyle, ghostButton, primaryButton, overlayStyle, modalStyle, pillStyle } from '../labStyles';
import ProtocolModal from './ProtocolModal';
import { SCALE, num, ru, ruInt, computeSeries, type Specimen } from '../protocolCalc';
import { useAutoRows, LabPagination } from '../pagination';
import { localDateStr, useEscapeClose } from '../labUtils';

type JournalKey = '7' | '28';

interface Props {
  focusOrderId?: number | null;
  focusDays?: '7' | '28' | null;
  onFocusConsumed?: () => void;
  onTestsChanged?: () => void;
}

const orderLabel = (o: any): string =>
  `#${o.id} · ${o.delivery_date || '—'} · ${o.grade || '—'}` +
  `${o.organization_name || o.full_name ? ` · ${o.organization_name || o.full_name}` : ''}` +
  `${o.volume ? ` · ${o.volume} м³` : ''}`;

const defaultSpecimens = (): Specimen[] => [
  { mass: '', load: '' },
  { mass: '', load: '' },
  { mass: '', load: '' },
];

const emptyTest = (testType: JournalKey) => ({
  batch_no: '',
  recipe_code: '',
  sample_date: localDateStr(),
  test_type: testType,
  order_id: null as number | null,
  required_strength: 0,
  actual_strength_mpa: 0,
  result: 'pending',
  lab_name: '',
  note: '',
  protocol: { cube_size: 100, specimens: defaultSpecimens() },
});

// Журнал испытаний партий: два отдельных журнала — 7 суток (промежуточный
// контроль) и 28 суток (проектный/итоговый контроль прочности).
export default function TestsTab({ focusOrderId, focusDays, onFocusConsumed, onTestsChanged }: Props) {
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [protocolTest, setProtocolTest] = useState<any>(null);
  const [journal, setJournal] = useState<JournalKey>('7');
  const [orders, setOrders] = useState<any[]>([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const { perPage, rowH } = useAutoRows(listRef, { deps: [journal, tests.length, dateFilter, orderFilter] });
  const loadedOrderMonths = useRef<Set<string>>(new Set());
  const loadingOrderMonths = useRef<Set<string>>(new Set());

  useEscapeClose(() => setEditing(null), editing != null);

  const journalTests = tests
    .filter((t) => String(t.test_type) === journal)
    .filter((t) => !dateFilter || String(t.sample_date).slice(0, 10) === dateFilter)
    .filter((t) => !orderFilter || String(t.order_id) === orderFilter);
  const count7 = tests.filter((t) => String(t.test_type) === '7').length;
  const count28 = tests.filter((t) => String(t.test_type) === '28').length;

  const totalPages = Math.max(1, Math.ceil(journalTests.length / perPage));
  const pageSafe = Math.min(page, totalPages);
  const pagedTests = journalTests.slice((pageSafe - 1) * perPage, pageSafe * perPage);

  // Сброс на первую страницу при смене журнала / фильтра даты.
  useEffect(() => {
    setPage(1);
  }, [journal, dateFilter, orderFilter]);

  // Переход с бейджа 7/28 на заявках — фильтр к нужному испытанию.
  useEffect(() => {
    if (focusOrderId == null) return;
    if (focusDays === '7' || focusDays === '28') setJournal(focusDays);
    setOrderFilter(String(focusOrderId));
    setOrderSearch(String(focusOrderId));
    onFocusConsumed?.();
  }, [focusOrderId, focusDays, onFocusConsumed]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/concrete-tests');
      if (res.ok) setTests(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Ленивая помесячная загрузка заявок для привязки испытания к заказу.
  // Заявка обычно совпадает по дате с датой образцов, поэтому грузим месяц
  // выбранной даты образцов.
  const ensureOrdersMonth = async (dateStr?: string) => {
    if (!dateStr) return;
    const parts = String(dateStr).slice(0, 10).split('-').map(Number);
    if (parts.length < 2 || !parts[0] || !parts[1]) return;
    const year = parts[0];
    const month = parts[1];
    const key = `${year}-${month}`;
    if (loadedOrderMonths.current.has(key) || loadingOrderMonths.current.has(key)) return;
    loadingOrderMonths.current.add(key);
    try {
      const res = await fetch(`/api/adminCifra/orders?year=${year}&month=${month}`);
      if (res.ok) {
        const data = await res.json();
        setOrders((prev) => {
          const map = new Map(prev.map((o) => [String(o.id), o]));
          (data || []).forEach((o: any) => map.set(String(o.id), o));
          return Array.from(map.values());
        });
        loadedOrderMonths.current.add(key);
      }
    } catch (e) {
      console.error(e);
    } finally {
      loadingOrderMonths.current.delete(key);
    }
  };

  useEffect(() => {
    if (editing) ensureOrdersMonth(editing.sample_date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.sample_date, editing != null]);

  // Поиск по номеру заявки: если ввели чистое число и такой заявки нет среди
  // загруженных (например, из другого месяца) — подгружаем её по id напрямую,
  // чтобы она появилась в выпадающем списке.
  useEffect(() => {
    const q = orderSearch.trim();
    if (!editing || !/^\d+$/.test(q)) return;
    if (orders.some((o) => String(o.id) === q)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/adminCifra/orders/${q}`);
        if (res.ok && !cancelled) {
          const o = await res.json();
          if (o && o.id) {
            setOrders((prev) => (prev.some((x) => String(x.id) === String(o.id)) ? prev : [...prev, o]));
          }
        }
      } catch (e) {
        console.error(e);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSearch, editing != null]);

  const orderOptions = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders
      .filter((o) =>
        !q ||
        [o.id, o.grade, o.organization_name, o.full_name, o.address, o.delivery_date]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
      .sort((a, b) => String(b.delivery_date || '').localeCompare(String(a.delivery_date || '')))
      .slice(0, 100);
  }, [orders, orderSearch]);

  const selectedOrder = editing?.order_id != null ? orders.find((o) => String(o.id) === String(editing.order_id)) : null;

  const selectOrder = (val: string) => {
    const id = val ? Number(val) : null;
    const o = id != null ? orders.find((x) => String(x.id) === String(id)) : null;
    const consumer = o ? o.organization_name || o.full_name || '' : '';
    setEditing((prev: any) => {
      const p = prev.protocol && typeof prev.protocol === 'object' ? prev.protocol : { cube_size: 100, specimens: defaultSpecimens() };
      return {
        ...prev,
        order_id: id,
        recipe_code: prev.recipe_code || o?.grade || '',
        // Организацию-потребителя храним в protocol.consumer: она показывается
        // в строке журнала и подставляется в печатный протокол.
        protocol: { ...p, consumer },
      };
    });
  };

  // Данные серии кубиков (масса/нагрузка) храним в editing.protocol.
  const protRaw =
    editing?.protocol && typeof editing.protocol === 'object'
      ? editing.protocol
      : { cube_size: 100, specimens: defaultSpecimens() };
  const prot = {
    ...protRaw,
    cube_size: Number(protRaw.cube_size) || 100,
    specimens: Array.isArray(protRaw.specimens) ? protRaw.specimens : defaultSpecimens(),
  };
  const calc = editing ? computeSeries(prot.specimens, prot.cube_size, editing.required_strength) : null;
  const hasSeries = !!calc && calc.rows.some((r) => r.strength > 0);
  const cubeCm = Math.round(prot.cube_size / 10);

  const updSpecimens = (specimens: Specimen[]) => setEditing({ ...editing, protocol: { ...prot, specimens } });
  const setSpec = (idx: number, key: keyof Specimen, val: string) =>
    updSpecimens(prot.specimens.map((s: Specimen, i: number) => (i === idx ? { ...s, [key]: val === '' ? '' : num(val) } : s)));
  const addSpec = () => updSpecimens([...prot.specimens, { mass: '', load: '' }]);
  const delSpec = (idx: number) => updSpecimens(prot.specimens.filter((_: Specimen, i: number) => i !== idx));
  const setCubeSize = (v: string) => setEditing({ ...editing, protocol: { ...prot, cube_size: Number(v) } });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const method = editing.id ? 'PUT' : 'POST';
    const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;

    // Прочность считаем из серии кубиков; результат для 28 сут выставляем
    // автоматически, если оператор не переопределил его вручную.
    const specimens = Array.isArray(prot.specimens) ? prot.specimens : defaultSpecimens();
    const series = computeSeries(specimens, prot.cube_size || 100, editing.required_strength);
    const seriesFilled = series.rows.some((r) => r.strength > 0);
    const actual = seriesFilled ? Number(series.avgStrength.toFixed(2)) : editing.actual_strength_mpa || 0;
    let result = editing.result || 'pending';
    if (editing.test_type === '28' && seriesFilled && (result === 'pending' || result === '')) {
      result = series.pass ? 'pass' : 'fail';
    }

    const merged = { ...editing, actual_strength_mpa: actual, result, protocol: { ...prot, specimens } };
    const body = merged.id ? merged : { ...merged, created_by: userId ? Number(userId) : null };
    try {
      const res = await fetch('/api/adminCifra/concrete-tests', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditing(null);
        await load();
        onTestsChanged?.();
      } else {
        const txt = await res.text().catch(() => '');
        alert(`Ошибка сохранения испытания${txt ? `:\n${txt}` : ''}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Удалить запись испытания?')) return;
    await fetch(`/api/adminCifra/concrete-tests?id=${id}`, { method: 'DELETE' });
    await load();
    onTestsChanged?.();
  };

  const resultPill = (r: string) => {
    if (r === 'pass') return pillStyle('rgba(74,222,128,0.15)', COLORS.accent);
    if (r === 'fail') return pillStyle('rgba(248,113,113,0.15)', COLORS.danger);
    return pillStyle('rgba(148,163,184,0.15)', COLORS.muted);
  };
  const resultLabel = (r: string) => (r === 'pass' ? 'Соответствует' : r === 'fail' ? 'Не соответствует' : 'Ожидает');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '18px', color: '#fff', margin: 0 }}>Журнал испытаний</h2>
          <p style={{ color: COLORS.muted, fontSize: '13px', margin: '4px 0 0' }}>
            {journal === '7'
              ? 'Промежуточный контроль прочности в возрасте 7 суток'
              : 'Проектный (итоговый) контроль прочности в возрасте 28 суток'}
          </p>
        </div>
        <button onClick={() => setEditing(emptyTest(journal))} style={primaryButton()}>
          + Испытание ({journal} сут)
        </button>
      </div>

      {/* Переключатель журналов: 7 суток / 28 суток — это два разных журнала */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
        {([
          { key: '7' as JournalKey, label: 'Журнал 7 суток', count: count7 },
          { key: '28' as JournalKey, label: 'Журнал 28 суток', count: count28 },
        ]).map((j) => (
          <button
            key={j.key}
            onClick={() => setJournal(j.key)}
            style={{
              ...ghostButton,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: journal === j.key ? 'rgba(74,222,128,0.12)' : '#334155',
              color: journal === j.key ? COLORS.accent : '#E2E8F0',
              border: journal === j.key ? '1px solid rgba(74,222,128,0.45)' : '1px solid transparent',
            }}
          >
            {j.label}
            <span style={pillStyle('rgba(148,163,184,0.15)', journal === j.key ? COLORS.accent : COLORS.muted)}>{j.count}</span>
          </button>
        ))}
        {/* Фильтры: заказ + дата образцов */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {orderFilter && (
            <>
              <span style={{ ...pillStyle('rgba(96,165,250,0.15)', COLORS.blue) }}>Заказ №{orderFilter}</span>
              <button onClick={() => { setOrderFilter(''); setOrderSearch(''); }} style={{ ...ghostButton, padding: '8px 12px' }}>Сброс заказа</button>
            </>
          )}
          <span style={{ color: COLORS.muted, fontSize: '13px' }}>Дата образцов:</span>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '8px 10px' }} />
          {dateFilter && (
            <button onClick={() => setDateFilter('')} style={{ ...ghostButton, padding: '8px 12px' }}>Сброс даты</button>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: COLORS.muted }}>Загрузка...</p>
      ) : journalTests.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: COLORS.muted }}>
          {dateFilter
            ? `За ${dateFilter} записей в журнале ${journal} суток нет.`
            : `В журнале ${journal} суток записей нет. Добавьте первое испытание партии.`}
        </div>
      ) : (
        <div ref={listRef} style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <div data-lab-head style={{ display: 'flex', padding: '12px 16px', color: COLORS.muted, fontSize: '13px', borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{ width: '120px' }}>Партия</div>
            <div style={{ width: '80px' }}>Заявка</div>
            <div style={{ width: '80px' }}>Марка</div>
            <div style={{ width: '100px' }}>Дата</div>
            <div style={{ flex: 1 }}>Организация</div>
            <div style={{ width: '100px' }}>Требуемая</div>
            <div style={{ width: '100px' }}>Факт</div>
            <div style={{ width: '150px' }}>Результат</div>
            <div style={{ width: '250px' }}></div>
          </div>
          {pagedTests.map((t) => (
            <div key={t.id} data-lab-row style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, color: '#E2E8F0', fontSize: '14px' }}>
              <div style={{ width: '120px' }}>{t.batch_no || '—'}</div>
              <div style={{ width: '80px', color: t.order_id ? COLORS.blue : COLORS.muted }}>{t.order_id ? `№${t.order_id}` : '—'}</div>
              <div style={{ width: '80px' }}>{t.recipe_code || '—'}</div>
              <div style={{ width: '100px' }}>{t.sample_date || '—'}</div>
              <div style={{ flex: 1, color: t.protocol?.consumer ? '#E2E8F0' : COLORS.muted, paddingRight: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.protocol?.consumer || '—'}
              </div>
              <div style={{ width: '100px' }}>{t.required_strength ?? '—'} МПа</div>
              <div style={{ width: '100px' }}>{t.actual_strength_mpa ?? '—'} МПа</div>
              <div style={{ width: '150px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={resultPill(t.result)}>{resultLabel(t.result)}</span>
              </div>
              <div style={{ width: '250px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button onClick={() => setProtocolTest(t)} style={{ ...ghostButton, padding: '6px 12px', background: 'rgba(96,165,250,0.15)', color: COLORS.blue }}>Протокол</button>
                <button onClick={() => setEditing(t)} style={{ ...ghostButton, padding: '6px 12px' }}>Изм.</button>
                <button onClick={() => remove(t.id)} style={{ ...ghostButton, padding: '6px 12px' }}>Удал.</button>
              </div>
            </div>
          ))}
          {/* Распорка держит высоту списка постоянной, чтобы пагинация не прыгала. */}
          {totalPages > 1 && pagedTests.length < perPage && (
            <div style={{ height: `${(perPage - pagedTests.length) * rowH}px` }} />
          )}
        </div>
      )}

      <LabPagination page={pageSafe} totalPages={totalPages} onPage={setPage} />

      {editing && (
        <div style={overlayStyle} onClick={() => setEditing(null)}>
          <div style={modalStyle(640)} onClick={(e) => e.stopPropagation()} className="scroll-hidden">
            <h2 style={{ fontSize: '20px', color: '#fff', marginBottom: '6px' }}>
              {editing.id ? 'Изменение' : 'Новое'} испытание
            </h2>
            <p style={{ color: COLORS.muted, fontSize: '13px', margin: '0 0 20px' }}>
              Журнал <strong style={{ color: COLORS.accent }}>{editing.test_type} суток</strong>
              {' '}({editing.test_type === '7' ? 'промежуточный' : 'проектный'} контроль)
            </p>

            {/* Привязка к заявке — прочность из этого испытания автоматически
                попадёт в паспорт качества соответствующего заказа. */}
            <div style={{ marginBottom: '18px', padding: '12px 14px', background: '#1B2536', borderRadius: '10px' }}>
              <label style={{ ...labelStyle, marginBottom: '8px' }}>Заявка (для паспорта)</label>
              <input
                placeholder="Поиск заявки: № / марка / клиент / дата"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                style={{ ...inputStyle, marginBottom: '8px' }}
              />
              <select value={editing.order_id ?? ''} onChange={(e) => selectOrder(e.target.value)} style={inputStyle}>
                <option value="">— не привязано —</option>
                {selectedOrder && !orderOptions.some((o) => String(o.id) === String(selectedOrder.id)) && (
                  <option value={selectedOrder.id}>{orderLabel(selectedOrder)}</option>
                )}
                {editing.order_id != null && !selectedOrder && (
                  <option value={editing.order_id}>#{editing.order_id} (заявка вне загруженного месяца)</option>
                )}
                {orderOptions.map((o) => (
                  <option key={o.id} value={o.id}>{orderLabel(o)}</option>
                ))}
              </select>
              <p style={{ color: COLORS.muted, fontSize: '12px', margin: '8px 0 0' }}>
                {selectedOrder
                  ? `Привязано: ${orderLabel(selectedOrder)}`
                  : 'Без привязки прочность в паспорт заказа не подставится.'}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Номер партии</label>
                <input value={editing.batch_no || ''} onChange={(e) => setEditing({ ...editing, batch_no: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Марка / код</label>
                <input value={editing.recipe_code || ''} onChange={(e) => setEditing({ ...editing, recipe_code: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Дата образцов</label>
                <input type="date" value={editing.sample_date || ''} onChange={(e) => setEditing({ ...editing, sample_date: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Требуемая прочность, МПа</label>
                <input type="number" value={editing.required_strength ?? 0} onChange={(e) => setEditing({ ...editing, required_strength: Number(e.target.value) })} onWheel={(e) => e.currentTarget.blur()} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Фактическая прочность, МПа</label>
                <div style={{ ...inputStyle, background: '#1B2536', color: hasSeries ? COLORS.accent : COLORS.muted, fontWeight: 600 }}>
                  {hasSeries ? `${ru(calc!.avgStrength)} (среднее по серии)` : '— заполните кубики'}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Результат</label>
                <select value={editing.result || 'pending'} onChange={(e) => setEditing({ ...editing, result: e.target.value })} style={inputStyle}>
                  <option value="pending">Ожидает</option>
                  <option value="pass">Соответствует</option>
                  <option value="fail">Не соответствует</option>
                </select>
                {editing.test_type === '28' && hasSeries && (
                  <p style={{ margin: '6px 0 0', fontSize: '12px', color: calc!.pass ? COLORS.accent : COLORS.danger }}>
                    Расчёт: {calc!.pass ? 'соответствует классу' : 'не соответствует классу'}
                  </p>
                )}
                {editing.test_type === '7' && hasSeries && calc!.percent > 0 && (
                  <p style={{ margin: '6px 0 0', fontSize: '12px', color: COLORS.muted }}>
                    {calc!.percent}% от заданной прочности
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Лаборатория</label>
                <input value={editing.lab_name || ''} onChange={(e) => setEditing({ ...editing, lab_name: e.target.value })} style={inputStyle} />
              </div>
            </div>

            {/* Серия кубиков одной партии (масса + нагрузка). Прочность и
                плотность считаются автоматически по ГОСТ 10180-2012. */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ color: '#fff', fontSize: '15px', margin: 0 }}>
                  Кубики серии
                  <span style={{ color: COLORS.muted, fontSize: '13px', fontWeight: 400 }}> · {cubeCm}×{cubeCm}×{cubeCm} см</span>
                </h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select value={prot.cube_size} onChange={(e) => setCubeSize(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '6px 10px' }}>
                    {[70, 100, 150, 200, 300].map((s) => (
                      <option key={s} value={s}>{s} мм (α={SCALE[s]})</option>
                    ))}
                  </select>
                  <button onClick={addSpec} style={{ ...ghostButton, padding: '6px 14px' }}>+ Кубик</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 1fr 30px', gap: '8px', alignItems: 'center', color: COLORS.muted, fontSize: '12px', marginBottom: '6px' }}>
                <div>№</div>
                <div>Масса, г</div>
                <div>Нагрузка, кН</div>
                <div>Плотность, кг/м³</div>
                <div>Прочность, МПа</div>
                <div></div>
              </div>
              {prot.specimens.map((s: Specimen, idx: number) => {
                const r = calc?.rows[idx];
                return (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 1fr 1fr 1fr 30px', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ color: COLORS.muted, textAlign: 'center' }}>{idx + 1}</div>
                    <input type="number" value={s.mass} onChange={(e) => setSpec(idx, 'mass', e.target.value)} onWheel={(e) => e.currentTarget.blur()} style={inputStyle} />
                    <input type="number" value={s.load} onChange={(e) => setSpec(idx, 'load', e.target.value)} onWheel={(e) => e.currentTarget.blur()} style={inputStyle} />
                    <div style={{ ...inputStyle, background: '#1B2536', color: COLORS.muted }}>{r && r.density > 0 ? ruInt(r.density) : '—'}</div>
                    <div style={{ ...inputStyle, background: '#1B2536', color: r && r.strength > 0 ? COLORS.accent : COLORS.muted, fontWeight: 600 }}>{r && r.strength > 0 ? ru(r.strength) : '—'}</div>
                    <button onClick={() => delSpec(idx)} style={{ ...ghostButton, padding: '6px 0', background: 'transparent', color: COLORS.danger }}>✕</button>
                  </div>
                );
              })}
              {calc && (
                <div style={{ display: 'flex', gap: '20px', marginTop: '8px', flexWrap: 'wrap', fontSize: '13px', color: COLORS.muted }}>
                  <div>Средняя плотность: <b style={{ color: '#fff' }}>{calc.avgDensity > 0 ? ruInt(calc.avgDensity) : '—'} кг/м³</b></div>
                  <div>Средняя прочность: <b style={{ color: COLORS.accent }}>{calc.avgStrength > 0 ? ru(calc.avgStrength) : '—'} МПа</b></div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '16px' }}>
              <label style={labelStyle}>Примечание</label>
              <input value={editing.note || ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })} style={inputStyle} />
            </div>
            <p style={{ color: COLORS.muted, fontSize: '12px', margin: '10px 0 0' }}>
              Для печати протокола (Результат №, потребитель, заключение) используйте кнопку «Протокол» в строке журнала — кубики уже сохранены.
            </p>
            <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={ghostButton}>Отмена</button>
              <button onClick={save} disabled={saving} style={{ ...primaryButton(), opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {protocolTest && (
        <ProtocolModal
          test={protocolTest}
          onClose={() => setProtocolTest(null)}
          onSaved={() => {
            setProtocolTest(null);
            load();
            onTestsChanged?.();
          }}
        />
      )}
    </div>
  );
}
