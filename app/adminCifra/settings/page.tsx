'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Settings,
  Truck,
  FlaskConical,
  Cable,
  MapPin,
  Users,
  Bell,
  Factory,
  Timer,
  Warehouse,
  Layout,
  Shield,
  ExternalLink,
  Save,
  Info,
  Gavel,
  BookOpen,
  Wallet,
} from 'lucide-react';
import { useUserRole } from '../../providers/UserRoleProvider';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import DeliverySettingsTab from '../mixers/DeliverySettingsTab';
import LabSettingsForm from '../recipes/components/LabSettingsForm';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { formatBuildLabelFull, formatBuildVersion } from '@/lib/buildInfo';
import { appConfirm } from '../components/appDialog';
import {
  DEFAULT_SYSTEM_SETTINGS,
  NAV_SECTION_LABELS,
  NAV_SECTIONS,
  STAFF_ROLES_FOR_ACCESS,
  type NavSection,
  type StaffRoleKey,
  type SystemSettingsData,
} from '@/lib/systemSettings';
import type { LoadingPoint } from '@/lib/loadingPoints';
import { setRouteOriginCoordsOverride } from '@/lib/geocodeAddress';
import { setRouteOriginAddressOverride } from '@/lib/bryanskAddress';
import HelpSettingsTab from './HelpSettingsTab';
import FleetTariffsSettingsTab from './FleetTariffsSettingsTab';

const SECTIONS = [
  { id: 'delivery', label: 'Доставка и тарифы', icon: Truck },
  { id: 'fleetTariffs', label: 'Тарифы техники', icon: Wallet },
  { id: 'lab', label: 'Лаборатория', icon: FlaskConical },
  { id: 'integrations', label: 'Интеграции', icon: Cable },
  { id: 'loading', label: 'Точки погрузки', icon: MapPin },
  { id: 'staff', label: 'Сотрудники / торги', icon: Users },
  { id: 'help', label: 'Инструкции', icon: BookOpen },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'plant', label: 'Завод / гео', icon: Factory },
  { id: 'logistics', label: 'Нормы логистики', icon: Timer },
  { id: 'warehouse', label: 'Склад', icon: Warehouse },
  { id: 'interface', label: 'Интерфейс и баннеры', icon: Layout },
  { id: 'roles', label: 'Права по ролям', icon: Shield },
  { id: 'system', label: 'Система', icon: Info },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const KIND_LABEL: Record<string, string> = {
  concrete: 'Бетон',
  aggregate: 'Щебень',
  cement: 'Цемент',
  mixed: 'Смешанная',
};

const ROLE_LABEL: Record<StaffRoleKey, string> = {
  admin: 'Admin',
  manager: 'Manager',
  dispatcher: 'Dispatcher',
  operator: 'Operator',
  laborant: 'Laborant',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#25334A',
  border: '1px solid #334155',
  borderRadius: 10,
  color: '#fff',
  fontSize: 14,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  color: '#94A3B8',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
};

function SectionCard({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div style={volumeCardStyle({ borderRadius: 18, padding: '20px 22px', marginBottom: 16 })}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: hint ? 8 : 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#F1F5F9' }}>{title}</h2>
        {action}
      </div>
      {hint && (
        <p style={{ margin: '0 0 16px', color: '#94A3B8', fontSize: 13, lineHeight: 1.45 }}>{hint}</p>
      )}
      {children}
    </div>
  );
}

