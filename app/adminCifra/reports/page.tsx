'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell 
} from 'recharts';

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

// Кеш данных между переключениями вкладок — не нужно рефетчить каждый раз
let _historyCache: any[] | null = null;

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
  const itemsPerPage = 10;

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
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
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





  return (
    <div style={{ padding: '0 0 24px 0' }}>
      {/* ====================== КНОПКА ЗАГРУЗКИ НОВОГО ОТЧЕТА ====================== */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <label style={{
    color: '#10B981',
    padding: '10px 20px',
    fontWeight: '600',
    fontSize: '15.5px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'transparent',
    border: 'none',
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

          {/* ==================== СТАТИСТИКА СВЕРХУ ==================== */}
<div style={{ 
  display: 'grid', 
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
  gap: '14px',
  marginBottom: '18px'
}}>
  
  {/* Всего отчётов */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '18px', 
    padding: '16px 20px' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: '13.5px', marginBottom: '6px' }}>Всего отчётов</div>
    <div style={{ fontSize: '32px', fontWeight: '700' }}>{stats.reports}</div>
  </div>

  {/* Общий объём */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '18px', 
    padding: '16px 20px' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: '13.5px', marginBottom: '6px' }}>Общий объём</div>
    <div style={{ fontSize: '32px', fontWeight: '700', color: '#10B981' }}>
      {stats.volume} м³
    </div>
  </div>

  {/* Цемент */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '18px', 
    padding: '16px 20px' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: '13.5px', marginBottom: '6px' }}>Цемент израсходовано</div>
    <div style={{ fontSize: '32px', fontWeight: '700', color: '#F59E0B' }}>
      {stats.cement} т
    </div>
  </div>

  {/* Добавка 1 */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '18px', 
    padding: '16px 20px' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: '13.5px', marginBottom: '6px' }}>Добавка 1 (ПФМ-НЛК)</div>
    <div style={{ fontSize: '32px', fontWeight: '700', color: '#8B5CF6' }}>
      {stats.additive1} кг
    </div>
  </div>

  {/* Добавка 2 */}
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '18px', 
    padding: '16px 20px' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: '13.5px', marginBottom: '6px' }}>Добавка 2 (Линомикс)</div>
    <div style={{ fontSize: '32px', fontWeight: '700', color: '#EC4899' }}>
      {stats.additive2} кг
    </div>
  </div>

