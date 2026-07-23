'use client';

import { useState, useEffect, useRef } from 'react';
import NewOrderModal from '../components/NewOrderModal';
import OrderViewModal from '../components/OrderViewModal';
import CallResultModal from '../components/CallResultModal';
import ModalSelect from '../components/ModalSelect';

import { formatPhoneDisplay, formatPhoneInput } from '@/lib/phone';
import { adminCifraFetch } from '@/lib/adminCifraFetch';
import { Users } from 'lucide-react';
import { CARD_BORDER, CARD_VOLUME_SOFT, modalFieldStyle, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '../cardStyles';
import { appConfirm } from '../components/appDialog';

type ClientsGridFit = { cols: number; rows: number; perPage: number };

// Список: не больше столько строк на странице — быстрее грузится и не лагает
const TABLE_MAX_ROWS = 22;
const TABLE_ROW_GAP = 8;

export default function ClientsPage() {

 // ==================== 1. ОСНОВНЫЕ СОСТОЯНИЯ ====================
  const [profiles, setProfiles] = useState<any[]>([]);
  const [userOrders, setUserOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');        
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Фильтр списка: all | legal | physical — живёт в state, не сбрасывается при пагинации
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'legal' | 'physical'>('all');
  
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  // Сетка/список: сколько элементов влезает в доступную область без скролла
  const listAreaRef = useRef<HTMLDivElement>(null);
  const [gridFit, setGridFit] = useState<ClientsGridFit>({ cols: 4, rows: 3, perPage: 12 });
  // Список: компактные строки, лимит чтобы не тормозить на больших экранах
  const [tablePerPage, setTablePerPage] = useState(12);
  // Высота области списка в layout-пикселях (с учётом transform: scale админки)
  const [listAreaH, setListAreaH] = useState(0);
  const [curators, setCurators] = useState<any[]>([]);
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [clientVolumes, setClientVolumes] = useState<Record<number | string, number>>({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [clientsToMerge, setClientsToMerge] = useState<any[]>([]);
  const [dadataSuggestions, setDadataSuggestions] = useState<any[]>([]);
  const [isLoadingDadata, setIsLoadingDadata] = useState(false);
  // Подсказки ИНН в боковой карточке клиента (отдельно от модалок создания/редактирования)
  const [sideInnSuggestions, setSideInnSuggestions] = useState<any[]>([]);
  const [sideInnLoading, setSideInnLoading] = useState(false);
  const [sideInnSaving, setSideInnSaving] = useState(false);
  const [sideInnManual, setSideInnManual] = useState('');
  // Безопасная смена типа клиента физ ↔ юр в боковой колонке
  const [sideConvertToLegal, setSideConvertToLegal] = useState(false);
  const [sideOrgManual, setSideOrgManual] = useState('');
  const [sideTypeSaving, setSideTypeSaving] = useState(false);
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<string>('admin');
  const [userFullName, setUserFullName] = useState<string>('');
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentUserRole, setCurrentUserRole] = useState<string>('manager');
  const [staffProfiles, setStaffProfiles] = useState<any[]>([]);
  const [isStaffEditModalOpen, setIsStaffEditModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any>(null);
  const [isNewStaff, setIsNewStaff] = useState(false);
  const [staffPasswordInput, setStaffPasswordInput] = useState('');
  const [savingStaff, setSavingStaff] = useState(false);

  // ==================== ИМЕНА ОПЕРАТОРОВ СМЕНЫ (карточка "Оператор") ====================
  // У оператора БСУ одна общая учётка на всех (см. app/adminCifra/operator/page.tsx —
  // переключатель "Смена"), поэтому редактировать здесь нужно не сам логин,
  // а список имён, из которых оператор выбирает себя на странице БСУ.
  // Список хранится в operator_shift_settings.available_names (одна строка).
  const [operatorShiftNames, setOperatorShiftNames] = useState<string[]>([]);
  const [newOperatorNameInput, setNewOperatorNameInput] = useState('');
  const [savingOperatorNames, setSavingOperatorNames] = useState(false);

  // ==================== СТАТИСТИКА ОПЕРАТОРОВ (боковая панель карточки) ====================
  // У "Оператора" одна общая учётка — обычная "статистика куратора" (клиенты,
  // объём продаж) для неё бессмысленна (всегда 0). Показываем вместо неё
  // реальную активность каждого из операторов (Семён/Максим) по данным
  // production_logs.operator_name — см. /api/adminCifra/staff/operator-stats.
  const [operatorStatsData, setOperatorStatsData] = useState<{
    operators: string[];
    today: { name: string; trips: number; volume: number; avgDurationMinutes: number | null }[];
    week: { name: string; trips: number; volume: number; avgDurationMinutes: number | null }[];
    month: { name: string; trips: number; volume: number; avgDurationMinutes: number | null }[];
  } | null>(null);
  const [operatorStatsPeriod, setOperatorStatsPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [operatorStatsLoading, setOperatorStatsLoading] = useState(false);

  // ==================== СТАТИСТИКА ЛАБОРАНТА (боковая панель карточки) ====================
  // У лаборанта, в отличие от оператора БСУ, обычный личный логин — считаем
  // строго по её/его user_id (created_by/changed_by уже заполнены во всех
  // таблицах модуля "Лаборатория"). См. /api/adminCifra/staff/laborant-stats.
  type LaborantPeriodStats = {
    tests: { total: number; pass: number; fail: number; pending: number; passRate: number | null };
    passports: { total: number; concrete: number; mortar: number };
    recipeEdits: number;
  };
  const [laborantStatsData, setLaborantStatsData] = useState<{
    today: LaborantPeriodStats;
    week: LaborantPeriodStats;
    month: LaborantPeriodStats;
  } | null>(null);
  const [laborantStatsPeriod, setLaborantStatsPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [laborantStatsLoading, setLaborantStatsLoading] = useState(false);

  // ==================== СОСТОЯНИЯ МОДАЛЬНОГО ОКНА ЗВОНКА ====================
  const [showCallModal, setShowCallModal] = useState(false);
  const [callModalClient, setCallModalClient] = useState<any>(null);

  // ==================== ПОИСК — ТОЛЬКО ПО КНОПКЕ ====================
  // debouncedSearch меняется только при явном нажатии кнопки «Найти» или Enter.
  // Никакого автопоиска нет.
  const handleSearch = () => {
    setCurrentPage(1);
    setDebouncedSearch(searchTerm.trim());
  };

    // ==================== ЗАГРУЗКА КУРАТОРОВ ЧЕРЕЗ API ====================
  // Используем API с service role key — клиентский Supabase ограничен RLS
  // и может вернуть пустой список.
  useEffect(() => {
    const loadCurators = async () => {
      try {
        const res = await fetch('/api/adminCifra/staff/stats');
        if (!res.ok) return;
        const data = await res.json();
        const list = (Array.isArray(data) ? data : [])
          .filter((u: any) =>
            ['admin', 'manager', 'dispatcher'].includes((u.role || '').toLowerCase())
          )
          .sort((a: any, b: any) => (a.full_name || '').localeCompare(b.full_name || ''));
        setCurators(list);
        console.log('Кураторы загружены через API:', list.length);
      } catch (error) {
        console.error('Ошибка загрузки кураторов:', error);
      }
    };

    loadCurators();
  }, []);

  // ==================== ПАГИНАЦИЯ ====================
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalClients, setTotalClients] = useState(0);
  // Сколько элементов на странице — из замера доступной области (см. useEffect ниже)
  const itemsPerPage = viewMode === 'table' ? tablePerPage : gridFit.perPage;

  const [activeTab, setActiveTab] = useState<'clients' | 'staff'>('clients');

  // Сколько карточек/строк влезает. Считаем в visual-пикселях (getBoundingClientRect
  // + window.innerHeight) — так корректно учитывается transform: scale админки.
  // Карточки остаются натуральной высоты; лишнее не влезает — на след. страницу.
  useEffect(() => {
    const el = listAreaRef.current;
    if (!el) return;

    const GAP_LAYOUT = 12;
    const MIN_CARD_W_LAYOUT = 260;
    const FALLBACK_CARD_H_VISUAL = activeTab === 'staff' ? 150 : 155;
    const TABLE_HEAD_H_VISUAL = 42;
    const FALLBACK_ROW_H_VISUAL = 38; // компактная однострочная строка списка
    const PAGINATION_RESERVE = 64; // visual px под кнопки страниц

    const compute = () => {
      const rect = el.getBoundingClientRect();
      const layoutW = el.clientWidth;
      if (layoutW < 80 || rect.width < 80) return;

      const scale = layoutW > 0 ? rect.width / layoutW : 1;
      const safeScale = scale > 0.1 ? scale : 1;
      const visualAvail = Math.max(160, window.innerHeight - rect.top - PAGINATION_RESERVE);
      const layoutH = Math.max(160, Math.floor(visualAvail / safeScale));
      setListAreaH((prev) => (prev === layoutH ? prev : layoutH));

      if (viewMode === 'cards') {
        const gapVisual = GAP_LAYOUT * safeScale;
        const cols = Math.max(1, Math.floor((layoutW + GAP_LAYOUT) / (MIN_CARD_W_LAYOUT + GAP_LAYOUT)));

        const firstCard = el.querySelector('[data-client-card]') as HTMLElement | null;
        const cardVisualH = firstCard
          ? firstCard.getBoundingClientRect().height
          : FALLBACK_CARD_H_VISUAL;
        const safeCardH = cardVisualH > 40 ? cardVisualH : FALLBACK_CARD_H_VISUAL;

        // +8px запас, чтобы нижний ряд не обрезался у пагинации
        const rows = Math.max(1, Math.floor((visualAvail + gapVisual) / (safeCardH + gapVisual + 8)));
        const perPage = cols * rows;
        setGridFit((prev) =>
          prev.cols === cols && prev.rows === rows && prev.perPage === perPage
            ? prev
            : { cols, rows, perPage }
        );
      } else {
        // Список: фиксированная компактная высота строки (не ждём DOM) —
        // быстрее и стабильнее на разных разрешениях. Потолок TABLE_MAX_ROWS.
        const gapV = TABLE_ROW_GAP * safeScale;
        const headV = TABLE_HEAD_H_VISUAL;
        const rowV = FALLBACK_ROW_H_VISUAL;
        const fit = Math.floor((visualAvail - headV + gapV) / (rowV + gapV));
        const tableRows = Math.max(8, Math.min(TABLE_MAX_ROWS, fit));
        setTablePerPage((prev) => (prev === tableRows ? prev : tableRows));
      }
    };

    compute();
    const t1 = setTimeout(compute, 60);
    const t2 = setTimeout(compute, 300);
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // loading: пока «Загрузка CRM…», listArea ещё не в DOM — ref=null.
    // После загрузки нужно пересчитать cols/rows/perPage.
  }, [viewMode, activeTab, loading]);
  
  // Новое состояние для формы создания клиента
  const [newClientForm, setNewClientForm] = useState({
    type: 'legal' as 'legal' | 'physical',
    full_name: '',
    organization_name: '',
    phone: '+7',
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
      if (clientTypeFilter && clientTypeFilter !== 'all') {
        url += `&clientType=${encodeURIComponent(clientTypeFilter)}`;
      }

      // Список клиентов — только grouped. Стафф грузится отдельно через /staff/stats.
      if (activeTab === 'staff') {
        setLoading(false);
        return;
      }

      const res = await adminCifraFetch(url);

      if (res.ok) {
        const data = await res.json();
        setProfiles(data.clients || data.groups || data);
        setTotalPages(data.totalPages || 1);
        setTotalClients(data.total || 0);
      } else if (res.status === 403) {
        console.error('❌ Нет доступа к списку клиентов');
      }
    } catch (err) {
      console.error('❌ Ошибка загрузки клиентов:', err);
    } finally {
      setLoading(false);
    }
  };

  // Первая загрузка и смена страницы + поиск + фильтр типа клиента
  useEffect(() => {
    fetchClientsPage(currentPage);
  }, [currentPage, debouncedSearch, activeTab, itemsPerPage, clientTypeFilter]);

  // При смене вида отображения (карточки/список) размер страницы меняется —
  // сбрасываем на первую страницу, чтобы не оказаться на "несуществующей" странице.
  useEffect(() => {
    setCurrentPage(1);
  }, [viewMode]);

  // Сразу при входе в «Список» считаем вместимость по окну — не ждём ResizeObserver,
  // иначе один кадр остаётся старый tablePerPage (12) и страница «залипает».
  useEffect(() => {
    if (viewMode !== 'table') return;
    const approxTop = 200; // шапка + поиск + табы (visual)
    const visualAvail = Math.max(200, window.innerHeight - approxTop - 64);
    const rowStep = 38 + TABLE_ROW_GAP; // высота строки + gap
    const fit = Math.floor((visualAvail - 42) / rowStep);
    const next = Math.max(8, Math.min(TABLE_MAX_ROWS, fit));
    setTablePerPage((prev) => (prev === next ? prev : next));
  }, [viewMode]);

  // ==================== 2.0.1 ЗАГРУЗКА ДАННЫХ ДЛЯ ВКЛАДКИ СТАФФ ====================
  // Вынесено в отдельную функцию — вызывается и при переключении на вкладку,
  // и после создания/редактирования сотрудника (чтобы список сразу обновился,
  // без перезагрузки страницы).
  const loadStaffList = () => {
    fetch('/api/adminCifra/staff/stats')
      .then(res => res.json())
      .then(data => {
        let staffList = Array.isArray(data) ? data : [];

        // Фильтр + сортировка с Гостем
        staffList = staffList
          .filter((u: any) => 
            ['admin', 'manager', 'dispatcher', 'operator', 'laborant', 'guest'].includes((u.role || '').toLowerCase())
          )
          .sort((a: any, b: any) => {
            const roleOrder: { [key: string]: number } = {
              admin: 1,
              manager: 2,
              dispatcher: 3,
              operator: 4,
              laborant: 5,
              guest: 6
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
  };

  // ==================== 2.0.2 ИМЕНА ОПЕРАТОРОВ СМЕНЫ ====================
  // Подгружаем при открытии карточки "Оператор" (и при смене роли на "Оператор"
  // прямо в форме) — список общий для всех, поэтому хранится в БД, а не в этой
  // конкретной записи сотрудника.
  useEffect(() => {
    if (!isStaffEditModalOpen || editingStaff?.role !== 'operator') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/adminCifra/operator-shift');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setOperatorShiftNames(Array.isArray(data?.available_names) ? data.available_names : []);
      } catch (err) {
        console.error('Не удалось загрузить список имён операторов:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isStaffEditModalOpen, editingStaff?.role]);

  const saveOperatorShiftNames = async (names: string[]) => {
    setSavingOperatorNames(true);
    try {
      const res = await fetch('/api/adminCifra/operator-shift', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available_names: names }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Не удалось сохранить список имён операторов:', err);
      alert('Не удалось сохранить список операторов — попробуйте ещё раз');
    } finally {
      setSavingOperatorNames(false);
    }
  };

  const addOperatorShiftName = () => {
    const name = newOperatorNameInput.trim();
    if (!name || operatorShiftNames.includes(name)) return;
    const updated = [...operatorShiftNames, name];
    setOperatorShiftNames(updated);
    setNewOperatorNameInput('');
    saveOperatorShiftNames(updated);
  };

  const removeOperatorShiftName = (name: string) => {
    const updated = operatorShiftNames.filter((n) => n !== name);
    setOperatorShiftNames(updated);
    saveOperatorShiftNames(updated);
  };

  // Статистика в боковой панели — грузим при открытии карточки "Оператор"
  // (не путать с эффектом выше, который грузит список имён внутри модалки
  // редактирования — это разные, независимые UI).
  useEffect(() => {
    if (!(selectedProfile?.isStaff && selectedProfile?.role === 'operator')) return;
    let cancelled = false;
    setOperatorStatsLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/adminCifra/staff/operator-stats');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setOperatorStatsData(data);
      } catch (err) {
        console.error('Не удалось загрузить статистику операторов:', err);
      } finally {
        if (!cancelled) setOperatorStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProfile]);

  useEffect(() => {
    if (!(selectedProfile?.isStaff && selectedProfile?.role === 'laborant' && selectedProfile?.user_id)) return;
    let cancelled = false;
    setLaborantStatsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/adminCifra/staff/laborant-stats?userId=${selectedProfile.user_id}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setLaborantStatsData(data);
      } catch (err) {
        console.error('Не удалось загрузить статистику лаборанта:', err);
      } finally {
        if (!cancelled) setLaborantStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProfile]);

  // Подсказка ИНН из DaData — только для юрлиц (есть organization_name), не для физлиц
  useEffect(() => {
    if (!selectedProfile || selectedProfile.isStaff) return;

    const inn = (selectedProfile.inn || selectedProfile.clients?.[0]?.inn || '').trim();
    const orgName = (
      selectedProfile.organization_name ||
      selectedProfile.clients?.[0]?.organization_name ||
      ''
    ).trim();

    setSideInnManual('');
    setSideInnSuggestions([]);
    setSideInnLoading(false);
    setSideConvertToLegal(false);
    setSideOrgManual('');

    if (inn) return;
    // Физлицо: нет названия организации — не предлагаем заполнить ИНН
    if (!orgName || orgName.length < 3) return;

    let cancelled = false;
    setSideInnLoading(true);

    (async () => {
      try {
        const res = await fetch('/api/dadata/party', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: orgName, mode: 'suggest' }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setSideInnSuggestions(data.suggestions || []);
      } catch (err) {
        console.error('Не удалось загрузить подсказки ИНН:', err);
      } finally {
        if (!cancelled) setSideInnLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedProfile]);

  useEffect(() => {
    if (activeTab === 'staff') loadStaffList();
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

  // currentUserRole (гейтит "Добавить сотрудника"/"Сменить пароль"/"Изменить"
  // в вкладке "Стафф") раньше вычислялся отдельно и криво — по хардкод-id
  // "главного" админа и/или последнему значению из localStorage, по
  // умолчанию 'manager'. Из-за этого ЛЮБОЙ реальный админ (кроме одного
  // хардкод-id) не видел admin-только функции. currentRole — настоящая роль
  // из базы (см. loadRoleAndName выше) — теперь считается источником правды.
  useEffect(() => {
    if (currentRole) {
      setCurrentUserRole(currentRole);
      localStorage.setItem('currentUserRole', currentRole);
    }
  }, [currentRole]);


// ==================== 2.0.3 ОБРАБОТКА КЛИКА ПО КАРТОЧКЕ ====================
const handleSelectProfile = async (profile: any) => {
  console.log("🔍 Выбран профиль:", profile);

  let selected = { ...profile };

  if (['admin', 'manager', 'dispatcher', 'operator', 'laborant'].includes((profile.role || '').toLowerCase())) {
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

    // curator_name уже приходит из grouped API — если данных нет,
    // подтягиваем через clients endpoint (service role, без RLS).
    if (mainClient?.user_id && !selected.curator_name) {
      try {
        const res = await adminCifraFetch(`/api/adminCifra/clients?userId=${mainClient.user_id}`);
        if (res.ok) {
          const clientData = await res.json();
          if (clientData?.created_by) {
            // Ищем куратора в уже загруженном списке кураторов
            const curatorRecord = curators.find((c: any) => c.user_id === clientData.created_by);
            const curatorName = curatorRecord?.full_name || null;

            if (curatorName) {
              selected.curator_name = curatorName;
              selected.created_by = clientData.created_by;
              if (selected.clients && selected.clients.length > 0) {
                selected.clients = selected.clients.map((c: any) => ({
                  ...c,
                  curator_name: curatorName,
                  created_by: clientData.created_by,
                }));
              }
            }
          }
        }
      } catch (e) {
        console.error('Ошибка загрузки куратора:', e);
      }
    }
  }

  setSelectedProfile(selected);
};

  // ==================== 2.1 АВТООТКРЫТИЕ КЛИЕНТА ИЗ URL (?openClient=) ====================
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openClientId = params.get('openClient');
    if (!openClientId || profiles.length === 0) return;

    const clientToOpen = profiles.find(
      (p: any) =>
        p.groupId === openClientId ||
        String(p.user_id) === openClientId ||
        String(p.id) === openClientId
    );

    if (clientToOpen) {
      setSelectedProfile(clientToOpen);
      window.history.replaceState({}, '', '/adminCifra/clients');
    }
  }, [profiles]);

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
    const clientIds = group.clients
      .map((c: any) => c.user_id || c.id)
      .filter(Boolean);

    // Параллельные запросы для всех клиентов группы — вместо N+1 последовательных
    const [ordersResults, callsResults] = await Promise.all([
      Promise.all(
        clientIds.map((id: any) =>
          fetch(`/api/adminCifra/client-orders?userId=${id}`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      ),
      Promise.all(
        clientIds.map((id: any) =>
          fetch(`/api/adminCifra/client-calls?clientId=${id}`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      ),
    ]);

    const allOrders = ordersResults.flat();
    const allCalls: any[] = (callsResults.flat() as any[]).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setUserOrders(allOrders);
    setCallHistory(allCalls);

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

          const res = await adminCifraFetch(`/api/adminCifra/clients?userId=${userId}`);
          if (res.ok) {
            const freshClient = await res.json();
            clientsToEdit.push({
              ...freshClient,
              address: freshClient.address || c.address || '',
              phone: freshClient.phone ? formatPhoneInput(freshClient.phone) : '+7',
            });
          } else {
            clientsToEdit.push({
              ...c,
              address: c.address || '',
              phone: c.phone ? formatPhoneInput(c.phone) : '+7',
            });
          }
        }
        console.log(`✏️ Загружена группа (${clientsToEdit.length} клиентов)`);
      } else {
        // Одиночный клиент
        const userId = item.user_id || item.id;
        if (userId) {
          const res = await adminCifraFetch(`/api/adminCifra/clients?userId=${userId}`);
          if (res.ok) {
            const fresh = await res.json();
            clientsToEdit = [{
              ...fresh,
              address: fresh.address || item.address || '',
              phone: fresh.phone ? formatPhoneInput(fresh.phone) : '+7',
            }];
          } else {
            clientsToEdit = [{
              ...item,
              address: item.address || '',
              phone: item.phone ? formatPhoneInput(item.phone) : '+7',
            }];
          }
        } else {
          clientsToEdit = [{
            ...item,
            address: item.address || '',
            phone: item.phone ? formatPhoneInput(item.phone) : '+7',
          }];
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки свежих данных:', err);
      // Fallback
      if (item.groupId && item.clients) {
        clientsToEdit = item.clients.map((c: any) => ({
          ...c,
          address: c.address || '',
          phone: c.phone ? formatPhoneInput(c.phone) : '+7',
        }));
      } else {
        clientsToEdit = [{
          ...item,
          address: item.address || '',
          phone: item.phone ? formatPhoneInput(item.phone) : '+7',
        }];
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

      let okCount = 0;
      const failures: string[] = [];

      for (const [index, client] of editingClient.entries()) {
        const payload = {
          userId: client.user_id || client.id,
          full_name: client.full_name || null,
          organization_name: client.organization_name || null,
          phone: client.phone || null,
          inn: client.inn || null,
          address: client.address || null,
          client_status: client.client_status || null,
          loyalty_score: client.loyalty_score ?? null,
        };

        const res = await adminCifraFetch('/api/adminCifra/clients/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          okCount += 1;
        } else {
          const err = await res.json().catch(() => ({}));
          failures.push(`${payload.userId}: ${err.error || res.status}`);
          console.error(`❌ Ошибка при обновлении ${payload.userId}:`, err);
        }
      }

      if (failures.length === 0) {
        alert(`✅ Сохранено: ${okCount} из ${editingClient.length}`);
        setIsEditModalOpen(false);
        setEditingClient(null);
        window.location.reload();
      } else {
        alert(
          `Сохранено ${okCount} из ${editingClient.length}. Ошибки:\n${failures.join('\n')}`
        );
      }
    } catch (err) {
      console.error('❌ Критическая ошибка сохранения:', err);
      alert('Ошибка при сохранении изменений');
    }
  };

  const getSelectedClientIds = (): number[] => {
    if (!selectedProfile) return [];
    const ids: number[] = [];
    if (Array.isArray(selectedProfile.clients) && selectedProfile.clients.length > 0) {
      selectedProfile.clients.forEach((c: any) => {
        const id = Number(c.user_id || c.id);
        if (Number.isFinite(id)) ids.push(id);
      });
    } else {
      const id = Number(selectedProfile.user_id || selectedProfile.id);
      if (Number.isFinite(id)) ids.push(id);
    }
    return ids;
  };

  const patchSelectedProfileLocally = (patch: Record<string, unknown>) => {
    if (!selectedProfile) return;
    const updatedProfile = {
      ...selectedProfile,
      ...patch,
      clients: selectedProfile.clients
        ? selectedProfile.clients.map((c: any) => ({ ...c, ...patch }))
        : selectedProfile.clients,
    };
    setSelectedProfile(updatedProfile);
    setProfiles((prev) =>
      prev.map((p) => {
        const sameByGroup =
          selectedProfile.groupId != null &&
          p.groupId != null &&
          p.groupId === selectedProfile.groupId;
        const sameByUser =
          selectedProfile.user_id != null &&
          p.user_id != null &&
          String(p.user_id) === String(selectedProfile.user_id);
        return sameByGroup || sameByUser ? { ...p, ...updatedProfile } : p;
      })
    );
  };

  // Сохранить ИНН прямо из боковой карточки (на все контактные записи группы)
  const saveInnFromSidePanel = async (inn: string, organizationName?: string) => {
    if (!selectedProfile || selectedProfile.isStaff) return;
    const cleanInn = String(inn || '').replace(/\D/g, '').slice(0, 12);
    if (cleanInn.length !== 10 && cleanInn.length !== 12) {
      alert('ИНН должен содержать 10 или 12 цифр');
      return;
    }

    const clientIds = getSelectedClientIds();
    if (clientIds.length === 0) {
      alert('Не найден id клиента для сохранения ИНН');
      return;
    }

    setSideInnSaving(true);
    try {
      const failures: string[] = [];
      const orgName = (organizationName || selectedProfile.organization_name || '').trim();
      for (const userId of clientIds) {
        const payload: Record<string, unknown> = { userId, inn: cleanInn };
        if (orgName) payload.organization_name = orgName;

        const res = await adminCifraFetch('/api/adminCifra/clients/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          failures.push(`${userId}: ${err.error || res.status}`);
        }
      }

      if (failures.length > 0) {
        alert(`Не удалось сохранить ИНН:\n${failures.join('\n')}`);
        return;
      }

      const newGroupId = `${cleanInn}_${orgName.toLowerCase().replace(/[^a-zа-я0-9]/g, '')}`;
      patchSelectedProfileLocally({
        inn: cleanInn,
        groupId: newGroupId,
        organization_name: orgName || selectedProfile.organization_name,
      });
      setSideInnSuggestions([]);
      setSideInnManual('');
      setSideConvertToLegal(false);
      setSideOrgManual('');
    } catch (err) {
      console.error(err);
      alert('Ошибка при сохранении ИНН');
    } finally {
      setSideInnSaving(false);
    }
  };

  // Физлицо → юрлицо: нужна организация (ИНН желателен)
  const convertToLegal = async () => {
    if (!selectedProfile || selectedProfile.isStaff) return;
    const orgName = sideOrgManual.trim();
    if (orgName.length < 2) {
      alert('Укажите название организации');
      return;
    }
    const cleanInn = sideInnManual.replace(/\D/g, '').slice(0, 12);
    if (cleanInn && cleanInn.length !== 10 && cleanInn.length !== 12) {
      alert('ИНН должен содержать 10 или 12 цифр, либо оставьте поле пустым');
      return;
    }

    const clientIds = getSelectedClientIds();
    if (clientIds.length === 0) {
      alert('Не найден id клиента');
      return;
    }

    setSideTypeSaving(true);
    try {
      const failures: string[] = [];
      for (const userId of clientIds) {
        const payload: Record<string, unknown> = {
          userId,
          organization_name: orgName,
        };
        if (cleanInn) payload.inn = cleanInn;

        const res = await adminCifraFetch('/api/adminCifra/clients/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          failures.push(`${userId}: ${err.error || res.status}`);
        }
      }
      if (failures.length > 0) {
        alert(`Не удалось сменить тип:\n${failures.join('\n')}`);
        return;
      }

      const primaryId = clientIds[0];
      const newGroupId = cleanInn
        ? `${cleanInn}_${orgName.toLowerCase().replace(/[^a-zа-я0-9]/g, '')}`
        : `no-inn_${primaryId}`;

      patchSelectedProfileLocally({
        organization_name: orgName,
        inn: cleanInn || null,
        groupId: newGroupId,
      });
      setSideConvertToLegal(false);
      setSideOrgManual('');
      setSideInnManual('');
      setSideInnSuggestions([]);
    } catch (err) {
      console.error(err);
      alert('Ошибка при смене типа на юрлицо');
    } finally {
      setSideTypeSaving(false);
    }
  };

  // Юрлицо → физлицо: организация и ИНН очищаются, ФИО сохраняем/подставляем из названия
  const convertToPhysical = async () => {
    if (!selectedProfile || selectedProfile.isStaff) return;

    const orgName = (
      selectedProfile.organization_name ||
      selectedProfile.clients?.[0]?.organization_name ||
      ''
    ).trim();
    const currentInn = (selectedProfile.inn || selectedProfile.clients?.[0]?.inn || '').trim();
    const currentFullName = (
      selectedProfile.full_name ||
      selectedProfile.clients?.[0]?.full_name ||
      ''
    ).trim();

    const ok = await appConfirm(
      `Сделать клиента физическим лицом?\n\n` +
        `Организация${orgName ? ` «${orgName}»` : ''} и ИНН${currentInn ? ` ${currentInn}` : ''} будут очищены.\n` +
        `Телефон, заказы и история звонков сохранятся.`
    );
    if (!ok) return;

    const clientIds = getSelectedClientIds();
    if (clientIds.length === 0) {
      alert('Не найден id клиента');
      return;
    }

    // Если ФИО пустое — сохраняем название организации как ФИО, чтобы не потерять имя в карточке
    const keepFullName = currentFullName || orgName || null;

    setSideTypeSaving(true);
    try {
      const failures: string[] = [];
      for (const userId of clientIds) {
        const res = await adminCifraFetch('/api/adminCifra/clients/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            organization_name: null,
            inn: null,
            full_name: keepFullName,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          failures.push(`${userId}: ${err.error || res.status}`);
        }
      }
      if (failures.length > 0) {
        alert(`Не удалось сменить тип:\n${failures.join('\n')}`);
        return;
      }

      const primaryId = clientIds[0];
      patchSelectedProfileLocally({
        organization_name: null,
        inn: null,
        full_name: keepFullName,
        groupId: `no-inn_${primaryId}`,
      });
      setSideConvertToLegal(false);
      setSideOrgManual('');
      setSideInnManual('');
      setSideInnSuggestions([]);
    } catch (err) {
      console.error(err);
      alert('Ошибка при смене типа на физлицо');
    } finally {
      setSideTypeSaving(false);
    }
  };

    // ==================== 3.0.3 УДАЛЕНИЕ КЛИЕНТА ====================
  const deleteClient = async (clientId: number | string) => {
    if (!(await appConfirm('Вы уверены, что хотите удалить этого клиента?', { variant: 'danger', okLabel: 'Удалить', title: 'Удаление' }))) return;

    try {
      const res = await adminCifraFetch(`/api/adminCifra/clients/delete?userId=${clientId}`, {
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

    const res = await adminCifraFetch('/api/adminCifra/clients', {
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
        phone: '+7',
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
    const res = await adminCifraFetch('/api/adminCifra/clients/duplicates');
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
    try {
      const res = await adminCifraFetch('/api/adminCifra/clients/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUserId: sourceId,
          targetUserId: targetId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Ошибка при объединении: ${err.error || res.status}`);
        return;
      }

      // Убираем влитую запись из модалки без перезагрузки страницы
      const nextGroups = clientsToMerge
        .map((group: any) => ({
          ...group,
          clients: (group.clients || []).filter(
            (c: any) => String(c.user_id) !== String(sourceId)
          ),
        }))
        .filter((group: any) => (group.clients || []).length > 1);

      setClientsToMerge(nextGroups);
      if (nextGroups.length === 0) setShowMergeModal(false);

      // Обновляем список клиентов на фоне
      fetchClientsPage(currentPage);

      // Если в панели был исходный контакт — закрываем / сбрасываем
      if (selectedProfile) {
        const hitSource =
          String(selectedProfile.user_id) === String(sourceId) ||
          selectedProfile.clients?.some((c: any) => String(c.user_id) === String(sourceId));
        if (hitSource) setSelectedProfile(null);
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

// ==================== ОТКРЫТИЕ МОДАЛЬНОГО ОКНА ЗВОНКА ====================
const openCallModal = (client: any) => {
  const mainClient = client?.clients?.[0] || client;
  setCallModalClient({
    ...mainClient,
    phone: mainClient.phone || client?.phones?.[0] || '',
    organization_name: client.organization_name || mainClient.organization_name || '',
    full_name: client.full_name || mainClient.full_name || '',
    _group: client,
  });
  setShowCallModal(true);
};

const handleCallSaved = () => {
  setShowCallModal(false);
  setCallModalClient(null);
  if (selectedProfile) {
    if (selectedProfile.groupId) {
      loadGroupOrders(selectedProfile);
    } else {
      const uid = selectedProfile.user_id || selectedProfile.id;
      if (uid) loadUserOrders(uid);
    }
  }
};

// ==================== ОТКРЫТИЕ МОДАЛКИ РЕДАКТИРОВАНИЯ ЗАКАЗА ====================
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

const hasManagerPermissions = (role: string) => ['admin', 'manager'].includes((role || '').toLowerCase());

// ==================== ДЕЙСТВИЯ С ЗАКАЗОМ ====================
const handleDeleteOrder = async (orderId: number | string) => {
  if (!(await appConfirm(`Удалить заказ #${orderId}?`, { variant: 'danger', okLabel: 'Удалить', title: 'Удаление' }))) return;

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
  ['admin', 'manager', 'dispatcher', 'operator', 'laborant'].includes((item.role || '').toLowerCase())
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

// ==================== ФУНКЦИЯ РЕДАКТИРОВАНИЯ СОТРУДНИКА ====================
const editStaff = (staffMember: any) => {
  setIsNewStaff(false);
  setStaffPasswordInput('');
  setEditingStaff(staffMember);        // новая переменная состояния
  setIsStaffEditModalOpen(true);
};

// ==================== ФУНКЦИЯ СОЗДАНИЯ НОВОГО СОТРУДНИКА ====================
// Раньше единственный способ дать доступ новому сотруднику — сначала попросить
// его зайти на "/" и зарегистрироваться как клиент (телефон+ФИО), а потом найти
// его в списке клиентов и вручную назначить роль/пароль. Теперь админ может
// сразу завести учётку прямо здесь — сотрудник ни разу не открывает публичную
// форму входа, а сразу заходит по телефону+паролю в /adminCifra или /mobile.
const addNewStaff = () => {
  setIsNewStaff(true);
  setStaffPasswordInput('');
  setEditingStaff({ full_name: '', phone: '+7', role: 'manager' });
  setIsStaffEditModalOpen(true);
};

// ==================== СОХРАНЕНИЕ СОТРУДНИКА (СОЗДАНИЕ/РЕДАКТИРОВАНИЕ) ====================
const saveStaff = async () => {
  if (!editingStaff?.full_name || editingStaff.full_name.trim().length < 2) {
    alert('Укажите ФИО сотрудника');
    return;
  }
  if (!editingStaff?.phone || editingStaff.phone.replace(/\D/g, '').length < 11) {
    alert('Укажите корректный номер телефона');
    return;
  }
  if (isNewStaff && staffPasswordInput.length < 6) {
    alert('Укажите пароль (минимум 6 символов) для нового сотрудника');
    return;
  }

  setSavingStaff(true);
  try {
    const res = await fetch('/api/adminCifra/staff', {
      method: isNewStaff ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: editingStaff.user_id,
        fullName: editingStaff.full_name.trim(),
        phone: editingStaff.phone,
        role: editingStaff.role || 'manager',
        password: staffPasswordInput || undefined,
      }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      alert('Ошибка: ' + (data.error || 'Не удалось сохранить сотрудника'));
      return;
    }

    alert(isNewStaff ? '✅ Сотрудник успешно создан' : '✅ Изменения сохранены');
    setIsStaffEditModalOpen(false);
    setEditingStaff(null);
    setStaffPasswordInput('');
    loadStaffList();
  } catch (err) {
    console.error('Ошибка сохранения сотрудника:', err);
    alert('Ошибка соединения с сервером');
  } finally {
    setSavingStaff(false);
  }
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

  if (!(await appConfirm(`Сменить пароль для "${staffMember.full_name}" на:\n\n${newPassword}\n\nВы уверены?`))) {
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
    <div style={{
      background: '#0F172A',
      flex: 1,
      height: '100%',
      minHeight: 0,
      color: '#fff',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <h1 style={{
        fontSize: '26px',
        fontWeight: 700,
        color: '#fff',
        marginTop: 0,
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
      }}>
        <Users size={26} color="#94A3B8" />
        Клиенты CRM
      </h1>

      {/* Табы — единый стиль с оператором/лабораторией */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '48px',
          marginBottom: '14px',
          borderBottom: '1px solid #334155',
          paddingBottom: '8px',
          flexShrink: 0,
        }}
      >
        {[
          { key: 'clients' as const, label: 'Клиенты' },
          { key: 'staff' as const, label: 'Стафф' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '12px 0',
              background: 'transparent',
              border: 'none',
              fontSize: '17px',
              fontWeight: 600,
              color: activeTab === t.key ? '#10B981' : '#64748B',
              cursor: 'pointer',
              position: 'relative',
              transition: 'color 0.2s',
            }}
          >
            {t.label}
            {activeTab === t.key && (
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
        ))}
      </div>

      {/* ====================== ВЕРХНЯЯ ПАНЕЛЬ УПРАВЛЕНИЯ ====================== */}
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0 }}>

  {/* Левая группа — Кнопки действий */}
<div style={{ display: 'flex', gap: '8px' }}>

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

  {/* Кнопка Новый клиент / Новый сотрудник — меняется в зависимости от вкладки */}
  {activeTab === 'clients' && (
    <button 
      onClick={() => {
        setNewClientForm((prev) => ({ ...prev, phone: prev.phone || '+7' }));
        setIsNewClientModalOpen(true);
      }}
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
  )}

  {activeTab === 'staff' && currentUserRole === 'admin' && (
    <button 
      onClick={addNewStaff}
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
      Новый сотрудник
    </button>
  )}

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

{/* ==================== ПОЛЕ ПОИСКА — ТОЛЬКО ПО КНОПКЕ ==================== */}
{activeTab === 'clients' && (
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', marginBottom: '12px', flexShrink: 0 }}>
    <input
      type="text"
      placeholder="Поиск по имени, организации, телефону, ИНН..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
      style={volumeCardSoftStyle({
        flex: 1,
        maxWidth: '680px',
        padding: '12px 16px',
        borderRadius: 12,
        color: '#fff',
        fontSize: '16px',
        outline: 'none',
        ...(debouncedSearch ? {
          border: '1px solid rgba(74,222,128,0.45)',
          boxShadow: `${CARD_VOLUME_SOFT}, 0 0 0 3px rgba(74,222,128,0.12)`,
        } : {}),
      })}
    />
    <button
      onClick={handleSearch}
      style={{
        padding: '12px 28px',
        borderRadius: 12,
        background: 'rgba(74, 222, 128, 0.15)',
        color: '#4ADE80',
        border: '1px solid rgba(74, 222, 128, 0.35)',
        boxShadow: CARD_VOLUME_SOFT,
        fontSize: '16px',
        fontWeight: 700,
        letterSpacing: '0.02em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'filter 0.15s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.12)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
    >
      Найти
    </button>
    {debouncedSearch && (
      <button
        onClick={() => { setSearchTerm(''); setDebouncedSearch(''); setCurrentPage(1); }}
        style={volumeCardSoftStyle({
          padding: '12px 18px',
          borderRadius: 12,
          color: '#94A3B8',
          fontSize: '15px',
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
        })}
        title="Сбросить поиск"
      >
        ✕
      </button>
    )}
  </div>
)}

   {/* ==================== 8. ОТОБРАЖЕНИЕ (КАРТОЧКИ + ТАБЛИЦА) ==================== */}
{(activeTab === 'clients' || activeTab === 'staff') && (
  <div
    ref={listAreaRef}
    style={{
      flex: 1,
      minHeight: 0,
      height: listAreaH > 0 ? listAreaH : undefined,
      maxHeight: listAreaH > 0 ? listAreaH : undefined,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    {viewMode === 'cards' ? (
      /* ==================== КАРТОЧКИ ==================== */
      /* Без 1fr-рядов: карточки натуральной высоты, число на странице
         подгоняется под экран — иначе 2–3 ряда растягиваются в «столбы». */
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: `repeat(${Math.max(gridFit.cols, 1)}, minmax(0, 1fr))`,
        gap: '12px',
        alignContent: 'start',
        width: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}>
        {activeTab === 'staff' ? (
          // ==================== КАРТОЧКИ СОТРУДНИКОВ (НОВАЯ ЛОГИКА) ====================
          staffProfiles.map((person: any) => (
            <div
              key={person.user_id}
              data-client-card
              onClick={() => handleSelectProfile(person)}
              style={volumeCardStyle({
                borderRadius: 18,
                padding: '16px',
                cursor: 'pointer',
                border: selectedProfile?.user_id === person.user_id
                  ? '1px solid rgba(203, 213, 225, 0.42)'
                  : CARD_BORDER,
                minHeight: '150px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              })}
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
              <div style={volumeCardSoftStyle({ borderRadius: 12, padding: '16px' })}>
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
          // ==================== КАРТОЧКИ КЛИЕНТОВ ====================
          // Используем `clients` — это уже отфильтрованный сервером и
          // сгруппированный список. Повторная фильтрация profiles не нужна.
          clients.map((client: any) => {
              const vol = client.total_volume || client.totalVolume || 0;
              const ordersCount = client.total_orders || client.totalOrders || 0;

              return (
                <div
                  key={client.groupId || client.user_id || client.id}
                  data-client-card
                  onClick={() => handleSelectProfile(client)}
                  style={volumeCardStyle({
                    borderRadius: 18,
                    padding: '16px',
                    cursor: 'pointer',
                    border: selectedProfile?.groupId === client.groupId ||
                            selectedProfile?.user_id === client.user_id
                      ? '1px solid rgba(203, 213, 225, 0.42)'
                      : CARD_BORDER,
                    minHeight: '150px',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  })}
                >
                  {/* Верхняя часть — фиксированные высоты, чтобы статистика не прыгала */}
                  <div>
                    <div style={{
                      fontSize: '18px',
                      fontWeight: '700',
                      marginBottom: '6px',
                      lineHeight: 1.3,
                      height: '47px',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as const,
                      overflow: 'hidden',
                    }}>
                      {client.organization_name || client.full_name || client.name || 'Без названия'}
                    </div>
                    <div style={{
                      color: '#94A3B8',
                      fontSize: '13px',
                      marginBottom: '8px',
                      height: '18px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {client.phones?.length
                        ? client.phones.map((p: string) => formatPhoneDisplay(p)).join(' • ')
                        : formatPhoneDisplay(client.phone) || '\u00A0'}
                    </div>

                    {/* Слот куратора всегда на месте — иначе статистика скачет */}
                    <div style={{
                      fontSize: '12.5px',
                      color: '#94A3B8',
                      padding: '5px 8px',
                      background: !client.isStaff && client.curator_name ? 'rgba(51, 65, 85, 0.85)' : 'transparent',
                      borderRadius: '8px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minHeight: '28px',
                      boxSizing: 'border-box',
                      visibility: !client.isStaff && client.curator_name ? 'visible' : 'hidden',
                    }}>
                      👤 Куратор:{' '}
                      <span style={{ color: '#60A5FA', fontWeight: '600' }}>
                        {client.curator_name || '—'}
                      </span>
                    </div>
                  </div>

                  {/* Нижняя часть */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '10px', flexShrink: 0 }}>
                    <div>
                      <div style={{ color: '#60A5FA', fontSize: '22px', fontWeight: '700', lineHeight: 1 }}>
                        {vol.toFixed(1)}
                      </div>
                      <div style={{ color: '#94A3B8', fontSize: '12px' }}>м³ заказано</div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: '#94A3B8' }}>
                        {ordersCount}
                      </div>
                      <div style={{ color: '#94A3B8', fontSize: '12px' }}>заказов</div>
                    </div>
                  </div>
                </div>
              );
            })
        )}
      </div>
        ) : (
      /* ==================== РЕЖИМ ТАБЛИЦЫ ==================== */
      <div style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Шапка таблицы */}
      {activeTab === 'staff' ? (
  <div style={volumeCardSoftStyle({
    display: 'grid',
    gridTemplateColumns: currentUserRole === 'admin'
      ? '2.8fr 160px 1.6fr 1.1fr 130px'
      : '2.8fr 1.6fr 1.1fr 130px',
    padding: '10px 16px',
    borderRadius: 12,
    fontSize: '13px',
    fontWeight: 600,
    color: '#94A3B8',
    flexShrink: 0,
    marginBottom: TABLE_ROW_GAP,
  })}>
    <div>Сотрудник</div>
    {currentUserRole === 'admin' && <div style={{ textAlign: 'center' }}>Пароль</div>}
    <div>Телефон</div>
    <div style={{ textAlign: 'center' }}>Роль</div>
    <div style={{ textAlign: 'center' }}>Изменить</div>
  </div>
) : (

          <div style={volumeCardSoftStyle({
            display: 'grid',
            gridTemplateColumns: 'minmax(160px, 2fr) 110px 120px 100px 90px 110px 70px',
            padding: '8px 16px',
            borderRadius: 12,
            fontSize: '13px',
            fontWeight: 600,
            color: '#94A3B8',
            flexShrink: 0,
            marginBottom: TABLE_ROW_GAP,
            alignItems: 'center',
            gap: 8,
          })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ whiteSpace: 'nowrap' }}>Клиент / Организация</span>
              <div onClick={(e) => e.stopPropagation()}>
                <ModalSelect
                  value={clientTypeFilter}
                  onChange={(v) => {
                    setClientTypeFilter(v as 'all' | 'legal' | 'physical');
                    setCurrentPage(1);
                  }}
                  options={[
                    { value: 'all', label: 'Все', text: 'Все' },
                    { value: 'physical', label: 'Физлицо', text: 'Физлицо' },
                    { value: 'legal', label: 'Юрлицо', text: 'Юрлицо' },
                  ]}
                  minPopupWidth={120}
                  triggerStyle={{
                    padding: '4px 8px',
                    borderRadius: 8,
                    border: '1px solid #475569',
                    background: '#1E2937',
                    color: '#E2E8F0',
                    fontSize: 12,
                    fontWeight: 500,
                    maxWidth: 120,
                  }}
                />
              </div>
            </div>
            <div>ИНН</div>
            <div>Куратор</div>
            <div>Статус</div>
            <div>Объём</div>
            <div title="Средний / последний объём заявки">Ср. / посл.</div>
            <div style={{ textAlign: 'center' }}>Заявки</div>
          </div>
        )}

        {/* Строки — компактные, с gap, число под экран (макс. TABLE_MAX_ROWS) */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: TABLE_ROW_GAP,
        }}>
        {(activeTab === 'staff' ? staffProfiles : clients).map((item: any) => {
          if (activeTab === 'staff') {
  return (
    <div
      key={item.user_id}
      data-client-row
      onClick={() => handleSelectProfile(item)}
      style={volumeCardSoftStyle({
        display: 'grid',
        gridTemplateColumns: currentUserRole === 'admin'
          ? '2.8fr 160px 1.6fr 1.1fr 130px'
          : '2.8fr 1.6fr 1.1fr 130px',
        padding: '6px 14px',
        borderRadius: 10,
        cursor: 'pointer',
        alignItems: 'center',
        opacity: item.role === 'guest' ? 0.92 : 1,
        flexShrink: 0,
        transition: 'filter 0.15s ease',
      })}
      onMouseOver={(e) => {
        e.currentTarget.style.filter = 'brightness(1.08)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.filter = 'none';
      }}
    >
      {/* 1. Сотрудник */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.full_name}</div>
        {item.role === 'guest' && (
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>Демо-доступ</div>
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
              padding: '4px 10px',
              backgroundColor: 'rgba(139, 92, 246, 0.15)',
              color: '#A78BFA',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '8px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Сменить пароль
          </button>
        </div>
      )}

      {/* 3. Телефон */}
      <div style={{ color: '#94A3B8', fontSize: '13px' }}>{formatPhoneDisplay(item.phone)}</div>

      {/* 4. Роль */}
      <div style={{ textAlign: 'center' }}>
        <span style={{ 
          padding: '3px 10px', 
          borderRadius: '9999px', 
          fontSize: '12px', 
          background: item.role === 'admin'
            ? 'rgba(124, 58, 237, 0.18)'
            : item.role === 'guest'
            ? 'rgba(71, 85, 105, 0.35)'
            : 'rgba(51, 65, 85, 0.6)',
          color: item.role === 'admin' ? '#A78BFA'
            : item.role === 'guest' ? '#64748B'
            : '#94A3B8',
          border: `1px solid ${item.role === 'admin' ? 'rgba(167,139,250,0.25)' : 'rgba(100,116,139,0.2)'}`,
          display: 'inline-block',
          fontWeight: 500,
        }}>
          {item.role === 'admin' ? 'Администратор' : 
           item.role === 'dispatcher' ? 'Диспетчер' : 
           item.role === 'operator' ? 'Оператор' : 
           item.role === 'laborant' ? 'Лаборант' : 
           item.role === 'guest' ? 'Гость' : 'Менеджер'}
        </span>
      </div>

      {/* 5. Изменить */}
      <div style={{ textAlign: 'center' }}>
        <button 
          onClick={(e) => { e.stopPropagation(); editStaff(item); }}
          style={{ 
            padding: '4px 12px', 
            background: 'rgba(96, 165, 250, 0.12)',
            border: '1px solid rgba(96, 165, 250, 0.3)',
            borderRadius: '8px', 
            color: '#60A5FA', 
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '12px',
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
            const avgVol = Number(item.avg_volume ?? (ordersCount > 0 ? vol / ordersCount : 0));
            const lastVol = Number(item.last_volume ?? 0);
            let statusText = '❄️ Холодный';
            let statusColor = '#64748B';
            if (vol >= 30 || ordersCount >= 5) { statusText = '🔥 Горячий'; statusColor = '#EF4444'; }
            else if (vol >= 8 || ordersCount >= 2) { statusText = '🌡️ Тёплый'; statusColor = '#F59E0B'; }

            const phoneLine = item.phones?.length
              ? item.phones.map((p: string) => formatPhoneDisplay(p)).join(' • ')
              : formatPhoneDisplay(item.phone);

            return (
              <div
                key={item.groupId || item.user_id}
                data-client-row
                onClick={() => setSelectedProfile(item)}
                style={volumeCardSoftStyle({
                  display: 'grid',
                  gridTemplateColumns: 'minmax(160px, 2fr) 110px 120px 100px 90px 110px 70px',
                  padding: '6px 14px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  alignItems: 'center',
                  flexShrink: 0,
                  minHeight: 0,
                  gap: 8,
                  transition: 'filter 0.15s ease',
                })}
                onMouseOver={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
                onMouseOut={(e) => { e.currentTarget.style.filter = 'none'; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600,
                    fontSize: '14px',
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {item.organization_name || item.full_name || 'Без названия'}
                    {phoneLine ? (
                      <span style={{ color: '#94A3B8', fontWeight: 400, fontSize: '12px' }}>
                        {' · '}{phoneLine}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div style={{ color: '#94A3B8', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.inn || '—'}
                </div>
                <div style={{
                  color: item.curator_name ? '#60A5FA' : '#64748B',
                  fontSize: '13px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {item.curator_name || '—'}
                </div>
                <div style={{ color: statusColor, fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap' }}>{statusText}</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#60A5FA', whiteSpace: 'nowrap' }}>{Number(vol).toFixed(1)}</div>
                <div
                  style={{ fontSize: '13px', color: '#CBD5E1', whiteSpace: 'nowrap' }}
                  title="Средний / последний объём, м³"
                >
                  {ordersCount > 0 ? (
                    <>
                      <span style={{ color: '#94A3B8' }}>{avgVol.toFixed(1)}</span>
                      <span style={{ color: '#64748B' }}> / </span>
                      <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{lastVol.toFixed(1)}</span>
                    </>
                  ) : '—'}
                </div>
                <div style={{ color: '#94A3B8', fontWeight: 500, fontSize: '13px', whiteSpace: 'nowrap', textAlign: 'center' }}>{ordersCount}</div>
              </div>
            );
          }
        })}
        </div>
      </div>
    )}
  </div>
)}

{/* ==================== ПАГИНАЦИЯ — всегда резервируем место, чтобы сетка не прыгала ==================== */}
{activeTab === 'clients' && (
  <div style={{ 
    display: 'flex', 
    justifyContent: 'center', 
    alignItems: 'center', 
    gap: '16px',
    flexShrink: 0,
    height: 56,
    visibility: totalPages > 1 ? 'visible' : 'hidden',
  }}>
    <button 
      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
      disabled={currentPage === 1}
      style={{ padding: '10px 22px', background: currentPage === 1 ? '#334155' : '#1E2937', color: '#fff', border: 'none', borderRadius: '12px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
    >
      ← Назад
    </button>

    <div style={{ fontSize: '17px', fontWeight: '600' }}>
      Страница <span style={{ color: '#10B981' }}>{currentPage}</span> из {totalPages}
    </div>

    <button 
      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
      disabled={currentPage === totalPages}
      style={{ padding: '10px 22px', background: currentPage === totalPages ? '#334155' : '#1E2937', color: '#fff', border: 'none', borderRadius: '12px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
    >
      Вперед →
    </button>
  </div>
)}

     {/* ==================== 9. БОКОВАЯ ПАНЕЛЬ ==================== */}
{selectedProfile && (
  <>
    <div
      onClick={() => setSelectedProfile(null)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999 }}
    />
    {/* ==================== БОКОВАЯ ПАНЕЛЬ ДЛЯ СОТРУДНИКА ==================== */}
{selectedProfile.isStaff ? (
  <div
    onClick={(e) => e.stopPropagation()}
    style={volumeCardStyle({
    position: 'fixed',
    top: 0,
    right: 0,
    width: '760px',
    maxWidth: '100vw',
    height: '100%',
    borderRadius: 0,
    borderLeft: CARD_BORDER,
    borderTop: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    zIndex: 1000,
    overflow: 'auto',
  })} className="scroll-hidden">
    <div style={{ padding: '32px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div>
          <h2 style={{ marginBottom: '4px' }}>{selectedProfile.full_name}</h2>
          <div style={{ color: '#10B981', fontSize: '17px', fontWeight: '600', marginBottom: '4px' }}>
            {selectedProfile.role?.toUpperCase() || 'СОТРУДНИК'}
          </div>
        </div>
        <button 
          onClick={() => setSelectedProfile(null)} 
          style={{ fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8', lineHeight: 1, cursor: 'pointer' }}
        >
          ×
        </button>
      </div>

      {selectedProfile.role === 'operator' ? (
        /* ==================== СТАТИСТИКА ОПЕРАТОРОВ СМЕНЫ ==================== */
        /* Общая учётка на всех (Семён/Максим) — "статистика куратора" здесь
           бессмысленна (клиентов/продаж у оператора нет по определению).
           Вместо неё — реальная активность каждого по данным production_logs. */
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexShrink: 0 }}>
            {([
              { id: 'today', label: 'Сегодня' },
              { id: 'week', label: '7 дней' },
              { id: 'month', label: '30 дней' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setOperatorStatsPeriod(tab.id)}
                style={{
                  padding: '8px 18px',
                  borderRadius: '9999px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  background: operatorStatsPeriod === tab.id ? '#10B981' : '#25334A',
                  color: operatorStatsPeriod === tab.id ? '#0F172A' : '#94A3B8',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {operatorStatsLoading && !operatorStatsData ? (
            <div style={{ color: '#94A3B8', textAlign: 'center', padding: '40px 0' }}>Загрузка…</div>
          ) : (() => {
            const rows = operatorStatsData?.[operatorStatsPeriod] || [];
            const maxVolume = Math.max(1, ...rows.map((r) => r.volume));

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
                {rows.length === 0 && (
                  <div style={{ color: '#64748B', textAlign: 'center', padding: '20px 0' }}>Нет данных за период</div>
                )}
                {rows.map((row) => (
                  <div key={row.name} style={volumeCardSoftStyle({ borderRadius: 16, padding: '18px 20px' })}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                      <div style={{ fontSize: '18px', fontWeight: '700' }}>{row.name}</div>
                      <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                        {row.trips} {row.trips === 1 ? 'рейс' : 'рейсов'}
                      </div>
                    </div>

                    {/* Полоска сравнения объёма относительно лидера периода */}
                    <div style={{ background: '#334155', borderRadius: '9999px', height: '8px', overflow: 'hidden', marginBottom: '12px' }}>
                      <div style={{
                        height: '100%',
                        borderRadius: '9999px',
                        width: `${Math.max(4, Math.round((row.volume / maxVolume) * 100))}%`,
                        background: '#10B981',
                      }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: '700', color: '#60A5FA' }}>{row.volume}</div>
                        <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>м³ отгружено</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: '700', color: '#FBBF24' }}>
                          {row.avgDurationMinutes != null ? `${row.avgDurationMinutes} мин` : '—'}
                        </div>
                        <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>среднее время загрузки</div>
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{ color: '#64748B', fontSize: '12.5px', textAlign: 'center', marginTop: '4px' }}>
                  Учитываются рейсы, оформленные через кнопку «Загружен» — статистика ведётся с момента внедрения атрибуции по оператору смены.
                </div>
              </div>
            );
          })()}
        </div>
      ) : selectedProfile.role === 'laborant' ? (
        /* ==================== СТАТИСТИКА ЛАБОРАНТА ==================== */
        /* У лаборанта личный логин (не общая учётка) — "статистика куратора"
           здесь тоже бессмысленна, у неё нет клиентов. Вместо этого — реальная
           работа по модулю "Лаборатория": испытания, паспорта, рецептуры. */
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexShrink: 0 }}>
            {([
              { id: 'today', label: 'Сегодня' },
              { id: 'week', label: '7 дней' },
              { id: 'month', label: '30 дней' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setLaborantStatsPeriod(tab.id)}
                style={{
                  padding: '8px 18px',
                  borderRadius: '9999px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  background: laborantStatsPeriod === tab.id ? '#10B981' : '#25334A',
                  color: laborantStatsPeriod === tab.id ? '#0F172A' : '#94A3B8',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {laborantStatsLoading && !laborantStatsData ? (
            <div style={{ color: '#94A3B8', textAlign: 'center', padding: '40px 0' }}>Загрузка…</div>
          ) : (() => {
            const stats = laborantStatsData?.[laborantStatsPeriod];
            if (!stats) {
              return <div style={{ color: '#64748B', textAlign: 'center', padding: '20px 0' }}>Нет данных за период</div>;
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Испытания */}
                <div style={volumeCardSoftStyle({ borderRadius: 16, padding: '18px 20px' })}>
                  <div style={{ fontSize: '15px', color: '#94A3B8', marginBottom: '12px' }}>Испытания прочности</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    <div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#60A5FA' }}>{stats.tests.total}</div>
                      <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>проведено</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#34D399' }}>
                        {stats.tests.passRate != null ? `${stats.tests.passRate}%` : '—'}
                      </div>
                      <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>прошли норму</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: stats.tests.fail > 0 ? '#F87171' : '#94A3B8' }}>
                        {stats.tests.fail}
                      </div>
                      <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>не прошли</div>
                    </div>
                  </div>
                </div>

                {/* Паспорта качества */}
                <div style={volumeCardSoftStyle({ borderRadius: 16, padding: '18px 20px' })}>
                  <div style={{ fontSize: '15px', color: '#94A3B8', marginBottom: '12px' }}>Паспорта качества</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    <div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#60A5FA' }}>{stats.passports.total}</div>
                      <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>всего выпущено</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#FBBF24' }}>{stats.passports.concrete}</div>
                      <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>бетон</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#A78BFA' }}>{stats.passports.mortar}</div>
                      <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>раствор</div>
                    </div>
                  </div>
                </div>

                {/* Рецептуры */}
                <div style={volumeCardSoftStyle({
                  borderRadius: 12,
                  padding: '10px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                })}>
                  <div style={{ color: '#94A3B8' }}>Изменений в рецептурах</div>
                  <div style={{ fontSize: '24px', fontWeight: '700' }}>{stats.recipeEdits}</div>
                </div>

                <div style={{ color: '#64748B', fontSize: '12.5px', textAlign: 'center', marginTop: '4px' }}>
                  Испытания, паспорта и правки рецептур из модуля «Лаборатория».
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
      <>
      {/* Основная статистика */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px', flexShrink: 0 }}>
        <div style={volumeCardSoftStyle({ padding: '16px 20px', borderRadius: 16, textAlign: 'center' })}>
          <div style={{ fontSize: '40px', fontWeight: '700', color: '#60A5FA' }}>
            {selectedProfile.clients_count || 0}
          </div>
          <div style={{ color: '#94A3B8', fontSize: '15px' }}>Клиентов на кураторстве</div>
        </div>
        <div style={volumeCardSoftStyle({ padding: '16px 20px', borderRadius: 16, textAlign: 'center' })}>
          <div style={{ fontSize: '40px', fontWeight: '700' }}>
            {selectedProfile.total_volume || 0}
          </div>
          <div style={{ color: '#94A3B8', fontSize: '15px' }}>м³ всего продано</div>
        </div>
      </div>


{/* ==================== БЛОК ЭФФЕКТИВНОСТЬ КУРАТОРА ==================== */}
{selectedProfile.isStaff && (
  <div style={{ marginBottom: '16px', flexShrink: 0 }}>
    <h3 style={{ marginBottom: '10px', color: '#94A3B8', fontSize: '15px' }}>
      Эффективность куратора
    </h3>
    
    <div style={volumeCardSoftStyle({
      borderRadius: 16,
      padding: '16px',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '12px',
    })}>
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
    <div style={volumeCardSoftStyle({
      marginTop: '8px',
      borderRadius: 12,
      padding: '10px 16px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    })}>
      <div style={{ color: '#94A3B8' }}>Привлёк клиентов</div>
      <div style={{ fontSize: '24px', fontWeight: '700' }}>
        {selectedProfile.clients_count || 0}
      </div>
    </div>
  </div>
)}

{/* Список клиентов — растягивается до низа бокового окна */}
{selectedProfile.clients && selectedProfile.clients.length > 0 ? (
  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <h3 style={{ marginBottom: '10px', color: '#94A3B8', flexShrink: 0 }}>
      Клиенты куратора ({selectedProfile.clients.length})
    </h3>
    <div className="scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {selectedProfile.clients.map((client: any) => (
        <div key={client.user_id} style={volumeCardSoftStyle({
          padding: '12px 16px',
          borderRadius: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        })}>
          <div>
            <div style={{ fontWeight: '600' }}>
              {client.organization_name || client.full_name || 'Без названия'}
            </div>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>{formatPhoneDisplay(client.phone)}</div>
          </div>
          <div style={{ color: '#60A5FA', fontWeight: '700', textAlign: 'right' }}>
            {(client.total_volume || 0)} м³
          </div>
        </div>
      ))}
    </div>
  </div>
) : (
  <div style={volumeCardSoftStyle({
    textAlign: 'center',
    padding: '100px 40px',
    color: '#94A3B8',
    borderRadius: 16,
  })}>
    Пока нет клиентов под кураторством
  </div>
)}
      </>
      )}

    </div>
  </div>
) : (
      /* ==================== СТАРАЯ БОКОВАЯ ПАНЕЛЬ ДЛЯ КЛИЕНТОВ (без изменений) ==================== */
  <div
    onClick={(e) => e.stopPropagation()}
    style={volumeCardStyle({
    position: 'fixed',
    top: 0,
    right: 0,
    width: '720px',
    maxWidth: '100vw',
    height: '100%',
    borderRadius: 0,
    borderLeft: CARD_BORDER,
    borderTop: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    zIndex: 1000,
    overflow: 'auto',
  })} className="scroll-hidden">
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
          📞 {selectedProfile.phones.filter(Boolean).map((p: string) => formatPhoneDisplay(p)).join(' • ')}
        </p>
      )}

      {/* Тип клиента + безопасная смена физ ↔ юр */}
      {(() => {
        const profileInn = (selectedProfile.inn || selectedProfile.clients?.[0]?.inn || '').trim();
        const orgName = (
          selectedProfile.organization_name ||
          selectedProfile.clients?.[0]?.organization_name ||
          ''
        ).trim();
        const isLegal = !!(orgName || profileInn);
        const busy = sideInnSaving || sideTypeSaving;

        return (
          <div style={{ marginTop: '16px' }}>
            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
              Тип клиента
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!isLegal) {
                    setSideConvertToLegal(false);
                    return;
                  }
                  convertToPhysical();
                }}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: !isLegal ? '1px solid #3B82F6' : '1px solid #334155',
                  background: !isLegal ? 'rgba(59,130,246,0.2)' : '#25334A',
                  color: !isLegal ? '#93C5FD' : '#94A3B8',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Физлицо
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (isLegal) {
                    setSideConvertToLegal(false);
                    return;
                  }
                  setSideConvertToLegal(true);
                  setSideOrgManual(orgName || '');
                  setSideInnManual(profileInn || '');
                }}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: isLegal ? '1px solid #10B981' : '1px solid #334155',
                  background: isLegal ? 'rgba(16,185,129,0.2)' : '#25334A',
                  color: isLegal ? '#6EE7B7' : '#94A3B8',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Юрлицо
              </button>
            </div>

            {/* Форма: физ → юр */}
            {sideConvertToLegal && !isLegal && (
              <div style={volumeCardSoftStyle({
                marginTop: '12px',
                padding: '16px',
                borderRadius: 14,
              })}>
                <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '12px' }}>
                  Укажите организацию (и ИНН, если есть). Телефон и заказы сохранятся.
                </div>
                <input
                  type="text"
                  placeholder="Название организации *"
                  value={sideOrgManual}
                  disabled={busy}
                  onChange={(e) => setSideOrgManual(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    marginBottom: '10px',
                    background: '#1E2937',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    color: '#fff',
                    fontSize: '15px',
                  }}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="ИНН (необязательно)"
                  value={sideInnManual}
                  disabled={busy}
                  onChange={(e) => setSideInnManual(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    marginBottom: '12px',
                    background: '#1E2937',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    color: '#fff',
                    fontSize: '15px',
                  }}
                />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSideConvertToLegal(false);
                      setSideOrgManual('');
                      setSideInnManual('');
                    }}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: '#334155',
                      color: '#E2E8F0',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: 600,
                      cursor: busy ? 'default' : 'pointer',
                    }}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    disabled={busy || sideOrgManual.trim().length < 2}
                    onClick={() => convertToLegal()}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: busy || sideOrgManual.trim().length < 2 ? '#334155' : '#10B981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: 600,
                      cursor: busy || sideOrgManual.trim().length < 2 ? 'default' : 'pointer',
                    }}
                  >
                    {sideTypeSaving ? 'Сохранение…' : 'Сделать юрлицом'}
                  </button>
                </div>
              </div>
            )}

            {/* ИНН: показать если есть; предложить заполнить — только текущим юрлицам */}
            {profileInn ? (
              <p style={{ color: '#CBD5E1', fontSize: '16px', marginTop: '12px' }}>
                ИНН {profileInn}
              </p>
            ) : isLegal ? (
              <div style={volumeCardSoftStyle({
                marginTop: '12px',
                padding: '16px',
                borderRadius: 14,
              })}>
                <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '10px' }}>
                  ИНН не заполнен
                </div>

                {sideInnLoading && (
                  <div style={{ color: '#64748B', fontSize: '14px', marginBottom: '12px' }}>
                    Ищем организацию в DaData…
                  </div>
                )}

                {!sideInnLoading && sideInnSuggestions.length > 0 && (
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>
                      Предложено из DaData
                    </div>
                    {sideInnSuggestions.map((suggestion: any, index: number) => {
                      const suggestedInn = suggestion?.data?.inn;
                      if (!suggestedInn) return null;
                      const name =
                        suggestion.value ||
                        suggestion.data?.name?.short_with_opf ||
                        suggestion.data?.name?.full_with_opf ||
                        'Организация';
                      return (
                        <div
                          key={`${suggestedInn}-${index}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px',
                            padding: '12px',
                            marginBottom: '8px',
                            background: '#1E2937',
                            borderRadius: '10px',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '15px' }}>{name}</div>
                            <div style={{ color: '#94A3B8', fontSize: '13px', marginTop: '4px' }}>
                              ИНН {suggestedInn}
                              {suggestion.data?.address?.value
                                ? ` • ${suggestion.data.address.value}`
                                : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => saveInnFromSidePanel(suggestedInn, name)}
                            style={{
                              flexShrink: 0,
                              padding: '10px 14px',
                              background: busy ? '#334155' : '#10B981',
                              color: 'white',
                              border: 'none',
                              borderRadius: '10px',
                              fontWeight: 600,
                              cursor: busy ? 'default' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Добавить
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!sideInnLoading && sideInnSuggestions.length === 0 && (
                  <div style={{ color: '#64748B', fontSize: '13px', marginBottom: '12px' }}>
                    Подсказок не найдено — можно ввести ИНН вручную
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="ИНН вручную"
                    value={sideInnManual}
                    disabled={busy}
                    onChange={(e) => setSideInnManual(e.target.value.replace(/\D/g, '').slice(0, 12))}
                    style={{
                      flex: 1,
                      padding: '12px 14px',
                      background: '#1E2937',
                      border: '1px solid #334155',
                      borderRadius: '10px',
                      color: '#fff',
                      fontSize: '15px',
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy || (sideInnManual.length !== 10 && sideInnManual.length !== 12)}
                    onClick={() => saveInnFromSidePanel(sideInnManual)}
                    style={{
                      padding: '12px 16px',
                      background:
                        busy || (sideInnManual.length !== 10 && sideInnManual.length !== 12)
                          ? '#334155'
                          : '#3B82F6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: 600,
                      cursor:
                        busy || (sideInnManual.length !== 10 && sideInnManual.length !== 12)
                          ? 'default'
                          : 'pointer',
                    }}
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })()}

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

{currentRole === 'admin' && (
  <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #334155' }}>
    <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
      Назначить куратора
    </div>
    <ModalSelect
      value={selectedProfile.curator_id ? String(selectedProfile.curator_id) : ''}
      placeholder="Выберите куратора..."
      onChange={async (newCuratorIdStr) => {
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
          const response = await adminCifraFetch('/api/adminCifra/clients/update-curator', {
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

          const picked = curators.find((c: any) => String(c.user_id) === newCuratorIdStr);
          const newCuratorName = picked?.full_name || 'Новый куратор';

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
      style={{ padding: '12px 16px', borderRadius: 10, fontSize: 16 }}
      options={curators.map((curator: any) => ({
        value: String(curator.user_id),
        label: `${curator.full_name} (${curator.role})`,
        text: `${curator.full_name} (${curator.role})`,
      }))}
    />
  </div>
)}

      {/* 9.3 Действия (кнопки) */}
      <div style={{ display: 'flex', gap: '12px', margin: '28px 0', flexWrap: 'wrap' }}>
        <button 
          onClick={() => openCallModal(selectedProfile)}
          style={{ flex: 1, padding: '14px', background: '#10B981', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '600', cursor: 'pointer' }}
        >
          📞 Позвонить
        </button>
        <button 
  onClick={() => {
    // Создаём объект с данными текущего клиента. Карточка клиента —
    // сгруппированный профиль (может объединять несколько контактных
    // записей users с одним ИНН — см. /api/adminCifra/clients/grouped), а
    // организация/ФИО/ИНН надёжнее берутся с уровня группы (там они уже
    // выбраны при группировке), чем с первой попавшейся контактной записи —
    // та могла быть создана только с телефоном, без остальных полей.
    // Адрес группа не агрегирует, поэтому для него ищем среди всех
    // контактных записей клиента первую заполненную.
    const clientsList = selectedProfile?.clients || [];
    const clientData = clientsList[0] || selectedProfile;
    const addressFromContacts = clientsList.find((c: any) => c.address)?.address;
    const organizationName = selectedProfile?.organization_name || clientData?.organization_name || clientData?.organizationName || '';
    const inn = selectedProfile?.inn || clientData?.inn || '';

    setNewOrderData({
      user_id: clientData?.user_id || selectedProfile?.user_id || selectedProfile?.id,
      // Если у клиента есть название организации/ИНН — это юр. лицо, иначе физ.
      // (раньше тип заказчика не передавался, и переключатель в модалке
      // сбрасывался на «Физ. лицо» даже для компаний).
      customerType: (organizationName || inn) ? 'legal' : 'physical',
      organizationName,
      fullName: selectedProfile?.full_name || clientData?.full_name || clientData?.fullName || '',
      phone: clientData?.phone || selectedProfile?.phones?.[0] || '',
      inn,
      address: addressFromContacts || clientData?.address || '',
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

{/* 9.5 Последний контакт */}
<div style={volumeCardSoftStyle({ padding: '16px', borderRadius: 14, marginBottom: '24px' })}>
  <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>
    Последний контакт
  </div>
  <div style={{ fontSize: '19px', fontWeight: '600' }}>
    {selectedProfile.last_contact
      ? new Date(selectedProfile.last_contact).toLocaleDateString('ru-RU', {
          day: 'numeric', month: 'long', year: 'numeric',
        })
      : userOrders.length > 0
        ? new Date(
            Math.max(
              ...userOrders.map((o: any) =>
                new Date(o.delivery_date || o.created_at).getTime()
              )
            )
          ).toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'long', year: 'numeric',
          })
        : '—'}
  </div>
</div>

      {/* ==================== 9.5.1 ПРОГНОЗ СЛЕДУЮЩЕГО ЗАКАЗА + ОБЪЁМ ==================== */}
<div style={volumeCardSoftStyle({
  padding: '20px',
  borderRadius: 16,
  marginBottom: '24px',
  border: '2px solid #F59E0B',
})}>
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
          style={volumeCardSoftStyle({
            padding: '18px',
            borderRadius: 16,
            marginBottom: '12px',
            cursor: 'pointer',
            transition: 'filter 0.2s',
          })}
          onMouseOver={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
          onMouseOut={(e) => { e.currentTarget.style.filter = 'none'; }}
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
        style={volumeCardSoftStyle({
          padding: '14px',
          borderRadius: 12,
          marginBottom: '12px',
        })}
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
  <div
    style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.82)', zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}
    onClick={() => { setIsEditModalOpen(false); setEditingClient(null); }}
  >
    <div
      className="w-full max-w-[720px] max-h-[90vh] overflow-auto mx-auto scroll-hidden"
      style={volumeModalStyle({
        borderRadius: 22, padding: '32px', color: '#fff',
      })}
      onClick={(e) => e.stopPropagation()}
    >
      <h2 style={{ marginBottom: '8px' }}>
        Редактирование {editingClient.length > 1 ? 'группы клиентов' : 'клиента'}
      </h2>

      {editingClient.map((client: any, index: number) => (
        <div key={client.user_id || index} style={volumeCardSoftStyle({
          padding: '24px',
          borderRadius: 16,
          marginBottom: '20px',
        })}>
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
                style={modalFieldStyle({ padding: '12px', borderRadius: 10 })}
              />
            </div>

            {/* Название и ФИО */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Название организации</label>
              <input value={client.organization_name || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].organization_name = e.target.value; setEditingClient(newClients);
              }} style={modalFieldStyle({ padding: '12px', borderRadius: 10 })} />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>ФИО</label>
              <input value={client.full_name || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].full_name = e.target.value; setEditingClient(newClients);
              }} style={modalFieldStyle({ padding: '12px', borderRadius: 10 })} />
            </div>

            {/* Телефон и Адрес */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Телефон</label>
              <input
                type="tel"
                placeholder="+7 (___) ___-__-__"
                value={client.phone || ''}
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].phone = formatPhoneInput(e.target.value);
                  setEditingClient(newClients);
                }}
                style={modalFieldStyle({ padding: '12px', borderRadius: 10 })}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Адрес</label>
              <input value={client.address || ''} onChange={(e) => {
                const newClients = [...editingClient]; newClients[index].address = e.target.value; setEditingClient(newClients);
              }} style={modalFieldStyle({ padding: '12px', borderRadius: 10 })} />
            </div>

            {/* Новые поля из презентации Цифра */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Статус клиента</label>
              <ModalSelect
                value={client.client_status || 'cold'}
                onChange={(client_status) => {
                  const newClients = [...editingClient];
                  newClients[index].client_status = client_status;
                  setEditingClient(newClients);
                }}
                style={{ padding: '12px', borderRadius: 10 }}
                options={[
                  { value: 'cold', label: '❄️ Холодный', text: '❄️ Холодный' },
                  { value: 'warm', label: '🔥 Тёплый', text: '🔥 Тёплый' },
                  { value: 'hot', label: '🔥 Горячий', text: '🔥 Горячий' },
                ]}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Коэффициент лояльности (0-100)</label>
              <input type="number" min="0" max="100" value={client.loyalty_score || 50} 
                onChange={(e) => {
                  const newClients = [...editingClient];
                  newClients[index].loyalty_score = parseInt(e.target.value) || 50;
                  setEditingClient(newClients);
                }}
                style={modalFieldStyle({ padding: '12px', borderRadius: 10 })} />
            </div>

          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
        <button onClick={() => { setIsEditModalOpen(false); setEditingClient(null); }} style={volumeCardSoftStyle({ flex: 1, padding: '16px', borderRadius: 12, color: '#fff', cursor: 'pointer' })}>
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
  <div
    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.82)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={() => { setIsStaffEditModalOpen(false); setEditingStaff(null); setStaffPasswordInput(''); }}
  >
    <div
      className="w-full max-w-[620px] max-h-[90vh] overflow-auto mx-auto scroll-hidden"
      style={volumeModalStyle({ borderRadius: 22, padding: '32px', color: '#fff' })}
      onClick={(e) => e.stopPropagation()}
    >
      <h2 style={{ marginBottom: '24px' }}>{isNewStaff ? 'Новый сотрудник' : 'Редактирование сотрудника'}</h2>

      <div style={{ display: 'grid', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>ФИО</label>
          <input 
            value={editingStaff.full_name || ''} 
            onChange={(e) => setEditingStaff({...editingStaff, full_name: e.target.value})}
            style={modalFieldStyle({ padding: '12px', borderRadius: 10 })} 
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Телефон</label>
          <input 
            type="tel"
            value={editingStaff.phone || ''} 
            onChange={(e) => setEditingStaff({...editingStaff, phone: formatPhoneInput(e.target.value)})}
            placeholder="+7 (___) ___-__-__"
            style={modalFieldStyle({ padding: '12px', borderRadius: 10 })} 
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>Роль</label>
          <ModalSelect
            value={editingStaff.role || 'manager'}
            onChange={(role) => setEditingStaff({ ...editingStaff, role })}
            style={{ padding: '12px', borderRadius: 10 }}
            options={[
              { value: 'admin', label: 'Администратор', text: 'Администратор' },
              { value: 'manager', label: 'Менеджер', text: 'Менеджер' },
              { value: 'dispatcher', label: 'Диспетчер', text: 'Диспетчер' },
              { value: 'operator', label: 'Оператор', text: 'Оператор' },
              { value: 'laborant', label: 'Лаборант', text: 'Лаборант' },
              { value: 'guest', label: 'Гость (демо-доступ)', text: 'Гость (демо-доступ)' },
            ]}
          />
        </div>

        {/* ==================== ИМЕНА ОПЕРАТОРОВ СМЕНЫ ==================== */}
        {/* У "Оператора" одна общая учётка на всех (без личных логинов) — здесь
            редактируется не сам логин, а список имён, из которых оператор
            выбирает себя на странице БСУ (плашка "Смена" в шапке). */}
        {editingStaff.role === 'operator' && (
          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>
              Операторы смены
            </label>
            <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '10px' }}>
              Общая учётка «Операторы» используется несколькими людьми по очереди —
              здесь список имён, из которых оператор выбирает себя на странице БСУ.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              {operatorShiftNames.length === 0 && (
                <div style={{ color: '#64748B', fontSize: '14px' }}>Список пуст</div>
              )}
              {operatorShiftNames.map((name) => (
                <div
                  key={name}
                  style={volumeCardSoftStyle({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 8px 6px 14px',
                    borderRadius: 9999,
                    fontSize: '14px',
                  })}
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeOperatorShiftName(name)}
                    disabled={savingOperatorNames}
                    title={`Удалить «${name}» из списка`}
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: 'none',
                      background: 'rgba(239, 68, 68, 0.18)',
                      color: '#F87171',
                      cursor: savingOperatorNames ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      lineHeight: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={newOperatorNameInput}
                onChange={(e) => setNewOperatorNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOperatorShiftName(); } }}
                placeholder="Имя нового оператора"
                style={modalFieldStyle({ flex: 1, width: 'auto', padding: '10px 12px', borderRadius: 10 })}
              />
              <button
                type="button"
                onClick={addOperatorShiftName}
                disabled={savingOperatorNames || !newOperatorNameInput.trim()}
                style={{
                  padding: '10px 18px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '10px',
                  color: '#10B981',
                  fontWeight: '500',
                  cursor: (savingOperatorNames || !newOperatorNameInput.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                Добавить
              </button>
            </div>
          </div>
        )}

        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: '#94A3B8' }}>
            {isNewStaff ? 'Пароль' : 'Новый пароль (оставьте пустым, чтобы не менять)'}
          </label>
          <input 
            type="text"
            value={staffPasswordInput} 
            onChange={(e) => setStaffPasswordInput(e.target.value)}
            placeholder={isNewStaff ? 'Минимум 6 символов' : '••••••'}
            style={modalFieldStyle({ padding: '12px', borderRadius: 10 })} 
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
        <button 
          onClick={() => { setIsStaffEditModalOpen(false); setEditingStaff(null); setStaffPasswordInput(''); }} 
          style={volumeCardSoftStyle({ flex: 1, padding: '16px', borderRadius: 12, color: '#fff', cursor: 'pointer' })}
        >
          Отмена
        </button>
        <button 
          onClick={saveStaff}
          disabled={savingStaff}
          style={{ flex: 1, padding: '16px', background: savingStaff ? '#475569' : '#10B981', border: 'none', borderRadius: '12px', color: '#fff', fontWeight: '600', cursor: savingStaff ? 'not-allowed' : 'pointer' }}
        >
          {savingStaff ? 'Сохранение...' : 'Сохранить'}
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
    
    
    currentUserName={userFullName || 'Сотрудник'}

    onSuccess={() => {
      setIsNewOrderModalOpen(false);
      setNewOrderData(null);
      setSelectedOrder(null);

      if (selectedProfile?.groupId) {
        loadGroupOrders(selectedProfile);
      } else if (selectedProfile) {
        const uid = selectedProfile.user_id || selectedProfile.id || selectedProfile?.clients?.[0]?.user_id;
        if (uid) loadUserOrders(uid);
      }
    }}
  />
)}


             {/* ==================== МОДАЛЬНОЕ ОКНО ДУБЛЕЙ ==================== */}
{showMergeModal && clientsToMerge.length > 0 && (
  <div
    style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.82)', zIndex: 1400,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}
    onClick={() => setShowMergeModal(false)}
  >
    <div
      className="w-full max-w-[780px] max-h-[88vh] overflow-auto mx-auto scroll-hidden"
      style={volumeModalStyle({
        borderRadius: 22,
        padding: '32px', color: '#fff',
      })}
      onClick={(e) => e.stopPropagation()}
    >
      <h2 style={{ marginBottom: '12px' }}>Группы дублей</h2>
      <p style={{ color: '#94A3B8', marginBottom: '24px' }}>
        Дубли по одному ИНН. Первая запись — целевая: остальные можно влить в неё
        (заказы переносятся, исходная запись удаляется).
      </p>

      {clientsToMerge.map((group: any, idx: number) => {
        const target = group.clients?.[0];
        return (
        <div key={idx} style={volumeCardSoftStyle({
          marginBottom: '24px',
          padding: '20px',
          borderRadius: 16,
        })}>
          <h3 style={{ color: '#FBBF24', marginBottom: '12px' }}>
            {group.inn ? `ИНН: ${group.inn}` : `ФИО: ${group.full_name}`}
          </h3>
          <div style={{ color: '#94A3B8', marginBottom: '12px' }}>
            {group.clients.length} записей
          </div>
          
          {group.clients.map((c: any, i: number) => (
            <div key={i} style={{ 
              padding: '10px 0', 
              borderBottom: i < group.clients.length - 1 ? '1px solid #334155' : 'none',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}>
              <div>
                {c.organization_name || c.full_name} — {formatPhoneDisplay(c.phone)}
                {i === 0 && (
                  <span style={{ marginLeft: 8, color: '#10B981', fontSize: 13 }}>целевая</span>
                )}
              </div>
              {i > 0 && target?.user_id && (
                <button
                  type="button"
                  onClick={() => mergeClients(c.user_id, target.user_id)}
                  style={{
                    padding: '8px 14px',
                    background: '#F59E0B',
                    border: 'none',
                    borderRadius: 10,
                    color: '#0f172a',
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Влить в целевую
                </button>
              )}
            </div>
          ))}
        </div>
        );
      })}

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
  <div
    style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.82)', zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}
    onClick={() => setIsNewClientModalOpen(false)}
  >
    <div
      className="w-full max-w-[540px] max-h-[90vh] overflow-auto mx-auto scroll-hidden"
      style={volumeModalStyle({
        borderRadius: 22, padding: '32px', color: '#fff',
      })}
      onClick={(e) => e.stopPropagation()}
    >
      <h2 style={{ marginBottom: '24px' }}>Новый клиент</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

        {/* Тип клиента */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8' }}>Тип клиента</label>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              type="button" 
              onClick={() => setNewClientForm(p => ({...p, type: 'legal'}))}
              style={newClientForm.type === 'legal'
                ? { flex: 1, padding: '12px', borderRadius: '12px', background: '#3B82F6', color: 'white', border: 'none', cursor: 'pointer' }
                : volumeCardSoftStyle({ flex: 1, padding: '12px', borderRadius: 12, color: 'white', cursor: 'pointer' })}
            >
              Юридическое лицо
            </button>
            <button 
              type="button" 
              onClick={() => setNewClientForm(p => ({...p, type: 'physical'}))}
              style={newClientForm.type === 'physical'
                ? { flex: 1, padding: '12px', borderRadius: '12px', background: '#3B82F6', color: 'white', border: 'none', cursor: 'pointer' }
                : volumeCardSoftStyle({ flex: 1, padding: '12px', borderRadius: 12, color: 'white', cursor: 'pointer' })}
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
            style={modalFieldStyle()}
          />

          {/* Подсказки DaData */}
          {dadataSuggestions.length > 0 && (
            <div style={volumeCardSoftStyle({
              marginTop: '8px',
              maxHeight: '220px',
              overflowY: 'auto',
              borderRadius: 12,
            })}>
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
                    borderBottom: index < dadataSuggestions.length - 1 ? CARD_BORDER : 'none',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(148,163,184,0.12)'}
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
            style={modalFieldStyle()}
          />
        ) : (
          <input 
            placeholder="ФИО полностью *" 
            value={newClientForm.full_name} 
            onChange={(e) => setNewClientForm({...newClientForm, full_name: e.target.value})}
            style={modalFieldStyle()}
          />
        )}

        <input
          type="tel"
          placeholder="+7 (___) ___-__-__"
          value={newClientForm.phone}
          onChange={(e) => setNewClientForm({ ...newClientForm, phone: formatPhoneInput(e.target.value) })}
          style={modalFieldStyle()}
        />

        <input 
          placeholder="Адрес" 
          value={newClientForm.address} 
          onChange={(e) => setNewClientForm({...newClientForm, address: e.target.value})}
          style={modalFieldStyle()}
        />
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
        <button 
          onClick={() => setIsNewClientModalOpen(false)} 
          style={volumeCardSoftStyle({ flex: 1, padding: '16px', borderRadius: 12, color: '#fff', cursor: 'pointer' })}
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


{/* ==================== ПРОСМОТР ЗАЯВКИ (read-only) + ДУБЛИРОВАНИЕ ==================== */}
{selectedOrder && (
  <OrderViewModal
    order={selectedOrder}
    onClose={() => setSelectedOrder(null)}
    onDuplicate={hasManagerPermissions(currentRole) ? duplicateOrder : undefined}
  />
)}






{showCallModal && callModalClient && (
  <CallResultModal
    client={callModalClient}
    onClose={() => {
      setShowCallModal(false);
      setCallModalClient(null);
    }}
    onSaved={handleCallSaved}
    variant="desktop"
  />
)}

    </div>
  );
}