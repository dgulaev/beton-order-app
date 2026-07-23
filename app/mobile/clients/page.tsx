'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, X, Phone, Users, Briefcase, ChevronDown, ChevronRight, Building2, User } from 'lucide-react';
import MobileExitButton from '../components/MobileExitButton';
import MobileClientDetailModal from '../components/MobileClientDetailModal';
import { useUserRole } from '../../providers/UserRoleProvider';
import { formatPhoneDisplay } from '@/lib/phone';
import { CARD_BORDER, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '@/app/adminCifra/cardStyles';

// ==================== ТИПЫ ====================

type Tab = 'clients' | 'staff';

// ==================== ХЕЛПЕРЫ ====================

function initials(name: string): string {
  return (name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function roleLabel(role: string): string {
  switch (role) {
    case 'admin':      return 'Администратор';
    case 'manager':    return 'Менеджер';
    case 'dispatcher': return 'Диспетчер';
    case 'operator':   return 'Оператор';
    case 'laborant':   return 'Лаборант';
    default:           return role;
  }
}

const AVATAR_COLORS = ['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#06B6D4','#EC4899'];
function avatarColor(name: string): string {
  let n = 0;
  for (const ch of name) n += ch.charCodeAt(0);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

// ==================== КНОПКА В СТИЛЕ MODALACTIONBUTTON ====================

function OutlineBtn({
  onClick, color, label, icon, fullWidth, disabled,
}: {
  onClick: () => void;
  color: string;
  label: string;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        padding: '12px 18px',
        width: fullWidth ? '100%' : undefined,
        background: hover && !disabled ? `${color}18` : 'transparent',
        border: `1px solid ${color}${hover && !disabled ? '80' : '35'}`,
        borderRadius: '12px',
        color,
        fontWeight: 600,
        fontSize: '14px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s, border-color 0.15s',
        flexShrink: 0,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ==================== ГЛАВНАЯ СТРАНИЦА ====================

export default function MobileClientsPage() {
  const { user } = useUserRole();
  const currentRole = user?.role || 'manager';
  const currentUserName = user?.full_name || user?.username || 'Сотрудник';

  const [tab, setTab] = useState<Tab>('clients');

  // Разделяем "что в поле ввода" и "по чему реально ищем"
  const [searchInput, setSearchInput] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');

  // Клиенты
  const [clients, setClients] = useState<any[]>([]);
  const [clientsTotal, setClientsTotal] = useState(0);
  const [clientsPage, setClientsPage] = useState(1);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsHasMore, setClientsHasMore] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState<any>(null);

  // Сотрудники
  const [staff, setStaff] = useState<any[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);

  const LIMIT = 20;

  // ==================== ЗАГРУЗКА КЛИЕНТОВ ====================

  const loadClients = useCallback(async (page: number, q: string, reset: boolean) => {
    setClientsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (q) params.set('search', q);
      const userId = localStorage.getItem('userId');
      const res = await fetch(`/api/adminCifra/clients/grouped?${params}`, {
        headers: userId ? { 'x-user-id': userId } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      const items: any[] = data.clients || data.profiles || [];
      const total: number = data.total || 0;
      setClientsTotal(total);
      setClients(prev => reset ? items : [...prev, ...items]);
      setClientsHasMore(page * LIMIT < total);
    } catch (err) {
      console.error('Ошибка загрузки клиентов:', err);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  // Перезагрузка при смене committedSearch или вкладки
  useEffect(() => {
    if (tab !== 'clients') return;
    setClientsPage(1);
    loadClients(1, committedSearch, true);
  }, [committedSearch, tab, loadClients]);

  // Кнопка «Найти» / Enter
  const handleSearch = useCallback(() => {
    setCommittedSearch(searchInput.trim());
  }, [searchInput]);

  // Сброс поиска
  const handleClear = useCallback(() => {
    setSearchInput('');
    setCommittedSearch('');
  }, []);

  const loadMore = useCallback(() => {
    if (clientsLoading || !clientsHasMore) return;
    const next = clientsPage + 1;
    setClientsPage(next);
    loadClients(next, committedSearch, false);
  }, [clientsLoading, clientsHasMore, clientsPage, committedSearch, loadClients]);

  // ==================== ЗАГРУЗКА СОТРУДНИКОВ ====================

  const loadStaff = useCallback(async () => {
    setStaffLoading(true);
    try {
      const res = await fetch('/api/adminCifra/staff');
      if (!res.ok) return;
      const data = await res.json();
      setStaff(Array.isArray(data) ? data : (data.staff || []));
    } catch (err) {
      console.error('Ошибка загрузки сотрудников:', err);
    } finally {
      setStaffLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'staff') loadStaff();
  }, [tab, loadStaff]);

  // ==================== РЕНДЕР ====================

  return (
    <div style={{ paddingBottom: '100px', minHeight: '100vh', background: '#0F172A' }}>

      {/* ШАПКА */}
      <div style={{ padding: '16px 16px 0', position: 'sticky', top: 0, background: '#0F172A', zIndex: 100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: '700', margin: 0, color: '#fff' }}>Клиенты</h1>
          <MobileExitButton />
        </div>

        {/* ВКЛАДКИ в стиле ModalActionButton */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <TabBtn active={tab === 'clients'} onClick={() => setTab('clients')} icon={<Users size={14} />} label="Клиенты" count={clientsTotal} />
          <TabBtn active={tab === 'staff'} onClick={() => setTab('staff')} icon={<Briefcase size={14} />} label="Сотрудники" />
        </div>

        {/* ПОИСК — поле + кнопки */}
        {tab === 'clients' && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#475569', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Имя, телефон, ИНН..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                style={volumeCardSoftStyle({
                  width: '100%',
                  padding: '12px 36px 12px 36px',
                  borderRadius: 12,
                  color: '#fff',
                  fontSize: '15px',
                  outline: 'none',
                  colorScheme: 'dark',
                })}
              />
              {searchInput && (
                <button
                  onClick={handleClear}
                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', display: 'flex', padding: '2px' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <OutlineBtn onClick={handleSearch} color="#3B82F6" label="Найти" icon={<Search size={14} />} disabled={clientsLoading} />
          </div>
        )}

        {/* Активный поиск — подсказка */}
        {tab === 'clients' && committedSearch && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', paddingBottom: '10px', borderBottom: CARD_BORDER }}>
            <span style={{ fontSize: '13px', color: '#64748B' }}>
              Поиск: <span style={{ color: '#93C5FD' }}>«{committedSearch}»</span> — {clientsTotal} рез.
            </span>
            <OutlineBtn onClick={handleClear} color="#EF4444" label="Сбросить" icon={<X size={13} />} />
          </div>
        )}
      </div>

      {/* ==================== СПИСОК КЛИЕНТОВ ==================== */}
      {tab === 'clients' && (
        <div style={{ padding: '0 16px' }}>
          {clients.length === 0 && !clientsLoading && (
            <EmptyState text={committedSearch ? 'Ничего не найдено' : 'Клиентов пока нет'} />
          )}

          {clients.map((profile: any) => {
            const name = profile.organization_name || profile.full_name || 'Клиент';
            const isLegal = !!profile.organization_name;
            const phone = profile.phones?.[0] || profile.clients?.[0]?.phone || null;
            const volume = Number(profile.total_volume || 0);
            const ordersCount = Number(profile.total_orders || 0);
            const color = isLegal ? '#10B981' : '#60A5FA';

            return (
              <div
                key={profile.groupId}
                onClick={() => setSelectedProfile(profile)}
                style={volumeCardSoftStyle({
                  borderRadius: 16,
                  marginBottom: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'stretch',
                  overflow: 'hidden',
                  WebkitTapHighlightColor: 'transparent',
                  border: CARD_BORDER,
                })}
              >
                {/* Цветная полоска слева */}
                <div style={{ width: '4px', background: color, flexShrink: 0 }} />

                {/* Основной контент */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 10px 12px 12px', minWidth: 0 }}>

                  {/* Аватар */}
                  <div style={{
                    width: '42px', height: '42px', borderRadius: '13px',
                    background: `${color}22`,
                    border: `1.5px solid ${color}50`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {isLegal
                      ? <Building2 size={18} color={color} />
                      : <User size={18} color={color} />
                    }
                  </div>

                  {/* Текст — занимает всё доступное место */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Строка 1: имя + объём */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: '14px', color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </div>
                      {volume > 0 && (
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#10B981', background: '#10B98115', border: '1px solid #10B98130', borderRadius: '7px', padding: '1px 7px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {volume % 1 === 0 ? volume : volume.toFixed(1)} м³
                        </div>
                      )}
                    </div>
                    {/* Строка 2: телефон + тип + кол-во заказов */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', overflow: 'hidden' }}>
                      {phone && (
                        <span style={{ fontSize: '12px', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                          {formatPhoneDisplay(phone)}
                        </span>
                      )}
                      {ordersCount > 0 && (
                        <span style={{ fontSize: '10px', color: '#334155', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {ordersCount} зак.
                        </span>
                      )}
                    </div>
                  </div>

                  <ChevronRight size={13} color="#2D3F55" style={{ flexShrink: 0 }} />
                </div>
              </div>
            );
          })}

          {clientsLoading && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#475569', fontSize: '14px' }}>Загрузка...</div>
          )}

          {!clientsLoading && clientsHasMore && (
            <div style={{ marginTop: '4px', marginBottom: '8px' }}>
              <OutlineBtn
                onClick={loadMore}
                color="#64748B"
                label={`Загрузить ещё (${clientsTotal - clients.length} из ${clientsTotal})`}
                icon={<ChevronDown size={15} />}
                fullWidth
              />
            </div>
          )}
        </div>
      )}

      {/* ==================== СПИСОК СОТРУДНИКОВ ==================== */}
      {tab === 'staff' && (
        <div style={{ padding: '0 16px' }}>
          {staffLoading && <div style={{ textAlign: 'center', padding: '32px', color: '#475569', fontSize: '14px' }}>Загрузка...</div>}
          {!staffLoading && staff.length === 0 && <EmptyState text="Нет данных о сотрудниках" />}

          {!staffLoading && staff.map((member: any) => {
            const name = member.full_name || member.username || 'Сотрудник';
            const phone = member.phone || null;
            const role = roleLabel(member.role || '');
            const clientsCount = Number(member.clients_count || 0);
            const memberVolume = Number(member.total_volume || 0);

            return (
              <div key={member.user_id} style={volumeCardStyle({ borderRadius: 16, padding: '14px 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '14px' })}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '13px',
                  background: avatarColor(name), display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '16px', fontWeight: '700', color: '#fff', flexShrink: 0,
                }}>
                  {initials(name)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '600', fontSize: '15px', color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>{role}</div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                    {clientsCount > 0 && (
                      <span style={{ fontSize: '12px', color: '#10B98180', border: '1px solid #10B98130', borderRadius: '9999px', padding: '1px 8px' }}>
                        {clientsCount} клиентов
                      </span>
                    )}
                    {memberVolume > 0 && (
                      <span style={{ fontSize: '12px', color: '#60A5FA80', border: '1px solid #3B82F630', borderRadius: '9999px', padding: '1px 8px' }}>
                        {memberVolume} м³
                      </span>
                    )}
                  </div>
                </div>

                {phone && (
                  <a
                    href={`tel:${phone}`}
                    onClick={e => e.stopPropagation()}
                    style={volumeCardSoftStyle({
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 40, height: 40, borderRadius: 11,
                      border: '1px solid #10B98135',
                      color: '#10B981',
                      flexShrink: 0, textDecoration: 'none',
                      transition: 'background 0.15s',
                      padding: 0,
                    })}
                  >
                    <Phone size={16} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ДЕТАЛЬНАЯ КАРТОЧКА КЛИЕНТА */}
      {selectedProfile && (
        <MobileClientDetailModal
          profile={selectedProfile}
          currentRole={currentRole || 'manager'}
          currentUserName={currentUserName || 'Сотрудник'}
          onClose={() => setSelectedProfile(null)}
        />
      )}
    </div>
  );
}

// ==================== КОМПОНЕНТЫ ====================

function TabBtn({ active, onClick, icon, label, count }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  const color = '#3B82F6';
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '10px 16px',
        background: active ? `${color}18` : (hover ? '#33415560' : 'transparent'),
        border: `1px solid ${active ? `${color}60` : (hover ? '#33415560' : '#33415530')}`,
        borderRadius: '12px',
        color: active ? '#93C5FD' : '#64748B',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span style={{
          fontSize: '11px',
          background: active ? `${color}25` : '#334155',
          border: `1px solid ${active ? `${color}40` : '#33415540'}`,
          color: active ? '#93C5FD' : '#475569',
          borderRadius: '9999px',
          padding: '0 7px',
          lineHeight: '18px',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <Users size={40} style={{ color: '#334155', marginBottom: '12px' }} />
      <div style={{ color: '#475569', fontSize: '15px' }}>{text}</div>
    </div>
  );
}
