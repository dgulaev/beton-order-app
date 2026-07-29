'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { COLORS, ghostButton } from './labStyles';
import SpecificationsTab from './components/SpecificationsTab';
import TestsTab from './components/TestsTab';
import OrdersTab from './components/OrdersTab';
import ProductsTab from './components/ProductsTab';
import LabSettingsModal from './components/LabSettingsModal';
import WarehousePage from '../warehouse/page';
import { useRealtimeOrders, useOrderChangeNotifications } from '../../../hooks/useRealtimeOrders';
import { FlaskConical } from 'lucide-react';
import { isFbs } from './productCatalog';

export type LabTab = 'orders' | 'specifications' | 'recipes' | 'tests' | 'warehouse';

interface LaboratoryPageProps {
  /** Встроено во вкладку оператора — без заголовка и без своей строки табов. */
  embedded?: boolean;
  /** Controlled-вкладка (для dropdown у оператора). */
  tab?: LabTab;
  onTabChange?: (tab: LabTab) => void;
  /** Увеличить снаружи, чтобы открыть модалку «Реквизиты». */
  openRequisitesKey?: number;
}

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

export default function LaboratoryPage({
  embedded = false,
  tab: controlledTab,
  onTabChange,
  openRequisitesKey = 0,
}: LaboratoryPageProps) {
  const [internalTab, setInternalTab] = useState<LabTab>('orders');
  const tab = controlledTab ?? internalTab;
  const setTab = (next: LabTab) => {
    if (onTabChange) onTabChange(next);
    if (controlledTab === undefined) setInternalTab(next);
  };

  // ==================== ЗАЯВКИ (для вкладки «Заявки») ====================
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  // orderId → массив всех паспортов этой заявки (полные записи)
  const [passportsByOrder, setPassportsByOrder] = useState<Map<string, any[]>>(new Map());
  // Сводка испытаний: orderId → { '7': result, '28': result }
  const [testSummary, setTestSummary] = useState<Map<string, Record<string, string>>>(new Map());
  const loadedMonthsRef = useRef<Set<string>>(new Set());
  const loadingMonthsRef = useRef<Set<string>>(new Set());
  const [testsFocusOrderId, setTestsFocusOrderId] = useState<number | null>(null);
  const [testsFocusDays, setTestsFocusDays] = useState<'7' | '28' | null>(null);
  const [showLabSettings, setShowLabSettings] = useState(false);

  useEffect(() => {
    if (openRequisitesKey > 0) setShowLabSettings(true);
  }, [openRequisitesKey]);

  const mergeOrders = (prev: any[], incoming: any[]) => {
    const map = new Map(prev.map((o) => [String(o.id), o]));
    incoming.forEach((o) => map.set(String(o.id), { ...map.get(String(o.id)), ...o }));
    return Array.from(map.values());
  };

  // Ленивая помесячная загрузка заявок: грузим только тот месяц, который нужен
  // текущему виду недели. Уже загруженные месяцы не запрашиваем повторно.
  // В loadedMonths добавляем только после успешного ответа — иначе месяц «залипает» пустым.
  const ensureMonth = useCallback(async (year: number, month: number) => {
    const key = `${year}-${month}`;
    if (loadedMonthsRef.current.has(key) || loadingMonthsRef.current.has(key)) return;
    loadingMonthsRef.current.add(key);
    setMonthLoading(true);
    try {
      const res = await fetch(`/api/adminCifra/orders?year=${year}&month=${month}`);
      if (res.ok) {
        const data = await res.json();
        setOrders((prev) => mergeOrders(prev, data));
        loadedMonthsRef.current.add(key);
      }
    } catch (e) {
      console.error(e);
    } finally {
      loadingMonthsRef.current.delete(key);
      setMonthLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setOrdersLoading(true);
      try {
        const now = new Date();
        await ensureMonth(now.getFullYear(), now.getMonth() + 1);

        const [passRes, testsRes] = await Promise.all([
          fetch('/api/adminCifra/concrete-passports'),
          fetch('/api/adminCifra/concrete-tests'),
        ]);

        if (passRes.ok) {
          const passports: any[] = await passRes.json();
          const map = new Map<string, any[]>();
          (passports || []).forEach((p: any) => {
            if (p.order_id == null) return;
            const key = String(p.order_id);
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(p);
          });
          setPassportsByOrder(map);
        }

        if (testsRes.ok) {
          const tests: any[] = await testsRes.json();
          // API отдаёт sample_date DESC — берём первую (свежую) запись на тип.
          const map = new Map<string, Record<string, string>>();
          tests.forEach((t) => {
            if (t.order_id == null) return;
            const key = String(t.order_id);
            const cur = map.get(key) || {};
            const tt = String(t.test_type);
            if (cur[tt] == null) cur[tt] = t.result || 'pending';
            map.set(key, cur);
          });
          setTestSummary(map);
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

  // После сохранения паспорта — перегружаем список паспортов для этой заявки
  const markPassportSaved = useCallback(async (orderId: number | null) => {
    if (orderId == null) return;
    try {
      const res = await fetch(`/api/adminCifra/concrete-passports?order_id=${orderId}`);
      if (!res.ok) return;
      const list: any[] = await res.json();
      setPassportsByOrder((prev) => {
        const next = new Map(prev);
        next.set(String(orderId), list);
        return next;
      });
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Обновить бейджи 7/28 на заявках после правок в журнале испытаний
  const refreshTestSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/adminCifra/concrete-tests');
      if (!res.ok) return;
      const tests: any[] = await res.json();
      const map = new Map<string, Record<string, string>>();
      tests.forEach((t) => {
        if (t.order_id == null) return;
        const key = String(t.order_id);
        const cur = map.get(key) || {};
        const tt = String(t.test_type);
        if (cur[tt] == null) cur[tt] = t.result || 'pending';
        map.set(key, cur);
      });
      setTestSummary(map);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // ==================== КАТАЛОГ ПРОДУКЦИИ (бетон / щебень·песок / ЖБИ) ====================
  const [recipes, setRecipes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecipes();
  }, []);

  const fetchRecipes = async () => {
    setLoading(true);
    try {
      // ?all=true — каталог видит и неактивные позиции.
      const res = await fetch('/api/adminCifra/recipes?all=true');
      if (res.ok) {
        let data = await res.json();
        data.sort((a: any, b: any) => {
          if (isFbs(a) && !isFbs(b)) return 1;
          if (!isFbs(a) && isFbs(b)) return -1;
          return String(a.code || '').localeCompare(String(b.code || ''), 'ru');
        });
        setRecipes(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const tabBtn = (key: LabTab, label: string, badge?: number) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: '12px 0',
        background: 'transparent',
        border: 'none',
        fontSize: '17px',
        fontWeight: 600,
        color: tab === key ? '#10B981' : '#64748B',
        cursor: 'pointer',
        position: 'relative',
        transition: 'color 0.2s',
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
            background: '#10B981',
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
      {tab === key && (
        <div
          style={{
            position: 'absolute',
            bottom: '-6px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '5px',
            height: '5px',
            backgroundColor: '#10B981',
            borderRadius: '50%',
            boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.3)',
          }}
        />
      )}
    </button>
  );

  const requisitesBtn = (
    <button
      type="button"
      onClick={() => setShowLabSettings(true)}
      style={ghostButton}
      title="Свидетельство, декларации и QR Росаккредитации"
    >
      Реквизиты
    </button>
  );

  return (
    <div
      style={{
        color: '#fff',
        height: embedded ? 'auto' : '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: embedded ? 'visible' : 'hidden',
      }}
    >
      {/* ==================== ЗАГОЛОВОК + ВКЛАДКИ (только полная страница) ==================== */}
      {!embedded && (
        <div style={{ marginBottom: '14px', flexShrink: 0 }}>
          <style>{`
            @keyframes labTabBadgePulse {
              0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(74,222,128,0.6); }
              50%      { transform: scale(1.12); box-shadow: 0 0 0 6px rgba(74,222,128,0); }
            }
            .lab-tab-badge { animation: labTabBadgePulse 1.4s infinite; }
          `}</style>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FlaskConical size={26} color="#94A3B8" />
              Лаборатория
            </h1>
            {requisitesBtn}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '48px',
              borderBottom: '1px solid #334155',
              paddingBottom: '8px',
            }}
          >
            {tabBtn('orders', 'Заявки', newOrderIds.size)}
            {tabBtn('specifications', 'Спецификации')}
            {tabBtn('recipes', 'Продукция')}
            {tabBtn('tests', 'Испытания')}
            {tabBtn('warehouse', 'Склад')}
          </div>
        </div>
      )}

      {/* Keep-alive вкладок: не размонтируем, чтобы не сбрасывать день/фильтры */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: tab === 'orders' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
          <OrdersTab
            orders={orders}
            loading={ordersLoading}
            monthLoading={monthLoading}
            newOrderIds={newOrderIds}
            passportsByOrder={passportsByOrder}
            testSummary={testSummary}
            onEnsureMonth={ensureMonth}
            onAcknowledge={acknowledgeOrder}
            onAcknowledgeAll={acknowledgeAllOrders}
            onPassportSaved={markPassportSaved}
            onOpenTests={(orderId, days) => {
              setTestsFocusOrderId(orderId ?? null);
              setTestsFocusDays(days ?? null);
              setTab('tests');
            }}
          />
        </div>
        <div style={{ display: tab === 'specifications' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
          <SpecificationsTab onPassportSaved={markPassportSaved} />
        </div>
        <div style={{ display: tab === 'tests' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
          <TestsTab
            focusOrderId={testsFocusOrderId}
            focusDays={testsFocusDays}
            onFocusConsumed={() => {
              setTestsFocusOrderId(null);
              setTestsFocusDays(null);
            }}
            onTestsChanged={refreshTestSummary}
          />
        </div>

        {/* Склад — для лаборанта (и остальных ролей на этой странице) */}
        {tab === 'warehouse' && (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <WarehousePage
              recipes={recipes}
              actorName={getCurrentUser().name || null}
            />
          </div>
        )}

        {/* ==================== ВКЛАДКА ПРОДУКЦИЯ ==================== */}
        {tab === 'recipes' && (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <ProductsTab recipes={recipes} loading={loading} onReload={fetchRecipes} />
          </div>
        )}
      </div>

      {showLabSettings && <LabSettingsModal onClose={() => setShowLabSettings(false)} />}
    </div>
  );
}
