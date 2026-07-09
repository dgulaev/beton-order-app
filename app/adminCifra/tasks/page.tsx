'use client';

import { useState, useEffect } from 'react';
import { Plus, CheckCircle } from 'lucide-react';

export default function TasksPage() {

  // ==================== БЛОК 1: ОСНОВНЫЕ СОСТОЯНИЯ ====================
  const [tasks, setTasks] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [filter, setFilter] = useState<'all' | 'my_created' | 'assigned_to_me' | 'created_by_me'>('all');
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    assigned_to: '',
    due_date: ''
  });

  const userId = localStorage.getItem('userId');

  // ==================== БЛОК 2: ЗАГРУЗКА ДАННЫХ ====================
  useEffect(() => {
    if (userId) {
      console.log('🔄 Загрузка задач для userId:', userId);
      fetchTasks();
      fetchEmployees();
    }
  }, [userId]);

  const fetchTasks = async () => {
    try {
      const res = await fetch(`/api/adminCifra/tasks?userId=${userId}`);
      const data = await res.json();
      console.log('📋 Получено задач с сервера:', data.tasks?.length || 0, data);
      setTasks(data.tasks || []);
    } catch (err) {
      console.error('Ошибка загрузки задач:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/adminCifra/employees');
      const data = await res.json();
      setEmployees(data.employees || []);
    } catch (err) {
      console.error('Ошибка загрузки сотрудников:', err);
    }
  };

  // Восстановление уведомлений после перезагрузки страницы
useEffect(() => {
  const activeNotifications = JSON.parse(localStorage.getItem('activeNotifications') || '[]');
  
  activeNotifications.forEach((notif: any) => {
    showVisualNotification(notif.type, notif);
  });
}, []);

  // ==================== БЛОК 3: ФИЛЬТРАЦИЯ ЗАДАЧ ====================
  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') return true;
    if (filter === 'my_created') return String(task.created_by) === userId;
    if (filter === 'assigned_to_me') return String(task.assigned_to) === userId;
    if (filter === 'created_by_me') return String(task.created_by) === userId;
    return true;
  });

  console.log('🔍 Текущий фильтр:', filter, ' | Задач после фильтра:', filteredTasks.length);

  // ==================== БЛОК 4: СОЗДАНИЕ / РЕДАКТИРОВАНИЕ ЗАДАЧИ ====================
const createTask = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!formData.title) return;

  const isEditing = editingTaskId !== null;

  let bodyData: any;
  let method = 'POST';

  if (isEditing) {
    method = 'PATCH';
    bodyData = { 
      taskId: editingTaskId,
      title: formData.title,
      description: formData.description,
      assigned_to: formData.assigned_to || null,
      due_date: formData.due_date || null
    };
  } else {
    bodyData = { 
      ...formData,
      created_by: parseInt(userId!) 
    };
  }

  const res = await fetch('/api/adminCifra/tasks', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyData)
  });

  if (res.ok) {
    console.log('✅ Задача успешно сохранена');
    setShowForm(false);
    setEditingTaskId(null);
    setFormData({ title: '', description: '', assigned_to: '', due_date: '' });
    fetchTasks();
  } else {
    const errorText = await res.text();
    console.error('❌ Ошибка сохранения:', errorText);
    alert('Ошибка при сохранении задачи');
  }
};

  // ==================== БЛОК 5: ОБНОВЛЕНИЕ СТАТУСА + УДАЛЕНИЕ + УВЕДОМЛЕНИЯ ====================
const updateTaskStatus = async (taskId: number, newStatus: string, note?: string) => {
  const body: any = { taskId, status: newStatus };
  if (newStatus === 'completed' && note) {
    body.completion_note = note;
  }

  const res = await fetch('/api/adminCifra/tasks', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      let titleText = '';
      let messageText = '';

      if (newStatus === 'in_progress') {
        titleText = 'Задача в работе';
        messageText = `Задача "${task.title}" взята в работу`;
      } else if (newStatus === 'completed') {
        titleText = 'Задача выполнена';
        messageText = `Задача "${task.title}" выполнена`;
        if (note) messageText += `\nКомментарий: ${note}`;
      }

      // Всплывающее уведомление
     showVisualNotification('status', {
  title: task.title,
  message: messageText,
  creator: task.creator?.organization_name || task.creator?.full_name || 'Неизвестно',
  due_date: task.due_date
});

      // Звук — безопасный вызов (через window, чтобы не подчёркивало)
      if (typeof (window as any).playNotificationSound === 'function') {
        (window as any).playNotificationSound();
      }
    }
  }

  fetchTasks();
};

const deleteTask = async (taskId: number) => {
  if (!confirm('Вы уверены, что хотите удалить эту задачу?')) return;

  try {
    const res = await fetch('/api/adminCifra/tasks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        taskId, 
        userId: parseInt(userId!) 
      })
    });

    const result = await res.json();

    if (res.ok) {
      console.log('✅ Задача успешно удалена');
      fetchTasks();
    } else {
      console.error('❌ Ошибка удаления:', result);
      alert(result.error || 'Не удалось удалить задачу. У вас нет прав.');
    }
  } catch (err) {
    console.error('Ошибка удаления:', err);
    alert('Ошибка соединения при удалении');
  }
};