function LinkPill({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={volumeCardSoftStyle({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        borderRadius: 10,
        color: '#4ADE80',
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      })}
    >
      {label} <ExternalLink size={14} />
    </Link>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: roleLoading } = useUserRole();
  const userRole = user?.role || null;

  const [active, setActive] = useState<SectionId>('delivery');
  const [settings, setSettings] = useState<SystemSettingsData>(DEFAULT_SYSTEM_SETTINGS);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [defaultsPoints, setDefaultsPoints] = useState<LoadingPoint[]>([]);
  const [loadPointsError, setLoadPointsError] = useState<string | null>(null);
  type StaffRow = {
    user_id: number;
    full_name: string | null;
    phone: string | null;
    role: string;
    can_process_tenders?: boolean;
  };
  const [staffList, setStaffList] = useState<StaffRow[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [savingTenderUserId, setSavingTenderUserId] = useState<number | null>(null);

  useEffect(() => {
    if (roleLoading) return;
    if (userRole !== 'admin') {
      router.replace('/adminCifra/dashboard');
    }
  }, [roleLoading, userRole, router]);

  const loadSystem = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const res = await fetch('/api/adminCifra/system-settings', {
        headers: adminCifraAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  useEffect(() => {
    if (userRole === 'admin') void loadSystem();
  }, [userRole, loadSystem]);

  useEffect(() => {
    if (userRole !== 'admin') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/adminCifra/loading-points', {
          headers: adminCifraAuthHeaders(),
        });
        if (!res.ok) {
          if (!cancelled) setLoadPointsError('Не удалось загрузить точки');
          return;
        }
        const list: LoadingPoint[] = await res.json();
        if (!cancelled) {
          setDefaultsPoints((list || []).filter((p) => p.is_default && p.active !== false));
          setLoadPointsError(null);
        }
      } catch {
        if (!cancelled) setLoadPointsError('Ошибка соединения');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userRole]);

  const loadStaff = useCallback(async () => {
    setLoadingStaff(true);
    setStaffError(null);
    try {
      const res = await fetch('/api/adminCifra/staff', {
        headers: adminCifraAuthHeaders(),
      });
      if (!res.ok) {
        setStaffError('Не удалось загрузить сотрудников');
        return;
      }
      const list: StaffRow[] = await res.json();
      setStaffList(Array.isArray(list) ? list : []);
    } catch {
      setStaffError('Ошибка соединения');
    } finally {
      setLoadingStaff(false);
    }
  }, []);

  useEffect(() => {
    if (userRole === 'admin' && active === 'staff') void loadStaff();
  }, [userRole, active, loadStaff]);

  const toggleTenderFlag = async (person: StaffRow, next: boolean) => {
    if (!person.phone) {
      alert('У сотрудника не указан телефон — сначала заполни в карточке сотрудника');
      return;
    }
    setSavingTenderUserId(person.user_id);
    try {
      const res = await fetch('/api/adminCifra/staff', {
        method: 'PUT',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: person.user_id,
          fullName: person.full_name || '',
          phone: person.phone,
          role: person.role || 'manager',
          canProcessTenders: next,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        alert(data.error || 'Не удалось сохранить');
        return;
      }
      setStaffList((prev) =>
        prev.map((s) =>
          s.user_id === person.user_id ? { ...s, can_process_tenders: next } : s,
        ),
      );
    } catch {
      alert('Ошибка соединения с сервером');
    } finally {
      setSavingTenderUserId(null);
    }
  };

  const saveSystem = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/adminCifra/system-settings', {
        method: 'PUT',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Не удалось сохранить');
        return;
      }
      setSettings(data);
      setRouteOriginCoordsOverride({ lat: data.plant.lat, lon: data.plant.lon });
      setRouteOriginAddressOverride(data.plant.address);
      alert('✅ Системные настройки сохранены');
    } catch {
      alert('Ошибка соединения с сервером');
    } finally {
      setSavingSettings(false);
    }
  };

  const forceLogoutAll = async () => {
    if (
      !(await appConfirm(
        'Вы уверены, что хотите выкинуть ВСЕХ сотрудников?\n\nОни будут вынуждены заново ввести пароль.',
        { title: 'Выкинуть всех', okLabel: 'Выкинуть', variant: 'danger' },
      ))
    ) {
      return;
    }
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) {
        alert('Сессия не найдена');
        return;
      }
      const res = await fetch('/api/adminCifra/force-logout-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        alert(`✅ Выкинуто сотрудников: ${data.kicked ?? 'все'}. Ты остаёшься в системе.`);
      } else {
        alert('Ошибка: ' + (data.message || `HTTP ${res.status}`));
      }
    } catch {
      alert('Ошибка соединения с сервером');
    }
  };

  const patch = <K extends keyof SystemSettingsData>(key: K, value: SystemSettingsData[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleRoleAccess = (section: NavSection, role: StaffRoleKey) => {
    // Страница Настройки и PUT — только admin; матрица это отражает.
    if (section === 'settings') return;
    if (role === 'admin') return;
    setSettings((prev) => {
      const current = prev.roleAccess[section] || [];
      const has = current.includes(role);
      const next = has ? current.filter((r) => r !== role) : [...current, role];
      return { ...prev, roleAccess: { ...prev.roleAccess, [section]: next } };
    });
  };

  const toggleToastRole = (role: StaffRoleKey) => {
    setSettings((prev) => {
      const current = prev.notifications.orderToastRoles;
      const has = current.includes(role);
      return {
        ...prev,
        notifications: {
          ...prev.notifications,
          orderToastRoles: has ? current.filter((r) => r !== role) : [...current, role],
        },
      };
    });
  };

  const systemDirtyHint = useMemo(
    () =>
      'Секции «Уведомления», «Завод», «Нормы», «Склад», «Интерфейс», «Права» сохраняются кнопкой ниже.',
    [],
  );

  if (roleLoading || userRole !== 'admin') {
    return (
      <div style={{ padding: 48, color: '#94A3B8', textAlign: 'center' }}>
        {roleLoading ? 'Загрузка...' : 'Доступ только для admin'}
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexShrink: 0 }}>
        <Settings size={24} color="#94A3B8" />
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Настройки</h1>
        <span style={{ color: '#64748B', fontSize: 13 }}>централизованно · дубли разделов остаются на местах</span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '220px minmax(0, 1fr)',
          gap: 20,
          overflow: 'hidden',
        }}
      >
        <nav
          className="scroll-hidden"
          style={{
            ...volumeCardSoftStyle({
              borderRadius: 16,
              padding: 10,
              overflowY: 'auto',
              minHeight: 0,
              alignSelf: 'stretch',
            }),
          }}
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const on = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  marginBottom: 4,
                  borderRadius: 10,
                  border: on ? '1px solid rgba(74,222,128,0.4)' : '1px solid transparent',
                  background: on ? 'rgba(74,222,128,0.12)' : 'transparent',
                  color: on ? '#4ADE80' : '#94A3B8',
                  cursor: 'pointer',
                  fontSize: 13.5,
                  fontWeight: on ? 600 : 500,
                  textAlign: 'left',
                }}
              >
                <Icon size={16} style={{ flexShrink: 0 }} />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div className="scroll-hidden" style={{ minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          {active === 'delivery' && (
            <SectionCard
              title="Доставка и тарифы"
              hint="Дубль вкладки Техника → «Тарифы доставки». Сохраняется своей кнопкой внутри формы."
              action={<LinkPill href="/adminCifra/mixers" label="Открыть в Технике" />}
            >
              <DeliverySettingsTab />
            </SectionCard>
          )}

          {active === 'fleetTariffs' && (
            <SectionCard
              title="Тарифы техники"
              hint="Дубль тарифов единиц из раздела Техника (кроме миксеров). Данные в mixers.specs — для расчётов в рейсах на следующем этапе."
              action={<LinkPill href="/adminCifra/mixers" label="Открыть Технику" />}
            >
              <FleetTariffsSettingsTab />
            </SectionCard>
          )}

          {active === 'lab' && (
            <SectionCard
              title="Лаборатория — реквизиты и аттестация"
              hint="Дубль модалки «Реквизиты» на странице Лаборатория."
              action={<LinkPill href="/adminCifra/recipes" label="Открыть лабораторию" />}
            >
              <LabSettingsForm embedded />
            </SectionCard>
          )}

          {active === 'help' && (
            <SectionCard
              title="Инструкции для сотрудников"
              hint="Тексты справки «?» и онбординга. Дефолты в коде; сохранённые здесь переопределяют их. Если сохранение падает — в Supabase выполни NOTIFY pgrst, 'reload schema';."
            >
              <HelpSettingsTab />
            </SectionCard>
          )}

          {active === 'integrations' && (
            <SectionCard
              title="Интеграции"
              hint="Секреты Авито / ГосПлан / Спрос настраиваются на отдельной странице (безопаснее не дублировать поля ключей здесь)."
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ margin: 0, color: '#CBD5E1', fontSize: 14, lineHeight: 1.5 }}>
                  Подключение площадок, webhook, демо-спрос и заявки на новые интеграции — в разделе Продажи →
                  Интеграции.
                </p>
                <div>
                  <LinkPill href="/adminCifra/integrations" label="Открыть интеграции" />
                </div>
              </div>
            </SectionCard>
          )}

          {active === 'loading' && (
            <SectionCard
              title="Точки погрузки — по умолчанию"
              hint="Точки с флагом «По умолчанию для типа». Полный CRUD — на странице Точки погрузки."
              action={<LinkPill href="/adminCifra/loading-points" label="Управление точками" />}
            >
              {loadPointsError && <p style={{ color: '#F87171' }}>{loadPointsError}</p>}
              {!loadPointsError && defaultsPoints.length === 0 && (
                <p style={{ color: '#64748B', margin: 0 }}>Нет активных точек по умолчанию.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {defaultsPoints.map((p) => (
                  <div
                    key={p.id}
                    style={volumeCardSoftStyle({
                      borderRadius: 12,
                      padding: '12px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'center',
                    })}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#E2E8F0' }}>{p.name}</div>
                      <div style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>
                        {KIND_LABEL[p.kind || ''] || p.kind || '—'}
                        {p.address ? ` · ${p.address}` : ''}
                      </div>
                    </div>
                    <span style={{ color: '#4ADE80', fontSize: 12, fontWeight: 700 }}>DEFAULT</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {active === 'staff' && (
            <>
            <SectionCard
              title="Специалисты по торгам"
              hint="Флаг can_process_tenders: обработка заявок спроса/торгов, документы, назначение исполнителей. Админы имеют доступ всегда. Тот же переключатель — в карточке сотрудника."
              action={<LinkPill href="/adminCifra/clients?tab=staff" label="Все сотрудники" />}
            >
              {loadingStaff && <p style={{ color: '#64748B', margin: 0 }}>Загрузка...</p>}
              {staffError && <p style={{ color: '#F87171', margin: 0 }}>{staffError}</p>}
              {!loadingStaff && !staffError && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {staffList
                    .filter((s) => ['admin', 'manager', 'dispatcher'].includes(String(s.role || '').toLowerCase()))
                    .map((person) => {
                      const role = String(person.role || '').toLowerCase();
                      const isAdmin = role === 'admin';
                      const on = isAdmin || person.can_process_tenders === true;
                      const busy = savingTenderUserId === person.user_id;
                      return (
                        <label
                          key={person.user_id}
                          style={volumeCardSoftStyle({
                            borderRadius: 12,
                            padding: '12px 14px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            cursor: isAdmin || busy ? 'default' : 'pointer',
                            opacity: busy ? 0.7 : 1,
                          })}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={isAdmin || busy}
                            onChange={(e) => {
                              if (isAdmin) return;
                              void toggleTenderFlag(person, e.target.checked);
                            }}
                            style={{ marginTop: 3, width: 16, height: 16, accentColor: '#D97706' }}
                          />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span style={{ color: '#F8FAFC', fontWeight: 600, fontSize: 14 }}>
                                {person.full_name || 'Без имени'}
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: '#94A3B8',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                {role}
                              </span>
                              {on && (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#FBBF24',
                                  }}
                                >
                                  <Gavel size={12} />
                                  {isAdmin ? 'всегда' : 'торги'}
                                </span>
                              )}
                            </span>
                            <span style={{ display: 'block', color: '#64748B', fontSize: 12, marginTop: 3 }}>
                              {person.phone || 'телефон не указан'}
                              {isAdmin ? ' · админ обрабатывает торги без флага' : ''}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  {staffList.filter((s) =>
                    ['admin', 'manager', 'dispatcher'].includes(String(s.role || '').toLowerCase()),
                  ).length === 0 && (
                    <p style={{ color: '#64748B', margin: 0 }}>Нет сотрудников с ролями admin / manager / dispatcher.</p>
                  )}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Сотрудники — полное управление">
              <p style={{ margin: '0 0 14px', color: '#CBD5E1', fontSize: 14, lineHeight: 1.5 }}>
                Карточки, роли, пароли и имена операторов смены — во вкладке «Сотрудники» на странице Клиенты.
              </p>
              <LinkPill href="/adminCifra/clients?tab=staff" label="Открыть сотрудников" />
            </SectionCard>
            </>
          )}

          {(active === 'notifications' ||
            active === 'plant' ||
            active === 'logistics' ||
            active === 'warehouse' ||
            active === 'interface' ||
            active === 'roles') && (
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                marginBottom: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 12,
                background: 'rgba(15,23,42,0.92)',
                border: '1px solid #334155',
              }}
            >
              <span style={{ color: '#94A3B8', fontSize: 12 }}>{systemDirtyHint}</span>
              <button
                type="button"
                onClick={() => void saveSystem()}
                disabled={savingSettings || loadingSettings}
                style={volumeCardSoftStyle({
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 10,
                  background: 'linear-gradient(165deg, #10B981 0%, #059669 100%)',
                  border: '1px solid rgba(110,231,183,0.35)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: savingSettings ? 'not-allowed' : 'pointer',
                  opacity: savingSettings ? 0.7 : 1,
                })}
              >
                <Save size={15} />
                {savingSettings ? 'Сохранение...' : 'Сохранить системные'}
              </button>
            </div>
          )}

          {active === 'notifications' && (
            <SectionCard title="Уведомления" hint="Глобальные флаги для админки. Применяются после сохранения.">
              {loadingSettings ? (
                <p style={{ color: '#64748B' }}>Загрузка...</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {(
                    [
                      ['muteSound', 'Выключить звук тостов'],
                      ['muteToasts', 'Не показывать тосты (баннеры уведомлений)'],
                      ['channelToasts', 'Канал: тосты в админке'],
                      ['channelMax', 'Канал: Max (ручная отправка уведомления по заявке)'],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: '#E2E8F0' }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(settings.notifications[key])}
                        onChange={(e) =>
                          patch('notifications', {
                            ...settings.notifications,
                            [key]: e.target.checked,
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 8, fontWeight: 600 }}>
                      Кто получает тосты по заявкам
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {STAFF_ROLES_FOR_ACCESS.map((role) => (
                        <label
                          key={role}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            color: '#CBD5E1',
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={settings.notifications.orderToastRoles.includes(role)}
                            onChange={() => toggleToastRole(role)}
                          />
                          {ROLE_LABEL[role]}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          {active === 'plant' && (
            <SectionCard
              title="Завод / гео"
              hint="Адрес и координаты БСУ для маршрутов; отдельно — точка для прогноза погоды."
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Адрес завода (точка погрузки по умолчанию)</label>
                  <input
                    style={inputStyle}
                    value={settings.plant.address}
                    onChange={(e) => patch('plant', { ...settings.plant, address: e.target.value })}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Широта (маршруты)</label>
                  <input
                    type="number"
                    step="0.000001"
                    style={inputStyle}
                    value={settings.plant.lat}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') return;
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      patch('plant', { ...settings.plant, lat: n });
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Долгота (маршруты)</label>
                  <input
                    type="number"
                    step="0.000001"
                    style={inputStyle}
                    value={settings.plant.lon}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') return;
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      patch('plant', { ...settings.plant, lon: n });
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Широта (погода)</label>
                  <input
                    type="number"
                    step="0.000001"
                    style={inputStyle}
                    value={settings.plant.weatherLat}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') return;
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      patch('plant', { ...settings.plant, weatherLat: n });
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Долгота (погода)</label>
                  <input
                    type="number"
                    step="0.000001"
                    style={inputStyle}
                    value={settings.plant.weatherLon}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') return;
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      patch('plant', { ...settings.plant, weatherLon: n });
                    }}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Подпись локации погоды</label>
                  <input
                    style={inputStyle}
                    value={settings.plant.weatherLabel}
                    onChange={(e) => patch('plant', { ...settings.plant, weatherLabel: e.target.value })}
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {active === 'logistics' && (
            <SectionCard title="Нормы логистики">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Порог задержки заявки, мин</label>
                  <input
                    type="number"
                    min={1}
                    style={inputStyle}
                    value={settings.logistics.delayMinutesThreshold}
                    onChange={(e) =>
                      patch('logistics', {
                        ...settings.logistics,
                        delayMinutesThreshold: Number(e.target.value) || 15,
                      })
                    }
                  />
                  <div style={{ color: '#64748B', fontSize: 12, marginTop: 6 }}>
                    KPI «Задержки» на дашборде: опоздание больше этого значения.
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Норма разгрузки своих миксеров, мин</label>
                  <input
                    type="number"
                    min={1}
                    style={inputStyle}
                    value={settings.logistics.ownUnloadAllowanceMin}
                    onChange={(e) =>
                      patch('logistics', {
                        ...settings.logistics,
                        ownUnloadAllowanceMin: Number(e.target.value) || 50,
                      })
                    }
                  />
                  <div style={{ color: '#64748B', fontSize: 12, marginTop: 6 }}>
                    Для наёмных по-прежнему берётся значение с карточки техники.
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {active === 'warehouse' && (
            <SectionCard
              title="Склад — пороги глубокого минуса"
              hint="Одноразовый алерт оператору и админу (админу — персистентно, даже если был офлайн): проверить оборудование / дать задание оператору. Дефолт — силосы ~75 т → 5 т, силос ~150 т → 10 т. Чтобы БД считала эти пороги, один раз выполни scripts/warehouse-silo-low-rate-alert-settings-threshold.sql в Supabase."
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Силос 1 и 2 (~75 т), порог минуса</label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    style={inputStyle}
                    value={settings.warehouse.lowRateTonsSilo12}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') return;
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      patch('warehouse', {
                        ...settings.warehouse,
                        lowRateTonsSilo12: Math.max(0, n),
                      });
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Силос 3 (~150 т), порог минуса</label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    style={inputStyle}
                    value={settings.warehouse.lowRateTonsSilo3}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') return;
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      patch('warehouse', {
                        ...settings.warehouse,
                        lowRateTonsSilo3: Math.max(0, n),
                      });
                    }}
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {active === 'interface' && (
            <SectionCard title="Интерфейс и баннеры">
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  color: '#E2E8F0',
                  marginBottom: 18,
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.interface.sidebarCollapsedDefault}
                  onChange={(e) =>
                    patch('interface', {
                      ...settings.interface,
                      sidebarCollapsedDefault: e.target.checked,
                    })
                  }
                />
                Сайдбар свёрнут по умолчанию (если сотрудник ещё не выбирал сам)
              </label>

              <h3 style={{ margin: '0 0 10px', fontSize: 15, color: '#93C5FD' }}>Объявление для сотрудников</h3>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  color: '#E2E8F0',
                  marginBottom: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.interface.banner.enabled}
                  onChange={(e) =>
                    patch('interface', {
                      ...settings.interface,
                      banner: { ...settings.interface.banner, enabled: e.target.checked },
                    })
                  }
                />
                Показывать баннер
              </label>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Заголовок</label>
                  <input
                    style={inputStyle}
                    value={settings.interface.banner.title}
                    onChange={(e) =>
                      patch('interface', {
                        ...settings.interface,
                        banner: { ...settings.interface.banner, title: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <label style={labelStyle}>Текст</label>
                  <textarea
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                    value={settings.interface.banner.body}
                    onChange={(e) =>
                      patch('interface', {
                        ...settings.interface,
                        banner: { ...settings.interface.banner, body: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <label style={labelStyle}>Показывать до (дата, необязательно)</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={settings.interface.banner.expiresAt || ''}
                    onChange={(e) =>
                      patch('interface', {
                        ...settings.interface,
                        banner: {
                          ...settings.interface.banner,
                          expiresAt: e.target.value || null,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {active === 'roles' && (
            <SectionCard
              title="Права по ролям (меню)"
              hint="Управляет видимостью пунктов сайдбара и клиентскими редиректами. «Настройки» — только admin. У laborant/operator часть меню по-прежнему жёстко задана в коде (лаборатория / оператор БСУ). Серверные проверки API не отключаются."
            >
              <div className="scroll-hidden" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 6px', color: '#94A3B8', fontWeight: 600 }}>
                        Раздел
                      </th>
                      {STAFF_ROLES_FOR_ACCESS.map((role) => (
                        <th
                          key={role}
                          style={{ textAlign: 'center', padding: '8px 6px', color: '#94A3B8', fontWeight: 600 }}
                        >
                          {ROLE_LABEL[role]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {NAV_SECTIONS.map((section) => (
                      <tr key={section} style={{ borderTop: '1px solid #334155' }}>
                        <td style={{ padding: '10px 6px', color: '#E2E8F0' }}>{NAV_SECTION_LABELS[section]}</td>
                        {STAFF_ROLES_FOR_ACCESS.map((role) => {
                          const settingsOnlyAdmin = section === 'settings';
                          const checked = settingsOnlyAdmin
                            ? role === 'admin'
                            : role === 'admin' || (settings.roleAccess[section] || []).includes(role);
                          return (
                            <td key={role} style={{ textAlign: 'center', padding: '8px 6px' }}>
                              <input
                                type="checkbox"
                                disabled={settingsOnlyAdmin || role === 'admin'}
                                checked={checked}
                                onChange={() => toggleRoleAccess(section, role)}
                                title={
                                  settingsOnlyAdmin
                                    ? 'Настройки доступны только admin'
                                    : role === 'admin'
                                      ? 'Admin всегда имеет доступ'
                                      : undefined
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {active === 'system' && (
            <SectionCard title="Система">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={volumeCardSoftStyle({ borderRadius: 12, padding: '14px 16px' })}>
                  <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>Версия сборки</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#E2E8F0' }}>{formatBuildVersion()}</div>
                  <div style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>{formatBuildLabelFull()}</div>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => void forceLogoutAll()}
                    style={volumeCardSoftStyle({
                      padding: '12px 18px',
                      borderRadius: 12,
                      color: '#FCA5A5',
                      fontWeight: 700,
                      fontSize: 14,
                      cursor: 'pointer',
                      border: '1px solid rgba(248,113,113,0.35)',
                    })}
                  >
                    Разлогинить всех
                  </button>
                  <div style={{ color: '#64748B', fontSize: 12, marginTop: 8 }}>
                    Та же кнопка, что в подвале сайдбара. Твоя сессия сохранится.
                  </div>
                </div>
                <p style={{ margin: 0, color: '#64748B', fontSize: 12, lineHeight: 1.45 }}>
                  SQL для таблицы настроек: <code style={{ color: '#94A3B8' }}>scripts/system-settings-schema.sql</code>
                </p>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
