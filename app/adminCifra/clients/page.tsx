'use client';

import { useState, useEffect } from 'react';
import EfficiencyPage from '../efficiency/page';
import NewOrderModal from './NewOrderModal';

import { supabase } from '@/lib/supabaseClient';   // ← Правильный импорт
import { useYandexRouteHref } from '@/lib/yandexRoute';

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
  
  const [searchTerm, setSearchTerm] = useState('');        
  const [debouncedSearch, setDebouncedSearch] = useState(''); 
  
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [curators, setCurators] = useState<any[]>([]);
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
  const [userFullName, setUserFullName] = useState<string>('');
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentUserRole, setCurrentUserRole] = useState<string>('manager');
  const [staffProfiles, setStaffProfiles] = useState<any[]>([]);
  const [isStaffEditModalOpen, setIsStaffEditModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any>(null);

  // ==================== DEBOUNCE ДЛЯ ПОИСКА ====================
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      if (searchTerm.trim() !== debouncedSearch) {
        setCurrentPage(1);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [searchTerm]);

    // ==================== ЗАГРУЗКА КУРАТОРОВ ====================
  useEffect(() => {
    const loadCurators = async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('user_id, full_name, role')
          .in('role', ['admin', 'manager', 'dispatcher'])
          .order('full_name');

        setCurators(data || []);
        console.log("Кураторы загружены:", data?.length);
      } catch (error) {
        console.error("Ошибка загрузки кураторов:", error);
      }
    };

    loadCurators();
  }, []);

  // ==================== ПАГИНАЦИЯ ====================
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalClients, setTotalClients] = useState(0);
  const itemsPerPage = 18;

  const [activeTab, setActiveTab] = useState<'clients' | 'staff' | 'efficiency'>('clients');
  
  // Новое состояние для формы создания клиента
  const [newClientForm, setNewClientForm] = useState({
    type: 'legal' as 'legal' | 'physical',
    full_name: '',
    organization_name: '',
    phone: '',
    inn: '',
    address: '',
  });

   // ==================== АВТООПРЕДЕЛЕНИЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ====================
useEffect(() => {
  const savedUserId = localStorage.getItem('userId');
  
  if (savedUserId) {
    setCurrentUserId(savedUserId);
    console.log('✅ Текущий userId:', savedUserId);

    if (savedUserId === '1777619517739') {
      localStorage.setItem('currentUserRole', 'admin');
      setCurrentUserRole('admin');
      console.log('✅ Главный администратор');
    } else {
      const savedRole = localStorage.getItem('currentUserRole');
      if (savedRole) {
        setCurrentUserRole(savedRole);
        console.log('✅ Роль из localStorage:', savedRole);
      } else {
        setCurrentUserRole('manager');
        localStorage.setItem('currentUserRole', 'manager');
        console.log('✅ Установлена роль по умолчанию: manager');
      }
    }
  } else {
    setCurrentUserId('1777619517739');
    setCurrentUserRole('admin');
  }
}, []);

    // ==================== 2. ЗАГРУЗКА КЛИЕНТОВ С ПАГИНАЦИЕЙ ====================
    const fetchClientsPage = async (page: number = 1) => {
    setLoading(true);

    try {
      let url = `/api/adminCifra/clients/grouped?page=${page}&limit=${itemsPerPage}`;
      
      if (debouncedSearch) {
        url += `&search=${encodeURIComponent(debouncedSearch)}`;
      }

      const res = await fetch(url);
      
      if (res.ok) {
        const data = await res.json();
        
        let result = data.clients || data.groups || data;

        if (activeTab === 'staff') {
          const staffRes = await fetch('/api/adminCifra/clients?all=true');
          if (staffRes.ok) {
            const allUsers = await staffRes.json();
            result = allUsers
              .filter((u: any) => ['admin', 'manager', 'dispatcher', 'operator'].includes((u.role || '').toLowerCase()))
              .map((s: any) => ({ ...s, isStaff: true }));
          }
        }

        setProfiles(result);
        setTotalPages(data.totalPages || 1);
        setTotalClients(data.total || 0);
      }
    } catch (err) {
      console.error('❌ Ошибка загрузки клиентов:', err);
    } finally {
      setLoading(false);
    }
  };

  // Первая загрузка и смена страницы + поиск
  useEffect(() => {
    fetchClientsPage(currentPage);
  }, [currentPage, debouncedSearch, activeTab]);

  // ==================== 2.0.1 ЗАГРУЗКА ДАННЫХ ДЛЯ ВКЛАДКИ СТАФФ ====================
useEffect(() => {
  if (activeTab === 'staff') {
    fetch('/api/adminCifra/staff/stats')
      .then(res => res.json())
      .then(data => {
        let staffList = Array.isArray(data) ? data : [];

        // Фильтр + сортировка с Гостем
        staffList = staffList
          .filter((u: any) => 
            ['admin', 'manager', 'dispatcher', 'operator', 'guest'].includes((u.role || '').toLowerCase())
          )
          .sort((a: any, b: any) => {
            const roleOrder: { [key: string]: number } = {
              admin: 1,
              manager: 2,
              dispatcher: 3,
              operator: 4,
              guest: 5
            };
            return (roleOrder[a.role] || 999) - (roleOrder[b.role] || 999) || 
                   (a.full_name || '').localeCompare(b.full_name || '');
          });

        setStaffProfiles(staffList);
        console.log('✅ Стафф загружен:', staffList.length, 'человек');
        console.log('Список имён:', staffList.map((s: any) => s.full_name));
      })
      .catch(err => {
        console.error('Ошибка загрузки стаффа:', err);
        setStaffProfiles([]);
      });
  }
}, [activeTab]);


  // ==================== 2.0.2 ЗАГРУЗКА РОЛИ + РЕАЛЬНОГО ИМЕНИ ====================
  useEffect(() => {
    const loadRoleAndName = async () => {
      const savedUserId = localStorage.getItem('userId');
      if (!savedUserId) {
        setCurrentRole('admin');
        setUserFullName('Сотрудник');
        return;
      }

      try {
        const res = await fetch('/api/user/role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: savedUserId }),
          cache: 'no-store'
        });

        if (res.ok) {
          const data = await res.json();
          const role = (data.role || 'admin').toLowerCase();
          const name = data.full_name || data.username || data.name || 'Сотрудник';

          setCurrentRole(role);
          setUserFullName(name);

          localStorage.setItem('userRole', role);
          localStorage.setItem('userName', name);

          console.log(`✅ Загружено в ClientsPage: ${name} (${role})`);
        } else {
          setCurrentRole('admin');
          setUserFullName('Сотрудник');
        }
      } catch (err) {
        console.error('❌ Ошибка загрузки роли/имени:', err);
        setCurrentRole('admin');
        setUserFullName('Сотрудник');
      }
    };

    loadRoleAndName();
  }, []);


