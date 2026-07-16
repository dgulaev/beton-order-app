'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { COLORS, inputStyle as sharedInput, ghostButton, primaryButton, pillStyle } from './labStyles';
import SpecificationsTab from './components/SpecificationsTab';
import TestsTab from './components/TestsTab';
import OrdersTab from './components/OrdersTab';
import RecipeVersionsModal from './components/RecipeVersionsModal';
import TemplatesModal from './components/TemplatesModal';
import { useRealtimeOrders, useOrderChangeNotifications } from '../../../hooks/useRealtimeOrders';

type LabTab = 'orders' | 'specifications' | 'recipes' | 'tests';

function getCurrentUser() {
  if (typeof window === 'undefined') return { id: null as number | null, name: '' };
  try {
    const id = localStorage.getItem('userId');
    const cache = localStorage.getItem('userRoleCache');
    const name = cache ? (JSON.parse(cache).full_name || '') : '';
    return { id: id ? Number(id) : null, name };
  } catch {
    return { id: null, name: '' };
  }
}

export default function LaboratoryPage() {
  const [tab, setTab] = useState<LabTab>('orders');

  // ==================== ЗАЯВКИ (для вкладки «Заявки») ====================
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [passportOrderIds, setPassportOrderIds] = useState<Set<string>>(new Set());
  const loadedMonthsRef = useRef<Set<string>>(new Set());

  const mergeOrders = (prev: any[], incoming: any[]) => {
    const map = new Map(prev.map((o) => [String(o.id), o]));
    incoming.forEach((o) => map.set(String(o.id), { ...map.get(String(o.id)), ...o }));
    return Array.from(map.values());
  };

  // Ленивая помесячная загрузка заявок: грузим только тот месяц, который нужен
  // текущему виду недели. Уже загруженные месяцы не запрашиваем повторно.
  const ensureMonth = useCallback(async (year: number, month: number) => {
    const key = `${year}-${month}`;
    if (loadedMonthsRef.current.has(key)) return;
    loadedMonthsRef.current.add(key);
    setMonthLoading(true);
    try {
      const res = await fetch(`/api/adminCifra/orders?year=${year}&month=${month}`);
      if (res.ok) {
        const data = await res.json();
        setOrders((prev) => mergeOrders(prev, data));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setMonthLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setOrdersLoading(true);
      try {
        const now = new Date();
        await ensureMonth(now.getFullYear(), now.getMonth() + 1);

        const passRes = await fetch('/api/adminCifra/concrete-passports');
        if (passRes.ok) {
          const passports = await passRes.json();
          const ids = new Set<string>(
            (passports || [])
              .map((p: any) => (p.order_id != null ? String(p.order_id) : null))
              .filter(Boolean) as string[]
          );
          setPassportOrderIds(ids);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setOrdersLoading(false);
      }
    })();
  }, [ensureMonth]);

  // Live-обновление списка заявок (INSERT/UPDATE/DELETE).
  useRealtimeOrders(setOrders);

  // Отдельно отмечаем новые заявки для подсветки и бейджа на вкладке.
  useOrderChangeNotifications({
    onNewOrder: (o) => {
      if (!o?.id) return;
      setNewOrderIds((prev) => {
        const next = new Set(prev);
        next.add(String(o.id));
        return next;
      });
    },
  });

  const acknowledgeOrder = useCallback((id: string) => {
    setNewOrderIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const acknowledgeAllOrders = useCallback(() => setNewOrderIds(new Set()), []);

  // ==================== СОСТОЯНИЕ КАТАЛОГА РЕЦЕПТУР ====================
  const [recipes, setRecipes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [editingRecipe, setEditingRecipe] = useState<any>(null);
  const [changeNote, setChangeNote] = useState('');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [versionsFor, setVersionsFor] = useState<any>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const inputStyle = sharedInput;

  // ==================== ЗАГРУЗКА РЕЦЕПТОВ ====================
  useEffect(() => {
    fetchRecipes();
  }, []);

  const fetchRecipes = async () => {
    setLoading(true);
    try {
      // ?all=true — каталог лаборатории видит и неактивные рецепты.
      const res = await fetch('/api/adminCifra/recipes?all=true');
      if (res.ok) {
        let data = await res.json();
        data.sort((a: any, b: any) => {
          if (a.item_type === 'fbs' && b.item_type !== 'fbs') return 1;
          if (a.item_type !== 'fbs' && b.item_type === 'fbs') return -1;
          return 0;
        });
        setRecipes(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const groups = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => r.group_name && set.add(r.group_name));
    return Array.from(set).sort();
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (groupFilter !== 'all' && (r.group_name || '') !== groupFilter) return false;
      if (!q) return true;
      return [r.code, r.name, r.strength_class].filter(Boolean).some((v: string) => String(v).toLowerCase().includes(q));
    });
  }, [recipes, search, groupFilter]);

  // ==================== СОХРАНЕНИЕ РЕЦЕПТА ====================
  const saveRecipe = async (recipe: any) => {
    const user = getCurrentUser();
    const method = recipe.id ? 'PUT' : 'POST';
    const url = recipe.id ? `/api/adminCifra/recipes/${recipe.id}` : '/api/adminCifra/recipes';
    const body = recipe.id
      ? { ...recipe, changed_by: user.id, changed_by_name: user.name, change_note: changeNote || null }
      : recipe;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        fetchRecipes();
        setEditingRecipe(null);
        setChangeNote('');
        alert('Рецепт успешно сохранён');
      } else {
        const errText = await res.text();
        alert(`Ошибка сохранения: ${res.status} ${errText}`);
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка соединения с сервером');
    }
  };

  // ==================== УДАЛЕНИЕ ====================
  const deleteRecipe = async (id: number) => {
    if (!confirm('Удалить этот рецепт?')) return;
    try {
      const res = await fetch(`/api/adminCifra/recipes?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRecipes();
        alert('Рецепт удалён');
      }
    } catch (e) {
      alert('Ошибка удаления');
    }
  };

  // ==================== СОХРАНИТЬ КАК ШАБЛОН ====================
  const saveAsTemplate = async () => {
    if (!editingRecipe) return;
    const name = prompt('Название шаблона:', editingRecipe.code ? `${editingRecipe.code} шаблон` : 'Новый шаблон');
    if (!name) return;
    const { id, created_at, updated_at, ...payload } = editingRecipe;
    try {
      const res = await fetch('/api/adminCifra/recipe-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, group_name: editingRecipe.group_name || null, payload }),
      });
      if (res.ok) alert('Шаблон сохранён');
    } catch (e) {
      alert('Ошибка сохранения шаблона');
    }
  };

  const applyTemplate = (payload: any) => {
    setEditingRecipe((prev: any) => ({ ...prev, ...payload }));
  };

  const tabBtn = (key: LabTab, label: string, badge?: number) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: '10px 4px',
        background: 'transparent',
        border: 'none',
        borderBottom: tab === key ? `2px solid ${COLORS.accent}` : '2px solid transparent',
        color: tab === key ? '#fff' : COLORS.muted,
        fontSize: '16px',
        fontWeight: 600,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      {label}
      {badge != null && badge > 0 && (
        <span
          className="lab-tab-badge"
          style={{
            minWidth: '20px',
            height: '20px',
            padding: '0 6px',
            borderRadius: '9999px',
            background: COLORS.accent,
            color: '#0F172A',
            fontSize: '12px',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <div style={{ color: '#fff', padding: '0 0 24px 0' }}>
      {/* ==================== ЗАГОЛОВОК + ВКЛАДКИ ==================== */}
      <div style={{ marginBottom: '18px' }}>
        <style>{`
          @keyframes labTabBadgePulse {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(74,222,128,0.6); }
            50%      { transform: scale(1.12); box-shadow: 0 0 0 6px rgba(74,222,128,0); }
          }
          .lab-tab-badge { animation: labTabBadgePulse 1.4s infinite; }
        `}</style>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 12px' }}>Лаборатория</h1>
        <div style={{ display: 'flex', gap: '28px', borderBottom: `1px solid ${COLORS.border}` }}>
          {tabBtn('orders', 'Заявки', newOrderIds.size)}
          {tabBtn('specifications', 'Спецификации')}
          {tabBtn('recipes', 'Рецептуры')}
          {tabBtn('tests', 'Испытания')}
        </div>
      </div>

      {tab === 'orders' && (
        <OrdersTab
          orders={orders}
          loading={ordersLoading}
          monthLoading={monthLoading}
          newOrderIds={newOrderIds}
          passportOrderIds={passportOrderIds}
          onEnsureMonth={ensureMonth}
          onAcknowledge={acknowledgeOrder}
          onAcknowledgeAll={acknowledgeAllOrders}
        />
      )}
      {tab === 'specifications' && <SpecificationsTab />}
      {tab === 'tests' && <TestsTab />}

      {/* ==================== ВКЛАДКА РЕЦЕПТУРЫ ==================== */}
      {tab === 'recipes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input placeholder="Поиск рецептуры..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, width: '260px' }} />
              <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                <option value="all">Все группы</option>
                {groups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <button onClick={() => setShowTemplates(true)} style={ghostButton}>Шаблоны</button>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setEditingRecipe({ code: '', name: '', price: 0, cement: 0, sand: 0, gravel: 0, water: 0, additive: 0, additive2: 0, is_active: true })}
                style={primaryButton()}
              >
                + Новый рецепт
              </button>
              <button
                onClick={() => setEditingRecipe({ code: '', name: '', price: 0, length_cm: 240, width_cm: 30, height_cm: 60, unit: 'шт', item_type: 'fbs', is_active: true })}
                style={primaryButton('#3B82F6')}
              >
                + Новый ФБС
              </button>
            </div>
          </div>

          {/* Переключатель вида */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setViewMode('grid')} style={{ padding: '8px 20px', background: 'transparent', border: 'none', color: viewMode === 'grid' ? COLORS.accentDark : COLORS.muted, fontSize: '16px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '22px' }}>▦</span> Плитка
              </button>
              <button onClick={() => setViewMode('list')} style={{ padding: '8px 20px', background: 'transparent', border: 'none', color: viewMode === 'list' ? COLORS.accentDark : COLORS.muted, fontSize: '16px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '24px', lineHeight: 1 }}>≡</span> Список
              </button>
            </div>
          </div>

          {loading ? (
            <p style={{ color: COLORS.muted }}>Загрузка...</p>
          ) : viewMode === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
              {filteredRecipes.map((recipe) => (
                <div key={recipe.id} style={{ background: COLORS.card, borderRadius: '16px', padding: '16px', border: `1px solid ${COLORS.border}`, height: 'fit-content', opacity: recipe.is_active === false ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <div style={{ fontSize: '22px', fontWeight: 700 }}>{recipe.code}</div>
                    <span style={pillStyle(
                      recipe.item_type === 'fbs' ? '#6366F120' : (recipe.type === 'dolomite' ? '#FACC1520' : '#10B98120'),
                      recipe.item_type === 'fbs' ? '#6366F1' : (recipe.type === 'dolomite' ? '#FACC15' : '#10B981')
                    )}>
                      {recipe.item_type === 'fbs' ? 'ФБС' : (recipe.type === 'dolomite' ? 'Доломит' : 'Гранит')}
                    </span>
                  </div>
                  <div style={{ color: '#CBD5E1', fontSize: '16px', marginBottom: '14px' }}>{recipe.name}</div>

                  {/* Характеристики */}
                  {recipe.item_type !== 'fbs' && (recipe.strength_class || recipe.frost_resistance || recipe.water_resistance || recipe.slump) && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
                      {recipe.strength_class && <span style={pillStyle('rgba(96,165,250,0.12)', COLORS.blue)}>{recipe.strength_class}</span>}
                      {recipe.frost_resistance && <span style={pillStyle('rgba(148,163,184,0.15)', COLORS.muted)}>{recipe.frost_resistance}</span>}
                      {recipe.water_resistance && <span style={pillStyle('rgba(148,163,184,0.15)', COLORS.muted)}>{recipe.water_resistance}</span>}
                      {recipe.slump && <span style={pillStyle('rgba(148,163,184,0.15)', COLORS.muted)}>{recipe.slump}</span>}
                    </div>
                  )}

                  <div style={{ fontSize: '30px', fontWeight: 700, color: COLORS.blue, marginBottom: '16px' }}>
                    {Number(recipe.price || 0).toLocaleString()} ₽
                  </div>

                  {recipe.item_type !== 'fbs' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px', marginBottom: '18px' }}>
                      <div>Цемент: <strong>{recipe.cement} кг</strong></div>
                      <div>Песок: <strong>{recipe.sand} кг</strong></div>
                      <div>Щебень: <strong>{recipe.gravel} кг</strong></div>
                      <div>Вода: <strong>{recipe.water} кг</strong></div>
                    </div>
                  )}
                  {recipe.item_type === 'fbs' && (
                    <div style={{ fontSize: '14px', marginBottom: '18px', color: '#CBD5E1' }}>
                      {recipe.length_cm} × {recipe.width_cm} × {recipe.height_cm} см
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => { setChangeNote(''); setEditingRecipe(recipe); }} style={{ ...ghostButton, flex: 1 }}>Редактировать</button>
                    {recipe.id && <button onClick={() => setVersionsFor(recipe)} style={ghostButton}>История</button>}
                    <button onClick={() => deleteRecipe(recipe.id)} style={ghostButton}>Удалить</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: COLORS.card, borderRadius: '16px', overflow: 'hidden' }}>
              {filteredRecipes.map((recipe) => (
                <div key={recipe.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ width: '200px', fontWeight: 700, fontSize: '17px' }}>{recipe.code}</div>
                  <div style={{ flex: 1, color: '#CBD5E1', fontSize: '15px' }}>
                    {recipe.name}
                    {recipe.strength_class && <span style={{ color: COLORS.blue, marginLeft: '8px' }}>({recipe.strength_class}{recipe.slump ? ` ${recipe.slump}` : ''})</span>}
                  </div>
                  <div style={{ width: '140px', fontSize: '15px', fontWeight: 700, color: COLORS.blue, textAlign: 'right' }}>{Number(recipe.price || 0).toLocaleString()} ₽</div>
                  <div style={{ display: 'flex', gap: '8px', marginLeft: '40px' }}>
                    <button onClick={() => { setChangeNote(''); setEditingRecipe(recipe); }} style={ghostButton}>Изм.</button>
                    {recipe.id && <button onClick={() => setVersionsFor(recipe)} style={ghostButton}>История</button>}
                    <button onClick={() => deleteRecipe(recipe.id)} style={ghostButton}>Удал.</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== МОДАЛКА РЕДАКТИРОВАНИЯ РЕЦЕПТА ==================== */}
      {editingRecipe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setEditingRecipe(null)}>
          <div className="scroll-hidden" style={{ background: COLORS.card, padding: '28px', borderRadius: '20px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '22px', margin: 0 }}>
                {editingRecipe.id ? 'Редактирование' : 'Новый'} — {editingRecipe.item_type === 'fbs' ? 'ФБС' : 'Рецепт'}
              </h2>
              <button onClick={() => setShowTemplates(true)} style={{ ...ghostButton, padding: '6px 12px' }}>Применить шаблон</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Код марки</label>
                <input value={editingRecipe.code || ''} onChange={(e) => setEditingRecipe({ ...editingRecipe, code: e.target.value })} style={inputStyle} />
              </div>
              {editingRecipe.item_type !== 'fbs' && (
                <div>
                  <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Тип заполнителя</label>
                  <select value={editingRecipe.type || 'granite'} onChange={(e) => setEditingRecipe({ ...editingRecipe, type: e.target.value })} style={inputStyle}>
                    <option value="granite">Гранит</option>
                    <option value="dolomite">Доломит</option>
                  </select>
                </div>
              )}
            </div>

            <div style={{ marginTop: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Название</label>
              <input value={editingRecipe.name || ''} onChange={(e) => setEditingRecipe({ ...editingRecipe, name: e.target.value })} style={inputStyle} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Цена (₽)</label>
                <input type="number" value={editingRecipe.price || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, price: Number(e.target.value) })} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Группа</label>
                <input value={editingRecipe.group_name || ''} onChange={(e) => setEditingRecipe({ ...editingRecipe, group_name: e.target.value })} placeholder="напр. Зимние" style={inputStyle} />
              </div>
            </div>

            {/* Характеристики бетона */}
            {editingRecipe.item_type !== 'fbs' && (
              <>
                <h3 style={{ margin: '24px 0 12px', color: COLORS.blue }}>Характеристики бетона</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Класс (B)</label>
                    <input value={editingRecipe.strength_class || ''} onChange={(e) => setEditingRecipe({ ...editingRecipe, strength_class: e.target.value })} placeholder="В22,5" style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Морозостойкость (F)</label>
                    <input value={editingRecipe.frost_resistance || ''} onChange={(e) => setEditingRecipe({ ...editingRecipe, frost_resistance: e.target.value })} placeholder="F150" style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Водонепроницаемость (W)</label>
                    <input value={editingRecipe.water_resistance || ''} onChange={(e) => setEditingRecipe({ ...editingRecipe, water_resistance: e.target.value })} placeholder="W6" style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Подвижность (П)</label>
                    <input value={editingRecipe.slump || ''} onChange={(e) => setEditingRecipe({ ...editingRecipe, slump: e.target.value })} placeholder="П4" style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Марка цемента</label>
                    <input value={editingRecipe.cement_grade || ''} onChange={(e) => setEditingRecipe({ ...editingRecipe, cement_grade: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              </>
            )}

            {/* Размеры ФБС */}
            {editingRecipe.item_type === 'fbs' && (
              <div style={{ marginTop: '24px' }}>
                <h3 style={{ marginBottom: '12px', color: COLORS.blue }}>Размеры блока (см)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Длина</label>
                    <input type="number" value={editingRecipe.length_cm || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, length_cm: Number(e.target.value) })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Ширина</label>
                    <input type="number" value={editingRecipe.width_cm || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, width_cm: Number(e.target.value) })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Высота</label>
                    <input type="number" value={editingRecipe.height_cm || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, height_cm: Number(e.target.value) })} style={inputStyle} />
                  </div>
                </div>
              </div>
            )}

            {/* Состав */}
            {editingRecipe.item_type !== 'fbs' && (
              <>
                <h3 style={{ margin: '24px 0 12px', color: COLORS.blue }}>Состав на 1 м³</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Цемент (кг)</label><input type="number" value={editingRecipe.cement || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, cement: Number(e.target.value) })} style={inputStyle} /></div>
                  <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Песок (кг)</label><input type="number" value={editingRecipe.sand || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, sand: Number(e.target.value) })} style={inputStyle} /></div>
                  <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Щебень (кг)</label><input type="number" value={editingRecipe.gravel || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, gravel: Number(e.target.value) })} style={inputStyle} /></div>
                  <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Вода (кг)</label><input type="number" value={editingRecipe.water || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, water: Number(e.target.value) })} style={inputStyle} /></div>
                  <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Добавка 1 (кг)</label><input type="number" value={editingRecipe.additive || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, additive: Number(e.target.value) })} style={inputStyle} /></div>
                  <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Добавка 2 (кг)</label><input type="number" value={editingRecipe.additive2 || 0} onChange={(e) => setEditingRecipe({ ...editingRecipe, additive2: Number(e.target.value) })} style={inputStyle} /></div>
                </div>
              </>
            )}

            {/* Активность */}
            <div style={{ marginTop: '20px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: COLORS.muted }}>
                <input type="checkbox" checked={editingRecipe.is_active !== false} onChange={(e) => setEditingRecipe({ ...editingRecipe, is_active: e.target.checked })} style={{ width: '20px', height: '20px' }} />
                Активен
              </label>
            </div>

            {/* Комментарий к изменению (для истории версий) */}
            {editingRecipe.id && (
              <div style={{ marginTop: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Комментарий к изменению (в историю)</label>
                <input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="напр. скорректирован состав" style={inputStyle} />
              </div>
            )}

            <div style={{ marginTop: '28px', display: 'flex', gap: '12px' }}>
              <button onClick={() => saveRecipe(editingRecipe)} style={{ ...primaryButton(), flex: 1, justifyContent: 'center', padding: '14px' }}>Сохранить</button>
              <button onClick={saveAsTemplate} style={{ ...ghostButton, padding: '14px 18px' }}>Как шаблон</button>
              <button onClick={() => setEditingRecipe(null)} style={{ ...ghostButton, padding: '14px 18px' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {versionsFor && <RecipeVersionsModal recipe={versionsFor} onClose={() => setVersionsFor(null)} />}
      {showTemplates && (
        <TemplatesModal
          onClose={() => setShowTemplates(false)}
          onApply={editingRecipe ? applyTemplate : undefined}
        />
      )}
    </div>
  );
}
