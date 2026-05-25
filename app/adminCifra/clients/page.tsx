'use client';

import { useState, useEffect } from 'react';
import NewOrderModal from './NewOrderModal';

export default function ClientsPage() {

  // ==================== 1. ОСНОВНЫЕ СОСТОЯНИЯ ====================
  const [profiles, setProfiles] = useState<any[]>([]);
  const [userOrders, setUserOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'clients' | 'staff'>('clients');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [clientVolumes, setClientVolumes] = useState<Record<number | string, number>>({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [clientsToMerge, setClientsToMerge] = useState<any[]>([]);

      // ==================== 2. ЗАГРУЗКА ВСЕХ ПОЛЬЗОВАТЕЛЕЙ + ИХ ОБЪЁМОВ ====================
  useEffect(() => {
    const fetchUsersAndVolumes = async () => {
      setLoading(true);
      try {
        // 1. Загружаем всех клиентов
        const resUsers = await fetch('/api/adminCifra/clients');
        if (resUsers.ok) {
          const data: any[] = await resUsers.json();
          setProfiles(data);

          // 2. Собираем все client_id (с явной типизацией)
          const clientIds = data
            .filter((p: any) => p.role === 'client')           // ← исправлено
            .map((p: any) => p.user_id || p.id)               // ← исправлено
            .filter((id: any) => id != null);                 // убираем null/undefined

          if (clientIds.length > 0) {
            // 3. Загружаем объёмы для всех клиентов сразу
            const resVolumes = await fetch('/api/adminCifra/client-volumes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userIds: clientIds })
            });

            if (resVolumes.ok) {
              const volumesData: Record<number | string, number> = await resVolumes.json();
              setClientVolumes(volumesData);
              console.log('📊 Предзагружены объёмы для всех клиентов:', volumesData);
            }
          }
        }
      } catch (err) {
        console.error('Ошибка загрузки клиентов и объёмов:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchUsersAndVolumes();
  }, []);

      // ==================== 3. ЗАГРУЗКА ЗАКАЗОВ ВЫБРАННОГО ПОЛЬЗОВАТЕЛЯ ====================
  const loadUserOrders = async (userId: number | string | undefined) => {
    if (!userId) {
      console.warn('⚠️ loadUserOrders: userId отсутствует');
      return;
    }

    console.log(`🔄 [loadUserOrders] Запрос заказов для userId: ${userId} (тип: ${typeof userId})`);

    setOrdersLoading(true);
    try {
      const url = `/api/adminCifra/client-orders?userId=${userId}`;
      console.log(`📡 [loadUserOrders] Запрос по URL: ${url}`);

      const res = await fetch(url);
      
      console.log(`📨 [loadUserOrders] Ответ сервера: статус ${res.status} ${res.ok ? 'OK' : 'ERROR'}`);

      if (res.ok) {
        const data = await res.json();
        console.log(`📦 [loadUserOrders] Получено ${data.length} заказов`, data);

        setUserOrders(Array.isArray(data) ? data : []);

        // Обновление кэша для карточек
        const totalVol = data.reduce((sum: number, o: any) => {
          return sum + (Number(o?.volume) || 0);
        }, 0);

        console.log(`💰 [loadUserOrders] Итого объём: ${totalVol} м³ для клиента ${userId}`);

        setClientVolumes(prev => ({ ...prev, [userId]: totalVol }));
      } else {
        const errorText = await res.text();
        console.error('❌ Ошибка загрузки заказов. Статус:', res.status, 'Ответ:', errorText);
        setUserOrders([]);
      }
    } catch (err) {
      console.error('💥 Критическая ошибка при загрузке заказов:', err);
      setUserOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

    // ==================== РЕДАКТИРОВАНИЕ И УДАЛЕНИЕ КЛИЕНТА ====================

  const openEditModal = (client: any) => {
    setEditingClient({ ...client });
    setIsEditModalOpen(true);
  };

  const updateClient = async () => {
    if (!editingClient) return;

    try {
      const res = await fetch('/api/adminCifra/clients/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingClient),
      });

      if (res.ok) {
        alert('Клиент успешно обновлён');
        setIsEditModalOpen(false);
        setEditingClient(null);
        // Перезагружаем список клиентов
        window.location.reload();
      } else {
        alert('Ошибка при обновлении клиента');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    }
  };

  const deleteClient = async (clientId: number | string) => {
    if (!confirm('Вы уверены, что хотите удалить клиента? Все его заказы останутся в базе.')) return;

    try {
      const res = await fetch(`/api/adminCifra/clients/delete?userId=${clientId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        alert('Клиент удалён');
        setSelectedProfile(null);
        // Перезагружаем список
        window.location.reload();
      } else {
        alert('Не удалось удалить клиента');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    }
  };

    // ==================== 3.1 ФУНКЦИИ УПРАВЛЕНИЯ КЛИЕНТАМИ (ОБЪЕДИНЕНИЕ ДУБЛЕЙ) ====================

  const findDuplicates = async () => {
    try {
      const res = await fetch('/api/adminCifra/clients/duplicates');
      if (res.ok) {
        const data = await res.json();
        setClientsToMerge(data);
        setShowMergeModal(true);
      } else {
        alert('Не удалось получить список дублей');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка поиска дублей');
    }
  };

  const mergeClients = async (sourceId: number | string, targetId: number | string) => {
    if (!confirm(`Объединить клиента ${sourceId} с клиентом ${targetId}?`)) return;

    try {
      const res = await fetch('/api/adminCifra/clients/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sourceUserId: sourceId, 
          targetUserId: targetId 
        }),
      });

      if (res.ok) {
        alert('Клиенты успешно объединены');
        setShowMergeModal(false);
        // Перезагружаем данные
        window.location.reload();
      } else {
        alert('Ошибка при объединении клиентов');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    }
  };

  // ==================== 4. ФИЛЬТРАЦИЯ КЛИЕНТОВ И СОТРУДНИКОВ ====================
  // Фильтрация
  const clients = profiles.filter(p => p.role === 'client');
  const staff = profiles.filter(p => ['admin', 'manager', 'dispatcher', 'operator'].includes(p.role || ''));

  const currentList = activeTab === 'clients' ? clients : staff;
  const filteredList = currentList.filter(p => {
    const name = (p.name || p.full_name || p.organization_name || p.username || '').toLowerCase();
    return name.includes(search.toLowerCase()) || (p.phone && p.phone.includes(search));
  });

    // ==================== 5. АВТОМАТИЧЕСКАЯ ЗАГРУЗКА ЗАКАЗОВ ====================
  useEffect(() => {
    if (selectedProfile) {
      const uid = selectedProfile.user_id || selectedProfile.id || selectedProfile.userId;
      console.log(`👤 [useEffect] Выбран клиент:`, selectedProfile);
      console.log(`🔑 [useEffect] Извлечён userId: ${uid} (user_id=${selectedProfile.user_id}, id=${selectedProfile.id})`);
      
      if (uid) {
        loadUserOrders(uid);
      } else {
        console.warn('⚠️ Не удалось извлечь userId из selectedProfile');
      }
    }
  }, [selectedProfile]);

  // ==================== 6. РАСЧЁТ СТАТИСТИКИ (ИСПРАВЛЕНО И УЛУЧШЕНО) ====================
  // Статистика
  const totalVolume = userOrders.reduce((sum: number, o: any) => {
    return sum + (Number(o?.volume) || 0);   // Основное поле volume из таблицы orders
  }, 0);

  const totalAmount = userOrders.reduce((sum: number, o: any) => {
    return sum + (Number(o?.total_price) || 0);
  }, 0);

  const avgCheck = userOrders.length ? Math.round(totalAmount / userOrders.length) : 0;
  const cancelled = userOrders.filter(o => 
    String(o?.status || '').toLowerCase().includes('cancel')
  ).length;
  const refusalRate = userOrders.length ? Math.round((cancelled / userOrders.length) * 100) : 0;
  const lastOrderDate = userOrders.length 
    ? new Date(userOrders[0].delivery_date || userOrders[0].created_at).toLocaleDateString('ru-RU') 
    : '—';

  if (loading) return <div style={{ padding: '120px', textAlign: 'center', color: '#94A3B8' }}>Загрузка CRM...</div>;

  return (
    <div style={{ background: '#0F172A', minHeight: '100vh', color: '#fff', padding: '32px 40px' }}>
      <h1 style={{ fontSize: '34px', fontWeight: '700', marginBottom: '32px' }}>👥 CRM</h1>

      {/* ====================== ВЕРХНЯЯ ПАНЕЛЬ УПРАВЛЕНИЯ ====================== */}
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>

  {/* Левая группа — Табы + Кнопка объединения */}
  <div style={{ display: 'flex', gap: '8px' }}>

    {/* Кнопка Клиенты */}
    <button 
      onClick={() => setActiveTab('clients')} 
      style={{
        padding: '12px 24px',
        background: 'transparent',
        border: 'none',
        color: activeTab === 'clients' ? '#10B981' : '#64748B',
        fontSize: '17px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        position: 'relative',
        transition: 'color 0.25s ease',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: '22px', opacity: activeTab === 'clients' ? 0.9 : 0.45 }}>👥</span>
      Клиенты
      {activeTab === 'clients' && (
        <div style={{
          position: 'absolute',
          bottom: '3px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '5px',
          height: '5px',
          backgroundColor: '#10B981',
          borderRadius: '50%',
          boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.25)'
        }} />
      )}
    </button>

    {/* Кнопка Стафф */}
    <button 
      onClick={() => setActiveTab('staff')} 
      style={{
        padding: '12px 24px',
        background: 'transparent',
        border: 'none',
        color: activeTab === 'staff' ? '#10B981' : '#64748B',
        fontSize: '17px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        position: 'relative',
        transition: 'color 0.25s ease',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: '22px', opacity: activeTab === 'staff' ? 0.9 : 0.45 }}>👔</span>
      Стафф
      {activeTab === 'staff' && (
        <div style={{
          position: 'absolute',
          bottom: '3px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '5px',
          height: '5px',
          backgroundColor: '#10B981',
          borderRadius: '50%',
          boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.25)'
        }} />
      )}
    </button>

    {/* Кнопка Объединить дубли */}
    <button 
      onClick={findDuplicates}
      style={{
        padding: '12px 24px',
        background: 'transparent',
        border: 'none',
        color: '#8B5CF6',
        fontSize: '17px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        position: 'relative',
        transition: 'color 0.25s ease',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: '22px', opacity: 0.9 }}>🔗</span>
      Объединить дубли
    </button>

  </div>

  {/* Правая группа — Вид отображения (Карточки / Список) */}
  <div style={{ display: 'flex', gap: '8px' }}>
    <button 
      onClick={() => setViewMode('cards')} 
      style={{
        padding: '12px 24px',
        background: 'transparent',
        border: 'none',
        color: viewMode === 'cards' ? '#10B981' : '#64748B',
        fontSize: '17px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        position: 'relative',
        transition: 'color 0.25s ease',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: '22px', opacity: viewMode === 'cards' ? 0.9 : 0.45 }}>🃏</span>
      Карточки
      {viewMode === 'cards' && (
        <div style={{
          position: 'absolute',
          bottom: '3px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '5px',
          height: '5px',
          backgroundColor: '#10B981',
          borderRadius: '50%',
          boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.25)'
        }} />
      )}
    </button>

    <button 
      onClick={() => setViewMode('table')} 
      style={{
        padding: '12px 24px',
        background: 'transparent',
        border: 'none',
        color: viewMode === 'table' ? '#10B981' : '#64748B',
        fontSize: '17px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        position: 'relative',
        transition: 'color 0.25s ease',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: '24px', opacity: viewMode === 'table' ? 0.9 : 0.45, lineHeight: 1 }}>📋</span>
      Список
      {viewMode === 'table' && (
        <div style={{
          position: 'absolute',
          bottom: '3px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '5px',
          height: '5px',
          backgroundColor: '#10B981',
          borderRadius: '50%',
          boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.25)'
        }} />
      )}
    </button>
  </div>
</div>

                  {/* ==================== ПОЛЕ ПОИСКА С ИКОНКОЙ ==================== */}
      <div style={{ position: 'relative', width: '100%', maxWidth: '720px', marginBottom: '32px' }}>
        <div style={{ 
          position: 'absolute', 
          left: '20px', 
          top: '50%', 
          transform: 'translateY(-50%)',
          color: '#94A3B8',
          fontSize: '20px',
          pointerEvents: 'none'
        }}>
          🔍
        </div>
        
        <input 
          type="text" 
          placeholder="Поиск по имени, организации или телефону..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ 
            width: '100%', 
            padding: '16px 20px 16px 56px', 
            background: '#1E2937', 
            border: 'none', 
            borderRadius: '9999px', 
            color: '#fff', 
            fontSize: '16px',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.15)'
          }}
        />
      </div>

            {/* ==================== 8. ОТОБРАЖЕНИЕ КЛИЕНТОВ (КАРТОЧКИ) ==================== */}
      {viewMode === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '24px' }}>
          {filteredList.map((p) => {
            const clientId = p.user_id || p.id;
            const totalVol = clientVolumes[clientId] || 0;
            
            return (
              <div 
                key={`item-${clientId}`} 
                onClick={() => setSelectedProfile(p)} 
                style={{ background: '#1E2937', borderRadius: '20px', padding: '24px', cursor: 'pointer' }}
              >
                <div style={{ fontSize: '20px', fontWeight: '700' }}>
                  {p.name || p.full_name || p.organization_name || p.username || 'Без Имени'}
                </div>
                <div style={{ color: '#94A3B8' }}>{p.phone || '—'}</div>
                
                {/* ←←← НОВЫЙ БЛОК: Объём заказанного бетона */}
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#60A5FA', fontWeight: '600', fontSize: '18px' }}>
                    {totalVol} м³
                  </span>
                  <span style={{ color: '#94A3B8', fontSize: '14px' }}>заказано всего</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Таблица */}
      {viewMode === 'table' && (
        <div style={{ background: '#1E2937', borderRadius: '20px', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 140px 140px', padding: '18px 28px', background: '#25334A', fontWeight: '600', color: '#94A3B8' }}>
            <div>Клиент</div>
            <div>Телефон</div>
            <div>Баланс</div>
            <div>Дата регистрации</div>
          </div>
          {filteredList.map((p) => (
            <div 
              key={`row-${p.user_id || p.id}`} 
              onClick={() => setSelectedProfile(p)} 
              style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 140px 140px', padding: '20px 28px', borderTop: '1px solid #334155', cursor: 'pointer' }}
            >
              <div><strong>{p.name || p.full_name || p.organization_name || p.username || 'Без Имени'}</strong></div>
              <div>{p.phone || '—'}</div>
              <div style={{ color: (p.balance || 0) >= 0 ? '#10B981' : '#EF4444', fontWeight: '600' }}>
                {(p.balance || 0).toLocaleString()} ₽
              </div>
              <div style={{ color: '#94A3B8' }}>
                {p.created_at ? new Date(p.created_at).toLocaleDateString('ru-RU') : '—'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Боковая панель профиля */}
      {selectedProfile && (
        <div style={{ position: 'fixed', top: 0, right: 0, width: '620px', height: '100vh', background: '#1E2937', borderLeft: '1px solid #334155', zIndex: 1000, overflow: 'auto' }}>
          <div style={{ padding: '32px' }}>
            <button 
              onClick={() => setSelectedProfile(null)} 
              style={{ float: 'right', fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8' }}
            >
              ×
            </button>

            <h2>{selectedProfile.name || selectedProfile.full_name || selectedProfile.organization_name || selectedProfile.username || 'Без Имени'}</h2>
            <p style={{ color: '#94A3B8', fontSize: '18px' }}>{selectedProfile.phone}</p>

            <div style={{ display: 'flex', gap: '12px', margin: '28px 0', flexWrap: 'wrap' }}>
  <button onClick={() => window.open(`tel:${selectedProfile.phone}`, '_self')} style={{ flex: 1, padding: '14px', background: '#10B981', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}>
    📞 Позвонить
  </button>
  <button onClick={() => alert('Открывается чат с Max')} style={{ flex: 1, padding: '14px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}>
    💬 Написать в Max
  </button>
  <button onClick={() => setIsNewOrderModalOpen(true)} style={{ flex: 1, padding: '14px', background: '#F59E0B', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}>
    ➕ Новый заказ
  </button>

  {/* Новые кнопки */}
  <button 
    onClick={() => openEditModal(selectedProfile)} 
    style={{ flex: 1, padding: '14px', background: '#8B5CF6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
  >
    ✏️ Редактировать
  </button>
  <button 
    onClick={() => deleteClient(selectedProfile.user_id || selectedProfile.id)} 
    style={{ flex: 1, padding: '14px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
  >
    🗑 Удалить
  </button>
</div>

            {/* Статистика */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '24px' }}>
              <div style={{ background: '#25334A', padding: '16px', borderRadius: '12px' }}>
                <div style={{ color: '#94A3B8', fontSize: '14px' }}>Всего м³</div>
                <div style={{ fontSize: '32px', fontWeight: '700' }}>{totalVolume}</div>
              </div>
              <div style={{ background: '#25334A', padding: '16px', borderRadius: '12px' }}>
                <div style={{ color: '#94A3B8', fontSize: '14px' }}>Средний чек</div>
                <div style={{ fontSize: '32px', fontWeight: '700', color: '#60A5FA' }}>{avgCheck.toLocaleString()} ₽</div>
              </div>
              <div style={{ background: '#25334A', padding: '16px', borderRadius: '12px' }}>
                <div style={{ color: '#94A3B8', fontSize: '14px' }}>Отказов</div>
                <div style={{ fontSize: '32px', fontWeight: '700', color: '#EF4444' }}>{refusalRate}%</div>
              </div>
              <div style={{ background: '#25334A', padding: '16px', borderRadius: '12px' }}>
                <div style={{ color: '#94A3B8', fontSize: '14px' }}>Последний заказ</div>
                <div style={{ fontSize: '18px', fontWeight: '700' }}>{lastOrderDate}</div>
              </div>
            </div>

            <h3>📦 История заказов ({userOrders.length})</h3>

            {ordersLoading ? (
              <div>Загрузка заказов...</div>
            ) : userOrders.length > 0 ? (
              userOrders.map((o: any) => (
                <div key={o.id} style={{ background: '#25334A', padding: '18px', borderRadius: '16px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>Заказ #{o.id}</strong>
                    <span>{new Date(o.delivery_date).toLocaleDateString('ru-RU')}</span>
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    {o.volume} м³ • {o.grade || '—'} • <span style={{ color: o.status === 'completed' ? '#10B981' : o.status === 'cancelled' ? '#EF4444' : '#FACC15' }}>{o.status}</span>
                  </div>
                  {o.address && <div style={{ marginTop: '8px', color: '#94A3B8' }}>📍 {o.address}</div>}
                  {o.total_price && <div style={{ marginTop: '10px', fontSize: '18px', fontWeight: '700', color: '#60A5FA' }}>{o.total_price.toLocaleString()} ₽</div>}
                </div>
              ))
            ) : (
              <div style={{ color: '#94A3B8', textAlign: 'center', padding: '80px 0' }}>Заказов пока нет</div>
            )}
          </div>
        </div>
      )}

      {/* ==================== МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ КЛИЕНТА ==================== */}
      {isEditModalOpen && editingClient && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1200,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#1E2937', width: '520px', borderRadius: '20px', padding: '32px', color: '#fff'
          }}>
            <h2 style={{ marginBottom: '20px' }}>Редактировать клиента</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input 
                placeholder="ФИО" 
                value={editingClient.full_name || ''} 
                onChange={(e) => setEditingClient({...editingClient, full_name: e.target.value})}
                style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
              />
              <input 
                placeholder="Название организации" 
                value={editingClient.organization_name || ''} 
                onChange={(e) => setEditingClient({...editingClient, organization_name: e.target.value})}
                style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
              />
              <input 
                placeholder="Телефон" 
                value={editingClient.phone || ''} 
                onChange={(e) => setEditingClient({...editingClient, phone: e.target.value})}
                style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
              />
              <input 
                placeholder="ИНН" 
                value={editingClient.inn || ''} 
                onChange={(e) => setEditingClient({...editingClient, inn: e.target.value})}
                style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button onClick={() => { setIsEditModalOpen(false); setEditingClient(null); }} 
                style={{ flex: 1, padding: '16px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}>
                Отмена
              </button>
              <button onClick={updateClient} 
                style={{ flex: 1, padding: '16px', background: '#3B82F6', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: '600' }}>
                Сохранить изменения
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== МОДАЛЬНОЕ ОКНО НОВОГО ЗАКАЗА ==================== */}
      <NewOrderModal
        isOpen={isNewOrderModalOpen}
        onClose={() => setIsNewOrderModalOpen(false)}
        userId={selectedProfile?.user_id || selectedProfile?.id}
        userName={selectedProfile?.full_name || selectedProfile?.name || selectedProfile?.username || 'Клиент'}
        userPhone={selectedProfile?.phone || ''}
        onOrderCreated={() => {
          if (selectedProfile) {
            const uid = selectedProfile.user_id || selectedProfile.id;
            loadUserOrders(uid);
          }
        }}
      />
    </div>
  );
}