'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, inputStyle, labelStyle, cardStyle, ghostButton, primaryButton, overlayStyle, modalStyle, pillStyle } from '../labStyles';
import PassportModal from './PassportModal';
import { useAutoRows, LabPagination } from '../pagination';
import { useEscapeClose } from '../labUtils';
import ModalDateInput from '../../components/ModalDateInput';
import ModalSelect from '../../components/ModalSelect';
import { appConfirm } from '../../components/appDialog';

type FilterKey = 'all' | 'active' | 'no_recipes' | 'no_products';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'no_recipes', label: 'Без рецептов' },
  { key: 'no_products', label: 'Без продуктов' },
];

const emptySpec = () => ({
  code: '',
  name: '',
  order_id: '',
  grade: '',
  product_name: '',
  strength_class: '',
  frost_resistance: '',
  water_resistance: '',
  slump: '',
  status: 'active',
  source: 'manual',
  recipe_links: [] as any[],
});

interface Props {
  onPassportSaved?: (orderId: number | null) => void;
}

export default function SpecificationsTab({ onPassportSaved }: Props) {
  const [specs, setSpecs] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [plants, setPlants] = useState<any[]>([]);
  const [accredited, setAccredited] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const { perPage, rowH } = useAutoRows(listRef, { deps: [specs.length, dateFilter, filter] });
  const [editing, setEditing] = useState<any>(null);
  const [passportFor, setPassportFor] = useState<any>(null);
  // Результат поиска заказа по номеру в модалке: null — не искали,
  // объект — найден, false — не найден.
  const [orderLookup, setOrderLookup] = useState<any>(null);
  const [orderChecking, setOrderChecking] = useState(false);

  useEscapeClose(() => setEditing(null), editing != null);

  const recipeById = useMemo(() => {
    const m: Record<string, any> = {};
    recipes.forEach((r) => (m[r.id] = r));
    return m;
  }, [recipes]);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('filter', filter);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/adminCifra/specifications?${params.toString()}`);
      if (res.ok) setSpecs(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [r, p, a] = await Promise.all([
          fetch('/api/adminCifra/recipes?all=true'),
          fetch('/api/adminCifra/plants'),
          fetch('/api/adminCifra/accredited-grades'),
        ]);
        if (r.ok) setRecipes(await r.json());
        if (p.ok) setPlants(await p.json());
        if (a.ok) setAccredited(await a.json());
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, search.trim() ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const method = editing.id ? 'PUT' : 'POST';
    // specification_recipes — вложенная связь, пересобирается через recipe_links.
    // accredited_marking сохраняем в БД, чтобы марка не терялась при повторном
    // редактировании.
    const { specification_recipes, ...clean } = editing;
    void specification_recipes;
    const payload = { ...clean, order_id: editing.order_id ? Number(editing.order_id) : null };
    try {
      const res = await fetch('/api/adminCifra/specifications', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEditing(null);
        load();
      } else {
        alert('Ошибка сохранения спецификации');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!(await appConfirm('Удалить спецификацию?', { variant: 'danger', okLabel: 'Удалить', title: 'Удаление' }))) return;
    await fetch(`/api/adminCifra/specifications?id=${id}`, { method: 'DELETE' });
    load();
  };

  const openEdit = (spec: any) => {
    const recipe_links = (spec.specification_recipes || []).map((l: any) => ({
      plant_id: l.plant_id,
      recipe_id: l.recipe_id,
    }));
    setOrderLookup(null);
    setEditing({ ...spec, order_id: spec.order_id ?? '', recipe_links });
  };

  // Поиск заказа по номеру заявки — проверяем, что заказ существует, и
  // показываем клиента, чтобы лаборант убедился в привязке для паспорта.
  const findOrder = async () => {
    const id = String(editing?.order_id ?? '').trim();
    if (!id) {
      setOrderLookup(false);
      return;
    }
    setOrderChecking(true);
    try {
      const res = await fetch(`/api/adminCifra/orders/${id}`);
      if (res.ok) {
        const o = await res.json();
        setOrderLookup(o && o.id ? o : false);
      } else {
        setOrderLookup(false);
      }
    } catch (e) {
      console.error(e);
      setOrderLookup(false);
    } finally {
      setOrderChecking(false);
    }
  };

  // Автозаполнение полей спецификации по выбранной аккредитованной марке
  // (справочник из выписки Росаккредитации). Формирует и строку продукции.
  const applyAccredited = (marking: string) => {
    const g = accredited.find((a) => a.marking === marking);
    if (!g) {
      setEditing((prev: any) => ({ ...prev, accredited_marking: '' }));
      return;
    }
    const product =
      g.doc_kind === 'mortar'
        ? ['Раствор', g.marka, g.slump, g.frost_resistance].filter(Boolean).join(' ')
        : ['Бетон', g.strength_class, g.marka, g.frost_resistance, g.water_resistance, g.slump].filter(Boolean).join(' ');
    setEditing((prev: any) => ({
      ...prev,
      accredited_marking: marking,
      grade: g.marka || prev.grade || '',
      strength_class: g.strength_class || '',
      frost_resistance: g.frost_resistance || '',
      water_resistance: g.water_resistance || '',
      slump: g.slump || '',
      product_name: product,
    }));
  };

  const concreteGrades = useMemo(() => accredited.filter((a) => a.doc_kind !== 'mortar'), [accredited]);
  const mortarGrades = useMemo(() => accredited.filter((a) => a.doc_kind === 'mortar'), [accredited]);

  // Фильтр по дате (по дате создания спецификации) + пагинация под экран.
  const filteredSpecs = useMemo(
    () => (dateFilter ? specs.filter((s) => String(s.created_at || '').slice(0, 10) === dateFilter) : specs),
    [specs, dateFilter]
  );
  const totalPages = Math.max(1, Math.ceil(filteredSpecs.length / perPage));
  const pageSafe = Math.min(page, totalPages);
  const pagedSpecs = filteredSpecs.slice((pageSafe - 1) * perPage, pageSafe * perPage);

  useEffect(() => {
    setPage(1);
  }, [filter, search, dateFilter, specs.length]);

  const assignedRecipeText = (spec: any) => {
    const links = spec.specification_recipes || [];
    if (links.length === 0) return null;
    return links
      .map((l: any) => {
        const r = recipeById[l.recipe_id];
        return r ? `${r.code}` : `#${l.recipe_id}`;
      })
      .join(', ');
  };

  return (
    <div>
      {/* Заголовок + действия */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h2 style={{ fontSize: '18px', color: '#fff', margin: 0 }}>Спецификации</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => { setOrderLookup(null); setEditing(emptySpec()); }} style={primaryButton()}>+ Спецификация</button>
        </div>
      </div>

      {/* Фильтры + поиск */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap' }}>
        <input
          placeholder="Поиск по коду, марке, продукции..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: '320px' }}
        />
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              ...ghostButton,
              background: filter === f.key ? 'rgba(74,222,128,0.12)' : '#334155',
              color: filter === f.key ? COLORS.accent : '#E2E8F0',
              border: filter === f.key ? `1px solid rgba(74,222,128,0.45)` : '1px solid transparent',
            }}
          >
            {f.label}
          </button>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <span style={{ color: COLORS.muted, fontSize: '13px' }}>Дата:</span>
          <ModalDateInput value={dateFilter} onChange={setDateFilter} style={{ ...inputStyle, width: 'auto', padding: '8px 10px' }} />
          {dateFilter && (
            <button onClick={() => setDateFilter('')} style={{ ...ghostButton, padding: '8px 12px' }}>Сброс</button>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: COLORS.muted }}>Загрузка...</p>
      ) : filteredSpecs.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: COLORS.muted }}>
          {dateFilter ? `За ${dateFilter} спецификаций нет.` : 'Спецификаций нет. Создайте первую по кнопке «+ Спецификация».'}
        </div>
      ) : (
        <div ref={listRef} style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <div data-lab-head style={{ display: 'flex', padding: '12px 16px', color: COLORS.muted, fontSize: '13px', borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{ flex: 1.4 }}>Спецификация</div>
            <div style={{ flex: 1.2 }}>Продукция</div>
            <div style={{ flex: 1 }}>Рецептура</div>
            <div style={{ width: '110px' }}>Статус</div>
            <div style={{ width: '210px' }}></div>
          </div>
          {pagedSpecs.map((s) => {
            const recipeText = assignedRecipeText(s);
            return (
              <div key={s.id} data-lab-row style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, color: '#E2E8F0', fontSize: '14px' }}>
                <div style={{ flex: 1.4 }}>
                  <div style={{ fontWeight: 600 }}>{s.code || s.name || `Спец. #${s.id}`}</div>
                  <div style={{ color: COLORS.muted, fontSize: '13px' }}>
                    {s.grade || '—'} {s.order_id ? `· заказ №${s.order_id}` : ''}
                  </div>
                </div>
                <div style={{ flex: 1.2, color: s.product_name ? '#E2E8F0' : COLORS.danger }}>
                  {s.product_name || 'Без продукта'}
                </div>
                <div style={{ flex: 1 }}>
                  {recipeText ? (
                    <span style={pillStyle('rgba(96,165,250,0.15)', COLORS.blue)}>{recipeText}</span>
                  ) : (
                    <span style={pillStyle('rgba(248,113,113,0.12)', COLORS.danger)}>Без рецепта</span>
                  )}
                </div>
                <div style={{ width: '110px' }}>
                  <span style={s.status === 'active' ? pillStyle('rgba(74,222,128,0.15)', COLORS.accent) : pillStyle('rgba(148,163,184,0.15)', COLORS.muted)}>
                    {s.status === 'active' ? 'Активна' : 'Архив'}
                  </span>
                </div>
                <div style={{ width: '210px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setPassportFor(s)} style={{ ...ghostButton, padding: '6px 12px' }}>Паспорт</button>
                  <button onClick={() => openEdit(s)} style={{ ...ghostButton, padding: '6px 12px' }}>Изм.</button>
                  <button onClick={() => remove(s.id)} style={{ ...ghostButton, padding: '6px 12px' }}>Удал.</button>
                </div>
              </div>
            );
          })}
          {totalPages > 1 && pagedSpecs.length < perPage && (
            <div style={{ height: `${(perPage - pagedSpecs.length) * rowH}px` }} />
          )}
        </div>
      )}

      <LabPagination page={pageSafe} totalPages={totalPages} onPage={setPage} />

      {/* Модалка создания/редактирования */}
      {editing && (
        <div style={overlayStyle} onClick={() => setEditing(null)}>
          <div style={modalStyle(600)} onClick={(e) => e.stopPropagation()} className="scroll-hidden">
            <h2 style={{ fontSize: '20px', color: '#fff', marginBottom: '20px' }}>
              {editing.id ? 'Редактирование' : 'Новая'} спецификация
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Аккредитованная марка (автозаполнение)</label>
                <ModalSelect
                  value={editing.accredited_marking || ''}
                  onChange={applyAccredited}
                  style={inputStyle}
                  placeholder="— Выбрать из аккредитованных марок —"
                  options={[
                    { value: '', label: '— Выбрать из аккредитованных марок —' },
                    ...concreteGrades.map((g) => ({
                      value: g.marking,
                      label: `${g.marking} · ${g.marka}`,
                      text: `${g.marking} · ${g.marka}`,
                    })),
                    ...mortarGrades.map((g) => ({
                      value: g.marking,
                      label: `${g.marking} · ${g.marka}`,
                      text: `${g.marking} · ${g.marka}`,
                    })),
                  ]}
                />
                <p style={{ color: COLORS.muted, fontSize: '12px', margin: '6px 0 0' }}>
                  Подставит класс, марку, F/W/П и продукцию. Значения ниже можно поправить вручную.
                </p>
              </div>
              <div>
                <label style={labelStyle}>Код спецификации</label>
                <input value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Номер заказа</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="number"
                    value={editing.order_id ?? ''}
                    onChange={(e) => { setEditing({ ...editing, order_id: e.target.value }); setOrderLookup(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && findOrder()}
                    onWheel={(e) => e.currentTarget.blur()}
                    placeholder="напр. 583"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button type="button" onClick={findOrder} disabled={orderChecking} style={{ ...ghostButton, padding: '0 14px', whiteSpace: 'nowrap' }}>
                    {orderChecking ? '...' : 'Найти'}
                  </button>
                </div>
                {orderLookup === false && (
                  <p style={{ color: COLORS.danger, fontSize: '12px', margin: '6px 0 0' }}>Заявка с таким номером не найдена.</p>
                )}
                {orderLookup && orderLookup.id && (
                  <p style={{ color: COLORS.accent, fontSize: '12px', margin: '6px 0 0' }}>
                    Найдена: №{orderLookup.id} · {orderLookup.organization_name || orderLookup.full_name || 'клиент не указан'}
                    {orderLookup.grade ? ` · ${orderLookup.grade}` : ''}
                  </p>
                )}
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Наименование</label>
                <input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Продукция</label>
                <input value={editing.product_name || ''} onChange={(e) => setEditing({ ...editing, product_name: e.target.value })} placeholder="напр. Бетон B30 М400 F300 W8 П3" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Марка</label>
                <input value={editing.grade || ''} onChange={(e) => setEditing({ ...editing, grade: e.target.value })} placeholder="М400" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Класс (B)</label>
                <input value={editing.strength_class || ''} onChange={(e) => setEditing({ ...editing, strength_class: e.target.value })} placeholder="В30" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Морозостойкость (F)</label>
                <input value={editing.frost_resistance || ''} onChange={(e) => setEditing({ ...editing, frost_resistance: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Водонепроницаемость (W)</label>
                <input value={editing.water_resistance || ''} onChange={(e) => setEditing({ ...editing, water_resistance: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Подвижность (П)</label>
                <input value={editing.slump || ''} onChange={(e) => setEditing({ ...editing, slump: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Статус</label>
                <ModalSelect
                  value={editing.status || 'active'}
                  onChange={(status) => setEditing({ ...editing, status })}
                  style={inputStyle}
                  options={[
                    { value: 'active', label: 'Активна' },
                    { value: 'archived', label: 'Архив' },
                  ]}
                />
              </div>
            </div>

            {/* Назначение рецептуры (по заводам) */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Назначенная рецептура</label>
                <button
                  onClick={() => setEditing({ ...editing, recipe_links: [...(editing.recipe_links || []), { plant_id: plants[0]?.id ?? null, recipe_id: null }] })}
                  style={{ ...ghostButton, padding: '6px 12px' }}
                >
                  + Добавить
                </button>
              </div>
              {(editing.recipe_links || []).length === 0 && (
                <p style={{ color: COLORS.muted, fontSize: '13px' }}>Рецептура не назначена.</p>
              )}
              {(editing.recipe_links || []).map((link: any, idx: number) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <ModalSelect
                    value={link.plant_id != null ? String(link.plant_id) : ''}
                    onChange={(v) => {
                      const links = [...editing.recipe_links];
                      links[idx] = { ...link, plant_id: v ? Number(v) : null };
                      setEditing({ ...editing, recipe_links: links });
                    }}
                    style={{ ...inputStyle, flex: '0 0 160px' }}
                    placeholder="Завод..."
                    options={[
                      { value: '', label: 'Завод...' },
                      ...plants.map((p) => ({
                        value: String(p.id),
                        label: p.name || p.title || p.code || `Завод #${p.id}`,
                      })),
                    ]}
                  />
                  <ModalSelect
                    value={link.recipe_id != null ? String(link.recipe_id) : ''}
                    onChange={(v) => {
                      const links = [...editing.recipe_links];
                      links[idx] = { ...link, recipe_id: v ? Number(v) : null };
                      setEditing({ ...editing, recipe_links: links });
                    }}
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="Рецептура..."
                    options={[
                      { value: '', label: 'Рецептура...' },
                      ...recipes.map((r) => ({
                        value: String(r.id),
                        label: `${r.code} — ${r.name}`,
                        text: `${r.code} — ${r.name}`,
                      })),
                    ]}
                  />
                  <button
                    onClick={() => setEditing({ ...editing, recipe_links: editing.recipe_links.filter((_: any, i: number) => i !== idx) })}
                    style={{ ...ghostButton, padding: '6px 12px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={ghostButton}>Отмена</button>
              <button onClick={save} disabled={saving} style={{ ...primaryButton(), opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {passportFor && (
        <PassportModal
          orderId={passportFor.order_id ?? null}
          specId={passportFor.id ?? null}
          onClose={() => setPassportFor(null)}
          onSaved={onPassportSaved}
        />
      )}
    </div>
  );
}