// ==================== 2.0.3 ОБРАБОТКА КЛИКА ПО КАРТОЧКЕ ====================
const handleSelectProfile = async (profile: any) => {
  console.log("🔍 Выбран профиль:", profile);

  let selected = { ...profile };

  if (['admin', 'manager', 'dispatcher', 'operator'].includes((profile.role || '').toLowerCase())) {
    selected.isStaff = true;
    selected.role = profile.role;

    try {
      const res = await fetch(`/api/adminCifra/staff/stats?staffId=${profile.user_id}`);
      if (res.ok) {
        const data = await res.json();
        console.log("📦 Данные от API для сотрудника:", data);

        // Основные данные
        selected.clients_count = data.clients_count || 0;
        selected.total_volume = data.total_volume || 0;
        selected.attracted_clients = data.attracted_clients || data.clients_count || 0;

        // === НОВЫЕ ДИНАМИЧЕСКИЕ МЕТРИКИ ===
        selected.new_clients_30d = data.new_clients_30d ?? 0;
        selected.repeat_order_percent = data.repeat_order_percent ?? 0;

        if (data.clients && Array.isArray(data.clients)) {
          // Убираем дубликаты + сортируем
          const uniqueMap = new Map();
          data.clients.forEach((c: any) => {
            if (c.user_id && !uniqueMap.has(c.user_id)) {
              uniqueMap.set(c.user_id, c);
            }
          });

          const uniqueClients = Array.from(uniqueMap.values())
            .sort((a, b) => 
              (a.organization_name || a.full_name || '').localeCompare(b.organization_name || b.full_name || '')
            );

          selected.clients = uniqueClients;
          console.log(`✅ Успешно сохранено ${uniqueClients.length} уникальных клиентов из ${data.clients.length}`);
        }
      }
    } catch (e) {
      console.error("Ошибка загрузки данных сотрудника:", e);
    }
  } 
  // === Если это клиент ===
  else {
    const mainClient = profile.clients?.[0] || profile;

    if (mainClient?.user_id) {
      try {
        const { data: clientData } = await supabase
          .from('users')
          .select('created_by')
          .eq('user_id', mainClient.user_id)
          .single();

        if (clientData?.created_by) {
          const { data: curator } = await supabase
            .from('users')
            .select('full_name')
            .eq('user_id', clientData.created_by)
            .single();

          if (curator?.full_name) {
            selected.curator_name = curator.full_name;
            selected.created_by = clientData.created_by;

            if (selected.clients && selected.clients.length > 0) {
              selected.clients = selected.clients.map((c: any) => ({
                ...c,
                curator_name: curator.full_name,
                created_by: clientData.created_by
              }));
            }
          }
        }
      } catch (e) {
        console.error("Ошибка загрузки куратора:", e);
      }
    }
  }

  setSelectedProfile(selected);
};

  // ==================== 2.1 АВТООТКРЫТИЕ КЛИЕНТА ИЗ УВЕДОМЛЕНИЯ ====================
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const openClientId = params.get('openClient');
  const testCall = params.get('testCall') === 'true';

  if (!openClientId) return;

  // Ждём, пока profiles загрузятся
  if (profiles.length === 0) return;

  const clientToOpen = profiles.find((p: any) => 
    p.groupId === openClientId || 
    String(p.user_id) === openClientId || 
    String(p.id) === openClientId
  );

  if (clientToOpen) {
    console.log('🔗 Автооткрытие клиента:', clientToOpen.organization_name || clientToOpen.full_name);
    
    setSelectedProfile(clientToOpen);

    // Показываем уведомление
    if (testCall || (clientToOpen.next_contact && new Date(clientToOpen.next_contact) < new Date())) {
      console.log('🔔 Показываем уведомление');
      showClientReminder(clientToOpen, testCall);
    }

    // Очищаем URL
    window.history.replaceState({}, '', '/adminCifra/clients');
  }
}, [profiles]);   // ← Важно: зависимость только от profiles

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

  if (!currentUserId) {
    alert('Не удалось определить текущего пользователя. Обновите страницу.');
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
      
      // === Привязка к текущему куратору ===
      created_by: parseInt(currentUserId),
      curator_id: parseInt(currentUserId),
      curator_name: userFullName || null
    };

    const res = await fetch('/api/adminCifra/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      alert(`✅ Новый клиент успешно создан и привязан к куратору: ${userFullName}`);
      
      setIsNewClientModalOpen(false);
      
      setNewClientForm({
        type: 'legal' as 'legal' | 'physical',
        full_name: '',
        organization_name: '',
        phone: '',
        inn: '',
        address: '',
      });

      fetchClientsPage(currentPage);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Ошибка: ${err.error || 'Не удалось создать клиента'}`);
    }
  } catch (err) {
    console.error(err);
    alert('Ошибка соединения с сервером');
  }
};

    // ==================== ПОИСК ДУБЛЕЙ (информационный) ====================
const findDuplicates = async () => {
  try {
    const res = await fetch('/api/adminCifra/clients/duplicates');
    if (res.ok) {
      const data = await res.json();
      
      if (data.length === 0) {
        alert('✅ Дубликатов не найдено');
        return;
      }

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

// ==================== 3.5 ОТКРЫТИЕ МОДАЛКИ РЕДАКТИРОВАНИЯ ЗАКАЗА ====================
const openOrderModal = (orderId: number | string) => {
  if (!orderId) return;

  fetch(`/api/adminCifra/orders/${orderId}`)
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (data) {
        setSelectedOrder(data);
      } else {
        alert('Не удалось загрузить данные заказа');
      }
    })
    .catch(err => {
      console.error(err);
      alert('Ошибка при открытии заказа');
    });
};

// ==================== 3.6 СОСТОЯНИЯ И ФУНКЦИИ ДЛЯ МОДАЛКИ ЗАКАЗА ====================

const [selectedOrder, setSelectedOrder] = useState<any>(null);
const yandexRouteHref = useYandexRouteHref(selectedOrder?.address);
const [orderHistory, setOrderHistory] = useState<any[]>([]);
const [isSendingNotification, setIsSendingNotification] = useState(false);
const [allOrders, setAllOrders] = useState<any[]>([]);
const [newOrderData, setNewOrderData] = useState<any>(null);

// ==================== ЗАГРУЗКА ИСТОРИИ ЗАКАЗА ====================
const loadOrderHistory = async (orderId: number | string) => {
  try {
    const res = await fetch(`/api/adminCifra/orders/${orderId}/history`);
    if (res.ok) {
      const history = await res.json();
      setOrderHistory(Array.isArray(history) ? history : []);
    }
  } catch (err) {
    console.error(err);
    setOrderHistory([]);
  }
};

// ==================== КОНФИГУРАЦИЯ СТАТУСОВ ====================
const getStatusConfig = (status: string) => {
  switch (status) {
    case 'new': return { label: '🟡 Новая', bg: '#FACC15', color: '#FACC15', final: false };
    case 'processing': return { label: '🔵 В работе', bg: '#3B82F6', color: '#3B82F6', final: false };
    case 'completed': return { label: '🟢 Выполнена', bg: '#10B981', color: '#10B981', final: true };
    case 'cancelled': return { label: '🔴 Отменена', bg: '#EF4444', color: '#EF4444', final: true };
    default: return { label: status, bg: '#64748B', color: '#94A3B8', final: false };
  }
};

const getStatusColor = (status: string) => getStatusConfig(status).color;

const hasManagerPermissions = (role: string) => ['admin', 'manager'].includes((role || '').toLowerCase());

// ==================== ДЕЙСТВИЯ С ЗАКАЗОМ ====================
const handleDeleteOrder = async (orderId: number | string) => {
  if (!confirm(`Удалить заказ #${orderId}?`)) return;

  try {
    const res = await fetch(`/api/adminCifra/orders/${orderId}`, { method: 'DELETE' });
    if (res.ok) {
      alert('✅ Заказ успешно удалён');
      setSelectedOrder(null);
      window.location.reload();
    } else {
      alert('Не удалось удалить заказ');
    }
  } catch (err) {
    console.error(err);
    alert('Ошибка при удалении');
  }
};

const sendNotification = async (orderId: number | string) => {
  setIsSendingNotification(true);
  try {
    const res = await fetch('/api/adminCifra/orders/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId })
    });
    if (res.ok) {
      alert('✅ Уведомление отправлено в Max');
    }
  } catch (err) {
    alert('Ошибка отправки уведомления');
  } finally {
    setIsSendingNotification(false);
  }
};

const shareOrder = (order: any) => {
  const text = `Заказ #${order.id} — ${order.organization_name || order.full_name} — ${order.volume} м³`;
  navigator.clipboard.writeText(text);
  alert('✅ Ссылка скопирована');
};