</div>

          {/* Фильтры */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'end' }}>
            <div>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>Поиск</div>
              <input 
                type="text" 
                placeholder="Имя файла или дата..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: '14px 20px',
                  backgroundColor: '#1E2937',
                  border: 'none',
                  borderRadius: '9999px',
                  color: 'white',
                  width: '340px',
                  fontSize: '16px'
                }}
              />
            </div>

            <div>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>С даты</div>
              <input 
                type="date" 
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{
                  padding: '14px 20px',
                  backgroundColor: '#1E2937',
                  border: 'none',
                  borderRadius: '9999px',
                  color: 'white',
                  fontSize: '16px'
                }}
              />
            </div>

            <div>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>По дату</div>
              <input 
                type="date" 
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{
                  padding: '14px 20px',
                  backgroundColor: '#1E2937',
                  border: 'none',
                  borderRadius: '9999px',
                  color: 'white',
                  fontSize: '16px'
                }}
              />
            </div>

            <button 
              onClick={() => { setSearchTerm(''); setDateFrom(''); setDateTo(''); }}
              style={{ 
                padding: '14px 28px', 
                borderRadius: '9999px', 
                backgroundColor: '#334155', 
                border: 'none', 
                color: 'white', 
                cursor: 'pointer', 
                height: '52px'
              }}
            >
              Сбросить
            </button>
          </div>

         {/* Графики */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '20px' }}>

                     {/* 1. Объём производства — с переключением */}
            <div style={{ backgroundColor: '#1E2937', padding: '18px', borderRadius: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ color: '#E2E8F0' }}>Объём производства</h3>
                
                <div style={{ display: 'flex', backgroundColor: '#334155', borderRadius: '9999px', padding: '4px' }}>
                  <button
                    onClick={() => setViewMode('month')}
                    style={{
                      padding: '8px 24px',
                      borderRadius: '9999px',
                      backgroundColor: viewMode === 'month' ? '#10B981' : 'transparent',
                      color: viewMode === 'month' ? 'white' : '#94A3B8',
                      border: 'none',
                      fontSize: '15px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    По месяцам
                  </button>
                  <button
                    onClick={() => setViewMode('day')}
                    style={{
                      padding: '8px 24px',
                      borderRadius: '9999px',
                      backgroundColor: viewMode === 'day' ? '#10B981' : 'transparent',
                      color: viewMode === 'day' ? 'white' : '#94A3B8',
                      border: 'none',
                      fontSize: '15px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    По дням
                  </button>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={300}>
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

            {/* ТОП РЕЦЕПТОВ */}
<div style={{ background: '#1E2937', borderRadius: '18px', padding: '18px' }}>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
    <h3 style={{ margin: 0, color: '#94A3B8' }}>Топ рецептов</h3>
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
  
  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
    {isLoading && topRecipes.length === 0 ? (
      /* Скелетон — кольцо-заглушка пока грузятся данные */
      <div style={{
        width: '240px',
        height: '240px',
        borderRadius: '50%',
        border: '35px solid #263040',
        borderTopColor: '#1E3A5F',
        animation: 'spin 1.4s linear infinite',
        opacity: 0.6,
      }} />
    ) : (
      <PieChart width={280} height={280}>
        <Pie
          data={topRecipes}
          cx="50%"
          cy="50%"
          innerRadius={85}
          outerRadius={120}
          dataKey="value"
          nameKey="name"
          animationDuration={600}
          animationEasing="ease-out"
          isAnimationActive={true}
        >
          {topRecipes.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip content={<CustomPieTooltip />} />
      </PieChart>
    )}
  </div>

  {/* Легенда в одну строку с переносом */}
  <div style={{ 
    display: 'flex', 
    flexWrap: 'wrap', 
    gap: '14px 24px', 
    justifyContent: 'center',
    marginTop: '12px',
    minHeight: isLoading && topRecipes.length === 0 ? '44px' : 'auto',
  }}>
    {isLoading && topRecipes.length === 0 ? (
      /* Скелетон легенды */
      [0,1,2,3,4,5].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '18px', height: '18px', borderRadius: '4px', background: '#263040' }} />
          <div style={{ width: `${60 + (i % 3) * 20}px`, height: '14px', borderRadius: '4px', background: '#263040' }} />
        </div>
      ))
    ) : (
      topRecipes.map((recipe, index) => (
        <div key={index} style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px',
          whiteSpace: 'nowrap'
        }}>
          <div style={{ 
            width: '18px', 
            height: '18px', 
            backgroundColor: recipe.fill, 
            borderRadius: '4px',
            flexShrink: 0
          }} />
          <div>
            <span style={{ fontWeight: '600' }}>{recipe.name}</span>
            <span style={{ color: '#10B981', marginLeft: '8px', fontWeight: '700' }}>
              {Math.round(recipe.value)} м³
            </span>
          </div>
        </div>
      ))
    )}
  </div>
</div>

         {/* ==================== РАСХОД МАТЕРИАЛОВ С ПЕРЕКЛЮЧАТЕЛЕМ ==================== */}
