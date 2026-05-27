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
  const [dadataSuggestions, setDadataSuggestions] = useState<any[]>([]);
  const [isLoadingDadata, setIsLoadingDadata] = useState(false);
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
    const [currentRole, setCurrentRole] = useState<string>('admin');
  
  // Новое состояние для формы создания клиента
  const [newClientForm, setNewClientForm] = useState({
    type: 'legal' as 'legal' | 'physical',
    full_name: '',
    organization_name: '',
    phone: '',
    inn: '',
    address: '',
  });
  

                // ==================== 2. ЗАГРУЗКА ВСЕХ ПОЛЬЗОВАТЕЛЕЙ + ГРУППИРОВКА КЛИЕНТОВ ====================
  useEffect(() => {
    const fetchAllUsers = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/adminCifra/clients');
        
        if (res.ok) {
          const allUsers = await res.json();
          
          const staffList = allUsers.filter((u: any) => 
            ['admin', 'manager', 'dispatcher', 'operator'].includes((u.role || '').toLowerCase())
          );

          const clientGroupsRes = await fetch('/api/adminCifra/clients/grouped');
          let clientGroups = [];
          
          if (clientGroupsRes.ok) {
            clientGroups = await clientGroupsRes.json();
          }

          const combined = [...staffList, ...clientGroups];
          setProfiles(combined);
          
          console.log(`✅ Загружено: ${clientGroups.length} групп + ${staffList.length} стаффа`);
        }
      } catch (err) {
        console.error('Ошибка загрузки пользователей:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllUsers();
  }, []);

    // ==================== ЗАГРУЗКА РОЛИ ====================
  useEffect(() => {
    const loadRole = async () => {
      const savedRole = localStorage.getItem('userRole');
      if (savedRole) {
        setCurrentRole(savedRole.toLowerCase());
        return;
      }

      try {
        const res = await fetch('/api/user/role', { 
          method: 'POST',
          cache: 'no-store'
        });

        if (res.ok) {
          const data = await res.json();
          const role = (data.role || 'admin').toLowerCase();
          setCurrentRole(role);
          localStorage.setItem('userRole', role);
        }
      } catch (err) {
        console.error('Ошибка загрузки роли:', err);
      }
    };

    loadRole();
  }, []);

        // ==================== 3. ЗАГРУЗКА ЗАКАЗОВ ВЫБРАННОГО ПОЛЬЗОВАТЕЛЯ ====================
  const loadUserOrders = async (userId: number | string | undefined) => {
    if (!userId) {
      setUserOrders([]);
      return;
    }

    setOrdersLoading(true);
    try {
      const res = await fetch(`/api/adminCifra/client-orders?userId=${userId}`);
      if (res.ok) {
        const orders = await res.json();
        setUserOrders(orders);
        console.log(`📦 Загружено ${orders.length} заказов для клиента ${userId}`);
      } else {
        setUserOrders([]);
      }
    } catch (err) {
      console.error('Ошибка загрузки заказов:', err);
      setUserOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

      // ==================== 3.0 ЗАГРУЗКА ЗАКАЗОВ ДЛЯ ГРУППЫ КЛИЕНТОВ ====================
  const loadGroupOrders = async (group: any) => {
    if (!group?.clients || group.clients.length === 0) {
      setUserOrders([]);
      return;
    }

    setOrdersLoading(true);
    try {
      const allOrders: any[] = [];

      for (const client of group.clients) {
        const userId = client.user_id || client.id;
        if (!userId) continue;

        const res = await fetch(`/api/adminCifra/client-orders?userId=${userId}`);
        if (res.ok) {
          const orders = await res.json();
          allOrders.push(...orders);
        }
      }

      setUserOrders(allOrders);
      console.log(`📦 Загружено ${allOrders.length} заказов для группы`);
    } catch (err) {
      console.error('Ошибка загрузки заказов группы:', err);
      setUserOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

          // ==================== 3.0.1 ОТКРЫТИЕ РЕДАКТИРОВАНИЯ ====================
  const openEditModal = async (item: any) => {
    let clientsToEdit: any[] = [];

    try {
      if (item.groupId && item.clients && item.clients.length > 0) {
        // Группа — загружаем свежие данные для каждого клиента
        for (const c of item.clients) {
          const userId = c.user_id || c.id;
          if (!userId) continue;

          const res = await fetch(`/api/adminCifra/clients?userId=${userId}`);
          if (res.ok) {
            const freshClient = await res.json();
            clientsToEdit.push({
              ...freshClient,
              address: freshClient.address || c.address || ''
            });
          } else {
            clientsToEdit.push({ ...c, address: c.address || '' });
          }
        }
        console.log(`✏️ Загружена группа (${clientsToEdit.length} клиентов)`);
      } else {
        // Одиночный клиент
        const userId = item.user_id || item.id;
        if (userId) {
          const res = await fetch(`/api/adminCifra/clients?userId=${userId}`);
          if (res.ok) {
            const fresh = await res.json();
            clientsToEdit = [{ ...fresh, address: fresh.address || item.address || '' }];
          } else {
            clientsToEdit = [{ ...item, address: item.address || '' }];
          }
        } else {
          clientsToEdit = [{ ...item, address: item.address || '' }];
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки свежих данных:', err);
      // Fallback
      if (item.groupId && item.clients) {
        clientsToEdit = item.clients.map((c: any) => ({ ...c, address: c.address || '' }));
      } else {
        clientsToEdit = [{ ...item, address: item.address || '' }];
      }
    }

    setEditingClient(clientsToEdit);
    setIsEditModalOpen(true);
    setDadataSuggestions([]);
    console.log('📋 editingClient установлен:', clientsToEdit);
  };

       // ==================== 3.0.2 СОХРАНЕНИЕ ИЗМЕНЕНИЙ ГРУППЫ ====================
  const updateGroupClients = async () => {
    if (!editingClient || !Array.isArray(editingClient)) {
      alert('Нет данных для сохранения');
      return;
    }

    try {
      console.log('🚀 Начинаем сохранение группы. Количество клиентов:', editingClient.length);

      for (const [index, client] of editingClient.entries()) {
        const payload = {
          userId: client.user_id || client.id,
          full_name: client.full_name || null,
          organization_name: client.organization_name || null,
          phone: client.phone || null,
          inn: client.inn || null,
          address: client.address || null,
        };

        console.log(`📤 [${index + 1}/${editingClient.length}] Отправка для userId=${payload.userId}`, payload);

        const res = await fetch('/api/adminCifra/clients/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          console.log(`✅ Успешно обновлён клиент ${payload.userId}`);
        } else {
          const err = await res.json().catch(() => ({}));
          console.error(`❌ Ошибка при обновлении ${payload.userId}:`, err);
        }
      }

      alert('✅ Все изменения успешно сохранены (включая адреса)');
      setIsEditModalOpen(false);
      setEditingClient(null);
      window.location.reload();
    } catch (err) {
      console.error('❌ Критическая ошибка сохранения:', err);
      alert('Ошибка при сохранении изменений');
    }
  };

    // ==================== 3.0.3 УДАЛЕНИЕ КЛИЕНТА ====================
  const deleteClient = async (clientId: number | string) => {
    if (!confirm('Вы уверены, что хотите удалить этого клиента?')) return;

    try {
      const res = await fetch(`/api/adminCifra/clients/delete?userId=${clientId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        alert('✅ Клиент успешно удалён');
        setSelectedProfile(null);
        window.location.reload();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Не удалось удалить: ${err.error || 'Неизвестная ошибка'}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения с сервером');
    }
  };

    // ==================== 3.0.4 СОЗДАНИЕ НОВОГО КЛИЕНТА ====================
  const createNewClient = async () => {
    if (!newClientForm.phone) {
      alert('Укажите телефон клиента');
      return;
    }

    try {
      const payload = {
        role: 'client',
        phone: newClientForm.phone,
        full_name: newClientForm.type === 'physical' ? newClientForm.full_name : null,
        organization_name: newClientForm.type === 'legal' ? newClientForm.organization_name : null,
        inn: newClientForm.inn || null,
        address: newClientForm.address || null,
        balance: 0,
        referral_code: 'R' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      };

      const res = await fetch('/api/adminCifra/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        alert('✅ Новый клиент успешно создан!');
        setIsNewClientModalOpen(false);
        setNewClientForm({
          type: 'legal',
          full_name: '',
          organization_name: '',
          phone: '',
          inn: '',
          address: '',
        });
        window.location.reload(); // обновляем список
      } else {
        const err = await res.json();
        alert(`Ошибка: ${err.error || 'Не удалось создать клиента'}`);
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения с сервером');
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

            // ==================== 3.2 АВТОЗАПОЛНЕНИЕ ПО ИНН (DaData) ====================
  const fetchByInn = async (inn: string, clientIndex?: number) => {
    if (!inn || inn.length < 10) {
      setDadataSuggestions([]);
      return;
    }

    setIsLoadingDadata(true);
    console.log(`🔍 Запрос DaData по ИНН: ${inn}, index: ${clientIndex}`);

    try {
      const res = await fetch('/api/dadata/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: inn }),
      });

      if (res.ok) {
        const data = await res.json();
        const suggestions = data.suggestions || [];

        setDadataSuggestions(suggestions);
        console.log('✅ DaData вернул:', suggestions.length, 'подсказок');

        if (suggestions.length > 0) {
          const s = suggestions[0];

          if (clientIndex !== undefined && editingClient && Array.isArray(editingClient)) {
            // === РЕЖИМ ГРУППЫ ===
            const newClients = [...editingClient];
            newClients[clientIndex] = {
              ...newClients[clientIndex],
              inn: s.data.inn || inn,
              organization_name: s.value || s.data.name?.short_with_opf || s.data.name?.full_with_opf || '',
              full_name: s.data.name?.full || '',
              address: s.data.address?.value || '',
            };
            setEditingClient(newClients);
            console.log(`✅ Автозаполнение для клиента #${clientIndex}`);
          } 
        }
      } else {
        console.warn('⚠️ DaData вернул ошибку');
        setDadataSuggestions([]);
      }
    } catch (err) {
      console.error('❌ Ошибка DaData:', err);
      setDadataSuggestions([]);
    } finally {
      setIsLoadingDadata(false);
    }
  };

      // ==================== 4. ФИЛЬТРАЦИЯ КЛИЕНТОВ И СОТРУДНИКОВ ====================
  
  // Клиенты — показываем только сгруппированные карточки
  const clients = profiles.filter((item: any) => item.groupId);

  // Стафф — НЕ применяем группировку, показываем как есть
  const staff = profiles.filter((item: any) => 
    ['admin', 'manager', 'dispatcher', 'operator'].includes((item.role || '').toLowerCase())
  );

  const currentList = activeTab === 'clients' ? clients : staff;

  // Фильтрация по поиску
  const filteredList = currentList.filter((item: any) => {
    if (!search || search.trim() === '') return true;

    const searchLower = search.toLowerCase().trim();

    if (activeTab === 'clients' && item.groupId) {
      // Поиск по группе клиентов
      return (
        (item.organization_name || '').toLowerCase().includes(searchLower) ||
        (item.full_name || '').toLowerCase().includes(searchLower) ||
        (item.inn || '').toLowerCase().includes(searchLower) ||
        item.phones?.some((phone: string) => phone.toLowerCase().includes(searchLower))
      );
    } else {
      // Поиск по стаффу (без группировки)
      return (
        (item.name || item.full_name || item.organization_name || item.username || '').toLowerCase().includes(searchLower) ||
        (item.phone || '').toLowerCase().includes(searchLower)
      );
    }
  });

          // ==================== 5. ЗАГРУЗКА ЗАКАЗОВ ПРИ ВЫБОРЕ КЛИЕНТА ====================
  useEffect(() => {
    if (selectedProfile) {
      console.log('🔍 Выбран профиль:', selectedProfile);
      console.log('🔑 Есть groupId?', !!selectedProfile.groupId);
      console.log('📊 totalVolume в профиле:', selectedProfile.totalVolume);

      if (selectedProfile.groupId) {
        // Это группа клиентов
        loadGroupOrders(selectedProfile);
      } else {
        // Это одиночный клиент
        const uid = selectedProfile.user_id || selectedProfile.id;
        if (uid) {
          loadUserOrders(uid);
        } else {
          console.warn('⚠️ Не удалось извлечь userId');
          setUserOrders([]);
        }
      }
    } else {
      setUserOrders([]);
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
    {/* Кнопка Новый клиент */}
<button 
  onClick={() => setIsNewClientModalOpen(true)}
  style={{
    padding: '12px 24px',
    background: 'transparent',
    border: 'none',
    color: '#34D399',
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
  <span style={{ fontSize: '22px' }}>➕</span>
  Новый клиент
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

         {/* ==================== 10. ОТОБРАЖЕНИЕ КЛИЕНТОВ (СПИСОК) ==================== */}
{viewMode === 'table' && (
  <div style={{ background: '#1E2937', borderRadius: '20px', overflow: 'hidden' }}>
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: '2fr 1fr 140px 140px 100px', 
      padding: '16px 28px', 
      background: '#25334A',
      fontWeight: '600',
      color: '#94A3B8',
      fontSize: '14px',
      borderBottom: '1px solid #334155'
    }}>
      <div>Клиент / Организация</div>
      <div>ИНН</div>
      <div>Телефоны</div>
      <div>Общий объём</div>
      <div>Заказов</div>
    </div>

    {filteredList.map((client: any) => {
      const totalVol = client.totalVolume || 0;
      
      // Надёжный уникальный ключ
      const uniqueKey = client.groupId || client.user_id || client.id || `row-${Math.random().toString(36).slice(2)}`;

      return (
        <div 
          key={uniqueKey} 
          onClick={() => setSelectedProfile(client)} 
          style={{ 
            display: 'grid', 
            gridTemplateColumns: '2fr 1fr 140px 140px 100px', 
            padding: '20px 28px', 
            borderBottom: '1px solid #334155',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#25334A'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{ fontWeight: '600' }}>
            {client.organization_name || client.full_name || 'Без названия'}
            {client.clients && client.clients.length > 1 && (
              <span style={{ color: '#8B5CF6', fontSize: '13px', marginLeft: '8px' }}>
                ({client.clients.length})
              </span>
            )}
          </div>

          <div style={{ color: '#94A3B8' }}>
            {client.inn || '—'}
          </div>

          <div style={{ color: '#94A3B8', fontSize: '14px' }}>
            {client.phones && client.phones.length > 0 
              ? client.phones.filter(Boolean).join(', ') 
              : '—'}
          </div>

          <div style={{ fontWeight: '700', color: '#60A5FA' }}>
            {totalVol.toFixed(1)} м³
          </div>

          <div style={{ color: '#94A3B8' }}>
            {client.totalOrders || 0}
          </div>
        </div>
      );
    })}
  </div>
)}

            {/* ==================== 8. ОТОБРАЖЕНИЕ КЛИЕНТОВ (КАРТОЧКИ) ==================== */}
{viewMode === 'cards' && (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '24px' }}>
    {filteredList.map((client: any) => {
      const totalVol = client.totalVolume || 0;

      return (
        <div 
          key={client.groupId || client.user_id || Math.random()}   // ← исправленный key
          onClick={() => setSelectedProfile(client)} 
          style={{ 
            background: '#1E2937', 
            borderRadius: '20px', 
            padding: '24px', 
            cursor: 'pointer',
            border: selectedProfile?.groupId === client.groupId ? '2px solid #10B981' : '1px solid #334155',
            transition: 'all 0.2s'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: '700', marginBottom: '6px' }}>
                {client.organization_name || client.full_name || 'Без названия'}
              </div>
              {client.inn && (
                <div style={{ color: '#94A3B8', fontSize: '14px' }}>
                  ИНН: {client.inn}
                </div>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#60A5FA' }}>
                {totalVol.toFixed(1)} м³
              </div>
              <div style={{ color: '#94A3B8', fontSize: '14px' }}>
                {client.totalOrders || 0} заказов
              </div>
            </div>
          </div>

          {client.phones && client.phones.length > 0 && (
            <div style={{ 
              marginTop: '16px', 
              padding: '10px 14px', 
              background: '#25334A', 
              borderRadius: '12px',
              fontSize: '14px',
              color: '#94A3B8'
            }}>
              📞 {client.phones.filter(Boolean).join(' • ')}
            </div>
          )}

          {client.clients && client.clients.length > 1 && (
            <div style={{
              marginTop: '12px',
              display: 'inline-block',
              padding: '4px 12px',
              background: '#334155',
              borderRadius: '9999px',
              fontSize: '13px',
              color: '#CBD5E1'
            }}>
              {client.clients.length} карточки
            </div>
          )}
        </div>
      );
    })}
  </div>
)}

     {/* ==================== 9. БОКОВАЯ ПАНЕЛЬ ПРОФИЛЯ КЛИЕНТА ==================== */}
{selectedProfile && (
  <div style={{ 
    position: 'fixed', 
    top: 0, 
    right: 0, 
    width: '620px', 
    height: '100vh', 
    background: '#1E2937', 
    borderLeft: '1px solid #334155', 
    zIndex: 1000, 
    overflow: 'auto' 
  }}>
    <div style={{ padding: '32px' }}>
      <button 
        onClick={() => setSelectedProfile(null)} 
        style={{ float: 'right', fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8' }}
      >
        ×
      </button>

      <h2>
        {selectedProfile.organization_name || selectedProfile.full_name || 'Без названия'}
      </h2>

      {/* Все телефоны группы */}
      {selectedProfile.phones && selectedProfile.phones.length > 0 && (
        <p style={{ color: '#94A3B8', fontSize: '18px', marginTop: '4px' }}>
          📞 {selectedProfile.phones.filter(Boolean).join(' • ')}
        </p>
      )}

      <div style={{ display: 'flex', gap: '12px', margin: '28px 0', flexWrap: 'wrap' }}>
        <button 
          onClick={() => window.open(`tel:${selectedProfile.phone || selectedProfile.phones?.[0]}`, '_self')} 
          style={{ flex: 1, padding: '14px', background: '#10B981', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
        >
          📞 Позвонить
        </button>
        <button 
          onClick={() => alert('Открывается чат с Max')} 
          style={{ flex: 1, padding: '14px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
        >
          💬 Написать в Max
        </button>
        <button 
          onClick={() => setIsNewOrderModalOpen(true)} 
          style={{ flex: 1, padding: '14px', background: '#F59E0B', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
        >
          ➕ Новый заказ
        </button>

        <button 
          onClick={() => openEditModal(selectedProfile)} 
          style={{ flex: 1, padding: '14px', background: '#8B5CF6', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
        >
          ✏️ Редактировать
        </button>
        <button 
          onClick={() => deleteClient(selectedProfile.user_id || selectedProfile.id || selectedProfile.clients?.[0]?.user_id)} 
          style={{ flex: 1, padding: '14px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
        >
          🗑 Удалить
        </button>
      </div>

      {/* Статистика группы */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <div style={{ background: '#25334A', padding: '16px', borderRadius: '12px' }}>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Всего м³</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>
            {selectedProfile.totalVolume ? selectedProfile.totalVolume.toFixed(1) : '0'}
          </div>
        </div>
        <div style={{ background: '#25334A', padding: '16px', borderRadius: '12px' }}>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Заказов</div>
          <div style={{ fontSize: '32px', fontWeight: '700', color: '#60A5FA' }}>
            {selectedProfile.totalOrders || 0}
          </div>
        </div>
      </div>

      <h3>📦 История заказов ({userOrders.length})</h3>

      {/* ==================== СПИСОК ЗАКАЗОВ ==================== */}
      {ordersLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748B' }}>Загрузка заказов...</div>
      ) : userOrders.length > 0 ? (
        userOrders
          .sort((a, b) => new Date(b.created_at || b.delivery_date).getTime() - new Date(a.created_at || a.delivery_date).getTime())
          .map((o: any) => (
            <div 
              key={o.id} 
              style={{ 
                background: '#25334A', 
                padding: '18px', 
                borderRadius: '16px', 
                marginBottom: '16px' 
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Заказ #{o.id}</strong>
                <span>{new Date(o.delivery_date).toLocaleDateString('ru-RU')}</span>
              </div>

              <div style={{ marginTop: '8px' }}>
                {o.volume} м³ • {o.grade || '—'} • 
                <span style={{ color: o.status === 'completed' ? '#10B981' : o.status === 'cancelled' ? '#EF4444' : '#FACC15' }}>
                  {o.status}
                </span>
              </div>

              {/* Телефон заказа */}
              {o.phone && (
                <div style={{ 
                  marginTop: '10px', 
                  padding: '8px 12px', 
                  background: '#1E2937', 
                  borderRadius: '10px',
                  fontSize: '14px',
                  color: '#94A3B8'
                }}>
                  📞 {o.phone}
                </div>
              )}

              {o.address && <div style={{ marginTop: '8px', color: '#94A3B8' }}>📍 {o.address}</div>}

              {o.total_price && (
                <div style={{ 
                  marginTop: '12px', 
                  fontSize: '18px', 
                  fontWeight: '700', 
                  color: '#60A5FA' 
                }}>
                  {Number(o.total_price).toLocaleString('ru-RU')} ₽
                </div>
              )}
            </div>
          ))
      ) : (
        <div style={{ color: '#94A3B8', textAlign: 'center', padding: '80px 0' }}>
          Заказов пока нет
        </div>
      )}
    </div>
  </div>
)}

      {/* ==================== 9.1 МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ==================== */}
{isEditModalOpen && editingClient && Array.isArray(editingClient) && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1300,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }}>
    <div style={{
      background: '#1E2937', width: '680px', borderRadius: '20px', padding: '32px', color: '#fff', maxHeight: '90vh', overflow: 'auto'
    }}>
      <h2 style={{ marginBottom: '8px' }}>
        Редактирование {editingClient.length > 1 ? 'группы клиентов' : 'клиента'}
      </h2>
      <p style={{ color: '#94A3B8', marginBottom: '24px' }}>
        {editingClient.length} {editingClient.length > 1 ? 'карточки' : 'карточка'}
      </p>

      {editingClient.map((client: any, index: number) => (
        <div key={client.user_id || index} style={{ 
          background: '#25334A', 
          padding: '20px', 
          borderRadius: '16px', 
          marginBottom: '20px' 
        }}>
          <h4 style={{ marginBottom: '16px' }}>Клиент #{index + 1}</h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

            {/* ИНН с автозаполнением */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>ИНН</label>
              <input 
                value={client.inn || ''} 
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 12);
                  const newClients = [...editingClient];
                  newClients[index].inn = value;
                  setEditingClient(newClients);

                  if (value.length === 10 || value.length === 12) {
                    fetchByInn(value, index);   // ← передаём index
                  }
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }}
              />
            </div>

            {/* Название организации */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Название организации</label>
              <input 
                value={client.organization_name || ''} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].organization_name = e.target.value;
                  setEditingClient(newClients);
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }}
              />
            </div>

            {/* ФИО */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>ФИО</label>
              <input 
                value={client.full_name || ''} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].full_name = e.target.value;
                  setEditingClient(newClients);
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }}
              />
            </div>

            {/* Телефон */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Телефон</label>
              <input 
                value={client.phone || ''} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].phone = e.target.value;
                  setEditingClient(newClients);
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }}
              />
            </div>

           {/* Адрес */}
<div>
  <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Адрес</label>
  <input 
    value={client.address || ''} 
    onChange={(e) => {
      const newValue = e.target.value;
      const newClients = [...editingClient];
      newClients[index].address = newValue;
      setEditingClient(newClients);
      
      console.log(`📝 Изменён адрес для клиента #${index}:`, newValue);
    }}
    style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }}
  />
</div>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
        <button 
          onClick={() => { setIsEditModalOpen(false); setEditingClient(null); }}
          style={{ flex: 1, padding: '16px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
        >
          Отмена
        </button>
        <button 
          onClick={updateGroupClients}
          style={{ flex: 1, padding: '16px', background: '#10B981', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: '600' }}
        >
          Сохранить все изменения
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
        currentRole={currentRole}
        onOrderCreated={() => {
          if (selectedProfile) {
            const uid = selectedProfile.user_id || selectedProfile.id;
            loadUserOrders(uid);
          }
        }}
      />

             {/* ==================== МОДАЛЬНОЕ ОКНО ОБЪЕДИНЕНИЯ ДУБЛЕЙ ==================== */}
{showMergeModal && clientsToMerge.length > 0 && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 1400,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }}>
    <div style={{
      background: '#1E2937', width: '740px', borderRadius: '20px', padding: '32px', color: '#fff', maxHeight: '90vh', overflow: 'auto'
    }}>
      <h2 style={{ marginBottom: '8px' }}>Найдены дубли клиентов</h2>
      <p style={{ color: '#94A3B8', marginBottom: '24px' }}>
        Они уже сгруппированы визуально. Вы можете присоединить отдельные карточки к группам.
      </p>

      {clientsToMerge.map((group: any, idx: number) => (
        <div key={idx} style={{ marginBottom: '28px', background: '#25334A', padding: '20px', borderRadius: '16px' }}>
          <h3 style={{ marginBottom: '12px' }}>
            Группа по ИНН: {group.inn}
          </h3>
          <p style={{ color: '#94A3B8', marginBottom: '16px' }}>
            {group.clients.length} клиентов в группе
          </p>

          {group.clients.map((c: any, i: number) => (
            <div key={i} style={{ 
              padding: '14px', 
              background: '#1E2937', 
              borderRadius: '12px', 
              marginBottom: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <strong>{c.organization_name || c.full_name}</strong><br />
                <span style={{ color: '#94A3B8' }}>{c.phone}</span>
              </div>
              <button 
                onClick={() => {
                  // Здесь можно добавить логику присоединения к основной группе
                  alert(`Присоединить ${c.phone} к основной группе?`);
                }}
                style={{
                  padding: '8px 20px',
                  background: '#10B981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                Присоединить к группе
              </button>
            </div>
          ))}
        </div>
      ))}

      <button 
        onClick={() => setShowMergeModal(false)}
        style={{ padding: '14px 32px', background: '#10B981', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
      >
        Закрыть
      </button>
    </div>
  </div>
)}

      {/* ==================== МОДАЛЬНОЕ ОКНО СОЗДАНИЯ НОВОГО КЛИЕНТА ==================== */}
{isNewClientModalOpen && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1300,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }}>
    <div style={{
      background: '#1E2937', width: '540px', borderRadius: '20px', padding: '32px', color: '#fff'
    }}>
      <h2 style={{ marginBottom: '24px' }}>Новый клиент</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

        {/* Тип клиента */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8' }}>Тип клиента</label>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              type="button" 
              onClick={() => setNewClientForm(p => ({...p, type: 'legal'}))}
              style={{ 
                flex: 1, padding: '12px', borderRadius: '12px', 
                background: newClientForm.type === 'legal' ? '#3B82F6' : '#334155', 
                color: 'white' 
              }}
            >
              Юридическое лицо
            </button>
            <button 
              type="button" 
              onClick={() => setNewClientForm(p => ({...p, type: 'physical'}))}
              style={{ 
                flex: 1, padding: '12px', borderRadius: '12px', 
                background: newClientForm.type === 'physical' ? '#3B82F6' : '#334155', 
                color: 'white' 
              }}
            >
              Физическое лицо
            </button>
          </div>
        </div>

        {/* ИНН с автозаполнением */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8' }}>ИНН</label>
          <input 
            placeholder="Введите ИНН" 
            value={newClientForm.inn || ''} 
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '').slice(0, 12);
              setNewClientForm({...newClientForm, inn: value});
              if (value.length === 10 || value.length === 12) {
                fetchByInn(value);   // ← автозаполнение
              } else {
                setDadataSuggestions([]);
              }
            }}
            style={{ 
              padding: '14px', 
              background: '#25334A', 
              border: 'none', 
              borderRadius: '12px', 
              color: '#fff',
              width: '100%'
            }}
          />

          {/* Подсказки DaData */}
          {dadataSuggestions.length > 0 && (
            <div style={{
              marginTop: '8px',
              maxHeight: '220px',
              overflowY: 'auto',
              background: '#25334A',
              borderRadius: '12px',
              border: '1px solid #334155'
            }}>
              {dadataSuggestions.map((suggestion: any, index: number) => (
                <div
                  key={index}
                  onClick={() => {
                    setNewClientForm({
                      ...newClientForm,
                      inn: suggestion.data.inn,
                      organization_name: suggestion.value || suggestion.data.name?.short || '',
                      full_name: suggestion.data.name?.full || '',
                      address: suggestion.data.address?.value || '',
                    });
                    setDadataSuggestions([]);
                  }}
                  style={{
                    padding: '12px 16px',
                    cursor: 'pointer',
                    borderBottom: index < dadataSuggestions.length - 1 ? '1px solid #334155' : 'none',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <div style={{ fontWeight: '600' }}>{suggestion.value}</div>
                  <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                    ИНН: {suggestion.data.inn} • {suggestion.data.address?.value || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Название / ФИО */}
        {newClientForm.type === 'legal' ? (
          <input 
            placeholder="Название организации *" 
            value={newClientForm.organization_name} 
            onChange={(e) => setNewClientForm({...newClientForm, organization_name: e.target.value})}
            style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
          />
        ) : (
          <input 
            placeholder="ФИО полностью *" 
            value={newClientForm.full_name} 
            onChange={(e) => setNewClientForm({...newClientForm, full_name: e.target.value})}
            style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
          />
        )}

        <input 
          placeholder="Телефон *" 
          value={newClientForm.phone} 
          onChange={(e) => setNewClientForm({...newClientForm, phone: e.target.value})}
          style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
        />

        <input 
          placeholder="Адрес" 
          value={newClientForm.address} 
          onChange={(e) => setNewClientForm({...newClientForm, address: e.target.value})}
          style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
        <button 
          onClick={() => setIsNewClientModalOpen(false)} 
          style={{ flex: 1, padding: '16px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
        >
          Отмена
        </button>
        <button 
          onClick={createNewClient} 
          style={{ flex: 1, padding: '16px', background: '#10B981', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: '600' }}
        >
          Создать клиента
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}