const openEditModal = (task: any) => {
  setFormData({
    title: task.title || '',
    description: task.description || '',
    assigned_to: task.assigned_to ? String(task.assigned_to) : '',
    due_date: task.due_date ? task.due_date.slice(0, 16) : ''
  });
  setEditingTaskId(task.id);
  setShowForm(true);
};

// ==================== БЛОК 5.2: ВСПЛЫВАЮЩИЕ УВЕДОМЛЕНИЯ (СОХРАНЕНИЕ ПОСЛЕ ПЕРЕЗАГРУЗКИ) ====================
const showVisualNotification = (type: string, data: any) => {
  const notificationId = `notif-${data.id || Date.now()}`;

  // Проверяем, было ли уже закрыто
  const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
  if (closed.includes(notificationId)) return;

  // Сохраняем активное уведомление
  const activeNotifications = JSON.parse(localStorage.getItem('activeNotifications') || '[]');
  const newNotif = {
    id: notificationId,
    type,
    ...data,
    timestamp: Date.now()
  };
  activeNotifications.push(newNotif);
  localStorage.setItem('activeNotifications', JSON.stringify(activeNotifications));

  // Создаём карточку
  const notif = document.createElement('div');
  notif.id = notificationId;
  notif.style.cssText = `
    position: fixed;
    top: 80px;
    right: 24px;
    background: linear-gradient(135deg, #fbbf24, #fcd34d);
    color: #1e2937;
    padding: 18px 24px;
    border-radius: 16px;
    z-index: 10000;
    font-weight: 600;
    box-shadow: 0 20px 40px rgba(251, 191, 36, 0.5);
    min-width: 440px;
    display: flex;
    align-items: flex-start;
    gap: 16px;
    border: 1px solid #f59e0b;
  `;

  let emoji = '🔄';
  let titleText = data.title || 'Обновление задачи';

  if (type === 'status') {
    if (data.status === 'in_progress') {
      emoji = '▶️';
      titleText = 'Взята в работу';
    } else if (data.status === 'completed') {
      emoji = '✅';
      titleText = 'Задача выполнена';
    }
  } else if (type === 'new') {
    emoji = '🆕';
    titleText = 'Новая задача';
  }

  notif.innerHTML = `
    <div style="font-size: 36px; margin-top: 2px;">${emoji}</div>
    <div style="flex: 1;">
      <div style="font-size: 17px; font-weight: 700; margin-bottom: 8px;">${titleText}</div>
      <div style="font-size: 14.5px; opacity: 0.95; line-height: 1.45;">${data.message || ''}</div>
      ${data.creator ? `<div style="margin-top: 8px; font-size: 13.5px;">От: <strong>${data.creator}</strong></div>` : ''}
      ${data.due_date ? `<div style="font-size: 13.5px;">Срок: ${new Date(data.due_date).toLocaleString('ru-RU')}</div>` : ''}
    </div>
    <div style="font-size: 26px; cursor: pointer; padding: 4px 10px; opacity: 0.85; margin-top: -4px;" class="close-btn">✕</div>
  `;

  const closeBtn = notif.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      notif.remove();
      // Удаляем из активных и добавляем в закрытые
      const active = JSON.parse(localStorage.getItem('activeNotifications') || '[]');
      const updatedActive = active.filter((n: any) => n.id !== notificationId);
      localStorage.setItem('activeNotifications', JSON.stringify(updatedActive));

      const closedList = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
      if (!closedList.includes(notificationId)) {
        closedList.push(notificationId);
        localStorage.setItem('closedNotifications', JSON.stringify(closedList));
      }
    });
  }

  document.body.appendChild(notif);
};

  // ==================== БЛОК 6: РЕНДЕР ====================
  return (
    <div style={{ padding: '20px 40px', backgroundColor: '#0F172A', minHeight: '100vh', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700' }}>Задачи</h1>
        <button onClick={() => setShowForm(true)} style={{background: '#3B82F6', color: 'white', padding: '12px 24px', borderRadius: '12px', border: 'none', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '16px', cursor: 'pointer'}}>
          <Plus size={20} /> Новая задача
        </button>
      </div>

      {/* Фильтры */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', flexWrap: 'wrap' }}>
        {['all', 'my_created', 'assigned_to_me', 'created_by_me'].map(f => (
          <button key={f} onClick={() => setFilter(f as any)} style={{ padding: '12px 28px', background: 'transparent', border: 'none', color: filter === f ? '#10B981' : '#64748B', fontSize: '17px', fontWeight: '600', cursor: 'pointer' }}>
            {f === 'all' && 'Все'}
            {f === 'my_created' && 'Созданные мной'}
            {f === 'assigned_to_me' && 'Назначенные мне'}
            {f === 'created_by_me' && 'Мои задачи'}
          </button>
        ))}
      </div>

      {/* Модальная форма */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowForm(false)}>
          <div style={{ background: '#1E2937', width: '920px', borderRadius: '20px', padding: '32px', maxHeight: '90vh', height: '620px', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '24px', fontSize: '24px' }}>{editingTaskId ? 'Редактировать задачу' : 'Новая задача'}</h2>
            <form onSubmit={createTask}>
              <input type="text" placeholder="Название задачи *" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} style={{width:'97%', padding:'16px', background:'#0F172A', border:'none', borderRadius:'12px', color:'#fff', marginBottom:'16px'}} required />
              <textarea placeholder="Описание задачи" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} style={{width:'97%', padding:'16px', background:'#0F172A', border:'none', borderRadius:'12px', color:'#fff', height:'140px', marginBottom:'16px'}} />
              <select value={formData.assigned_to} onChange={(e) => setFormData({...formData, assigned_to: e.target.value})} style={{width:'100%', padding:'16px', background:'#0F172A', border:'none', borderRadius:'12px', color:'#fff', marginBottom:'16px'}} required>
                <option value="">Кому назначить задачу</option>
                {employees.map((emp: any) => {
                  const display = emp.organization_name && emp.organization_name.trim() !== '' ? emp.organization_name : (emp.full_name || 'Без имени');
                  return <option key={emp.user_id} value={emp.user_id}>{display} ({emp.role})</option>;
                })}
              </select>
              <input type="datetime-local" value={formData.due_date} onChange={(e) => setFormData({...formData, due_date: e.target.value})} style={{width:'97%', padding:'16px', background:'#0F172A', border:'none', borderRadius:'12px', color:'#fff', marginBottom:'24px'}} />
              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" onClick={() => {setShowForm(false); setEditingTaskId(null);}} style={{ flex: 1, padding: '14px', background: '#334155', borderRadius: '12px', color: '#fff', border: 'none', cursor: 'pointer' }}>Отмена</button>
                <button type="submit" style={{ flex: 1, padding: '14px', background: '#22c55e', borderRadius: '12px', color: 'white', border: 'none', fontWeight: '600', cursor: 'pointer' }}>Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== БЛОК 9: СПИСОК ЗАДАЧ ==================== */}
{loading ? (
  <div style={{textAlign:'center', padding:'100px', color:'#94A3B8'}}>Загрузка задач...</div>
) : (
  <div style={{ display: 'grid', gap: '16px' }}>
    {filteredTasks.length === 0 ? (
      <div style={{ textAlign: 'center', padding: '80px', color: '#64748B', fontSize: '18px' }}>Нет задач по выбранному фильтру</div>
    ) : (
      filteredTasks.map((task: any) => (
        <div key={task.id} style={{
          background: '#1E2937',
          padding: '24px',
          borderRadius: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>{task.title}</div>
            {task.description && <div style={{ color: '#94A3B8', marginBottom: '12px' }}>{task.description}</div>}
            
            {/* Исправленное отображение От / Кому с приоритетом organization_name */}
  <div style={{ fontSize: '14px', color: '#64748B', display: 'flex', gap: '20px', marginBottom: '8px' }}>
    <div>
      От: <strong>
        {task.creator?.organization_name || task.creator?.full_name || 'Неизвестно'}
      </strong>
    </div>
    <div>
      Кому: <strong>
        {task.assignee?.organization_name || task.assignee?.full_name || 'Не назначен'}
      </strong>
    </div>
  </div>

            {/* Времена */}
            <div style={{ fontSize: '13px', color: '#94A3B8', lineHeight: '1.5' }}>
              Создано: {new Date(task.created_at).toLocaleString('ru-RU')}<br/>
              {task.due_date && `Срок: ${new Date(task.due_date).toLocaleString('ru-RU')}`}<br/>
              {task.updated_at && task.updated_at !== task.created_at && `Изменено: ${new Date(task.updated_at).toLocaleString('ru-RU')}`}<br/>
              {task.completed_at && (
                <span style={{ color: '#22c55e' }}>
                  Выполнено: {new Date(task.completed_at).toLocaleString('ru-RU')}
                  {task.completion_note && ` — ${task.completion_note}`}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {task.status !== 'completed' && (
              <>
                <button onClick={() => updateTaskStatus(task.id, 'in_progress')} style={{ padding: '8px 16px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>В работу</button>
                <button onClick={() => {
                  const note = prompt('Что было сделано для выполнения задачи?');
                  updateTaskStatus(task.id, 'completed', note || '');
                }} style={{ padding: '8px 16px', background: '#22c55e', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Выполнено</button>
              </>
            )}

            {String(task.created_by) === userId && (
              <>
                <button onClick={() => openEditModal(task)} style={{ padding: '8px 16px', background: '#64748B', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Изменить</button>
                <button onClick={() => deleteTask(task.id)} style={{ padding: '8px 16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Удалить</button>
              </>
            )}
          </div>
        </div>
      ))
    )}
  </div>
)}
    </div>
  );
}