<div style={{ background: '#1E2937', borderRadius: '18px', padding: '18px' }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
    <h3 style={{ margin: 0, color: '#94A3B8' }}>Расход материалов</h3>
    
    {/* Красивый переключатель */}
    <div style={{ 
      background: '#25334A', 
      borderRadius: '9999px', 
      padding: '4px', 
      display: 'flex' 
    }}>
      <button 
        onClick={() => setScaleMode('linear')}
        style={{
          padding: '8px 20px',
          borderRadius: '9999px',
          background: scaleMode === 'linear' ? '#10B981' : 'transparent',
          color: scaleMode === 'linear' ? '#fff' : '#94A3B8',
          border: 'none',
          fontWeight: '600',
          fontSize: '14px',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        Линейный
      </button>
      <button 
        onClick={() => setScaleMode('log')}
        style={{
          padding: '8px 20px',
          borderRadius: '9999px',
          background: scaleMode === 'log' ? '#10B981' : 'transparent',
          color: scaleMode === 'log' ? '#fff' : '#94A3B8',
          border: 'none',
          fontWeight: '600',
          fontSize: '14px',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        Логарифмический
      </button>
    </div>
  </div>
  
  <ResponsiveContainer width="100%" height={300}>
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

  {/* Легенда */}
  <div style={{ 
    display: 'flex', 
    flexWrap: 'wrap', 
    gap: '12px 24px', 
    justifyContent: 'center',
    marginTop: '12px'
  }}>
    {[
      { color: '#F59E0B', label: 'Цемент' },
      { color: '#3B82F6', label: 'Песок' },
      { color: '#10B981', label: 'Щебень' },
      { color: '#8B5CF6', label: 'Вода' },
      { color: '#EF4444', label: 'Добавка' }
    ].map((item, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '18px', height: '18px', backgroundColor: item.color, borderRadius: '4px' }} />
        <span style={{ fontWeight: '500' }}>{item.label}</span>
      </div>
    ))}
  </div>
</div>
            </div>

                              {/* ====================== ИСТОРИЯ ====================== */}
          <h3 style={{ marginBottom: '12px', color: '#94A3B8' }}>
            История загруженных отчётов ({filteredHistory.length})
          </h3>

          {/* Пагинация */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ color: '#94A3B8' }}>
                Страница {currentPage} из {totalPages}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{ 
                    padding: '8px 16px', 
                    borderRadius: '9999px', 
                    backgroundColor: '#334155', 
                    border: 'none', 
                    color: 'white', 
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                    opacity: currentPage === 1 ? 0.5 : 1 
                  }}
                >
                  ← Назад
                </button>
                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{ 
                    padding: '8px 16px', 
                    borderRadius: '9999px', 
                    backgroundColor: '#334155', 
                    border: 'none', 
                    color: 'white', 
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                    opacity: currentPage === totalPages ? 0.5 : 1 
                  }}
                >
                  Вперёд →
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentReports.length > 0 ? currentReports.map((report: any) => (
              <div 
                key={report.id} 
                style={{
                  backgroundColor: '#25334A',
                  padding: '12px 20px',
                  borderRadius: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '15px'
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
                    {report.raw_data?.length || 0} партий • {report.total_volume} м³ • {report.file_name}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button 
                    style={{ backgroundColor: '#10B981', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
                    onClick={() => setReportData(report.raw_data || [])}
                  >
                    Открыть
                  </button>
                  <button 
                    style={{ backgroundColor: '#64748B', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
                    onClick={() => setReportData([])}
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

          {/* Текущий отчёт */}
          {reportData.length > 0 && (
            <div style={{ marginTop: '28px' }}>
              <h3 style={{ marginBottom: '14px', color: '#10B981' }}>
                ✅ Текущий отчёт • {reportData.length} партий
              </h3>

              <div className="scroll-hidden" style={{ overflowX: 'auto', borderRadius: '16px' }}>
              <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', backgroundColor: '#25334A', overflow: 'hidden' }}>
                <thead>
                  <tr style={{ backgroundColor: '#334155' }}>
                    <th style={{ padding: '14px', textAlign: 'left' }}>NO</th>
                    <th style={{ padding: '14px', textAlign: 'left' }}>Дата</th>
                    <th style={{ padding: '14px', textAlign: 'left' }}>Время</th>
                    <th style={{ padding: '14px', textAlign: 'left' }}>Рецепт</th>
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
                  {reportData.map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #334155' }}>
                      <td style={{ padding: '14px' }}>{row.no}</td>
                      <td style={{ padding: '14px' }}>{row.date}</td>
                      <td style={{ padding: '14px' }}>{row.time}</td>
                      <td style={{ padding: '14px', fontWeight: '600' }}>{row.recipe}</td>
                      <td style={{ padding: '14px', textAlign: 'right', color: '#10B981', fontWeight: '600' }}>{row.qty}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{row.cement.toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{row.sand.toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{row.gravel.toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{row.water.toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{row.additive.toFixed(3)}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>
                        {row.additive2 > 0 ? row.additive2.toFixed(3) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>

      {/* ИТОГОВАЯ СТРОКА (только одна) */}
                <tfoot>
                  <tr style={{ 
                    backgroundColor: '#334155', 
                    fontWeight: '700', 
                    fontSize: '16px',
                    borderTop: '3px solid #10B981'
                  }}>
                    <td style={{ padding: '16px 14px' }} colSpan={4}>
                      <strong>ИТОГО ЗА ДЕНЬ</strong>
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right', color: '#10B981' }}>
                      {reportData.reduce((sum, r) => sum + (r.qty || 0), 0)} м³
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {reportData.reduce((sum, r) => sum + (r.cement || 0), 0).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {reportData.reduce((sum, r) => sum + (r.sand || 0), 0).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {reportData.reduce((sum, r) => sum + (r.gravel || 0), 0).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {reportData.reduce((sum, r) => sum + (r.water || 0), 0).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {reportData.reduce((sum, r) => sum + (r.additive || 0), 0).toFixed(3)} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {reportData.reduce((sum, r) => sum + (r.additive2 || 0), 0).toFixed(3)} кг
                    </td>
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>
          )}
    </div>
  );
}