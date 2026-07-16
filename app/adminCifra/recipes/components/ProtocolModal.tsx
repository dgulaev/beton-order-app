'use client';

import { useEffect, useMemo, useState } from 'react';
import { COLORS, overlayStyle, modalStyle, inputStyle, labelStyle, ghostButton, primaryButton } from '../labStyles';
import { SCALE, num, ru, ruInt, computeSeries, type Specimen } from '../protocolCalc';

interface Props {
  test: any;              // строка concrete_tests, к которой формируем протокол
  onClose: () => void;
  onSaved?: () => void;   // перезагрузить журнал после сохранения
}

// dd.mm.yyyy из yyyy-mm-dd или Date
function toRuDate(v?: string | Date): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return typeof v === 'string' ? v : '';
  return d.toLocaleDateString('ru-RU');
}
function addDays(v: string | undefined, days: number): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return toRuDate(d);
}

export default function ProtocolModal({ test, onClose, onSaved }: Props) {
  const age: '7' | '28' = String(test?.test_type) === '28' ? '28' : '7';
  const [saving, setSaving] = useState(false);
  const [prot, setProt] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let settings: any = {};
      try {
        const res = await fetch('/api/adminCifra/lab-settings');
        if (res.ok) settings = await res.json();
      } catch (e) {
        console.error(e);
      }
      if (cancelled) return;

      // Если протокол уже сохранён — берём его, иначе строим черновик.
      const saved = test?.protocol && typeof test.protocol === 'object' ? test.protocol : null;
      const base = {
        result_no: '',
        consumer: '',
        object: 'Строительство',
        design_class: test?.recipe_code || '',
        design_strength: test?.required_strength || '',
        fabrication_date: toRuDate(test?.sample_date),
        test_date: addDays(test?.sample_date, Number(age)),
        cube_size: 100,
        specimens: [
          { mass: '', load: '' },
          { mass: '', load: '' },
          { mass: '', load: '' },
        ] as Specimen[],
        conclusion: '',
        lab_title: settings.org_name ? `Строительная лаборатория ${settings.org_name}` : 'Строительная лаборатория',
        cert_line: settings.lab_attestat || '',
        lab_org: settings.org_name || '',
        lab_head: settings.lab_head_name || '',
      };
      setProt(saved ? { ...base, ...saved } : base);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key: string, value: any) => setProt((p: any) => ({ ...p, [key]: value }));
  const setSpec = (idx: number, key: keyof Specimen, value: any) =>
    setProt((p: any) => {
      const specimens = [...p.specimens];
      specimens[idx] = { ...specimens[idx], [key]: value === '' ? '' : num(value) };
      return { ...p, specimens };
    });
  const addSpec = () => setProt((p: any) => ({ ...p, specimens: [...p.specimens, { mass: '', load: '' }] }));
  const delSpec = (idx: number) =>
    setProt((p: any) => ({ ...p, specimens: p.specimens.filter((_: any, i: number) => i !== idx) }));

  // Производные величины: прочность/плотность кубиков и средние по серии.
  const calc = useMemo(
    () => (prot ? computeSeries(prot.specimens as Specimen[], prot.cube_size, prot.design_strength) : null),
    [prot]
  );

  const buildConclusion = (): string => {
    if (!calc) return '';
    if (age === '7') {
      return `По результатам испытаний прочность при сжатии составляет ${calc.percent}% от заданной, что соответствует нормальному набору прочности бетона.`;
    }
    const cls = [prot.design_class, calc.design ? `(${ru(calc.design)} МПа)` : ''].filter(Boolean).join(' ');
    return calc.pass
      ? `Данная партия бетона по прочности соответствует заданному классу ${cls}.`
      : `Данная партия бетона по прочности НЕ соответствует заданному классу ${cls}.`;
  };

  // Автозаполнение заключения при первом расчёте, если поле пустое.
  useEffect(() => {
    if (prot && calc && !prot.conclusion && calc.avgStrength > 0) {
      set('conclusion', buildConclusion());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc?.avgStrength]);

  const save = async () => {
    if (!prot || !calc) return;
    setSaving(true);
    try {
      const result = age === '28' ? (calc.pass ? 'pass' : 'fail') : test.result || 'pending';
      const res = await fetch('/api/adminCifra/concrete-tests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: test.id,
          protocol: prot,
          actual_strength_mpa: Number(calc.avgStrength.toFixed(2)),
          required_strength: calc.design || test.required_strength,
          result,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      alert('Протокол сохранён');
      onSaved?.();
    } catch (e) {
      alert('Ошибка сохранения протокола');
    } finally {
      setSaving(false);
    }
  };

  const printProtocol = () => {
    if (!prot || !calc) return;
    const esc = (v: any) => (v == null ? '' : String(v));
    const n = calc.rows.length;
    const sizeCm = ru(calc.size / 10, 1);
    const sizeStr = `${sizeCm}*${sizeCm}*${sizeCm}`;
    const cls = [esc(prot.design_class), calc.design ? `(${ru(calc.design)} МПа)` : ''].filter(Boolean).join('<br/>');

    const bodyRows = calc.rows
      .map((r, i) => {
        const first = i === 0;
        // № п/п — своя ячейка в каждой строке
        const numCell = `<td class="c">${i + 1}</td>`;
        // объединённые по всей серии ячейки только в первой строке (rowspan)
        const mergedCols = first
          ? `
        <td rowspan="${n}" class="c">${cls}</td>
        <td rowspan="${n}" class="c">${esc(prot.fabrication_date)}</td>
        <td rowspan="${n}" class="c">${esc(prot.test_date)}</td>
        <td rowspan="${n}" class="c">${age}</td>`
          : '';
        const densCell = first ? `<td rowspan="${n}" class="c">${ruInt(calc.avgDensity)}</td>` : '';
        const avgCell = first ? `<td rowspan="${n}" class="c b">${ru(calc.avgStrength)}</td>` : '';
        return `<tr>
        ${numCell}
        ${mergedCols}
        <td class="c">${r.mass ? ruInt(r.mass) : ''}</td>
        <td class="c">${sizeStr}</td>
        ${densCell}
        <td class="c">${r.load ? ru(r.load, r.load % 1 ? 2 : 0) : ''}</td>
        <td class="c">${r.strength ? ru(r.strength) : ''}</td>
        ${avgCell}
      </tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Протокол ${esc(prot.result_no)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; color: #000; margin: 16px 20px; font-size: 12px; }
  .center { text-align: center; }
  .h1 { font-weight: bold; font-size: 13px; }
  .head { margin-bottom: 10px; line-height: 1.4; }
  .meta { margin: 8px 0; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #000; padding: 3px 4px; font-size: 11px; vertical-align: middle; }
  th { font-weight: normal; text-align: center; line-height: 1.15; }
  td.c { text-align: center; }
  td.b { font-weight: bold; }
  .concl { margin-top: 12px; text-align: justify; line-height: 1.4; }
  .concl b { font-weight: bold; }
  .gost { margin-top: 10px; text-align: justify; line-height: 1.4; font-size: 11px; }
  .sign { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
  @page { size: A4; margin: 0; }
  @media print { body { margin: 10mm 12mm; } }
</style></head><body>
  <div class="head center">
    <div class="h1">${esc(prot.lab_title)}</div>
    <div>${esc(prot.cert_line)}</div>
  </div>
  <div class="meta">
    <div><b>Результат № ${esc(prot.result_no)}</b></div>
    <div>Организация потребитель: ${esc(prot.consumer)}</div>
    <div>Объект: ${esc(prot.object)}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:32px">№<br/>п/п</th>
        <th style="width:88px">Проектный класс бетона по прочности</th>
        <th style="width:70px">Дата изготов-ления образцов</th>
        <th style="width:70px">Дата испытания образцов</th>
        <th style="width:52px">Возраст образцов, сут</th>
        <th style="width:56px">Масса, г</th>
        <th style="width:80px">Размеры, см</th>
        <th style="width:72px">Средняя плотность, кг/м³</th>
        <th style="width:74px">Разрушаю-щая нагрузка, кН</th>
        <th style="width:64px">Прочность образца, МПа</th>
        <th style="width:78px">Средняя прочность образцов в серии, МПа</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>

  <div class="concl"><b>ЗАКЛЮЧЕНИЕ:</b> ${esc(prot.conclusion)}</div>
  <div class="gost">Испытания производились по ГОСТ 10180-2012 «Бетоны. Методы определения прочности по контрольным образцам» на контрольных образцах-кубах в возрасте ${age} суток.</div>

  <div class="sign">
    <div>Нач. лаборатории ${esc(prot.lab_org)}</div>
    <div>${esc(prot.lab_head)}</div>
  </div>
</body></html>`;

    // Печать через скрытый iframe (без попапов — не подвешивает Яндекс.Браузер).
    const prev = document.getElementById('lab-print-frame');
    if (prev) prev.remove();
    const iframe = document.createElement('iframe');
    iframe.id = 'lab-print-frame';
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' });
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
    if (iframe.contentWindow) iframe.contentWindow.onload = () => setTimeout(doPrint, 150);
    setTimeout(doPrint, 500);
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle(880)} onClick={(e) => e.stopPropagation()} className="scroll-hidden">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <h2 style={{ fontSize: '20px', color: '#fff', margin: 0 }}>Протокол испытания</h2>
          <span style={{ color: COLORS.accent, fontSize: '14px', fontWeight: 600 }}>{age} суток (ГОСТ 10180-2012)</span>
        </div>
        <p style={{ color: COLORS.muted, fontSize: '13px', margin: '0 0 18px' }}>
          Партия {test?.batch_no || '—'} · {test?.recipe_code || '—'}
        </p>

        {!prot ? (
          <p style={{ color: COLORS.muted }}>Загрузка...</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Результат №</label>
                <input value={prot.result_no} onChange={(e) => set('result_no', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Организация потребитель</label>
                <input value={prot.consumer} onChange={(e) => set('consumer', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Объект</label>
                <input value={prot.object} onChange={(e) => set('object', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Проектный класс</label>
                <input value={prot.design_class} onChange={(e) => set('design_class', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Требуемая прочность, МПа</label>
                <input
                  type="number"
                  value={prot.design_strength}
                  onChange={(e) => set('design_strength', e.target.value === '' ? '' : Number(e.target.value))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Размер кубика, мм</label>
                <select value={prot.cube_size} onChange={(e) => set('cube_size', Number(e.target.value))} style={inputStyle}>
                  {[70, 100, 150, 200, 300].map((s) => (
                    <option key={s} value={s}>{s} мм (α={SCALE[s]})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Дата изготовления</label>
                <input value={prot.fabrication_date} onChange={(e) => set('fabrication_date', e.target.value)} style={inputStyle} placeholder="дд.мм.гггг" />
              </div>
              <div>
                <label style={labelStyle}>Дата испытания</label>
                <input value={prot.test_date} onChange={(e) => set('test_date', e.target.value)} style={inputStyle} placeholder="дд.мм.гггг" />
              </div>
              <div>
                <label style={labelStyle}>Возраст, сут</label>
                <input value={`${age} (по журналу)`} disabled style={{ ...inputStyle, opacity: 0.7 }} />
              </div>
            </div>

            {/* Серия образцов */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ color: '#fff', fontSize: '15px', margin: 0 }}>Образцы серии</h3>
                <button onClick={addSpec} style={{ ...ghostButton, padding: '6px 14px' }}>+ Образец</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr 1fr 1fr 34px', gap: '8px', alignItems: 'center', color: COLORS.muted, fontSize: '12px', marginBottom: '6px' }}>
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
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr 1fr 1fr 34px', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ color: COLORS.muted, textAlign: 'center' }}>{idx + 1}</div>
                    <input type="number" value={s.mass} onChange={(e) => setSpec(idx, 'mass', e.target.value)} style={inputStyle} />
                    <input type="number" value={s.load} onChange={(e) => setSpec(idx, 'load', e.target.value)} style={inputStyle} />
                    <div style={{ ...inputStyle, background: '#1B2536', color: COLORS.muted }}>{r && r.density > 0 ? ruInt(r.density) : '—'}</div>
                    <div style={{ ...inputStyle, background: '#1B2536', color: r && r.strength > 0 ? COLORS.accent : COLORS.muted, fontWeight: 600 }}>{r && r.strength > 0 ? ru(r.strength) : '—'}</div>
                    <button onClick={() => delSpec(idx)} style={{ ...ghostButton, padding: '6px 0', background: 'transparent', color: COLORS.danger }}>✕</button>
                  </div>
                );
              })}
            </div>

            {/* Итоги по серии */}
            {calc && (
              <div style={{ display: 'flex', gap: '24px', marginTop: '12px', padding: '12px 16px', background: '#1B2536', borderRadius: '10px', flexWrap: 'wrap' }}>
                <div style={{ color: COLORS.muted, fontSize: '13px' }}>Средняя плотность: <b style={{ color: '#fff' }}>{calc.avgDensity > 0 ? ruInt(calc.avgDensity) : '—'} кг/м³</b></div>
                <div style={{ color: COLORS.muted, fontSize: '13px' }}>Средняя прочность: <b style={{ color: COLORS.accent }}>{calc.avgStrength > 0 ? ru(calc.avgStrength) : '—'} МПа</b></div>
                {age === '7' ? (
                  <div style={{ color: COLORS.muted, fontSize: '13px' }}>От заданной: <b style={{ color: '#fff' }}>{calc.percent > 0 ? `${calc.percent}%` : '—'}</b></div>
                ) : (
                  <div style={{ color: COLORS.muted, fontSize: '13px' }}>Соответствие классу: <b style={{ color: calc.pass ? COLORS.accent : COLORS.danger }}>{calc.avgStrength > 0 ? (calc.pass ? 'соответствует' : 'не соответствует') : '—'}</b></div>
                )}
              </div>
            )}

            {/* Заключение */}
            <div style={{ marginTop: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Заключение</label>
                <button onClick={() => set('conclusion', buildConclusion())} style={{ ...ghostButton, padding: '4px 12px', fontSize: '12px' }}>Сформировать</button>
              </div>
              <textarea
                value={prot.conclusion}
                onChange={(e) => set('conclusion', e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* Реквизиты лаборатории */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Шапка (лаборатория)</label>
                <input value={prot.lab_title} onChange={(e) => set('lab_title', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Свидетельство</label>
                <input value={prot.cert_line} onChange={(e) => set('cert_line', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Организация (для подписи)</label>
                <input value={prot.lab_org} onChange={(e) => set('lab_org', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Нач. лаборатории</label>
                <input value={prot.lab_head} onChange={(e) => set('lab_head', e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{ ...ghostButton, background: 'transparent', border: `1px solid ${COLORS.border}`, color: '#E2E8F0' }}
              >
                Закрыть
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{ ...primaryButton(COLORS.blue), opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={printProtocol} style={primaryButton()}>Печать</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
