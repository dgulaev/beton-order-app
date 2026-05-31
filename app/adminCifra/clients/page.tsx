'use client';

import { useState, useEffect } from 'react';
import NewOrderModal from './NewOrderModal';

// ==================== 0.1 ГЛОБАЛЬНЫЕ ТИПЫ ДЛЯ WINDOW ===============
declare global {
  interface Window {
    callClient: (clientId: number | string) => void;
  }
}

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
  const [callHistory, setCallHistory] = useState<any[]>([]);
  
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
      console.log('🔄 [Загрузка] Начинаем загрузку данных...');

      // 1. Загружаем группы клиентов
      const clientGroupsRes = await fetch('/api/adminCifra/clients/grouped');
      let clientGroups: any[] = [];
      if (clientGroupsRes.ok) {
        clientGroups = await clientGroupsRes.json();
      }

      // 2. Загружаем всех пользователей (включая стафф)
      const allRes = await fetch('/api/adminCifra/clients?all=true');
      let allUsers: any[] = [];
      if (allRes.ok) {
        allUsers = await allRes.json();
      }

      // 3. Отделяем стафф
      const staffList = allUsers.filter((u: any) => 
        ['admin', 'manager', 'dispatcher', 'operator'].includes((u.role || '').toLowerCase())
      );

      console.log(`👔 Загружено сотрудников: ${staffList.length}`);
      console.log(`👥 Загружено групп клиентов: ${clientGroups.length}`);

      // 4. Объединяем стафф + группы клиентов
      const combined = [
        ...staffList.map((s: any) => ({ ...s, isStaff: true })),
        ...clientGroups
      ];

      setProfiles(combined);
      console.log(`✅ Итого в profiles: ${combined.length} записей`);
    } catch (err) {
      console.error('❌ Ошибка загрузки пользователей:', err);
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

      // ==================== 3.0 ЗАГРУЗКА ЗАКАЗОВ И ЗВОНКОВ ДЛЯ ГРУППЫ ====================
const loadGroupOrders = async (group: any) => {
  if (!group?.clients || group.clients.length === 0) {
    setUserOrders([]);
    setCallHistory([]);
    return;
  }

  setOrdersLoading(true);
  try {
    const allOrders: any[] = [];
    const allCalls: any[] = [];

    for (const client of group.clients) {
      const userId = client.user_id || client.id;
      if (!userId) continue;

      // Заказы
      const resOrders = await fetch(`/api/adminCifra/client-orders?userId=${userId}`);
      if (resOrders.ok) {
        const orders = await resOrders.json();
        allOrders.push(...orders);
      }

      // Звонки
      const resCalls = await fetch(`/api/adminCifra/client-calls?clientId=${userId}`);
      if (resCalls.ok) {
        const calls = await resCalls.json();
        allCalls.push(...calls);
      }
    }

    setUserOrders(allOrders);
    setCallHistory(allCalls.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ));

    console.log(`📦 Загружено ${allOrders.length} заказов и ${allCalls.length} звонков для группы`);
  } catch (err) {
    console.error('Ошибка загрузки данных группы:', err);
    setUserOrders([]);
    setCallHistory([]);
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

  // ==================== 3.3 ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ И СОХРАНЕНИЕ next_contact ====================
const refreshClientData = async () => {
  if (!selectedProfile) {
    alert('Сначала выберите клиента');
    return;
  }

  const uid = selectedProfile.user_id || selectedProfile.id || selectedProfile.clients?.[0]?.user_id;
  if (!uid) {
    alert('Не удалось определить ID клиента');
    return;
  }

  try {
    // Пересчёт next_contact
    let newNextContact = null;

    if (userOrders && userOrders.length >= 2) {
      const dates = userOrders
        .map((o: any) => new Date(o.delivery_date || o.created_at))
        .filter(d => d && !isNaN(d.getTime()))
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());

      if (dates.length >= 2) {
        let totalDays = 0;
        for (let i = 1; i < dates.length; i++) {
          totalDays += (dates[i].getTime() - dates[i-1].getTime()) / (1000 * 3600 * 24);
        }
        const avgInterval = totalDays / (dates.length - 1);
        const daysToAdd = Math.max(14, Math.ceil(avgInterval * 1.25));
        const lastOrder = dates[dates.length - 1];
        const nextDate = new Date(lastOrder.getTime() + daysToAdd * 86400000);
        newNextContact = nextDate.toISOString();
      }
    }

    if (!newNextContact) {
      const defaultNext = new Date();
      defaultNext.setDate(defaultNext.getDate() + 30);
      newNextContact = defaultNext.toISOString();
    }

    // Сохраняем в базу
    await fetch('/api/adminCifra/clients/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        next_contact: newNextContact
      })
    });

    alert(`✅ Дата обновлена: ${new Date(newNextContact).toLocaleDateString('ru-RU')}`);

    // Полная перезагрузка страницы — самое надёжное решение для групп
    window.location.reload();

  } catch (err: any) {
    console.error(err);
    alert('Ошибка сохранения');
  }
};

      // ==================== 3.4 ТЕСТОВОЕ УВЕДОМЛЕНИЕ ====================