// ==================== ДУБЛИРОВАНИЕ ЗАКАЗА ====================
const duplicateOrder = (order: any) => {
  if (!order) return alert('Нет данных заказа');

  const clientData = selectedProfile?.clients?.[0] || selectedProfile || {};

  const today = new Date().toISOString().split('T')[0]; // ← сегодняшняя дата

  const duplicated = {
    id: undefined,
    created_at: undefined,
    status: 'new',

    // Данные клиента
    user_id: order.user_id || clientData.user_id || clientData.id,
    organizationName: order.organization_name || order.organizationName || 
                     clientData.organization_name || clientData.organizationName || '',
    fullName: order.full_name || order.fullName || 
              clientData.full_name || clientData.fullName || '',
    phone: order.phone || clientData.phone || '',
    inn: order.inn || clientData.inn || '',

    // === ДАННЫЕ ЗАКАЗА ===
    grade: order.grade || 'М300',
    volume: order.volume || '',
    
    // ←←← ИСПРАВЛЕНИЕ: всегда сегодняшняя дата при дублировании
    delivery_date: today,
    delivery_time: order.delivery_time || order.deliveryTime || '10:00',
    
    address: order.address || clientData.address || '',
    
    comment: order.comment 
      ? `Копия заказа #${order.id}\n\n${order.comment}` 
      : `Копия заказа #${order.id}`,

    customerType: order.customer_type?.includes('Юрид') || order.customerType === 'legal' ? 'legal' : 'physical',
  };

  console.log('📋 Дублируем заказ → Дата доставки установлена на сегодня:', today);

  setNewOrderData(duplicated);
  setSelectedOrder(null);

  setTimeout(() => {
    setIsNewOrderModalOpen(true);
  }, 80);
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

// Фильтрация по поиску (используем searchTerm)
const filteredList = currentList.filter((item: any) => {
  if (!searchTerm || searchTerm.trim() === '') return true;

  const searchLower = searchTerm.toLowerCase().trim();

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

// ==================== 4.2 ПАГИНАЦИЯ ====================
const startIndex = (currentPage - 1) * itemsPerPage;
const displayedClients = filteredList.slice(startIndex, startIndex + itemsPerPage);

  // ==================== 4.1 ПОКАЗ УВЕДОМЛЕНИЯ О КЛИЕНТЕ ====================
const showClientReminder = (client: any, isTest = false) => {
  const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
  const key = `client-reminder-${client.groupId || client.user_id}`;

  if (!isTest && closed.includes(key)) return;

  const isOverdue = client.isOverdue || (client.next_contact && new Date(client.next_contact) < new Date());

  const notif = document.createElement('div');
  Object.assign(notif.style, {
    position: 'fixed',
    top: '90px',
    right: '24px',
    background: isOverdue ? 'linear-gradient(135deg, #ef4444, #f87171)' : 'linear-gradient(135deg, #f59e0b, #fbbf24)',
    color: '#0f172a',
    padding: '18px 24px',
    borderRadius: '16px',
    zIndex: '10000',
    boxShadow: '0 20px 40px rgba(239, 68, 68, 0.4)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    minWidth: '420px',
    cursor: 'pointer'
  });

  notif.innerHTML = `
    <div style="font-size: 36px;">📞</div>
    <div style="flex: 1;">
      <div style="font-size: 17px; font-weight: 700;">
        Пора позвонить клиенту!
      </div>
      <div style="font-size: 15px; margin-top: 4px;">
        ${client.organization_name || client.full_name || 'Клиент'}
      </div>
      <div style="font-size: 14px; opacity: 0.9;">
        Следующий контакт: ${new Date(client.next_contact).toLocaleDateString('ru-RU')}
      </div>
    </div>
    <div style="font-size: 28px; cursor: pointer; padding: 4px 10px;" class="close-reminder">✕</div>
  `;

  const closeBtn = notif.querySelector('.close-reminder') as HTMLElement;

  const closeNotification = () => {
    notif.remove();
    if (!isTest) {
      const closedList = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
      closedList.push(key);
      localStorage.setItem('closedNotifications', JSON.stringify(closedList));
    }
  };

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeNotification();
  });

  // Главное улучшение — открываем клиента
  notif.addEventListener('click', () => {
  closeNotification();
  const groupId = client.groupId || client.user_id || client.id;
  window.location.href = `/adminCifra/clients?openClient=${groupId}`;
});

  document.body.appendChild(notif);

  // Звук
  try {
    const audio = new Audio('/sounds/new-order.mp3');
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch (e) {}
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
window.callClient = (clientId: number | string) => {
  if (!clientId) {
    alert('❌ Не удалось определить ID клиента');
    return;
  }

  const phone = prompt("📞 Подтвердите или введите номер для звонка:", "+7");
  if (!phone) return;

  // Сразу открываем окно результата звонка
  const resultInput = prompt(
    "✅ Результат звонка:\n\n" +
    "1 — Положительный (клиент заказал)\n" +
    "2 — Нейтральный (скоро закажет)\n" +
    "3 — Отрицательный (не нужен)\n\n" +
    "Введите 1, 2 или 3:",
    "1"
  );

  if (resultInput === null) {
    // Пользователь отменил — просто звоним
    window.open(`tel:${phone}`, '_self');
    return;
  }

  let result = 'neutral';
  let comment = '';

  if (resultInput === '1') { 
    result = 'positive'; 
    comment = 'Клиент заказал бетон'; 
  } else if (resultInput === '2') { 
    result = 'neutral'; 
    comment = 'Клиент сказал, что скоро закажет'; 
  } else if (resultInput === '3') { 
    result = 'negative'; 
    comment = 'Клиент отказался'; 
  }

  // Запускаем звонок
  window.open(`tel:${phone}`, '_self');

  // Сохраняем результат звонка
  fetch('/api/adminCifra/client-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      client_id: clientId, 
      result, 
      comment 
    })
  })
  .then(res => {
    if (res.ok) {
      alert('✅ Результат звонка успешно сохранён');
    } else {
      alert('⚠️ Звонок выполнен, но результат не сохранён');
    }
  })
  .catch(err => {
    console.error(err);
    alert('Ошибка сохранения результата звонка');
  });
};

// ==================== ФУНКЦИЯ РЕДАКТИРОВАНИЯ СОТРУДНИКА ====================
const editStaff = (staffMember: any) => {
  setEditingStaff(staffMember);        // новая переменная состояния
  setIsStaffEditModalOpen(true);
};

// ==================== СМЕНА ПАРОЛЯ ДЛЯ СОТРУДНИКА ====================
const changeStaffPassword = async (staffMember: any) => {
  if (!staffMember?.user_id) {
    alert('Не удалось определить ID сотрудника');
    return;
  }

  const newPassword = prompt(`Новый пароль для сотрудника:\n${staffMember.full_name}`, 'guest2026');

  if (newPassword === null) return; // отмена
  if (newPassword.length < 6) {
    alert('Пароль должен содержать минимум 6 символов');
    return;
  }

  if (!confirm(`Сменить пароль для "${staffMember.full_name}" на:\n\n${newPassword}\n\nВы уверены?`)) {
    return;
  }

  try {
    const bcrypt = require('bcryptjs');
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    const res = await fetch('/api/adminCifra/staff/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: staffMember.user_id,
        encrypted_password: hashedPassword
      })
    });

    if (res.ok) {
      alert(`✅ Пароль успешно изменён для ${staffMember.full_name}`);
    } else {
      const errorData = await res.json().catch(() => ({}));
      alert(`Ошибка: ${errorData.error || 'Не удалось обновить пароль'}`);
    }
  } catch (err) {
    console.error(err);
    alert('Произошла ошибка при смене пароля');
  }
};


  return (
    <div style={{ background: '#0F172A', minHeight: '100vh', color: '#fff', padding: '32px 40px' }}>
      <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '32px' }}>Клиенты CRM</h1>

      {/* ====================== ВЕРХНЯЯ ПАНЕЛЬ УПРАВЛЕНИЯ ====================== */}
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>

  {/* Левая группа — Табы + Кнопки действий */}
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

  {/* Кнопка Показать дубли */}
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
    Показать дубли
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

  {/* ==================== Кнопка Эффективность (отключена) ==================== */}
{/* 
  <button 
    onClick={() => setActiveTab('efficiency')}
    style={{
      padding: '12px 24px',
      background: 'transparent',
      border: 'none',
      color: activeTab === 'efficiency' ? '#10B981' : '#A78BFA',
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
    <span style={{ fontSize: '22px', opacity: activeTab === 'efficiency' ? 0.9 : 0.7 }}>📊</span>
    Эффективность
    {activeTab === 'efficiency' && (
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
*/}

