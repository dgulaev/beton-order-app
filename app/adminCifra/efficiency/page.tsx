'use client';

import { useState, useEffect } from 'react';

export default function EfficiencyPage() {

  // ==================== 1. ОСНОВНЫЕ СОСТОЯНИЯ ====================
  const [staff, setStaff] = useState<any[]>([]);
  const [allClients, setAllClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [showAssignModal, setShowAssignModal] = useState(false);

  // Состояния массовой привязки
  const [selectedStaffForAssign, setSelectedStaffForAssign] = useState<any>(null);
  const [selectedClientsForAssign, setSelectedClientsForAssign] = useState<number[]>([]);

  // ==================== 2. ЗАГРУЗКА ДАННЫХ ====================
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [staffRes, clientsRes] = await Promise.all([
        fetch('/api/adminCifra/staff'),
        fetch('/api/adminCifra/clients')
      ]);

      if (staffRes.ok) setStaff(await staffRes.json());
      if (clientsRes.ok) setAllClients(await clientsRes.json());
    } catch (err) {
      console.error('Ошибка загрузки данных:', err);
    } finally {
      setLoading(false);
    }
  };

  // ==================== 3. ПРИВЯЗКА КЛИЕНТОВ ====================
  const assignClient = async (clientId: number, staffId: number) => {
    try {
      const res = await fetch('/api/adminCifra/clients/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, staffId })
      });
      return res.ok;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const executeMassAssign = async () => {
    if (!selectedStaffForAssign || selectedClientsForAssign.length === 0) return;

    let successCount = 0;
    for (const clientId of selectedClientsForAssign) {
      const success = await assignClient(clientId, selectedStaffForAssign.user_id);
      if (success) successCount++;
    }

    alert(`✅ Успешно привязано ${successCount} клиентов`);

    setShowAssignModal(false);
    setSelectedClientsForAssign([]);
    setSelectedStaffForAssign(null);
    loadData();
  };

  const toggleClientSelection = (clientId: number) => {
    if (selectedClientsForAssign.includes(clientId)) {
      setSelectedClientsForAssign(selectedClientsForAssign.filter(id => id !== clientId));
    } else {
      setSelectedClientsForAssign([...selectedClientsForAssign, clientId]);
    }
  };

  // ==================== 4. ФИЛЬТРАЦИЯ ====================
  const filteredStaff = staff
    .filter(s => roleFilter === 'all' || s.role === roleFilter)
    .filter(s => !search || (s.full_name || s.username || '').toLowerCase().includes(search.toLowerCase()));

  const selectedStaffClients = selectedStaff 
    ? allClients.filter(c => c.assigned_to === selectedStaff.user_id)
    : [];

  const unassignedClients = allClients.filter(c => !c.assigned_to);

  const maxVolume = Math.max(...selectedStaffClients.map(c => c.total_volume || 0), 1);

  // ==================== 5. ДАННЫЕ ДЛЯ КРУГОВОЙ ДИАГРАММЫ ====================
  const chartData = staff
    .filter(s => (s.clients_count || 0) > 0)
    .sort((a, b) => (b.clients_count || 0) - (a.clients_count || 0));

  const totalClients = chartData.reduce((sum, s) => sum + (s.clients_count || 0), 0);

  if (loading) return <div style={{padding: '140px', textAlign: 'center', color: '#94A3B8'}}>Загрузка аналитики...</div>;

  return (
    <div style={{ padding: '32px', background: '#0F172A', minHeight: '100vh', color: '#fff' }}>
      <h1 style={{ fontSize: '38px', fontWeight: '700', marginBottom: '32px' }}>📈 Эффективность отдела продаж</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '28px' }}>
        
        {/* ==================== 6. СПИСОК СОТРУДНИКОВ ==================== */}
        <div style={{ background: '#1E2937', borderRadius: '20px', padding: '24px' }}>
          <h2 style={{ marginBottom: '20px', fontSize: '22px' }}>👥 Сотрудники</h2>
          
          {filteredStaff.map((s: any) => (
            <div 
              key={s.user_id}
              onClick={() => setSelectedStaff(s)}
              style={{
                padding: '18px',
                marginBottom: '10px',
                borderRadius: '16px',
                cursor: 'pointer',
                background: selectedStaff?.user_id === s.user_id ? '#3B82F6' : '#25334A',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <strong>{s.full_name || s.username}</strong>
                  <div style={{ fontSize: '14px', color: '#94A3B8' }}>{s.role}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '26px', fontWeight: '700', color: '#60A5FA' }}>
                    {s.clients_count || 0}
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button 
            onClick={() => setShowAssignModal(true)}
            style={{ marginTop: '20px', padding: '14px 24px', background: '#8B5CF6', color: 'white', border: 'none', borderRadius: '9999px', width: '100%' }}
          >
            ⚡ Массово привязать клиентов
          </button>
        </div>

        {/* ==================== 7. ДЕТАЛЬНАЯ СТАТИСТИКА ==================== */}
        <div>
          {selectedStaff ? (
            <div style={{ background: '#1E2937', borderRadius: '20px', padding: '28px' }}>
              <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>
                {selectedStaff.full_name || selectedStaff.username}
              </h2>
              <p style={{ color: '#94A3B8', marginBottom: '24px' }}>{selectedStaff.role}</p>

              {/* Ключевые метрики */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
                <div style={{ background: '#25334A', padding: '24px', borderRadius: '16px' }}>
                  <div style={{ color: '#94A3B8' }}>Клиентов</div>
                  <div style={{ fontSize: '52px', fontWeight: '700', color: '#60A5FA' }}>
                    {selectedStaff.clients_count || 0}
                  </div>
                </div>
                <div style={{ background: '#25334A', padding: '24px', borderRadius: '16px' }}>
                  <div style={{ color: '#94A3B8' }}>Общий объём</div>
                  <div style={{ fontSize: '52px', fontWeight: '700', color: '#10B981' }}>
                    {(selectedStaff.total_volume || 0).toFixed(1)} м³
                  </div>
                </div>
              </div>

              {/* ==================== 8. КРУГОВАЯ ДИАГРАММА ==================== */}
              <div style={{ display: 'flex', gap: '48px', alignItems: 'center', marginBottom: '40px' }}>
                <div style={{ position: 'relative', width: '260px', height: '260px' }}>
                  <div style={{ 
                    width: '260px', 
                    height: '260px', 
                    borderRadius: '50%', 
                    background: totalClients > 0 
                      ? `conic-gradient(#3B82F6 0deg 120deg, #10B981 120deg 240deg, #F59E0B 240deg 360deg)` 
                      : '#334155',
                    position: 'relative'
                  }}>
                    <div style={{ 
                      position: 'absolute', 
                      top: '50%', 
                      left: '50%', 
                      transform: 'translate(-50%, -50%)',
                      width: '160px',
                      height: '160px',
                      background: '#1E2937',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '42px',
                      fontWeight: '700'
                    }}>
                      {totalClients}
                    </div>
                  </div>
                </div>

                {/* Основная информация */}
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginBottom: '16px' }}>Основная информация</h3>
                  <div style={{ background: '#25334A', padding: '20px', borderRadius: '16px' }}>
                    <div style={{ marginBottom: '12px' }}>
                      <strong>Всего клиентов в системе:</strong> {allClients.length}
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <strong>Привязано к сотрудникам:</strong> {totalClients}
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                      <strong>Не привязано:</strong> {allClients.length - totalClients}
                    </div>
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #475569' }}>
                      <strong>Средний объём на клиента:</strong> {totalClients > 0 ? (staff.reduce((sum, s) => sum + (s.total_volume || 0), 0) / totalClients).toFixed(1) : 0} м³
                    </div>
                  </div>
                </div>
              </div>

              {/* ==================== 9. СПИСОК ПРИВЯЗАННЫХ КЛИЕНТОВ ==================== */}
              <h3 style={{ marginBottom: '16px' }}>Привязанные клиенты ({selectedStaffClients.length})</h3>
              <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                {selectedStaffClients.length > 0 ? selectedStaffClients
                  .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
                  .map((client: any) => {
                    const percent = maxVolume > 0 ? Math.round(((client.total_volume || 0) / maxVolume) * 100) : 0;
                    return (
                      <div key={client.user_id} style={{ marginBottom: '18px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div>{client.organization_name || client.full_name}</div>
                          <div style={{ color: '#60A5FA', fontWeight: '600' }}>
                            {(client.total_volume || 0).toFixed(1)} м³
                          </div>
                        </div>
                        <div style={{ height: '14px', background: '#334155', borderRadius: '9999px' }}>
                          <div style={{ height: '100%', width: `${percent}%`, background: 'linear-gradient(90deg, #10B981, #34D399)', borderRadius: '9999px' }} />
                        </div>
                      </div>
                    );
                  }) : (
                  <div style={{ textAlign: 'center', padding: '60px', color: '#64748B' }}>
                    У сотрудника пока нет привязанных клиентов
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ background: '#1E2937', borderRadius: '20px', padding: '140px', textAlign: 'center', color: '#64748B' }}>
              Выберите сотрудника для просмотра статистики
            </div>
          )}
        </div>
      </div>

      {/* ==================== 10. МОДАЛЬНОЕ ОКНО МАССОВОЙ ПРИВЯЗКИ ==================== */}
      {showAssignModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1E2937', width: '780px', borderRadius: '20px', padding: '32px', maxHeight: '90vh', overflow: 'auto' }}>
            <h2 style={{ marginBottom: '8px' }}>Массовое назначение клиентов</h2>
            <p style={{ color: '#94A3B8', marginBottom: '24px' }}>Выберите сотрудника и клиентов для привязки</p>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8' }}>Сотрудник</label>
              <select 
                onChange={(e) => setSelectedStaffForAssign(staff.find(s => s.user_id === Number(e.target.value)))}
                style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
              >
                <option value="">Выберите сотрудника</option>
                {staff.map(s => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.full_name || s.username} — {s.role}
                  </option>
                ))}
              </select>
            </div>

            {selectedStaffForAssign && (
              <div>
                <label style={{ display: 'block', marginBottom: '12px', color: '#94A3B8' }}>
                  Выберите клиентов ({unassignedClients.length} доступно)
                </label>
                <div style={{ maxHeight: '420px', overflowY: 'auto', background: '#25334A', borderRadius: '16px', padding: '8px' }}>
                  {unassignedClients.map((client: any) => (
                    <label key={client.user_id} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      padding: '12px 16px', 
                      margin: '4px 0',
                      background: '#1E2937',
                      borderRadius: '12px',
                      cursor: 'pointer'
                    }}>
                      <input 
                        type="checkbox" 
                        checked={selectedClientsForAssign.includes(client.user_id)}
                        onChange={() => toggleClientSelection(client.user_id)}
                        style={{ marginRight: '12px' }}
                      />
                      <div>
                        <strong>{client.organization_name || client.full_name}</strong><br />
                        <span style={{ color: '#94A3B8', fontSize: '14px' }}>{client.phone}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
              <button 
                onClick={() => setShowAssignModal(false)}
                style={{ flex: 1, padding: '16px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
              >
                Отмена
              </button>
              <button 
                onClick={executeMassAssign}
                disabled={!selectedStaffForAssign || selectedClientsForAssign.length === 0}
                style={{ 
                  flex: 1, 
                  padding: '16px', 
                  background: (selectedStaffForAssign && selectedClientsForAssign.length > 0) ? '#10B981' : '#475569', 
                  border: 'none', 
                  borderRadius: '12px', 
                  color: 'white',
                  fontWeight: '600'
                }}
              >
                Привязать {selectedClientsForAssign.length} клиентов
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}