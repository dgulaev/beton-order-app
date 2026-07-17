'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell 
} from 'recharts';

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

// Кеш данных между переключениями вкладок — не нужно рефетчить каждый раз
let _historyCache: any[] | null = null;

// Вызывается из operator/page.tsx при его монтировании — загружает данные фоново,
// пока пользователь ещё смотрит на вкладку «Заявки». К моменту клика на «Отчёты»
// данные уже в кеше и диаграмма появляется мгновенно без скелетона.
export async function preloadReportsData(): Promise<void> {
  if (_historyCache) return;
  try {
    const res = await fetch('/api/adminCifra/meka-report');
    if (res.ok) {
      _historyCache = await res.json();
    }
  } catch {
    // некритично — при первом заходе просто покажем скелетон
  }
}

export default function ReportsPage() {
  const [history, setHistory] = useState<any[]>(_historyCache || []);
  const [isLoading, setIsLoading] = useState(!_historyCache);
  const [reportData, setReportData] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState<'month' | 'day'>('day');
  const [currentPage, setCurrentPage] = useState(1);
  const [scaleMode, setScaleMode] = useState<'linear' | 'log'>('linear');

  // Список загруженных отчётов не скроллится — вместо этого подстраиваем
  // количество строк на странице под реально доступную высоту (адаптивно
  // под 4K/1920/меньшие экраны), измеряя контейнер списка через ResizeObserver.
  const historyListRef = useRef<HTMLDivElement>(null);
  const [itemsPerPage, setItemsPerPage] = useState(8);

  // Recharts <ResponsiveContainer> ДО первого измерения родителя (через
  // ResizeObserver) держит служебные значения width/height = -1 — и именно в
  // этот момент, на самом первом рендере, печатает предупреждение "width(-1)
  // and height(-1) of chart should be greater than 0..." — это баг самого
  // Recharts (recharts/recharts#6716), возникает всегда при монтировании
  // компонента независимо от готовности раскладки страницы, поэтому просто
  // "подождать кадр" перед рендером не помогает. Официальный обходной путь —
  // передать `initialDimension`, тогда на первом рендере используются эти
  // значения вместо -1, и предупреждение не возникает. Сам график всё равно
  // корректно пересчитается на реальный размер сразу после измерения.
  const CHART_INITIAL_DIMENSION = { width: 400, height: 300 };

  // Подбираем itemsPerPage САМОСХОДЯЩИМСЯ алгоритмом по ФАКТИЧЕСКОМУ (а не
  // предполагаемому по формуле) свободному месту в контейнере — это надёжнее
  // любой формулы-оценки по высоте строки, т.к. учитывает зум браузера,
  // масштабирование экрана (DPI), округление суб-пикселей шрифта (высота
  // строки зависит от font-size: clamp(12px, 0.9vw, 15px)) и другие факторы,
  // из-за которых формула на конкретном экране может немного промахнуться.
  // На каждый проход только ОДНО решение: либо убрать строку (если реально не
  // влезает), либо добавить (если есть место под ещё одну целую строку) —
  // никогда оба сразу и никогда в противоречивые стороны одновременно,
  // поэтому гарантированно сходится к точному значению без "дребезга" туда-сюда,
  // независимо от того, с какого стартового значения начали.
  // Срабатывает на resize контейнера И на появление/удаление строк в DOM
  // (важно: данные истории отчётов подгружаются асинхронно ПОСЛЕ монтирования,
  // и до появления реальных строк измерять и корректировать нечего).
  useEffect(() => {
    const el = historyListRef.current;
    if (!el) return;
    const adjust = () => {
      if (el.clientHeight <= 0) return;
      if (el.scrollHeight > el.clientHeight + 1) {
        setItemsPerPage(prev => (prev > 1 ? prev - 1 : prev));
        return;
      }
      const firstRow = el.firstElementChild as HTMLElement | null;
      if (!firstRow) return;
      const rowHeight = firstRow.getBoundingClientRect().height + 8 /* gap */;
      const freeSpace = el.clientHeight - el.scrollHeight;
      if (freeSpace >= rowHeight) {
        setItemsPerPage(prev => prev + 1);
      }
    };
    adjust();
    const ro = new ResizeObserver(adjust);
    ro.observe(el);
    const mo = new MutationObserver(adjust);
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [itemsPerPage]);

  // ==================== ФИЛЬТР ПО РЕЦЕПТАМ В ТЕКУЩЕМ ОТЧЁТЕ (как в Excel) ====================
  // null = фильтр не применён (показываем все строки, все чекбоксы отмечены).
  // Set (даже пустой) = пользователь явно что-то выбрал/снял.
  const [selectedRecipes, setSelectedRecipes] = useState<Set<string> | null>(null);
  const [recipeFilterOpen, setRecipeFilterOpen] = useState(false);
  const [recipeFilterSearch, setRecipeFilterSearch] = useState('');
  // Координаты списка фильтра считаем от кнопки и рисуем через position:fixed —
  // иначе список зависит от высоты <table>, а <table>/её обёртка держат
  // overflow:hidden (нужно для другого фикса скролла) и "режут" список, когда
  // строк становится мало (например, после "Снять все" таблица сжимается почти
  // до высоты одного заголовка).
  const [recipeFilterPos, setRecipeFilterPos] = useState({ top: 0, left: 0 });
  // У модалки задан transform (центрирование) — по спецификации CSS это делает
  // её "системой координат" для всех потомков с position:fixed (top/left
  // считаются от НЕЁ, а не от экрана). getBoundingClientRect() кнопки всегда
  // возвращает координаты относительно ЭКРАНА, поэтому координаты обязательно
  // нужно пересчитывать относительно модалки — иначе на широких экранах (где
  // модалка сильно смещена от левого края) список фильтра "убегает" вправо на
  // величину этого смещения.
  const modalPanelRef = useRef<HTMLDivElement>(null);
  const modalBodyRef = useRef<HTMLDivElement>(null);

  // Метаданные отчёта, открытого в модалке (для заголовка) — сами строки лежат в reportData
  const [openReportMeta, setOpenReportMeta] = useState<{ fileName: string; dateLabel: string } | null>(null);

  const closeReportModal = () => {
    setReportData([]);
    setOpenReportMeta(null);
    setSelectedRecipes(null);
    setRecipeFilterOpen(false);
  };

  // Закрытие модалки детального отчёта по Escape
  useEffect(() => {
    if (reportData.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReportModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reportData.length]);

  const loadHistory = async (force = false) => {
    // Если данные уже есть в кеше и не форс — показываем мгновенно
    if (_historyCache && !force) {
      setHistory(_historyCache);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/adminCifra/meka-report');
      if (res.ok) {
        const data = await res.json();
        _historyCache = data;
        setHistory(data);
        setCurrentPage(1);
      } else {
        console.error('Ошибка загрузки отчётов');
      }
    } catch (err) {
      console.error('Ошибка fetch:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

    // ==================== ОПРЕДЕЛЕНИЕ РОЛИ ====================
  const [userRole, setUserRole] = useState<string>('manager');

  useEffect(() => {
    const savedRole = localStorage.getItem('userRole');
    if (savedRole) {
      setUserRole(savedRole);
    } else {
      // Запрос к серверу (как в layout и дашборде)
      fetch('/api/user/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: localStorage.getItem('userId') 
        }),
      })
        .then(res => res.json())
        .then(data => {
          const role = data.role || 'manager';
          setUserRole(role);
          localStorage.setItem('userRole', role);
        })
        .catch(() => setUserRole('manager'));
    }
  }, []);

  // ==================== ФИЛЬТРАЦИЯ И ПАГИНАЦИЯ ====================
  const filteredHistory = useMemo(() => {
    return history.filter(report => {
      let excelDate = report.raw_data?.[0]?.date || report.report_date || '';
      let reportDateStr = '';

      if (excelDate.includes('.')) {
        const [day, month, year] = excelDate.split('.');
        reportDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      } else {
        reportDateStr = String(excelDate);
      }

      const matchesSearch = 
        report.file_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        excelDate.includes(searchTerm) ||
        reportDateStr.includes(searchTerm);

      let matchesDate = true;
      if (dateFrom) matchesDate = matchesDate && reportDateStr >= dateFrom;
      if (dateTo) matchesDate = matchesDate && reportDateStr <= dateTo;

      return matchesSearch && matchesDate;
    });
  }, [history, searchTerm, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);

  // itemsPerPage меняется динамически (см. ResizeObserver выше) — не даём
  // currentPage "вылететь" за пределы диапазона после пересчёта. Вычисляем
  // безопасное значение прямо при рендере (без эффекта), а не мутируем state.
  const safeCurrentPage = Math.min(currentPage, Math.max(1, totalPages));

    // ==================== СОРТИРОВКА: ТЕКУЩИЙ МЕСЯЦ СНАЧАЛА ====================
  const sortedHistory = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

    return [...filteredHistory].sort((a, b) => {
      const dateA = a.raw_data?.[0]?.date || a.report_date || '';
      const dateB = b.raw_data?.[0]?.date || b.report_date || '';

      // Получаем YYYY-MM для сравнения месяца
      let monthA = '';
      let monthB = '';

      if (dateA.includes('.')) {
        const [_, m, y] = dateA.split('.');
        monthA = `${y}-${m.padStart(2, '0')}`;
      } else {
        monthA = dateA.substring(0, 7);
      }

      if (dateB.includes('.')) {
        const [_, m, y] = dateB.split('.');
        monthB = `${y}-${m.padStart(2, '0')}`;
      } else {
        monthB = dateB.substring(0, 7);
      }

      const currentMonthKey = `${currentYear}-${currentMonth}`;

      // 1. Отчёты текущего месяца — всегда выше
      if (monthA === currentMonthKey && monthB !== currentMonthKey) return -1;
      if (monthB === currentMonthKey && monthA !== currentMonthKey) return 1;

      // 2. Внутри одного месяца — по убыванию даты
      return dateB.localeCompare(dateA);
    });
  }, [filteredHistory]);

  const currentReports = sortedHistory.slice(
    (safeCurrentPage - 1) * itemsPerPage,
    safeCurrentPage * itemsPerPage
  );

    // ==================== ГРАФИКИ ====================

      // ==================== МЕСЯЧНЫЙ ГРАФИК ====================
      const monthlyVolume = useMemo(() => {
        const groups: any = {};

        filteredHistory.forEach(report => {
          let dateStr = report.raw_data?.[0]?.date || report.report_date || '';
          if (!dateStr) return;

          let monthKey = '';
          if (dateStr.includes('.')) {
            const [_, month, year] = dateStr.split('.');
            monthKey = `${year}-${month.padStart(2, '0')}`;
          } else {
            monthKey = dateStr.substring(0, 7);
          }

          groups[monthKey] = (groups[monthKey] || 0) + (report.total_volume || 0);
        });

        return Object.entries(groups)
          .map(([monthKey, volume]) => ({
            label: monthKey.split('-')[1] + '.' + monthKey.split('-')[0].slice(2),
            value: Math.round(Number(volume) || 0)   // Округление
          }))
          .sort((a, b) => b.label.localeCompare(a.label));
      }, [filteredHistory]);

          // ==================== ДНЕВНОЙ ГРАФИК — С УЛУЧШЕННЫМ TOOLTIP ====================
    const dailyVolume = useMemo(() => {
      const groups: any = {};

      filteredHistory.forEach(report => {
        let dateStr = report.raw_data?.[0]?.date || report.report_date || '';
        if (!dateStr) return;

        let fullDateKey = '';
        if (dateStr.includes('.')) {
          const [day, month, year] = dateStr.split('.');
          fullDateKey = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        } else {
          fullDateKey = dateStr.substring(0, 10);
        }

        groups[fullDateKey] = (groups[fullDateKey] || 0) + (report.total_volume || 0);
      });

      return Object.entries(groups)
        .map(([fullDate, volume]) => {
          const [year, month, day] = fullDate.split('-');
          const label = `${day}.${month}`;

          return {
            label,
            value: Math.round(Number(volume) || 0),   // ← Округляем до целого
            fullDate,
            dateObj: new Date(fullDate)
          };
        })
        .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime())
        .slice(0, 31);
    }, [filteredHistory]);

      // ==================== КАСТОМНЫЙ TOOLTIP ====================
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          background: '#1E2937',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid #475569',
          color: '#fff',
          fontSize: '14px'
        }}>
          <div style={{ marginBottom: '6px', color: '#94A3B8' }}>
            {label} • {payload[0].payload.fullDate}
          </div>
          <div style={{ fontWeight: '700', color: '#10B981' }}>
            {payload[0].value} м³
          </div>
        </div>
      );
    }
    return null;
  };

  // ==================== ТОП РЕЦЕПТОВ ====================
  const topRecipes = useMemo(() => {
    const groups: any = {};
    filteredHistory.forEach(report => {
      report.raw_data?.forEach((row: any) => {
        const recipe = row.recipe || 'Неизвестно';
        if (recipe === 'Неизвестно' || recipe.includes('ИТОГО')) return;
        groups[recipe] = (groups[recipe] || 0) + (row.qty || 0);
      });
    });

    return Object.entries(groups)
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value], index) => ({
        name,
        value: Number(value) || 0,
        fill: COLORS[index % COLORS.length]
      }));
  }, [filteredHistory]);

    // ==================== КАСТОМНЫЙ TOOLTIP ДЛЯ PIE CHART ====================
  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          backgroundColor: '#1E2937',
          padding: '12px 18px',
          borderRadius: '12px',
          border: '1px solid #475569',
          color: '#fff',
          fontSize: '14px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
        }}>
          <div style={{ 
            fontWeight: '700', 
            color: payload[0].fill,
            marginBottom: '4px'
          }}>
            {data.name}
          </div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#10B981' }}>
            {Math.round(data.value)} м³
          </div>
        </div>
      );
    }
    return null;
  };

    // ==================== РАСХОД МАТЕРИАЛОВ (ПЕРЕСТРОЕННЫЕ ДАННЫЕ) ====================
  const materialConsumption = useMemo(() => {
    let cement = 0, sand = 0, gravel = 0, water = 0, additive = 0;

    filteredHistory.forEach(report => {
      const data = report.raw_data || [];
      cement += data.reduce((sum: number, r: any) => sum + (r.cement || 0), 0);
      sand += data.reduce((sum: number, r: any) => sum + (r.sand || 0), 0);
      gravel += data.reduce((sum: number, r: any) => sum + (r.gravel || 0), 0);
      water += data.reduce((sum: number, r: any) => sum + (r.water || 0), 0);
      additive += data.reduce((sum: number, r: any) => sum + (r.additive || 0), 0);
    });

    return [
      { name: "Цемент",   value: Math.round(cement),   fill: "#F59E0B" },
      { name: "Песок",    value: Math.round(sand),     fill: "#3B82F6" },
      { name: "Щебень",   value: Math.round(gravel),   fill: "#10B981" },
      { name: "Вода",     value: Math.round(water),    fill: "#8B5CF6" },
      { name: "Добавка",  value: Math.round(additive), fill: "#EF4444" }
    ];
  }, [filteredHistory]);

           // ==================== TOOLTIP ДЛЯ РАСХОДА МАТЕРИАЛОВ ====================
  const MaterialTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length > 0) {
      const entry = payload[0];

      return (
        <div style={{
          backgroundColor: '#1E2937',
          padding: '14px 20px',
          borderRadius: '12px',
          border: '1px solid #475569',
          color: '#fff',
          fontSize: '15px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          minWidth: '220px'
        }}>
          <div style={{ fontWeight: '700', color: '#94A3B8', marginBottom: '8px' }}>
            {label}
          </div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            color: entry.fill || '#10B981'
          }}>
            <span style={{ fontWeight: '600' }}>{entry.name}</span>
            <span style={{ fontWeight: '700', fontSize: '17px' }}>
              {Math.round(entry.value).toLocaleString('ru-RU')} кг
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

    // ==================== СТАТИСТИКА ====================
  const stats = useMemo(() => {
    const totalVolume = filteredHistory.reduce((sum, r) => sum + (r.total_volume || 0), 0);
    const totalCement = filteredHistory.reduce((sum, r) => sum + (r.total_cement || 0), 0);
    
    let additive1 = 0;
    let additive2 = 0;

    filteredHistory.forEach(report => {
      const data = report.raw_data || [];
      additive1 += data.reduce((sum: number, r: any) => sum + (r.additive || 0), 0);
      additive2 += data.reduce((sum: number, r: any) => sum + (r.additive2 || 0), 0);
    });

    return {
      reports: filteredHistory.length,
      volume: totalVolume.toFixed(1),
      cement: (totalCement / 1000).toFixed(1),
      additive1: Math.round(additive1),
      additive2: Math.round(additive2),
    };
  }, [filteredHistory]);

  // ==================== СПИСОК РЕЦЕПТОВ В ОТКРЫТОМ ОТЧЁТЕ (для фильтра в шапке) ====================
  const availableRecipes = useMemo(() => {
    const counts = new Map<string, number>();
    reportData.forEach(row => {
      counts.set(row.recipe, (counts.get(row.recipe) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [reportData]);

  // Строки текущего отчёта после применения фильтра по рецептам
  const filteredReportData = useMemo(() => {
    if (selectedRecipes === null) return reportData;
    return reportData.filter(row => selectedRecipes.has(row.recipe));
  }, [reportData, selectedRecipes]);





  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      gap: 'clamp(6px, 0.9vh, 14px)'
    }}>
          {/* ==================== СТАТИСТИКА СВЕРХУ ====================
              Компактные карточки с адаптивными (clamp) отступами/шрифтом —
              на 4K они крупнее, на маленьких экранах ужимаются, но не скроллятся.
              Кнопка загрузки отчёта перенесена вниз, к шапке "История..." —
              освободившееся место отдано под эти карточки. */}
<div style={{ 
  display: 'grid', 
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
  gap: 'clamp(8px, 1vw, 14px)',
  flexShrink: 0
}}>
  
  {/* Всего отчётов */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '16px', 
    padding: 'clamp(8px, 1.2vh, 16px) clamp(12px, 1.4vw, 20px)' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: 'clamp(11px, 0.9vw, 13.5px)', marginBottom: '4px' }}>Всего отчётов</div>
    <div style={{ fontSize: 'clamp(20px, 2.2vw, 32px)', fontWeight: '700' }}>{stats.reports}</div>
  </div>

  {/* Общий объём */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '16px', 
    padding: 'clamp(8px, 1.2vh, 16px) clamp(12px, 1.4vw, 20px)' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: 'clamp(11px, 0.9vw, 13.5px)', marginBottom: '4px' }}>Общий объём</div>
    <div style={{ fontSize: 'clamp(20px, 2.2vw, 32px)', fontWeight: '700', color: '#10B981' }}>
      {stats.volume} м³
    </div>
  </div>

  {/* Цемент */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '16px', 
    padding: 'clamp(8px, 1.2vh, 16px) clamp(12px, 1.4vw, 20px)' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: 'clamp(11px, 0.9vw, 13.5px)', marginBottom: '4px' }}>Цемент израсходовано</div>
    <div style={{ fontSize: 'clamp(20px, 2.2vw, 32px)', fontWeight: '700', color: '#F59E0B' }}>
      {stats.cement} т
    </div>
  </div>

  {/* Добавка 1 */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '16px', 
    padding: 'clamp(8px, 1.2vh, 16px) clamp(12px, 1.4vw, 20px)' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: 'clamp(11px, 0.9vw, 13.5px)', marginBottom: '4px' }}>Добавка 1 (ПФМ-НЛК)</div>
    <div style={{ fontSize: 'clamp(20px, 2.2vw, 32px)', fontWeight: '700', color: '#8B5CF6' }}>
      {stats.additive1} кг
    </div>
  </div>

  {/* Добавка 2 */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '16px', 
    padding: 'clamp(8px, 1.2vh, 16px) clamp(12px, 1.4vw, 20px)' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: 'clamp(11px, 0.9vw, 13.5px)', marginBottom: '4px' }}>Добавка 2 (Линомикс)</div>
    <div style={{ fontSize: 'clamp(20px, 2.2vw, 32px)', fontWeight: '700', color: '#EC4899' }}>
      {stats.additive2} кг
    </div>
  </div>