</div>
  

  {/* Правая группа — Вид отображения (Карточки / Список) — ТОЛЬКО НА КЛИЕНТАХ И СТАФФЕ */}
{(activeTab === 'clients' || activeTab === 'staff') && (
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
)}
</div>

{/* ==================== ПОЛЕ ПОИСКА — С DEBOUNCE ==================== */}
{(activeTab === 'clients' || activeTab === 'staff') && (
  <div style={{ position: 'relative', width: '100%', maxWidth: '720px', marginBottom: '32px' }}>
    <input
      type="text"
      placeholder="Поиск по имени, организации, телефону, ИНН..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      style={{ 
        width: '100%', 
        padding: '12px 16px', 
        borderRadius: '12px', 
        background: '#1E2937', 
        border: '1px solid #334155', 
        color: '#fff',
        fontSize: '16px'
      }}
    />
  </div>
)}

   {/* ==================== 8. ОТОБРАЖЕНИЕ (КАРТОЧКИ + ТАБЛИЦА) ==================== */}
{(activeTab === 'clients' || activeTab === 'staff') && (
  <>
    {viewMode === 'cards' ? (
      /* ==================== КАРТОЧКИ ==================== */
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
        gap: '16px'
      }}>
        {activeTab === 'staff' ? (
          // ==================== КАРТОЧКИ СОТРУДНИКОВ (НОВАЯ ЛОГИКА) ====================
          staffProfiles.map((person: any) => (
            <div
              key={person.user_id}
              onClick={() => handleSelectProfile(person)}
              style={{ 
                background: '#1E2937', 
                borderRadius: '16px', 
                padding: '20px',
                cursor: 'pointer',
                border: selectedProfile?.user_id === person.user_id ? '2px solid #10B981' : '1px solid #334155',
                minHeight: '190px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              {/* Верхняя часть */}
              <div>
                <div style={{ fontSize: '18px', fontWeight: '700', marginBottom: '6px', lineHeight: 1.3 }}>
                  {person.full_name || 'Без имени'}
                </div>
                <div style={{ color: '#10B981', fontSize: '15px', marginBottom: '16px' }}>
                  {person.role ? person.role.toUpperCase() : 'СОТРУДНИК'}
                </div>
              </div>

              {/* Нижняя часть — статистика куратора */}
              <div style={{ background: '#334155', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '32px', fontWeight: '700', color: '#60A5FA' }}>
                      {person.clients_count || 0}
                    </div>
                    <div style={{ fontSize: '13px', color: '#94A3B8' }}>клиентов</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '28px', fontWeight: '700', color: '#fff' }}>
                      {person.total_volume || 0}
                    </div>
                    <div style={{ fontSize: '13px', color: '#94A3B8' }}>м³ всего</div>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          // ==================== СТАРЫЕ КАРТОЧКИ КЛИЕНТОВ (без изменений) ====================
          profiles
            .filter((item: any) => {
              const isStaffItem = item.isStaff || 
                                 ['admin', 'manager', 'dispatcher', 'operator'].includes((item.role || '').toLowerCase());
              return !isStaffItem;
            })
            .map((client: any) => {
              const vol = client.total_volume || client.totalVolume || 0;
              const ordersCount = client.total_orders || client.totalOrders || 0;

              return (
                <div 
                  key={client.groupId || client.user_id || client.id} 
                  onClick={() => handleSelectProfile(client)}
                  style={{ 
                    background: '#1E2937', 
                    borderRadius: '16px', 
                    padding: '16px 18px',
                    cursor: 'pointer',
                    border: selectedProfile?.groupId === client.groupId || 
                            selectedProfile?.user_id === client.user_id 
                      ? '2px solid #10B981' 
                      : '1px solid #334155',
                    minHeight: '152px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  {/* Верхняя часть — Имя и телефон */}
                  <div>
                    <div style={{ fontSize: '17px', fontWeight: '700', marginBottom: '4px', lineHeight: 1.3 }}>
                      {client.organization_name || client.full_name || client.name || 'Без названия'}
                    </div>
                    <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '12px' }}>
                      {client.phones ? client.phones.join(' • ') : client.phone || '—'}
                    </div>

                    {!client.isStaff && client.curator_name && (
                      <div style={{ 
                        fontSize: '13.5px', 
                        color: '#94A3B8', 
                        padding: '6px 10px',
                        background: '#334155',
                        borderRadius: '8px',
                        marginBottom: '12px'
                      }}>
                        👤 Куратор: <span style={{ color: '#60A5FA', fontWeight: '600' }}>{client.curator_name}</span>
                      </div>
                    )}
                  </div>

                  {/* Нижняя часть для клиентов */}
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
            })
        )}
      </div>
        ) : (
      /* ==================== РЕЖИМ ТАБЛИЦЫ ==================== */
      <div style={{ background: '#1E2937', borderRadius: '16px', overflow: 'hidden' }}>

        {/* Шапка таблицы */}
      {activeTab === 'staff' ? (
  <div style={{
    display: 'grid',
    gridTemplateColumns: currentUserRole === 'admin' 
      ? '2.8fr 160px 1.6fr 1.1fr 130px' 
      : '2.8fr 1.6fr 1.1fr 130px',
    padding: '18px 28px',
    background: '#25334A',
    borderBottom: '2px solid #334155',
    fontSize: '15px',
    fontWeight: '600',
    color: '#94A3B8'
  }}>
    <div>Сотрудник</div>
    {currentUserRole === 'admin' && <div style={{ textAlign: 'center' }}>Пароль</div>}
    <div>Телефон</div>
    <div style={{ textAlign: 'center' }}>Роль</div>
    <div style={{ textAlign: 'center' }}>Изменить</div>
  </div>
) : (

          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 140px 140px 120px',
            padding: '18px 28px',
            background: '#25334A',
            borderBottom: '2px solid #334155',
            fontSize: '15px',
            fontWeight: '600',
            color: '#94A3B8'
          }}>
            <div>Клиент / Организация</div>
            <div>ИНН</div>
            <div>Статус</div>
            <div>Объём бетона</div>
            <div>Заказы</div>
          </div>
        )}

        {/* Строки таблицы */}
        {(activeTab === 'staff' ? staffProfiles : profiles).map((item: any) => {
          if (activeTab === 'staff') {
  return (
    <div
      key={item.user_id}
      onClick={() => setSelectedProfile(item)}
      style={{
        display: 'grid',
        gridTemplateColumns: currentUserRole === 'admin' 
          ? '2.8fr 160px 1.6fr 1.1fr 130px' 
          : '2.8fr 1.6fr 1.1fr 130px',
        padding: '16px 28px',
        borderBottom: '1px solid #334155',
        cursor: 'pointer',
        alignItems: 'center',
        opacity: item.role === 'guest' ? 0.92 : 1,
        background: item.role === 'guest' ? '#1F2A38' : 'transparent'
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = item.role === 'guest' ? '#334155' : '#25334A';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = item.role === 'guest' ? '#1F2A38' : 'transparent';
      }}
    >
      {/* 1. Сотрудник */}
      <div>
        <div style={{ fontWeight: '600', fontSize: '17px' }}>{item.full_name}</div>
        {item.role === 'guest' && (
          <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '2px' }}>
            Демо-доступ
          </div>
        )}
      </div>

      {/* 2. Пароль — только для админа */}
      {currentUserRole === 'admin' && (
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              changeStaffPassword(item);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#8B5CF6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Сменить пароль
          </button>
        </div>
      )}

      {/* 3. Телефон */}
      <div style={{ color: '#94A3B8' }}>{item.phone || '—'}</div>

      {/* 4. Роль */}
      <div style={{ textAlign: 'center' }}>
        <span style={{ 
          padding: '6px 16px', 
          borderRadius: '9999px', 
          fontSize: '13px', 
          background: item.role === 'admin' ? '#7C3AED' : 
                      item.role === 'guest' ? '#475569' : '#334155', 
          color: 'white',
          display: 'inline-block'
        }}>
          {item.role === 'admin' ? 'Администратор' : 
           item.role === 'dispatcher' ? 'Диспетчер' : 
           item.role === 'operator' ? 'Оператор' : 
           item.role === 'guest' ? 'Гость' : 'Менеджер'}
        </span>
      </div>

      {/* 5. Изменить */}
      <div style={{ textAlign: 'center' }}>
        <button 
          onClick={(e) => { e.stopPropagation(); editStaff(item); }}
          style={{ 
            padding: '8px 18px', 
            background: '#3B82F6', 
            border: 'none', 
            borderRadius: '8px', 
            color: 'white', 
            cursor: 'pointer' 
          }}
        >
          Изменить
        </button>
  </div>
</div>
            );
          } else {
            const vol = item.total_volume || item.totalVolume || 0;
            const ordersCount = item.total_orders || item.totalOrders || 0;
            let statusText = '❄️ Холодный';
            let statusColor = '#64748B';
            if (vol >= 30 || ordersCount >= 5) { statusText = '🔥 Горячий'; statusColor = '#EF4444'; }
            else if (vol >= 8 || ordersCount >= 2) { statusText = '🌡️ Тёплый'; statusColor = '#F59E0B'; }

            return (
              <div
                key={item.groupId || item.user_id}
                onClick={() => setSelectedProfile(item)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 140px 140px 120px',
                  padding: '14px 28px',
                  borderBottom: '1px solid #334155',
                  cursor: 'pointer',
                  alignItems: 'center'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#25334A'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div>
                  <div style={{ fontWeight: '600', fontSize: '17px' }}>{item.organization_name || item.full_name || 'Без названия'}</div>
                  <div style={{ color: '#94A3B8', fontSize: '14px' }}>{item.phones ? item.phones.join(' • ') : item.phone || '—'}</div>
                </div>
                <div style={{ color: '#94A3B8' }}>{item.inn || '—'}</div>
                <div style={{ color: statusColor, fontWeight: '600' }}>{statusText}</div>
                <div style={{ fontSize: '18px', fontWeight: '700', color: '#60A5FA' }}>{vol.toFixed(1)} м³</div>
                <div style={{ color: '#94A3B8', fontWeight: '500' }}>{ordersCount} шт.</div>
              </div>
            );
          }
        })}
      </div>
    )}
  </>
)}