const testClientReminder = () => {
  if (!selectedProfile) {
    alert('Сначала выберите клиента');
    return;
  }

  console.log('🧪 Тест уведомления для клиента:', selectedProfile.organization_name);

  const testReminder = {
    ...selectedProfile,
    next_contact: new Date().toISOString(),
    isOverdue: true
  };

  showClientReminder(testReminder, true);   // ← важно: true = тест
};

     // ==================== 4. ФИЛЬТРАЦИЯ КЛИЕНТОВ И СОТРУДНИКОВ ====================
  
// Клиенты — только сгруппированные карточки (имеют groupId)
const clients = profiles.filter((item: any) => item.groupId);

// Стафф — пользователи с ролью (без groupId)
const staff = profiles.filter((item: any) => 
  !item.groupId && 
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
      (item.phones || []).some((phone: string) => 
        phone.toLowerCase().includes(searchLower)
      )
    );
  } else {
    // Поиск по стаффу
    return (
      (item.name || item.full_name || item.organization_name || item.username || '').toLowerCase().includes(searchLower) ||
      (item.phone || '').toLowerCase().includes(searchLower)
    );
  }
});

  // ==================== 4.2 УВЕДОМЛЕНИЕ ПО КЛИЕНТУ ====================
const showClientReminder = (client: any, isTest = false) => {
  const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
  const key = `client-reminder-${client.groupId || client.user_id}`;

  if (!isTest && closed.includes(key)) {
    console.log('Автоматическое уведомление уже было закрыто');
    return;
  }

  const notif = document.createElement('div');

  Object.assign(notif.style, {
    position: 'fixed',
    top: '90px',
    right: '24px',
    background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
    color: '#0f172a',
    padding: '20px 24px',
    borderRadius: '16px',
    zIndex: '10000',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    gap: '18px',
    minWidth: '480px',
    cursor: 'pointer'
  });

  notif.innerHTML = `
    <div style="font-size: 42px; line-height: 1;">📞</div>
    <div style="flex: 1;">
      <div style="font-size: 18px; font-weight: 700; margin-bottom: 4px;">
        Пора позвонить клиенту!
      </div>
      <div style="font-size: 15.5px; font-weight: 600;">
        ${client.organization_name || client.full_name || 'Клиент'}
      </div>
      <div style="font-size: 14px; opacity: 0.95; margin-top: 2px;">
        Следующий контакт: ${new Date(client.next_contact).toLocaleDateString('ru-RU')}
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <button onclick="window.callClient(${client.user_id || client.clients?.[0]?.user_id || 'null'})" 
        style="padding: 12px 22px; background: #10B981; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; white-space: nowrap;">
        📞 Позвонить
      </button>
      <div style="font-size: 26px; cursor: pointer; padding: 4px 8px; opacity: 0.7;" class="close-reminder">✕</div>
    </div>
  `;

  const closeBtn = notif.querySelector('.close-reminder') as HTMLElement;

  const closeNotification = () => {
    notif.remove();
    if (!isTest) {
      const closedList = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
      if (!closedList.includes(key)) {
        closedList.push(key);
        localStorage.setItem('closedNotifications', JSON.stringify(closedList));
      }
    }
  };

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeNotification();
    });
  }

  notif.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('button')) {
      window.location.href = '/adminCifra/clients';
      closeNotification();
    }
  });

  document.body.appendChild(notif);

  try {
    const audio = new Audio('/sounds/new-order.mp3');
    audio.volume = 0.7;
    audio.play().catch(() => {});
  } catch (e) {}

  console.log(`🔔 Уведомление показано (${isTest ? 'ТЕСТ' : 'автоматическое'})`);
};

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

  // ==================== 7. ГЛОБАЛЬНАЯ ФУНКЦИЯ ЗВОНКА ====================
