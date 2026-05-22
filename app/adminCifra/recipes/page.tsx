'use client';

import { useState, useEffect } from 'react';

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [editingRecipe, setEditingRecipe] = useState<any>(null);

  // ==================== ЗАГРУЗКА РЕЦЕПТОВ ИЗ БАЗЫ ====================
  useEffect(() => {
    fetchRecipes();
  }, []);

  const fetchRecipes = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/recipes');
      if (res.ok) {
        const data = await res.json();
        setRecipes(data);
      } else {
        console.error('Ошибка загрузки рецептов');
      }
    } catch (e) {
      console.error('Ошибка соединения:', e);
    } finally {
      setLoading(false);
    }
  };

  // ==================== СОХРАНЕНИЕ РЕЦЕПТА ====================
  const saveRecipe = async (recipe: any) => {
    const method = recipe.id ? 'PUT' : 'POST';
    const url = recipe.id 
      ? `/api/adminCifra/recipes/${recipe.id}` 
      : '/api/adminCifra/recipes';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recipe),
      });

      if (res.ok) {
        fetchRecipes();           // обновляем список
        setEditingRecipe(null);
        alert('✅ Рецепт успешно сохранён!');
      } else {
        alert('Ошибка сохранения');
      }
    } catch (e) {
      alert('Ошибка соединения с сервером');
    }
  };

  // ==================== УДАЛЕНИЕ РЕЦЕПТА ====================
  const deleteRecipe = async (id: number) => {
    if (!confirm('Удалить этот рецепт?')) return;

    try {
      const res = await fetch(`/api/adminCifra/recipes?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRecipes();
        alert('✅ Рецепт удалён');
      }
    } catch (e) {
      alert('Ошибка удаления');
    }
  };

  return (
    <div style={{ background: '#0F172A', minHeight: '100vh', color: '#fff', padding: '32px 40px' }}>
      
      {/* ==================== ЗАГОЛОВОК + КНОПКА ==================== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <h1 style={{ fontSize: '34px', fontWeight: '700' }}>
          📋 Рецепты бетона
        </h1>

        <button 
          onClick={() => setEditingRecipe({ code: '', name: '', price: 0, cement: 0, sand: 0, gravel: 0, water: 0, additive: 0, is_active: true })}
          style={{ 
            padding: '14px 28px', 
            background: '#10B981', 
            color: 'white', 
            border: 'none', 
            borderRadius: '9999px', 
            fontWeight: '600',
            fontSize: '16px'
          }}
        >
          + Новый рецепт
        </button>
      </div>

      {/* ==================== ПЕРЕКЛЮЧЕНИЕ ВИДА ==================== */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '32px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={() => setViewMode('grid')} 
            style={{
              padding: '12px 24px',
              background: 'transparent',
              border: 'none',
              color: viewMode === 'grid' ? '#10B981' : '#64748B',
              fontSize: '17px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              position: 'relative',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '22px', opacity: viewMode === 'grid' ? 0.9 : 0.45 }}>▦</span>
            Плитка
          </button>

          <button 
            onClick={() => setViewMode('list')} 
            style={{
              padding: '12px 24px',
              background: 'transparent',
              border: 'none',
              color: viewMode === 'list' ? '#10B981' : '#64748B',
              fontSize: '17px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              position: 'relative',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '24px', opacity: viewMode === 'list' ? 0.9 : 0.45, lineHeight: 1 }}>≡</span>
            Список
          </button>
        </div>
      </div>

      {/* ==================== РЕЖИМ ПЛИТКИ ==================== */}
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
          {recipes.map((recipe) => (
            <div 
              key={recipe.id} 
              style={{ 
                background: '#1E2937', 
                borderRadius: '18px', 
                padding: '20px',
                transition: 'all 0.25s ease',
                border: '1px solid #334155',
                height: 'fit-content'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.boxShadow = '0 15px 35px rgba(0,0,0,0.35)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div style={{ fontSize: '22px', fontWeight: '700' }}>
                  {recipe.code}
                </div>
                <div style={{ 
                  padding: '5px 14px', 
                  borderRadius: '9999px', 
                  fontSize: '13.5px',
                  fontWeight: '600',
                  background: recipe.type === 'dolomite' ? '#FACC1520' : '#10B98120', 
                  color: recipe.type === 'dolomite' ? '#FACC15' : '#10B981'
                }}>
                  {recipe.type === 'dolomite' ? 'Доломит' : 'Гранит'}
                </div>
              </div>

              <div style={{ color: '#CBD5E1', fontSize: '16.5px', marginBottom: '20px' }}>
                {recipe.name}
              </div>

              <div style={{ fontSize: '32px', fontWeight: '700', color: '#60A5FA', marginBottom: '20px' }}>
                {recipe.price.toLocaleString()} ₽
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '15px', marginBottom: '24px' }}>
                <div>Цемент: <strong>{recipe.cement} кг</strong></div>
                <div>Песок: <strong>{recipe.sand} кг</strong></div>
                <div>Щебень: <strong>{recipe.gravel} кг</strong></div>
                <div>Вода: <strong>{recipe.water} кг</strong></div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onClick={() => setEditingRecipe(recipe)} 
                  style={{ 
                    flex: 1, 
                    padding: '10px 16px',
                    background: '#334155',
                    color: '#E2E8F0',
                    border: 'none', 
                    borderRadius: '9999px', 
                    fontWeight: '500',
                    fontSize: '14.5px',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#3B82F6'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#334155'; e.currentTarget.style.color = '#E2E8F0'; }}
                >
                  ✏️ Редактировать
                </button>
                <button 
                  onClick={() => setRecipes(prev => prev.filter(r => r.id !== recipe.id))}
                  style={{ 
                    flex: 1, 
                    padding: '10px 16px',
                    background: '#334155',
                    color: '#E2E8F0',
                    border: 'none', 
                    borderRadius: '9999px', 
                    fontWeight: '500',
                    fontSize: '14.5px'
                  }}
                >
                  🗑️ Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ==================== РЕЖИМ СПИСКА (компактный) ==================== */}
      {viewMode === 'list' && (
        <div style={{ 
          background: '#1E2937', 
          borderRadius: '20px', 
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
        }}>
          {recipes.map((recipe) => (
            <div 
              key={recipe.id} 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                padding: '10px 20px',        // ← уменьшил высоту строки
                borderBottom: '1px solid #334155',
                transition: 'background 0.2s ease',
                minHeight: '20px'             // ← максимально компактно
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#25334A'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ width: '130px', fontWeight: '700', fontSize: '18px' }}>
                {recipe.code}
              </div>

              <div style={{ flex: 1, color: '#CBD5E1', fontSize: '16px' }}>
                {recipe.name}
              </div>

              <div style={{ width: '160px', fontSize: '15px', fontWeight: '700', color: '#60A5FA', textAlign: 'right' }}>
                {recipe.price.toLocaleString()} ₽
              </div>

              <div style={{ display: 'flex', gap: '8px', marginLeft: '80px' }}>
                <button 
                  onClick={() => setEditingRecipe(recipe)}
                  style={{ 
                    padding: '8px 18px',
                    background: '#334155',
                    color: '#E2E8F0',
                    border: 'none', 
                    borderRadius: '9999px', 
                    fontWeight: '500',
                    fontSize: '14px'
                  }}
                >
                  Редактировать
                </button>
                <button 
                  onClick={() => setRecipes(prev => prev.filter(r => r.id !== recipe.id))}
                  style={{ 
                    padding: '8px 18px',
                    background: '#334155',
                    color: '#E2E8F0',
                    border: 'none', 
                    borderRadius: '9999px', 
                    fontWeight: '500',
                    fontSize: '14px'
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модалка редактирования */}
      {editingRecipe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1E2937', padding: '32px', borderRadius: '20px', width: '520px' }}>
            <h2 style={{ marginBottom: '24px' }}>Редактирование рецепта</h2>
            
            <input value={editingRecipe.code} onChange={e => setEditingRecipe({...editingRecipe, code: e.target.value})} placeholder="Код марки" style={{ width: '100%', padding: '12px', marginBottom: '12px', background: '#25334A', border: 'none', borderRadius: '8px', color: '#fff' }} />
            <input value={editingRecipe.name} onChange={e => setEditingRecipe({...editingRecipe, name: e.target.value})} placeholder="Название" style={{ width: '100%', padding: '12px', marginBottom: '12px', background: '#25334A', border: 'none', borderRadius: '8px', color: '#fff' }} />
            <input type="number" value={editingRecipe.price} onChange={e => setEditingRecipe({...editingRecipe, price: Number(e.target.value)})} placeholder="Цена за м³" style={{ width: '100%', padding: '12px', marginBottom: '12px', background: '#25334A', border: 'none', borderRadius: '8px', color: '#fff' }} />

            <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
              <button onClick={() => saveRecipe(editingRecipe)} style={{ flex: 1, padding: '14px', background: '#10B981', color: 'white', border: 'none', borderRadius: '12px' }}>Сохранить</button>
              <button onClick={() => setEditingRecipe(null)} style={{ flex: 1, padding: '14px', background: '#334155', color: 'white', border: 'none', borderRadius: '12px' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}