{/* ==================== ПАГИНАЦИЯ ==================== */}
{totalPages > 1 && (
  <div style={{ 
    display: 'flex', 
    justifyContent: 'center', 
    alignItems: 'center', 
    gap: '16px', 
    marginTop: '40px' 
  }}>
    <button 
      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
      disabled={currentPage === 1}
      style={{ padding: '12px 24px', background: currentPage === 1 ? '#334155' : '#1E2937', color: '#fff', border: 'none', borderRadius: '12px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
    >
      ← Назад
    </button>

    <div style={{ fontSize: '17px', fontWeight: '600' }}>
      Страница <span style={{ color: '#10B981' }}>{currentPage}</span> из {totalPages}
    </div>

    <button 
      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
      disabled={currentPage === totalPages}
      style={{ padding: '12px 24px', background: currentPage === totalPages ? '#334155' : '#1E2937', color: '#fff', border: 'none', borderRadius: '12px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
    >
      Вперед →
    </button>
  </div>
)}

     {/* ==================== ВКЛАДКА ЭФФЕКТИВНОСТЬ ================================ */}
             {activeTab === 'efficiency' && <EfficiencyPage />}

     {/* ==================== 9. БОКОВАЯ ПАНЕЛЬ ==================== */}
{selectedProfile && (
  <>
    {/* ==================== БОКОВАЯ ПАНЕЛЬ ДЛЯ СОТРУДНИКА ==================== */}
{selectedProfile.isStaff ? (
  <div style={{ 
    position: 'fixed', 
    top: 0, 
    right: 0, 
    width: '760px', 
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

      <h2 style={{ marginBottom: '4px' }}>{selectedProfile.full_name}</h2>
      <div style={{ color: '#10B981', fontSize: '17px', fontWeight: '600', marginBottom: '32px' }}>
        {selectedProfile.role?.toUpperCase() || 'СОТРУДНИК'}
      </div>

      {/* Основная статистика */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '40px' }}>
        <div style={{ background: '#25334A', padding: '28px 20px', borderRadius: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', fontWeight: '700', color: '#60A5FA' }}>
            {selectedProfile.clients_count || 0}
          </div>
          <div style={{ color: '#94A3B8', fontSize: '15px' }}>Клиентов на кураторстве</div>
        </div>
        <div style={{ background: '#25334A', padding: '28px 20px', borderRadius: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', fontWeight: '700' }}>
            {selectedProfile.total_volume || 0}
          </div>
          <div style={{ color: '#94A3B8', fontSize: '15px' }}>м³ всего продано</div>
        </div>
      </div>


{/* ==================== БЛОК ЭФФЕКТИВНОСТЬ КУРАТОРА ==================== */}
{selectedProfile.isStaff && (
  <div style={{ marginBottom: '24px' }}>
    <h3 style={{ marginBottom: '16px', color: '#94A3B8', fontSize: '15px' }}>
      Эффективность куратора
    </h3>
    
    <div style={{ 
      background: '#25334A', 
      borderRadius: '16px', 
      padding: '20px',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '16px'
    }}>
      <div>
        <div style={{ fontSize: '26px', fontWeight: '700', color: '#34D399' }}>
          {selectedProfile.clients?.length || 0}
        </div>
        <div style={{ fontSize: '13px', color: '#94A3B8' }}>активных клиентов</div>
      </div>

      <div>
        <div style={{ fontSize: '26px', fontWeight: '700', color: '#FBBF24' }}>
          {selectedProfile.clients?.length > 0 
            ? Math.round((selectedProfile.total_volume || 0) / selectedProfile.clients.length) 
            : 0}
        </div>
        <div style={{ fontSize: '13px', color: '#94A3B8' }}>средний объём</div>
      </div>

            <div>
  <div style={{ fontSize: '26px', fontWeight: '700', color: '#A78BFA' }}>
    {selectedProfile.new_clients_30d ?? 0}
  </div>
  <div style={{ fontSize: '13px', color: '#94A3B8' }}>новых за 30 дней</div>
</div>

      <div>
  <div style={{ fontSize: '26px', fontWeight: '700', color: '#10B981' }}>
    {selectedProfile.repeat_order_percent ?? 0}%
  </div>
  <div style={{ fontSize: '13px', color: '#94A3B8' }}>повторных заказов</div>
</div>
    </div>

        {/* Главная метрика */}
    <div style={{ 
      marginTop: '12px', 
      background: '#25334A', 
      borderRadius: '12px', 
      padding: '14px 20px', 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center' 
    }}>
      <div style={{ color: '#94A3B8' }}>Привлёк клиентов</div>
      <div style={{ fontSize: '24px', fontWeight: '700' }}>
        {selectedProfile.clients_count || 0}
      </div>
    </div>
  </div>
)}

{/* Список клиентов */}
{selectedProfile.clients && selectedProfile.clients.length > 0 ? (
  <div>
    <h3 style={{ marginBottom: '16px', color: '#94A3B8' }}>
      Клиенты куратора ({selectedProfile.clients.length})
    </h3>
    <div style={{ maxHeight: '520px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {selectedProfile.clients.map((client: any) => (
        <div key={client.user_id} style={{ 
          background: '#25334A', 
          padding: '16px', 
          borderRadius: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontWeight: '600' }}>
              {client.organization_name || client.full_name || 'Без названия'}
            </div>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>{client.phone}</div>
          </div>
          <div style={{ color: '#60A5FA', fontWeight: '700', textAlign: 'right' }}>
            {(client.total_volume || 0)} м³
          </div>
        </div>
      ))}
    </div>
  </div>
) : (
  <div style={{ 
    textAlign: 'center', 
    padding: '100px 40px', 
    color: '#94A3B8',
    background: '#25334A',
    borderRadius: '16px'
  }}>
    Пока нет клиентов под кураторством
  </div>
)}

    </div>
  </div>
) : (
      /* ==================== СТАРАЯ БОКОВАЯ ПАНЕЛЬ ДЛЯ КЛИЕНТОВ (без изменений) ==================== */
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

      {/* === КУРАТОР === */}
      {selectedProfile.curator_name && (
        <div style={{ marginTop: '20px', marginBottom: '24px' }}>
          <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>
            👤 Куратор клиента
          </div>
          <div style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            color: '#60A5FA',
            padding: '12px 16px',
            background: '#334155',
            borderRadius: '10px',
            display: 'inline-block'
          }}>
            {selectedProfile.curator_name}
          </div>
        </div>
      )}

    {/* ==================== СЕЛЕКТ ВЫБОРА КУРАТОРА — ТОЛЬКО ДЛЯ АДМИНА ==================== */}

{(window.localStorage.getItem('user_role') === 'admin' || 
  window.localStorage.getItem('role') === 'admin' || 
  window.localStorage.getItem('userRole') === 'admin') && (
  <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #334155' }}>
    <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
      Назначить куратора
    </div>
    <select
      value={selectedProfile.curator_id || ''}
      onChange={async (e) => {
        const newCuratorIdStr = e.target.value;
        if (!newCuratorIdStr) return;
        const newCuratorId = parseInt(newCuratorIdStr);
        if (isNaN(newCuratorId)) return;

        let clientIds: number[] = [];

        if (selectedProfile.clients && Array.isArray(selectedProfile.clients)) {
          selectedProfile.clients.forEach((c: any) => {
            const id = Number(c?.user_id);
            if (!isNaN(id) && id > 0) clientIds.push(id);
          });
        } else if (selectedProfile.user_id) {
          const id = Number(selectedProfile.user_id);
          if (!isNaN(id) && id > 0) clientIds.push(id);
        } else if (selectedProfile.groupId) {
          const id = Number(selectedProfile.groupId.split('_')[0]);
          if (!isNaN(id)) clientIds.push(id);
        }

        if (clientIds.length === 0) {
          alert("❌ Не найдены клиенты для обновления");
          return;
        }

        try {
          const response = await fetch('/api/adminCifra/clients/update-curator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_ids: clientIds,
              new_curator_id: newCuratorId
            })
          });

          const result = await response.json();

          if (!response.ok) {
            alert("Ошибка: " + (result.error || 'Неизвестная ошибка'));
            return;
          }

          const newCuratorName = e.target.options[e.target.selectedIndex].text.split(' (')[0] || 'Новый куратор';

          const updatedProfile = {
            ...selectedProfile,
            curator_name: newCuratorName,
            curator_id: newCuratorId,
            clients: selectedProfile.clients ? selectedProfile.clients.map((c: any) => ({
              ...c,
              curator_name: newCuratorName,
              curator_id: newCuratorId
            })) : null
          };

          setSelectedProfile(updatedProfile);

          alert(`✅ Куратор "${newCuratorName}" успешно назначен`);
          setTimeout(() => window.location.reload(), 800);

        } catch (err) {
          console.error(err);
          alert("Ошибка при назначении куратора");
        }
      }}
      style={{
        width: '100%',
        padding: '12px 16px',
        background: '#334155',
        color: 'white',
        border: 'none',
        borderRadius: '10px',
        fontSize: '16px'
      }}
    >
      <option value="">Выберите куратора...</option>
      {curators.map((curator: any) => (
        <option key={curator.user_id} value={curator.user_id}>
          {curator.full_name} ({curator.role})
        </option>
      ))}
    </select>
  </div>
)}

      {/* 9.3 Действия (кнопки) — ВСЕ КНОПКИ СОХРАНЕНЫ */}
      <div style={{ display: 'flex', gap: '12px', margin: '28px 0', flexWrap: 'wrap' }}>
        <button 
  onClick={() => {
    const client = selectedProfile;
    if (!client) return alert('Клиент не выбран');

    const phone = prompt("📞 Подтвердите номер для звонка:", 
      client.phones?.[0] || client.phone || "+7");

    if (!phone) return;

    // Сразу показываем окно результата
    const resultInput = prompt(
      "✅ Результат звонка:\n\n" +
      "1 — Положительный (клиент заказал)\n" +
      "2 — Нейтральный (скоро закажет)\n" +
      "3 — Отрицательный (не нужен)\n\n" +
      "Введите 1, 2 или 3:",
      "1"
    );

    if (resultInput === null) return;

    let result = 'neutral';
    let comment = '';

    if (resultInput === '1') { 
      result = 'positive'; 
      comment = 'Клиент заказал бетон'; 
    } else if (resultInput === '2') { 
      result = 'neutral'; 
      comment = 'Клиент сказал, что скоро закажет'; 
    } else if (resultInput === '3') { 
      result = 'negative'; 
      comment = 'Клиент отказался'; 
    }

    // Запускаем звонок
    window.open(`tel:${phone}`, '_self');

    // Сохраняем результат
    fetch('/api/adminCifra/client-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        client_id: client.user_id || client.id || client.clients?.[0]?.user_id, 
        result, 
        comment 
      })
    })
    .then(() => alert('✅ Результат звонка сохранён'))
    .catch(() => alert('⚠️ Звонок выполнен, но результат не сохранён'));
  }} 
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
  onClick={() => {
    // Создаём объект с данными текущего клиента
    const clientData = selectedProfile?.clients?.[0] || selectedProfile;
    
    setNewOrderData({
      user_id: clientData?.user_id || selectedProfile?.user_id || selectedProfile?.id,
      organizationName: clientData?.organization_name || clientData?.organizationName || '',
      fullName: clientData?.full_name || clientData?.fullName || '',
      phone: clientData?.phone || '',
      inn: clientData?.inn || '',
      address: clientData?.address || '',
      status: 'new'
    });
    
    setIsNewOrderModalOpen(true);
  }} 
  style={{ flex: 1, padding: '14px', background: '#10B981', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
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
    userOrders.map((o: any) => {
      // Русские статусы
      let statusText = 'Новая';
      let statusColor = '#FACC15';

      if (o.status === 'completed') {
        statusText = 'Выполнена';
        statusColor = '#10B981';
      } else if (o.status === 'processing') {
        statusText = 'В работе';
        statusColor = '#3B82F6';
      } else if (o.status === 'cancelled') {
        statusText = 'Отменена';
        statusColor = '#EF4444';
      }

      return (
        <div 
          key={o.id} 
          onClick={() => openOrderModal(o.id)}
          style={{ 
            background: '#25334A', 
            padding: '18px', 
            borderRadius: '16px', 
            marginBottom: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#334155'}
          onMouseOut={(e) => e.currentTarget.style.background = '#25334A'}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong 
              style={{ 
                color: '#60A5FA', 
                fontSize: '17px',
                textDecoration: 'underline',
                textDecorationStyle: 'dotted',
                cursor: 'pointer'
              }}
            >
              Заказ #{o.id}
            </strong>
            <span>{new Date(o.delivery_date).toLocaleDateString('ru-RU')}</span>
          </div>
          
          <div style={{ marginTop: '8px' }}>
            {o.volume} м³ • {o.grade || '—'} • 
            <span style={{ color: statusColor, fontWeight: '600' }}>
              {statusText}
            </span>
          </div>

          {o.address && <div style={{ marginTop: '8px', color: '#94A3B8' }}>📍 {o.address}</div>}
          
          {o.total_price && (
            <div style={{ marginTop: '10px', fontSize: '18px', fontWeight: '700', color: '#60A5FA' }}>
              {Number(o.total_price).toLocaleString('ru-RU')} ₽
            </div>
          )}
        </div>
      );
    })
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

    </>
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
                style={{ width: '96%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }}
              />
            </div>

            {/* Название и ФИО */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Название организации</label>
              <input value={client.organization_name || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].organization_name = e.target.value; setEditingClient(newClients);
              }} style={{ width: '96%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>ФИО</label>
              <input value={client.full_name || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].full_name = e.target.value; setEditingClient(newClients);
              }} style={{ width: '96%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            {/* Телефон и Адрес */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Телефон</label>
              <input value={client.phone || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].phone = e.target.value; setEditingClient(newClients);
              }} style={{ width: '90%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Адрес</label>
              <input value={client.address || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].address = e.target.value; setEditingClient(newClients);
              }} style={{ width: '92%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
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
                style={{ width: '90%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Следующий контакт</label>
              <input type="date" value={client.next_contact ? client.next_contact.split('T')[0] : ''} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].next_contact = e.target.value ? e.target.value + 'T00:00:00Z' : null;
                  setEditingClient(newClients);
                }}
                style={{ width: '92%', padding: '12px', background: '#1E2937', border: 'none', borderRadius: '10px', color: '#fff' }} />
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


{/* ==================== МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ СОТРУДНИКА ==================== */}
{isStaffEditModalOpen && editingStaff && (
  <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ background: '#1E2937', width: '620px', borderRadius: '20px', padding: '32px', color: '#fff' }}>
      <h2 style={{ marginBottom: '24px' }}>Редактирование сотрудника</h2>

      <div style={{ display: 'grid', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>ФИО</label>
          <input 
            value={editingStaff.full_name || ''} 
            onChange={(e) => setEditingStaff({...editingStaff, full_name: e.target.value})}
            style={{ width: '95%', padding: '12px', background: '#25334A', border: 'none', borderRadius: '10px', color: '#fff' }} 
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Телефон</label>
          <input 
            value={editingStaff.phone || ''} 
            onChange={(e) => setEditingStaff({...editingStaff, phone: e.target.value})}
            style={{ width: '95%', padding: '12px', background: '#25334A', border: 'none', borderRadius: '10px', color: '#fff' }} 
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Роль</label>
          <select 
            value={editingStaff.role || 'manager'} 
            onChange={(e) => setEditingStaff({...editingStaff, role: e.target.value})}
            style={{ width: '99%', padding: '12px', background: '#25334A', border: 'none', borderRadius: '10px', color: '#fff' }}
          >
            <option value="admin">Администратор</option>
            <option value="manager">Менеджер</option>
            <option value="dispatcher">Диспетчер</option>
            <option value="operator">Оператор</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
        <button 
          onClick={() => { setIsStaffEditModalOpen(false); setEditingStaff(null); }} 
          style={{ flex: 1, padding: '16px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
        >
          Отмена
        </button>
        <button 
          onClick={() => {
            // Здесь будет сохранение в Supabase
            console.log('Сохраняем сотрудника:', editingStaff);
            alert('Изменения сохранены (пока заглушка)');
            setIsStaffEditModalOpen(false);
            setEditingStaff(null);
            // window.location.reload(); // или обновить список staff
          }} 
          style={{ flex: 1, padding: '16px', background: '#10B981', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: '600' }}
        >
          Сохранить
        </button>
      </div>
    </div>
  </div>
)}

    {/* ==================== МОДАЛКА СОЗДАНИЯ / ДУБЛИРОВАНИЯ ЗАКАЗА ==================== */}
{isNewOrderModalOpen && (
  <NewOrderModal 
    isOpen={isNewOrderModalOpen}
    onClose={() => {
      setIsNewOrderModalOpen(false);
      setNewOrderData(null);
      setSelectedOrder(null);
    }}
    initialData={newOrderData}
    userId={newOrderData?.user_id || selectedProfile?.clients?.[0]?.user_id || selectedProfile?.user_id || selectedProfile?.id || ''}
    
    
    userName={newOrderData?.organizationName || newOrderData?.fullName || 
              selectedProfile?.organization_name || selectedProfile?.full_name || ''}
    
    userPhone={newOrderData?.phone || selectedProfile?.phones?.[0] || selectedProfile?.phone || ''}
    
    currentRole={currentRole}
    
    
    currentUserName={userFullName || 'Сотрудник'}     // ← Изменили название пропса!

    onOrderCreated={() => {
      setIsNewOrderModalOpen(false);
      setNewOrderData(null);
      setSelectedOrder(null);
      alert('✅ Новая заявка успешно создана!');
      
      if (selectedProfile) {
        const uid = selectedProfile.user_id || selectedProfile.id || selectedProfile?.clients?.[0]?.user_id;
        if (uid) loadUserOrders(uid);
      }
    }}
  />
)}


             {/* ==================== МОДАЛЬНОЕ ОКНО ДУБЛЕЙ ==================== */}
{showMergeModal && clientsToMerge.length > 0 && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 1400,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }}>
    <div style={{
      background: '#1E2937', width: '780px', borderRadius: '20px', 
      padding: '32px', color: '#fff', maxHeight: '88vh', overflow: 'auto'
    }}>
      <h2 style={{ marginBottom: '12px' }}>Группы дублей</h2>
      <p style={{ color: '#94A3B8', marginBottom: '24px' }}>
        Клиенты уже автоматически группируются по ИНН (юрлица) и ФИО (физлица).
      </p>

      {clientsToMerge.map((group: any, idx: number) => (
        <div key={idx} style={{ 
          marginBottom: '24px', 
          background: '#25334A', 
          padding: '20px', 
          borderRadius: '16px' 
        }}>
          <h3 style={{ color: '#FBBF24', marginBottom: '12px' }}>
            {group.inn ? `ИНН: ${group.inn}` : `ФИО: ${group.full_name}`}
          </h3>
          <div style={{ color: '#94A3B8', marginBottom: '12px' }}>
            {group.clients.length} записей
          </div>
          
          {group.clients.map((c: any, i: number) => (
            <div key={i} style={{ 
              padding: '10px 0', 
              borderBottom: i < group.clients.length - 1 ? '1px solid #334155' : 'none'
            }}>
              {c.organization_name || c.full_name} — {c.phone || '—'}
            </div>
          ))}
        </div>
      ))}

      <button 
        onClick={() => setShowMergeModal(false)}
        style={{ padding: '14px 36px', background: '#10B981', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600' }}
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
              width: '95%'
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


{/* ==================== МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ЗАКАЗА ==================== */}
{selectedOrder && (
  <div 
    style={{ 
      position: 'fixed', 
      inset: 0, 
      background: 'rgba(0,0,0,0.94)', 
      zIndex: 9999, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center' 
    }} 
    onClick={() => setSelectedOrder(null)}
  >
    <div 
      style={{ 
        background: '#1E2937', 
        width: '1080px', 
        borderRadius: '24px', 
        padding: '32px', 
        maxHeight: '94vh', 
        overflow: 'auto',
        boxShadow: '0 30px 80px rgba(0,0,0,0.7)'
      }} 
       onClick={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '28px' }}>
          Редактирование заявки #{selectedOrder.id}
        </h2>
        <button 
          onClick={() => setSelectedOrder(null)} 
          style={{ fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}
        >
          ×
        </button>
      </div>

      {/* Статус */}
      <div style={{ 
        display: 'inline-block', 
        padding: '8px 26px', 
        borderRadius: '9999px', 
        fontWeight: '600',
        backgroundColor: getStatusColor(selectedOrder.status) + '20',
        color: getStatusColor(selectedOrder.status),
        marginBottom: '28px'
      }}>
        {selectedOrder.status === 'new' && '🟡 Новая заявка'}
        {selectedOrder.status === 'processing' && '🔵 В работе'}
        {selectedOrder.status === 'completed' && '🟢 Выполнена'}
        {selectedOrder.status === 'cancelled' && '🔴 Отменена'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
        
        {/* Левая колонка — Информация (с возможностью редактирования) */}
        <div>
          <h3 style={{ marginBottom: '18px', color: '#94A3B8' }}>Информация о заказе</h3>
          
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '24px', lineHeight: '2' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px' }}>

              <div style={{ color: '#94A3B8' }}>Клиент</div>
              <input 
                value={selectedOrder.organization_name || selectedOrder.full_name || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, organization_name: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              {selectedOrder.inn !== undefined && (
                <>
                  <div style={{ color: '#94A3B8' }}>ИНН</div>
                  <input 
                    value={selectedOrder.inn || ''} 
                    onChange={(e) => setSelectedOrder({ ...selectedOrder, inn: e.target.value })}
                    style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
                  />
                </>
              )}

              <div style={{ color: '#94A3B8' }}>Телефон</div>
              <input 
                value={selectedOrder.phone || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, phone: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Марка бетона</div>
              <input 
                value={selectedOrder.grade || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, grade: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Объём</div>
              <input 
                type="number" 
                step="0.01"
                min="0.01"
                value={selectedOrder.volume || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, volume: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Дата доставки</div>
              <input 
                type="date" 
                value={selectedOrder.delivery_date ? selectedOrder.delivery_date.split('T')[0] : ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, delivery_date: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Время доставки</div>
              <input 
                type="time" 
                value={selectedOrder.delivery_time || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, delivery_time: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

                                <div style={{ color: '#94A3B8' }}>Статус заявки</div>
                
                {getStatusConfig(selectedOrder.status).final ? (
                  // ==================== ФИНАЛЬНЫЕ СТАТУСЫ — ЗАЩИЩЕНЫ ====================
                  <div style={{ 
                    backgroundColor: getStatusConfig(selectedOrder.status).bg,
                    color: getStatusConfig(selectedOrder.status).color,
                    padding: '12px 20px',
                    borderRadius: '16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: '600',
                    fontSize: '16px',
                    width: '88%'
                  }}>
                    {getStatusConfig(selectedOrder.status).label} — конечный статус
                  </div>
                ) : (
                  // Можно менять
                  <select 
                    value={selectedOrder.status || 'new'} 
                    onChange={(e) => setSelectedOrder({ ...selectedOrder, status: e.target.value })}
                    style={{ 
                      background: '#334155', 
                      border: 'none', 
                      borderRadius: '8px', 
                      padding: '10px 12px', 
                      color: '#fff',
                      fontSize: '16px',
                      width: '100%'
                    }}
                  >
                    <option value="new">🟡 Новая</option>
                    <option value="processing">🔵 В работе</option>
                    <option value="completed">🟢 Выполнена</option>
                    <option value="cancelled">🔴 Отменена</option>
                  </select>
                )}

              <div style={{ color: '#94A3B8' }}>Адрес доставки</div>
              <textarea 
                value={selectedOrder.address || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, address: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff', minHeight: '70px', gridColumn: '2' }}
              />

            </div>
          </div>

          {/* Комментарий */}
          {selectedOrder.comment && (
            <div style={{ marginTop: '24px' }}>
              <h4 style={{ color: '#94A3B8', marginBottom: '8px' }}>Комментарий клиента</h4>
              <textarea 
                value={selectedOrder.comment} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, comment: e.target.value })}
                style={{ width: '95%', background: '#25334A', border: 'none', borderRadius: '16px', padding: '16px', color: '#fff', minHeight: '80px' }}
              />
            </div>
          )}
        </div>          
              
                            {/* Правая колонка — Маршрут + История */}
              <div>
                <h3 style={{ marginBottom: '20px', color: '#94A3B8' }}>Маршрут доставки</h3>
                
                <div style={{ background: '#25334A', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ color: '#94A3B8', fontSize: '14px' }}>От завода</div>
                    <div style={{ fontWeight: '600' }}>Брянск, Орловский тупик, 6</div>
                  </div>
                  <div>
                    <div style={{ color: '#94A3B8', fontSize: '14px' }}>До объекта</div>
                    <div style={{ fontWeight: '600', fontSize: '18px' }}>{selectedOrder.address}</div>
                  </div>
                </div>

                {/* Компактные кнопки маршрутов в одну строку */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '32px' }}>
                  <a 
                    href={`https://2gis.ru/dir/534687/70000001000000000?from=534687%2C70000001000000000&to=${encodeURIComponent(selectedOrder.address || '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      flex: 1,
                      padding: '12px 16px', 
                      background: '#10B981', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '12px',
                      textDecoration: 'none',
                      fontSize: '15px',
                      fontWeight: '600'
                    }}
                  >
                    2ГИС
                  </a>

                  <a 
                    href={yandexRouteHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      flex: 1,
                      padding: '12px 16px', 
                      background: '#3B82F6', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '12px',
                      textDecoration: 'none',
                      fontSize: '15px',
                      fontWeight: '600'
                    }}
                  >
                    Яндекс
                  </a>

                  <a 
                    href={`https://www.google.com/maps/dir/?api=1&origin=Брянск,+Орловский+тупик,+6&destination=${encodeURIComponent(selectedOrder.address || '')}&travelmode=driving`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      flex: 1,
                      padding: '12px 16px', 
                      background: '#EF4444', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '12px',
                      textDecoration: 'none',
                      fontSize: '15px',
                      fontWeight: '600'
                    }}
                  >
                    Google
                  </a>
                </div>

                                               {/* ==================== ИСТОРИЯ ВЗАИМОДЕЙСТВИЯ ==================== */}
<div>
  <h3 style={{ marginBottom: '12px', color: '#94A3B8' }}>История взаимодействий</h3>
  <div style={{ 
    background: '#25334A', 
    borderRadius: '16px', 
    padding: '20px', 
    height: '340px', 
    overflowY: 'auto',
    fontSize: '14px',
    lineHeight: '1.6'
  }}>
    {userOrders.length > 0 ? (
      userOrders.slice(0, 6).map((o: any) => (
        <div key={o.id} style={{ 
          padding: '14px', 
          background: '#1E2937', 
          borderRadius: '12px', 
          marginBottom: '12px' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>Заказ #{o.id}</strong>
            <span>{new Date(o.delivery_date || o.created_at).toLocaleDateString('ru-RU')}</span>
          </div>
          <div style={{ marginTop: '6px' }}>
            {o.volume} м³ • {o.grade} • 
            <span style={{ 
              color: o.status === 'completed' ? '#10B981' : 
                     o.status === 'cancelled' ? '#EF4444' : '#FACC15' 
            }}>
              {o.status}
            </span>
          </div>
          {o.comment && <div style={{ marginTop: '8px', color: '#94A3B8', fontSize: '13px' }}>{o.comment}</div>}
        </div>
      ))
    ) : (
      <div style={{ color: '#64748B', textAlign: 'center', padding: '80px 0' }}>
        История взаимодействий пуста
      </div>
    )}
  </div>
</div>
              </div>
            </div>
            
        {/* ==================== КНОПКИ ДЕЙСТВИЙ ==================== */}
    <div style={{ marginTop: '40px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>

      { hasManagerPermissions(currentRole) && (
        <>
          {/* Копировать заявку */}
<button 
  onClick={() => duplicateOrder(selectedOrder)}
  style={{ 
    padding: '10px 24px', 
    background: '#6366F1', 
    color: 'white', 
    border: 'none', 
    borderRadius: '9999px', 
    fontWeight: '600',
    fontSize: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  }}
>
  📋 Дублировать заявку
</button>
        </>
      )}

      {/* Отмена */}
      <button 
        onClick={() => setSelectedOrder(null)}
        style={{ 
          padding: '10px 24px', 
          background: '#475569', 
          color: 'white', 
          border: 'none', 
          borderRadius: '9999px', 
          fontWeight: '600',
          fontSize: '15px'
        }}
      >
        Отмена
      </button>
    </div>
    </div>
  </div>
)}





    </div>
  );
}