window.callClient = async (clientId: number | string) => {
  if (!clientId) {
    alert('❌ Не удалось определить ID клиента');
    return;
  }

  const phone = prompt("📞 Введите номер для звонка:", "+7");
  if (!phone) return;

  window.open(`tel:${phone}`, '_self');

  // Ждём 800мс и спрашиваем результат
  setTimeout(async () => {
    const resultInput = prompt(
      "✅ Результат звонка:\n\n" +
      "1 — Положительный (клиент заказал)\n" +
      "2 — Нейтральный (скоро закажет)\n" +
      "3 — Отрицательный (не нужен)\n\n" +
      "Введите 1, 2 или 3:",
      "1"
    );

    if (!resultInput) return;

    let result = 'neutral';
    let comment = '';

    if (resultInput === '1') { result = 'positive'; comment = 'Клиент заказал бетон'; }
    else if (resultInput === '2') { result = 'neutral'; comment = 'Клиент сказал, что скоро закажет'; }
    else if (resultInput === '3') { result = 'negative'; comment = 'Клиент отказался'; }

    try {
      const res = await fetch('/api/adminCifra/client-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, result, comment })
      });

      if (res.ok) {
        alert('✅ Результат звонка сохранён');
      } else {
        alert('⚠️ Не удалось сохранить результат');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    }
  }, 800);
};

  return (
    <div style={{ background: '#0F172A', minHeight: '100vh', color: '#fff', padding: '32px 40px' }}>
      <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '32px' }}>Клиенты CRM</h1>

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
  {/* Кнопка Эффективность отдела продаж */}
    <button 
      onClick={() => window.location.href = '/adminCifra/efficiency'}
      style={{
        padding: '12px 24px',
        background: 'transparent',
        border: 'none',
        color: '#A78BFA',
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
      <span style={{ fontSize: '22px' }}>📏</span>
      Эффективность
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
      <span style={{ fontSize: '22px', opacity: viewMode === 'cards' ? 0.9 : 0.45 }}>▦</span>
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
      <span style={{ fontSize: '24px', opacity: viewMode === 'table' ? 0.9 : 0.45, lineHeight: 1 }}>≡</span>
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
  <div style={{ background: '#1E2937', borderRadius: '16px', overflow: 'hidden' }}>
    
    {/* ==================== ШАПКА ТАБЛИЦЫ ==================== */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 140px 140px 120px',
      padding: '18px 28px',
      background: '#25334A',
      borderBottom: '2px solid #334155',
      fontSize: '15px',
      fontWeight: '600',
      color: '#94A3B8',
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    }}>
      <div>Клиент / Организация</div>
      <div>ИНН</div>
      <div>Статус</div>
      <div>Объём бетона</div>
      <div>Заказы</div>
    </div>

    {/* ==================== СТРОКИ ТАБЛИЦЫ ==================== */}
    {filteredList.map((client: any) => {
      const vol = client.total_volume || client.totalVolume || 0;
      const ordersCount = client.total_orders || client.totalOrders || 0;

      let statusText = '❄️ Холодный';
      let statusColor = '#64748B';

      if (vol >= 30 || ordersCount >= 5) {
        statusText = '🔥 Горячий';
        statusColor = '#EF4444';
      } else if (vol >= 8 || ordersCount >= 2) {
        statusText = '🌡️ Тёплый';
        statusColor = '#F59E0B';
      }

      return (
        <div
          key={client.groupId || client.user_id || client.id}
          onClick={() => setSelectedProfile(client)}
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 140px 140px 120px',
            padding: '12px 12px',           // ← увеличил вертикальные отступы
            borderBottom: '1px solid #334155',
            cursor: 'pointer',
            alignItems: 'center',
            transition: 'background 0.2s',
            minHeight: '10px'               // ← ВЫСОТА СТРОКИ (здесь регулируй)
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#25334A'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <div>
            <div style={{ fontWeight: '600', fontSize: '17px' }}>
              {client.organization_name || client.full_name || 'Без названия'}
            </div>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>
              {client.phones ? client.phones.join(' • ') : client.phone || '—'}
            </div>
          </div>

          <div style={{ color: '#94A3B8' }}>{client.inn || '—'}</div>

          <div style={{ color: statusColor, fontWeight: '600' }}>
            {statusText}
          </div>

          <div style={{ fontSize: '18px', fontWeight: '700', color: '#60A5FA' }}>
            {vol.toFixed(1)} м³
          </div>

          <div style={{ color: '#94A3B8', fontWeight: '500' }}>
            {ordersCount} шт.
          </div>
        </div>
      );
    })}
  </div>
)}

            {/* ==================== 8. ОТОБРАЖЕНИЕ КЛИЕНТОВ (КАРТОЧКИ) — КОМПАКТНЫЙ ==================== */}
{viewMode === 'cards' && (
  <div style={{ 
    display: 'grid', 
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
    gap: '16px'        // расстояние между карточками
  }}>
    {filteredList.map((client: any) => {
      const vol = client.total_volume || client.totalVolume || 0;
      const ordersCount = client.total_orders || client.totalOrders || 0;

      let statusText = '❄️ Холодный';
      let statusColor = '#64748B';
      let statusBg = '#334155';

      if (vol >= 30 || ordersCount >= 5) {
        statusText = '🔥 Горячий';
        statusColor = '#EF4444';
        statusBg = '#EF444420';
      } else if (vol >= 8 || ordersCount >= 2) {
        statusText = '🌡️ Тёплый';
        statusColor = '#F59E0B';
        statusBg = '#F59E0B20';
      }

      return (
        <div 
          key={client.groupId || client.user_id || client.id} 
          onClick={() => setSelectedProfile(client)} 
          style={{ 
            background: '#1E2937', 
            borderRadius: '16px', 
            padding: '16px 18px',     // ← уменьшил отступы внутри
            cursor: 'pointer',
            border: selectedProfile?.groupId === client.groupId || 
                    selectedProfile?.user_id === client.user_id 
              ? '2px solid #10B981' 
              : '1px solid #334155',
            transition: 'all 0.2s',
            minHeight: '148px',        // ← ОСНОВНАЯ ВЫСОТА КАРТОЧКИ (здесь регулируй)
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}
        >
          {/* Заголовок и телефон */}
          <div>
            <div style={{ fontSize: '17px', fontWeight: '700', marginBottom: '4px', lineHeight: 1.3 }}>
              {client.organization_name || client.full_name || client.name || 'Без названия'}
            </div>
            
            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '10px' }}>
              {client.phones ? client.phones.join(' • ') : client.phone || '—'}
            </div>
          </div>

          {/* Статус */}
          <div style={{ 
            display: 'inline-block',
            padding: '4px 12px',
            background: statusBg,
            color: statusColor,
            borderRadius: '9999px',
            fontSize: '13.5px',
            fontWeight: '600',
            marginBottom: '12px'
          }}>
            {statusText}
          </div>

          {/* Объём и Заказы */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ color: '#60A5FA', fontSize: '26px', fontWeight: '700', lineHeight: 1 }}>
                {vol.toFixed(1)}
              </div>
              <div style={{ color: '#94A3B8', fontSize: '13px' }}>м³ заказано</div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#94A3B8' }}>
                {ordersCount}
              </div>
              <div style={{ color: '#94A3B8', fontSize: '13px' }}>заказов</div>
            </div>
          </div>
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
    width: '720px', 
    height: '95vh',
    minHeight: '1400px',
    background: '#1E2937', 
    borderLeft: '1px solid #334155', 
    zIndex: 1000, 

    overflow: 'auto' 
  }}>
    <div style={{ padding: '32px' }}>

      {/* 9.1 Кнопка закрытия */}
      <button 
        onClick={() => setSelectedProfile(null)} 
        style={{ float: 'right', fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8' }}
      >
        ×
      </button>

      {/* 9.2 Заголовок и телефоны */}
      <h2 style={{ marginBottom: '8px' }}>
        {selectedProfile.organization_name || selectedProfile.full_name || 'Без названия'}
      </h2>

      {selectedProfile.phones && selectedProfile.phones.length > 0 && (
        <p style={{ color: '#94A3B8', fontSize: '18px', marginTop: '4px' }}>
          📞 {selectedProfile.phones.filter(Boolean).join(' • ')}
        </p>
      )}

      {/* 9.3 Действия (кнопки) — ВСЕ КНОПКИ СОХРАНЕНЫ */}
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

      {/* 9.4 Статус и Лояльность (с расчётом для групп) */}
<div style={{ display: 'flex', gap: '16px', margin: '20px 0', alignItems: 'center' }}>
  <div style={{ 
    padding: '8px 20px', 
    borderRadius: '9999px', 
    fontSize: '16px',
    fontWeight: '600',
    background: (() => {
      const vol = selectedProfile.total_volume || selectedProfile.totalVolume || 0;
      const orders = selectedProfile.total_orders || userOrders.length || 0;
      
      if (vol >= 30 || orders >= 5) return '#EF444420';
      if (vol >= 8 || orders >= 2) return '#F59E0B20';
      return '#64748B20';
    })(),
    color: (() => {
      const vol = selectedProfile.total_volume || selectedProfile.totalVolume || 0;
      const orders = selectedProfile.total_orders || userOrders.length || 0;
      
      if (vol >= 30 || orders >= 5) return '#EF4444';      // Горячий
      if (vol >= 8 || orders >= 2) return '#F59E0B';      // Тёплый
      return '#94A3B8';                                   // Холодный
    })()
  }}>
    {(() => {
      const vol = selectedProfile.total_volume || selectedProfile.totalVolume || 0;
      const orders = selectedProfile.total_orders || userOrders.length || 0;
      
      if (vol >= 30 || orders >= 5) return '🔥 Горячий';
      if (vol >= 8 || orders >= 2) return '🌡️ Тёплый';
      return '❄️ Холодный';
    })()}
  </div>

  {/* Полоса лояльности */}
  <div style={{ flex: 1, background: '#25334A', borderRadius: '9999px', height: '10px' }}>
    <div style={{ 
      width: `${Math.min(100, (selectedProfile.total_volume || selectedProfile.totalVolume || 0) / 5)}%`, 
      height: '100%', 
      background: '#10B981', 
      borderRadius: '9999px' 
    }} />
  </div>
  <div style={{ fontSize: '16px', fontWeight: '600', minWidth: '60px' }}>
    {(selectedProfile.total_volume || selectedProfile.totalVolume || 0).toFixed(0)} м³
  </div>
</div>

{/* 9.5 Контакты и Прогноз (умный расчёт next_contact для групп) */}
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
  
  {/* Последний контакт */}
  <div style={{ background: '#25334A', padding: '16px', borderRadius: '14px' }}>
    <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>
      Последний контакт
    </div>
    <div style={{ fontSize: '19px', fontWeight: '600' }}>
      {selectedProfile.last_contact 
        ? new Date(selectedProfile.last_contact).toLocaleDateString('ru-RU', { 
            day: 'numeric', month: 'long', year: 'numeric' 
          })
        : (userOrders.length > 0 
            ? new Date(Math.max(...userOrders.map((o: any) => 
                new Date(o.delivery_date || o.created_at).getTime()
              ))).toLocaleDateString('ru-RU', { 
                day: 'numeric', month: 'long', year: 'numeric' 
              })
            : '—')}
    </div>
  </div>

  {/* Следующий контакт — умный расчёт */}
  <div style={{ background: '#25334A', padding: '16px', borderRadius: '14px' }}>
    <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>
      Следующий контакт
    </div>
    <div style={{ fontSize: '19px', fontWeight: '600', color: '#F59E0B' }}>
      {(() => {
        // 1. Если есть сохранённый next_contact
        if (selectedProfile.next_contact) {
          return new Date(selectedProfile.next_contact).toLocaleDateString('ru-RU', { 
            day: 'numeric', month: 'long', year: 'numeric' 
          });
        }

        // 2. Если есть predicted_next_order
        if (selectedProfile.predicted_next_order) {
          return new Date(selectedProfile.predicted_next_order).toLocaleDateString('ru-RU', { 
            day: 'numeric', month: 'long', year: 'numeric' 
          });
        }

        // 3. Умный расчёт по истории заказов (для групп)
        if (userOrders && userOrders.length >= 2) {
          const dates = userOrders
            .map((o: any) => new Date(o.delivery_date || o.created_at))
            .filter(d => d && !isNaN(d.getTime()))
            .sort((a: Date, b: Date) => a.getTime() - b.getTime());

          if (dates.length >= 2) {
            let totalDays = 0;
            for (let i = 1; i < dates.length; i++) {
              totalDays += (dates[i].getTime() - dates[i-1].getTime()) / (1000 * 3600 * 24);
            }
            const avgInterval = totalDays / (dates.length - 1);
            const lastOrder = dates[dates.length - 1];
            const nextDate = new Date(lastOrder.getTime() + avgInterval * 1.25 * 86400000); // +25% буфер
            
            return nextDate.toLocaleDateString('ru-RU', { 
              day: 'numeric', month: 'long', year: 'numeric' 
            });
          }
        }

        return 'Недостаточно данных';
      })()}
    </div>

    {/* Компактные кнопки в стиле Цифра */}
    <div style={{ marginTop: '14px', display: 'flex', gap: '8px' }}>
      <button 
        onClick={() => refreshClientData()}
        style={{
          padding: '6px 12px',
          background: '#475569',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          cursor: 'pointer',
          flex: 1
        }}
      >
        🔄 Обновить
      </button>

      <button 
        onClick={() => testClientReminder()}
        style={{
          padding: '6px 12px',
          background: '#10B981',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          cursor: 'pointer',
          flex: 1
        }}
      >
        🧪 Тест
      </button>
    </div>
  </div>
</div>

      {/* ==================== 9.5.1 ПРОГНОЗ СЛЕДУЮЩЕГО ЗАКАЗА + ОБЪЁМ ==================== */}
<div style={{ 
  background: '#25334A', 
  padding: '20px', 
  borderRadius: '16px', 
  marginBottom: '24px',
  border: '2px solid #F59E0B'
}}>
  <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '12px' }}>
    📅 Прогноз следующего заказа
  </div>

  {selectedProfile.predicted_next_order || (selectedProfile.groupId && userOrders.length >= 2) ? (
    <div>
      {/* Дата */}
      <div style={{ fontSize: '24px', fontWeight: '700', color: '#F59E0B', marginBottom: '8px' }}>
        {(() => {
          let nextDate;
          if (selectedProfile.predicted_next_order) {
            nextDate = new Date(selectedProfile.predicted_next_order);
          } else {
            const dates = userOrders
              .map((o: any) => new Date(o.delivery_date || o.created_at))
              .filter(d => d && !isNaN(d.getTime()))
              .sort((a, b) => a.getTime() - b.getTime());
            
            if (dates.length >= 2) {
              let totalDays = 0;
              for (let i = 1; i < dates.length; i++) {
                totalDays += (dates[i].getTime() - dates[i-1].getTime()) / (1000 * 3600 * 24);
              }
              const avgInterval = totalDays / (dates.length - 1);
              const lastOrder = dates[dates.length - 1];
              nextDate = new Date(lastOrder.getTime() + avgInterval * 1.2 * 86400000);
            }
          }
          return nextDate 
            ? nextDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
            : '—';
        })()}
      </div>

      {/* Прогнозируемый объём */}
      <div style={{ marginTop: '12px' }}>
        <span style={{ color: '#94A3B8', fontSize: '15px' }}>Примерный объём: </span>
        <span style={{ fontSize: '22px', fontWeight: '700', color: '#60A5FA' }}>
          {(() => {
            const volumes = userOrders
              .map((o: any) => Number(o.volume || 0))
              .filter(v => v > 0);
            
            if (volumes.length === 0) return '—';
            
            const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
            return avgVolume.toFixed(1) + ' м³';
          })()}
        </span>
      </div>
    </div>
  ) : (
    <div style={{ color: '#94A3B8' }}>
      Недостаточно заказов для прогноза (минимум 2)
    </div>
  )}
</div>

{/* ==================== 9.6.1 ИСТОРИЯ ВЗАИМОДЕЙСТВИЯ ==================== */}
<h3 style={{ margin: '32px 0 16px 0' }}>📋 История взаимодействия</h3>

{/* === Заказы === */}
<div style={{ marginBottom: '28px' }}>
  <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '12px', fontWeight: '600' }}>
    📦 Заказы ({userOrders.length})
  </div>

  {ordersLoading ? (
    <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>Загрузка заказов...</div>
  ) : userOrders.length > 0 ? (
    userOrders.map((o: any) => (
      <div key={o.id} style={{ background: '#25334A', padding: '18px', borderRadius: '16px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <strong>Заказ #{o.id}</strong>
          <span>{new Date(o.delivery_date).toLocaleDateString('ru-RU')}</span>
        </div>
        <div style={{ marginTop: '8px' }}>
          {o.volume} м³ • {o.grade || '—'} • <span style={{ color: o.status === 'completed' ? '#10B981' : o.status === 'cancelled' ? '#EF4444' : '#FACC15' }}>{o.status}</span>
        </div>
        {o.address && <div style={{ marginTop: '8px', color: '#94A3B8' }}>📍 {o.address}</div>}
        {o.total_price && <div style={{ marginTop: '10px', fontSize: '18px', fontWeight: '700', color: '#60A5FA' }}>{Number(o.total_price).toLocaleString('ru-RU')} ₽</div>}
      </div>
    ))
  ) : (
    <div style={{ color: '#94A3B8', textAlign: 'center', padding: '40px 0' }}>Заказов пока нет</div>
  )}
</div>

{/* === Звонки === */}
<div>
  <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '12px', fontWeight: '600' }}>
    📞 Звонки ({callHistory.length})
  </div>

  {callHistory.length > 0 ? (
    callHistory.map((call: any, index: number) => (
      <div 
        key={index} 
        style={{ 
          padding: '14px', 
          background: '#1E2937', 
          borderRadius: '12px', 
          marginBottom: '12px' 
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ 
            fontWeight: '600',
            color: call.result === 'positive' ? '#10B981' : 
                   call.result === 'negative' ? '#EF4444' : '#F59E0B'
          }}>
            {call.result === 'positive' ? '✅ Положительный' : 
             call.result === 'negative' ? '❌ Отрицательный' : '⚪ Нейтральный'}
          </span>
          <span style={{ color: '#94A3B8', fontSize: '14px' }}>
            {new Date(call.created_at).toLocaleDateString('ru-RU', { 
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
            })}
          </span>
        </div>
        {call.comment && (
          <div style={{ fontSize: '15px', color: '#CBD5E1' }}>
            {call.comment}
          </div>
        )}
      </div>
    ))
  ) : (
    <div style={{ textAlign: 'center', padding: '50px 0', color: '#64748B' }}>
      Звонков пока нет
    </div>
  )}
          </div>
        </div>
      </div>
    )}


      {/* ==================== 9.7 МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ==================== */}
{isEditModalOpen && editingClient && Array.isArray(editingClient) && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1300,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }}>
    <div style={{
      background: '#1E2937', width: '720px', borderRadius: '20px', padding: '32px', color: '#fff', maxHeight: '90vh', overflow: 'auto'
    }}>
      <h2 style={{ marginBottom: '8px' }}>
        Редактирование {editingClient.length > 1 ? 'группы клиентов' : 'клиента'}
      </h2>

      {editingClient.map((client: any, index: number) => (
        <div key={client.user_id || index} style={{ 
          background: '#25334A', 
          padding: '24px', 
          borderRadius: '16px', 
          marginBottom: '20px' 
        }}>
          <h4 style={{ marginBottom: '20px' }}>Клиент #{index + 1}</h4>

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
                  if (value.length === 10 || value.length === 12) fetchByInn(value, index);
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }}
              />
            </div>

            {/* Название и ФИО */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Название организации</label>
              <input value={client.organization_name || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].organization_name = e.target.value; setEditingClient(newClients);
              }} style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>ФИО</label>
              <input value={client.full_name || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].full_name = e.target.value; setEditingClient(newClients);
              }} style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            {/* Телефон и Адрес */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Телефон</label>
              <input value={client.phone || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].phone = e.target.value; setEditingClient(newClients);
              }} style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Адрес</label>
              <input value={client.address || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].address = e.target.value; setEditingClient(newClients);
              }} style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            {/* Новые поля из презентации Цифра */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Статус клиента</label>
              <select 
                value={client.client_status || 'cold'} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].client_status = e.target.value;
                  setEditingClient(newClients);
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }}
              >
                <option value="cold">❄️ Холодный</option>
                <option value="warm">🔥 Тёплый</option>
                <option value="hot">🔥 Горячий</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Последний контакт</label>
              <input type="date" value={client.last_contact ? client.last_contact.split('T')[0] : ''} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].last_contact = e.target.value ? e.target.value + 'T00:00:00Z' : null;
                  setEditingClient(newClients);
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Следующий контакт</label>
              <input type="date" value={client.next_contact ? client.next_contact.split('T')[0] : ''} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].next_contact = e.target.value ? e.target.value + 'T00:00:00Z' : null;
                  setEditingClient(newClients);
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Коэффициент лояльности (0-100)</label>
              <input type="number" min="0" max="100" value={client.loyalty_score || 50} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].loyalty_score = parseInt(e.target.value) || 50;
                  setEditingClient(newClients);
                }}
                style={{ width: '100%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
        <button onClick={() => { setIsEditModalOpen(false); setEditingClient(null); }} style={{ flex: 1, padding: '16px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}>
          Отмена
        </button>
        <button onClick={updateGroupClients} style={{ flex: 1, padding: '16px', background: '#10B981', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: '600' }}>
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