</div>

          {/* Фильтры */}
          <div style={{ display: 'flex', gap: 'clamp(8px, 1vw, 16px)', flexWrap: 'wrap', alignItems: 'end', flexShrink: 0 }}>
            <div>
              <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '4px' }}>Поиск</div>
              <input 
                type="text" 
                placeholder="Имя файла или дата..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: 'clamp(8px, 1vh, 14px) 20px',
                  backgroundColor: '#1E2937',
                  border: 'none',
                  borderRadius: '9999px',
                  color: 'white',
                  width: 'clamp(220px, 22vw, 340px)',
                  fontSize: '14px'
                }}
              />
            </div>

            <div>
              <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '4px' }}>С даты</div>
              <input 
                type="date" 
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{
                  padding: 'clamp(8px, 1vh, 14px) 20px',
                  backgroundColor: '#1E2937',
                  border: 'none',
                  borderRadius: '9999px',
                  color: 'white',
                  fontSize: '14px'
                }}
              />
            </div>

            <div>
              <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '4px' }}>По дату</div>
              <input 
                type="date" 
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{
                  padding: 'clamp(8px, 1vh, 14px) 20px',
                  backgroundColor: '#1E2937',
                  border: 'none',
                  borderRadius: '9999px',
                  color: 'white',
                  fontSize: '14px'
                }}
              />
            </div>

            <button 
              onClick={() => { setSearchTerm(''); setDateFrom(''); setDateTo(''); }}
              style={{ 
                padding: 'clamp(8px, 1vh, 14px) 28px', 
                borderRadius: '9999px', 
                backgroundColor: '#334155', 
                border: 'none', 
                color: 'white', 
                cursor: 'pointer'
              }}
            >
              Сбросить
            </button>
          </div>

         {/* Графики + история — общий flex:1 контейнер. Так сумма высот ВСЕГДА
             равна реально доступному месту (какое бы оно ни было на конкретном
             разрешении/с любой шапкой/баннерами над этим блоком) — переполнение
             и обрезка снизу структурно невозможны. Графики предпочитают свою
             высоту (flexBasis), но готовы сжаться (flexShrink:1), если места
             мало; история забирает весь остаток (flex:1) и сама решает, сколько
             строк показать (см. ResizeObserver у historyListRef). */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: 'clamp(6px, 0.9vh, 14px)' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'clamp(8px, 1vw, 16px)',
            flex: '0 1 clamp(200px, 27vh, 320px)',
            minHeight: 0
          }}>

                     {/* 1. Объём производства — с переключением */}
            <div style={{ backgroundColor: '#1E2937', padding: 'clamp(10px, 1.4vh, 18px)', borderRadius: '16px', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexShrink: 0 }}>
                <h3 style={{ color: '#E2E8F0', margin: 0, fontSize: 'clamp(13px, 1vw, 16px)' }}>Объём производства</h3>
                
                <div style={{ display: 'flex', backgroundColor: '#334155', borderRadius: '9999px', padding: '3px' }}>
                  <button
                    onClick={() => setViewMode('month')}
                    style={{
                      padding: '5px 14px',
                      borderRadius: '9999px',
                      backgroundColor: viewMode === 'month' ? '#10B981' : 'transparent',
                      color: viewMode === 'month' ? 'white' : '#94A3B8',
                      border: 'none',
                      fontSize: 'clamp(11px, 0.8vw, 13px)',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    По месяцам
                  </button>
                  <button
                    onClick={() => setViewMode('day')}
                    style={{
                      padding: '5px 14px',
                      borderRadius: '9999px',
                      backgroundColor: viewMode === 'day' ? '#10B981' : 'transparent',
                      color: viewMode === 'day' ? 'white' : '#94A3B8',
                      border: 'none',
                      fontSize: 'clamp(11px, 0.8vw, 13px)',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    По дням
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
                <BarChart 
  data={viewMode === 'month' ? monthlyVolume : dailyVolume}
  barCategoryGap={viewMode === 'month' ? 80 : 18}
>
  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
  <XAxis 
    dataKey="label" 
    stroke="#94A3B8" 
    tickLine={false}
  />
  <YAxis stroke="#94A3B8" />
  
  <Tooltip 
    content={<CustomTooltip />} 
    cursor={false}           // ← Правильное место
  />
  
  <Bar dataKey="value" fill="#10B981" radius={12} />
</BarChart>
              </ResponsiveContainer>
              </div>
            </div>

            {/* ТОП РЕЦЕПТОВ */}
<div style={{ background: '#1E2937', borderRadius: '16px', padding: 'clamp(10px, 1.4vh, 18px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexShrink: 0 }}>
    <h3 style={{ margin: 0, color: '#94A3B8', fontSize: 'clamp(13px, 1vw, 16px)' }}>Топ рецептов</h3>
    {isLoading && (
      <span style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          display: 'inline-block',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          border: '2px solid #334155',
          borderTopColor: '#10B981',
          animation: 'spin 0.8s linear infinite',
        }} />
        Загрузка...
      </span>
    )}
  </div>
  
  <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
    {isLoading && topRecipes.length === 0 ? (
      /* Скелетон — кольцо-заглушка пока грузятся данные */
      <div style={{
        width: 'clamp(100px, 16vh, 180px)',
        height: 'clamp(100px, 16vh, 180px)',
        borderRadius: '50%',
        border: '24px solid #263040',
        borderTopColor: '#1E3A5F',
        animation: 'spin 1.4s linear infinite',
        opacity: 0.6,
      }} />
    ) : (
      <div style={{
        width: '100%',
        height: '100%',
        animation: topRecipes.length > 0
          ? 'chartReveal 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
          : 'none',
        transformOrigin: 'center',
      }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
          <PieChart>
            <Pie
              data={topRecipes}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="82%"
              dataKey="value"
              nameKey="name"
              isAnimationActive={false}
            >
              {topRecipes.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip content={<CustomPieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )}
  </div>

  {/* Легенда в одну строку с переносом */}
  <div style={{ 
    display: 'flex', 
    flexWrap: 'wrap', 
    gap: '6px 16px', 
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 'clamp(11px, 0.8vw, 13px)',
    minHeight: isLoading && topRecipes.length === 0 ? '30px' : 'auto',
  }}>
    {isLoading && topRecipes.length === 0 ? (
      /* Скелетон легенды */
      [0,1,2,3,4,5].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: '#263040' }} />
          <div style={{ width: `${60 + (i % 3) * 20}px`, height: '12px', borderRadius: '4px', background: '#263040' }} />
        </div>
      ))
    ) : (
      topRecipes.map((recipe, index) => (
        <div key={index} style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          whiteSpace: 'nowrap'
        }}>
          <div style={{ 
            width: '12px', 
            height: '12px', 
            backgroundColor: recipe.fill, 
            borderRadius: '3px',
            flexShrink: 0
          }} />
          <div>
            <span style={{ fontWeight: '600' }}>{recipe.name}</span>
            <span style={{ color: '#10B981', marginLeft: '6px', fontWeight: '700' }}>
              {Math.round(recipe.value)} м³
            </span>
          </div>
        </div>
      ))
    )}
  </div>
</div>

         {/* ==================== РАСХОД МАТЕРИАЛОВ С ПЕРЕКЛЮЧАТЕЛЕМ ==================== */}
<div style={{ background: '#1E2937', borderRadius: '16px', padding: 'clamp(10px, 1.4vh, 18px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexShrink: 0 }}>
    <h3 style={{ margin: 0, color: '#94A3B8', fontSize: 'clamp(13px, 1vw, 16px)' }}>Расход материалов</h3>
    
    {/* Красивый переключатель */}
    <div style={{ 
      background: '#25334A', 
      borderRadius: '9999px', 
      padding: '3px', 
      display: 'flex' 
    }}>
      <button 
        onClick={() => setScaleMode('linear')}
        style={{
          padding: '5px 14px',
          borderRadius: '9999px',
          background: scaleMode === 'linear' ? '#10B981' : 'transparent',
          color: scaleMode === 'linear' ? '#fff' : '#94A3B8',
          border: 'none',
          fontWeight: '600',
          fontSize: 'clamp(11px, 0.8vw, 13px)',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        Линейный
      </button>
      <button 
        onClick={() => setScaleMode('log')}
        style={{
          padding: '5px 14px',
          borderRadius: '9999px',
          background: scaleMode === 'log' ? '#10B981' : 'transparent',
          color: scaleMode === 'log' ? '#fff' : '#94A3B8',
          border: 'none',
          fontWeight: '600',
          fontSize: 'clamp(11px, 0.8vw, 13px)',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        Логарифмический
      </button>
    </div>
  </div>
  
  <div style={{ flex: 1, minHeight: 0 }}>
  <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
    <BarChart data={materialConsumption} barCategoryGap={40}>
      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
      <XAxis 
        dataKey="name" 
        stroke="#94A3B8" 
        tickLine={false}
      />
      <YAxis 
        stroke="#94A3B8" 
        scale={scaleMode === 'log' ? "log" : "linear"}
        domain={scaleMode === 'log' ? [1, 'dataMax'] : [0, 'dataMax']}
        tickFormatter={(value) => (value / 1000).toFixed(0) + 'k'}
      />
      
      <Tooltip content={<MaterialTooltip />} cursor={false} />

      <Bar dataKey="value" fill="#10B981" radius={8} />
    </BarChart>
  </ResponsiveContainer>
  </div>

  {/* Легенда */}
  <div style={{ 
    display: 'flex', 
    flexWrap: 'wrap', 
    gap: '6px 16px', 
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 'clamp(11px, 0.8vw, 13px)'
  }}>
    {[
      { color: '#F59E0B', label: 'Цемент' },
      { color: '#3B82F6', label: 'Песок' },
      { color: '#10B981', label: 'Щебень' },
      { color: '#8B5CF6', label: 'Вода' },
      { color: '#EF4444', label: 'Добавка' }
    ].map((item, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '14px', height: '14px', backgroundColor: item.color, borderRadius: '4px' }} />
        <span style={{ fontWeight: '500' }}>{item.label}</span>
      </div>
    ))}
  </div>
</div>
            </div>

                              {/* ====================== ИСТОРИЯ ====================== */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px', flexShrink: 0 }}>
            <h3 style={{ margin: 0, color: '#94A3B8', fontSize: 'clamp(13px, 1vw, 16px)' }}>
              История загруженных отчётов ({filteredHistory.length})
            </h3>

            {/* ====================== КНОПКА ЗАГРУЗКИ НОВОГО ОТЧЕТА ====================== */}
            <label style={{
              color: '#10B981',
              padding: '6px 16px',
              fontWeight: '600',
              fontSize: 'clamp(12px, 0.9vw, 14px)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'transparent',
              border: '1px solid #10B981',
              borderRadius: '9999px',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
             }}>
              Загрузить новый отчёт MEKA (.xls / .xlsx)

              <input
                type="file"
                accept=".xls,.xlsx"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  try {
                    const XLSX = await import('xlsx');
                    const data = await file.arrayBuffer();
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];

                    const jsonData = XLSX.utils.sheet_to_json(sheet, {
                      range: 5,
                      defval: '',
                      blankrows: false
                    });

                    const processed = jsonData.map((row: any) => ({
                      no: row['__EMPTY_3'] || row['NO'] || '-',
                      date: row['__EMPTY_1'] || row['DATE'] || '',
                      time: row['__EMPTY_2'] || '',
                      recipe: row['__EMPTY_4'] || row['RECIPE CODE'] || 'Неизвестно',

                      qty: Number(row['__EMPTY_5'] || 0),
                      sand:    Number(row['__EMPTY_6'] || 0),
                      gravel:  Number(row['__EMPTY_7'] || 0),
                      cement:  Number(row['__EMPTY_12'] || 0),
                      water:   Number(row['__EMPTY_18'] || 0),
                      additive: Number(row['__EMPTY_20'] || 0),     // ПФМ-НЛК
                      additive2: Number(row['__EMPTY_21'] || row['__EMPTY_22'] || 0), // Линомикс
                    })).filter(r => r.qty > 0 && r.qty < 1000 && r.recipe !== 'Неизвестно' && !r.recipe.includes('ИТОГО') && r.no !== '-');

                    const totalVolume = processed.reduce((sum: number, r: any) => sum + r.qty, 0);
                    const totalCement = processed.reduce((sum: number, r: any) => sum + r.cement, 0);

                    // === РАСЧЁТ РАСХОДА ДОБАВОК ===
                    const totalAdditive1 = processed.reduce((sum: number, r: any) => sum + (r.additive || 0), 0);
                    const totalAdditive2 = processed.reduce((sum: number, r: any) => sum + (r.additive2 || 0), 0);

                    // === ИСПРАВЛЕНИЕ ДАТЫ ===
                    let reportDate = processed[0]?.date || '';
                    if (reportDate.includes('.')) {
                      const [day, month, year] = reportDate.split('.');
                      reportDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    }

                    const res = await fetch('/api/adminCifra/meka-report', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        file_name: file.name,
                        report_date: reportDate,
                        total_volume: totalVolume,
                        total_cement: totalCement,
                        raw_data: processed
                      })
                    });

                    if (res.ok) {
                      alert(`✅ Отчёт "${file.name}" успешно загружен!\nПартий: ${processed.length} • Объём: ${totalVolume} м³`);

                      // === АВТОМАТИЧЕСКОЕ СПИСАНИЕ ДОБАВОК ===
                      if (totalAdditive1 > 0 || totalAdditive2 > 0) {
                        try {
                          const resSubtract = await fetch('/api/adminCifra/warehouse/subtract', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              pfmLiters: totalAdditive1,
                              linomixLiters: totalAdditive2
                            })
                          });

                          if (resSubtract.ok) {
                            console.log(`✅ Автоматически списано: ПФМ-НЛК ${totalAdditive1.toFixed(1)} л, Линомикс ${totalAdditive2.toFixed(1)} л`);
                          } else {
                            console.warn('Не удалось списать добавки автоматически');
                          }
                        } catch (err) {
                          console.error('Ошибка при автоматическом списании добавок:', err);
                        }
                      }

                      loadHistory();
                      setReportData(processed);
                    } else {
                      const errorText = await res.text();
                      console.error('Ошибка сервера:', errorText);
                      alert(`Ошибка сохранения:\n${errorText}`);
                    }
                  } catch (err: any) {
                    console.error(err);
                    alert('Ошибка обработки файла');
                  }
                }}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          {/* Пагинация */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexShrink: 0 }}>
              <div style={{ color: '#94A3B8' }}>
                Страница {safeCurrentPage} из {totalPages}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
                  disabled={safeCurrentPage === 1}
                  style={{ 
                    padding: '8px 16px', 
                    borderRadius: '9999px', 
                    backgroundColor: '#334155', 
                    border: 'none', 
                    color: 'white', 
                    cursor: safeCurrentPage === 1 ? 'not-allowed' : 'pointer',
                    opacity: safeCurrentPage === 1 ? 0.5 : 1 
                  }}
                >
                  ← Назад
                </button>
                <button 
                  onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
                  disabled={safeCurrentPage === totalPages}
                  style={{ 
                    padding: '8px 16px', 
                    borderRadius: '9999px', 
                    backgroundColor: '#334155', 
                    border: 'none', 
                    color: 'white', 
                    cursor: safeCurrentPage === totalPages ? 'not-allowed' : 'pointer',
                    opacity: safeCurrentPage === totalPages ? 0.5 : 1 
                  }}
                >
                  Вперёд →
                </button>
              </div>
            </div>
          )}

          {/* Список не скроллится — количество строк (itemsPerPage) подстраивается
              под реально доступную высоту через ResizeObserver на этом контейнере. */}
          <div ref={historyListRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentReports.length > 0 ? currentReports.map((report: any) => (
              <div 
                key={report.id} 
                style={{
                  backgroundColor: '#25334A',
                  padding: '10px 20px',
                  borderRadius: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 'clamp(12px, 0.9vw, 15px)',
                  flexShrink: 0
                }}
              >
                <div>
                  <strong>
                    {(() => {
                      const excelDate = report.raw_data?.[0]?.date || report.report_date || '';
                      if (excelDate && excelDate.includes('.')) return excelDate;
                      const dateStr = excelDate || report.report_date || '';
                      if (!dateStr) return '-';
                      const parts = dateStr.split('-');
                      if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0].slice(2)}`;
                      return dateStr;
                    })()}
                  </strong>
                  <span style={{ color: '#94A3B8', marginLeft: '12px' }}>
                    {report.raw_data?.length || 0} партий • {Math.round(report.total_volume || 0)} м³ • {report.file_name}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button 
                    style={{ backgroundColor: '#10B981', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
                    onClick={() => {
                      const excelDate = report.raw_data?.[0]?.date || report.report_date || '';
                      setReportData(report.raw_data || []);
                      setOpenReportMeta({ fileName: report.file_name, dateLabel: excelDate });
                      setSelectedRecipes(null);
                      setRecipeFilterOpen(false);
                    }}
                  >
                    Открыть
                  </button>
                  <button 
                    style={{ backgroundColor: '#64748B', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
                    onClick={closeReportModal}
                  >
                    Скрыть
                  </button>
                {/* Кнопка Удалить — только для Админа */}
{userRole === 'admin' && (
  <button 
    style={{ 
      backgroundColor: '#EF4444', 
      color: 'white', 
      border: 'none', 
      padding: '6px 16px', 
      borderRadius: '9999px', 
      fontSize: '13px', 
      fontWeight: '600', 
      cursor: 'pointer' 
    }}
    onClick={async () => {
      if (!confirm('Удалить этот отчёт?')) return;

      try {
        console.log(`🗑 Удаляем отчёт #${report.id}`);

        const deleteRes = await fetch(`/api/adminCifra/meka-report?id=${report.id}`, { 
          method: 'DELETE' 
        });

        if (deleteRes.ok) {
          console.log('✅ Отчёт успешно удалён');
          loadHistory();
          alert('✅ Отчёт успешно удалён');
        } else {
          alert('❌ Ошибка при удалении отчёта');
        }
      } catch (err) {
        console.error('❌ Ошибка при удалении:', err);
        alert('Произошла ошибка при удалении');
      }
    }}
  >
    Удалить
  </button>
)}
                </div>
              </div>
            )) : (
              <div style={{ padding: '60px', textAlign: 'center', color: '#64748B', backgroundColor: '#25334A', borderRadius: '16px' }}>
                Отчёты по выбранным фильтрам не найдены
              </div>
            )}
          </div>
          </div>
          </div>

          {/* Текущий отчёт — модальное окно, а не блок в потоке страницы.
              Так исключён сам класс багов с "провалом" колеса мыши во вложенном
              скролл-контейнере: у модалки ровно одна зона вертикального скролла
              (тело модалки), она не зависит от скролла страницы под ней. */}
          {reportData.length > 0 && (
            <>
              <div
                onClick={closeReportModal}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200 }}
              />
              <div
                ref={modalPanelRef}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'fixed',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 201,
                  width: 'min(1240px, 94vw)',
                  // Фиксированная height (а не maxHeight!) обязательна: иначе при пустой
                  // выборке (например, "Снять все" в фильтре рецептов) высота модалки
                  // "сжималась" по контенту почти до нуля и вырезала (overflow: hidden)
                  // абсолютно спозиционированный выпадающий список фильтра — визуально это
                  // выглядело так, будто "марки из фильтра пропадают". Фиксированная высота
                  // также гарантирует, что body модалки всегда получает строго заданную
                  // высоту и скролл внутри неё работает предсказуемо при любом числе строк.
                  height: '86vh',
                  background: '#1E2937',
                  borderRadius: '20px',
                  boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden'
                }}
              >
                {/* Заголовок модалки */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '20px 24px',
                  borderBottom: '1px solid #334155',
                  flexShrink: 0
                }}>
                  <h3 style={{ margin: 0, color: '#10B981', fontSize: '17px' }}>
                    ✅ Отчёт{openReportMeta?.dateLabel ? ` от ${openReportMeta.dateLabel}` : ''} • {filteredReportData.length}
                    {selectedRecipes !== null ? ` из ${reportData.length}` : ''} партий
                    {openReportMeta?.fileName && (
                      <span style={{ color: '#64748B', fontWeight: 400, fontSize: '13px', marginLeft: '10px' }}>
                        {openReportMeta.fileName}
                      </span>
                    )}
                  </h3>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    {selectedRecipes !== null && (
                      <button
                        onClick={() => setSelectedRecipes(null)}
                        style={{
                          fontSize: '12px',
                          fontWeight: '600',
                          color: '#94A3B8',
                          background: '#334155',
                          border: 'none',
                          borderRadius: '9999px',
                          padding: '6px 14px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        ✕ Сбросить фильтр рецептов
                      </button>
                    )}
                    <button
                      onClick={closeReportModal}
                      title="Закрыть (Esc)"
                      style={{
                        background: '#334155',
                        border: 'none',
                        color: '#E2E8F0',
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        fontSize: '16px',
                        cursor: 'pointer',
                        flexShrink: 0
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Тело модалки — единственная зона вертикального скролла */}
                <div
                  ref={modalBodyRef}
                  className="scroll-subtle"
                  onScroll={() => setRecipeFilterOpen(false)}
                  style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}
                >

              {/* overflowY: 'hidden' обязателен — иначе браузер по спецификации CSS
                  автоматически делает overflow-y: auto у этого блока (т.к. задан overflow-x),
                  и он превращается в отдельный вертикальный скролл-контейнер без места для
                  прокрутки, конфликтующий с прокруткой тела модалки выше. Из-за overflow-y:
                  hidden колесо мыши над таблицей не всегда докручивает родителя (зависит от
                  браузера), поэтому дублируем прокрутку вручную через onWheel. */}
              <div
                className="scroll-hidden"
                onWheel={(e) => {
                  e.preventDefault();
                  modalBodyRef.current?.scrollBy({ top: e.deltaY, left: 0 });
                }}
                style={{ overflowX: 'auto', overflowY: 'hidden', borderRadius: '16px' }}
              >
              <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', backgroundColor: '#25334A' }}>
                <thead>
                  <tr style={{ backgroundColor: '#334155' }}>
                    <th style={{ padding: '14px', textAlign: 'left' }}>NO</th>
                    <th style={{ padding: '14px', textAlign: 'left' }}>Дата</th>
                    <th style={{ padding: '14px', textAlign: 'left' }}>Время</th>
                    <th style={{ padding: '14px', textAlign: 'left', position: 'relative' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Рецепт</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            const panelRect = modalPanelRef.current?.getBoundingClientRect();
                            setRecipeFilterPos({
                              top: rect.bottom - (panelRect?.top ?? 0) + 6,
                              left: rect.left - (panelRect?.left ?? 0)
                            });
                            setRecipeFilterSearch('');
                            setRecipeFilterOpen(o => !o);
                          }}
                          title="Фильтр по рецепту"
                          style={{
                            background: selectedRecipes !== null ? '#10B981' : 'transparent',
                            border: 'none',
                            borderRadius: '4px',
                            color: selectedRecipes !== null ? '#fff' : '#94A3B8',
                            cursor: 'pointer',
                            padding: '2px 5px',
                            fontSize: '11px',
                            lineHeight: 1
                          }}
                        >
                          ▼
                        </button>
                      </div>
                    </th>
                    <th style={{ padding: '14px', textAlign: 'right' }}>Объём (м³)</th>
                    <th style={{ padding: '14px', textAlign: 'right' }}>Цемент (кг)</th>
                    <th style={{ padding: '14px', textAlign: 'right' }}>Песок (кг)</th>
                    <th style={{ padding: '14px', textAlign: 'right' }}>Щебень (кг)</th>
                    <th style={{ padding: '14px', textAlign: 'right' }}>Вода (кг)</th>
                    <th style={{ padding: '14px', textAlign: 'right' }}>Добавка</th>
                    <th style={{ padding: '14px', textAlign: 'right' }}>Добавка2</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReportData.map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #334155' }}>
                      <td style={{ padding: '14px' }}>{row.no}</td>
                      <td style={{ padding: '14px' }}>{row.date}</td>
                      <td style={{ padding: '14px' }}>{row.time}</td>
                      <td style={{ padding: '14px', fontWeight: '600' }}>{row.recipe}</td>
                      <td style={{ padding: '14px', textAlign: 'right', color: '#10B981', fontWeight: '600' }}>{Math.round(row.qty)}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{Math.round(row.cement).toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{Math.round(row.sand).toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{Math.round(row.gravel).toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{Math.round(row.water).toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{row.additive.toFixed(3)}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>
                        {row.additive2 > 0 ? row.additive2.toFixed(3) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>

      {/* ИТОГОВАЯ СТРОКА (только одна, считается по отфильтрованным строкам) */}
                <tfoot>
                  <tr style={{ 
                    backgroundColor: '#334155', 
                    fontWeight: '700', 
                    fontSize: '16px',
                    borderTop: '3px solid #10B981'
                  }}>
                    <td style={{ padding: '16px 14px' }} colSpan={4}>
                      <strong>ИТОГО{selectedRecipes !== null ? ' ПО ФИЛЬТРУ' : ' ЗА ДЕНЬ'}</strong>
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right', color: '#10B981' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.qty || 0), 0))} м³
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.cement || 0), 0)).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.sand || 0), 0)).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.gravel || 0), 0)).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.water || 0), 0)).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {filteredReportData.reduce((sum, r) => sum + (r.additive || 0), 0).toFixed(3)} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {filteredReportData.reduce((sum, r) => sum + (r.additive2 || 0), 0).toFixed(3)} кг
                    </td>
                  </tr>
                </tfoot>
              </table>
              </div>
                </div>

                {/* Выпадающий список фильтра рецептов рисуется ЗДЕСЬ — вне таблицы
                    и вне скроллящихся контейнеров (.scroll-hidden/.scroll-subtle).
                    Раньше он был вложен в <th>, и когда фокус попадал на поле
                    поиска (autoFocus), браузер сам скроллил ВСЕХ scroll-предков
                    в DOM-дереве, чтобы "показать" элемент — в т.ч. горизontальный
                    scroll-hidden у таблицы, из-за чего форма визуально "уезжала
                    вправо". Позиция всё равно вычисляется от кнопки (fixed). */}
                {recipeFilterOpen && (
                  <>
                    <div
                      onClick={() => setRecipeFilterOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 210 }}
                    />
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'fixed',
                        top: recipeFilterPos.top,
                        left: recipeFilterPos.left,
                        zIndex: 211,
                        background: '#1E2937',
                        border: '1px solid #475569',
                        borderRadius: '12px',
                        padding: '10px',
                        minWidth: '220px',
                        maxHeight: '320px',
                        overflowY: 'auto',
                        boxShadow: '0 12px 30px rgba(0,0,0,0.6)',
                        fontWeight: '400',
                        fontSize: '14px',
                        textTransform: 'none'
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Поиск рецепта..."
                        value={recipeFilterSearch}
                        onChange={(e) => setRecipeFilterSearch(e.target.value)}
                        autoFocus
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '8px 10px',
                          marginBottom: '8px',
                          background: '#0F172A',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '13px'
                        }}
                      />

                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <button
                          onClick={() => setSelectedRecipes(null)}
                          style={{ flex: 1, padding: '6px', background: '#334155', border: 'none', borderRadius: '6px', color: '#E2E8F0', fontSize: '12px', cursor: 'pointer' }}
                        >
                          Выбрать все
                        </button>
                        <button
                          onClick={() => setSelectedRecipes(new Set())}
                          style={{ flex: 1, padding: '6px', background: '#334155', border: 'none', borderRadius: '6px', color: '#E2E8F0', fontSize: '12px', cursor: 'pointer' }}
                        >
                          Снять все
                        </button>
                      </div>

                      {availableRecipes
                        .filter(r => r.name.toLowerCase().includes(recipeFilterSearch.toLowerCase()))
                        .map(r => {
                          const isChecked = selectedRecipes === null || selectedRecipes.has(r.name);
                          return (
                            <label
                              key={r.name}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', cursor: 'pointer', borderRadius: '6px' }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedRecipes(prev => {
                                    // null значит "все выбраны" — материализуем полный
                                    // список, чтобы можно было снять галку с одного.
                                    const base = prev === null
                                      ? new Set(availableRecipes.map(r2 => r2.name))
                                      : new Set(prev);
                                    if (base.has(r.name)) base.delete(r.name);
                                    else base.add(r.name);
                                    // Если в итоге выбраны все — возвращаемся к "фильтр не применён"
                                    return base.size === availableRecipes.length ? null : base;
                                  });
                                }}
                              />
                              <span style={{ flex: 1 }}>{r.name}</span>
                              <span style={{ color: '#64748B', fontSize: '12px' }}>{r.count}</span>
                            </label>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
    </div>
  );
}