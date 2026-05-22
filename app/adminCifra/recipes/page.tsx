'use client';

import { useState, useEffect } from 'react';

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<any[]>([
    { id: 1, code: 'М100', name: 'Бетон М100 (B7,5)', price: 6380, type: 'granite', cement: 280, sand: 720, gravel: 1150, water: 190, additive: 2.0, is_active: true },
    { id: 2, code: 'М100и', name: 'Бетон М100 на доломите', price: 5050, type: 'dolomite', cement: 280, sand: 720, gravel: 1150, water: 190, additive: 2.0, is_active: true },
    { id: 3, code: 'М150', name: 'Бетон М150 (B10)', price: 6500, type: 'granite', cement: 310, sand: 700, gravel: 1120, water: 185, additive: 2.2, is_active: true },
    { id: 4, code: 'М150и', name: 'Бетон М150 на доломите', price: 5450, type: 'dolomite', cement: 310, sand: 700, gravel: 1120, water: 185, additive: 2.2, is_active: true },
    { id: 5, code: 'М200', name: 'Бетон М200 (B15)', price: 6600, type: 'granite', cement: 330, sand: 680, gravel: 1100, water: 180, additive: 2.5, is_active: true },
    { id: 6, code: 'М200и', name: 'Бетон М200 на доломите', price: 5600, type: 'dolomite', cement: 330, sand: 680, gravel: 1100, water: 180, additive: 2.5, is_active: true },
    { id: 7, code: 'М250', name: 'Бетон М250 (B20)', price: 6950, type: 'granite', cement: 350, sand: 660, gravel: 1080, water: 175, additive: 2.8, is_active: true },
    { id: 8, code: 'М250и', name: 'Бетон М250 на доломите', price: 5950, type: 'dolomite', cement: 350, sand: 660, gravel: 1080, water: 175, additive: 2.8, is_active: true },
    { id: 9, code: 'М300', name: 'Бетон М300 (B22,5)', price: 7230, type: 'granite', cement: 370, sand: 640, gravel: 1060, water: 170, additive: 3.0, is_active: true },
    { id: 10, code: 'М350', name: 'Бетон М350 (B25)', price: 7400, type: 'granite', cement: 390, sand: 620, gravel: 1040, water: 165, additive: 3.2, is_active: true },
    { id: 11, code: 'М350-27.5', name: 'Бетон М350 (B27,5)', price: 7800, type: 'granite', cement: 410, sand: 600, gravel: 1020, water: 160, additive: 3.5, is_active: true },
    { id: 12, code: 'М400', name: 'Бетон М400 (B30)', price: 8050, type: 'granite', cement: 430, sand: 580, gravel: 1000, water: 155, additive: 3.8, is_active: true },
    { id: 13, code: 'М450', name: 'Бетон М450 (B35)', price: 8350, type: 'granite', cement: 450, sand: 560, gravel: 980, water: 150, additive: 4.0, is_active: true },
    { id: 14, code: 'М500', name: 'Бетон М500 (B40)', price: 8700, type: 'granite', cement: 470, sand: 540, gravel: 960, water: 145, additive: 4.2, is_active: true },
  ]);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [editingRecipe, setEditingRecipe] = useState<any>(null);

  const saveRecipe = (recipe: any) => {
    if (recipe.id) {
      setRecipes(prev => prev.map(r => r.id === recipe.id ? recipe : r));
    } else {
      const newRecipe = { ...recipe, id: Date.now() };
      setRecipes(prev => [...prev, newRecipe]);
    }
    setEditingRecipe(null);
    alert('✅ Рецепт успешно сохранён!');
  };

  return (
    <div style={{ background: '#0F172A', minHeight: '100vh', color: '#fff', padding: '32px 40px' }}>
      
      {/* ==================== ЗАГОЛОВОК + КНОПКА ДОБАВИТЬ ==================== */}
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

      {/* ==================== ПАНЕЛЬ УПРАВЛЕНИЯ ==================== */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '32px'
      }}>
        
        {/* Левая группа — полезные кнопки */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={{
            padding: '12px 24px',
            background: '#1E2937',
            border: 'none',
            color: '#94A3B8',
            fontSize: '16px',
            fontWeight: '600',
            borderRadius: '9999px',
            cursor: 'pointer'
          }}>
            📊 Экспорт в Excel
          </button>
          <button style={{
            padding: '12px 24px',
            background: '#1E2937',
            border: 'none',
            color: '#94A3B8',
            fontSize: '16px',
            fontWeight: '600',
            borderRadius: '9999px',
            cursor: 'pointer'
          }}>
            📄 Печать КП
          </button>
        </div>

        {/* Правая группа — Переключение вида */}
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
              transition: 'color 0.25s ease',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '22px', opacity: viewMode === 'grid' ? 0.9 : 0.45 }}>▦</span>
            Плитка
            {viewMode === 'grid' && (
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
              transition: 'color 0.25s ease',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '24px', opacity: viewMode === 'list' ? 0.9 : 0.45, lineHeight: 1 }}>≡</span>
            Список
            {viewMode === 'list' && (
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

      {/* ==================== КАРТОЧКИ (ПЛИТКА) ==================== */}
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '24px' }}>
          {recipes.map(recipe => (
            <div key={recipe.id} style={{
              background: '#1E2937',
              borderRadius: '20px',
              padding: '24px',
              transition: 'all 0.25s ease'
            }}>
              <div style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>
                {recipe.code}
              </div>
              <div style={{ color: '#94A3B8', marginBottom: '20px' }}>{recipe.name}</div>

              <div style={{ fontSize: '32px', fontWeight: '700', color: '#60A5FA', marginBottom: '20px' }}>
                {recipe.price.toLocaleString()} ₽
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '15px', marginBottom: '24px' }}>
                <div>Цемент: <strong>{recipe.cement} кг</strong></div>
                <div>Песок: <strong>{recipe.sand} кг</strong></div>
                <div>Щебень: <strong>{recipe.gravel} кг</strong></div>
                <div>Вода: <strong>{recipe.water} кг</strong></div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  onClick={() => setEditingRecipe(recipe)}
                  style={{ flex: 1, padding: '12px', background: '#3B82F6', border: 'none', borderRadius: '9999px', color: 'white', fontWeight: '600' }}
                >
                  ✏️ Редактировать
                </button>
                <button 
                  onClick={() => setRecipes(prev => prev.filter(r => r.id !== recipe.id))}
                  style={{ flex: 1, padding: '12px', background: '#EF4444', border: 'none', borderRadius: '9999px', color: 'white', fontWeight: '600' }}
                >
                  🗑️ Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ==================== РЕЖИМ СПИСКА ==================== */}
      {viewMode === 'list' && (
        <div style={{ background: '#1E2937', borderRadius: '20px', overflow: 'hidden' }}>
          {recipes.map(recipe => (
            <div key={recipe.id} style={{
              display: 'flex',
              alignItems: 'center',
              padding: '20px 28px',
              borderBottom: '1px solid #334155'
            }}>
              <div style={{ width: '140px', fontWeight: '700', fontSize: '20px' }}>{recipe.code}</div>
              <div style={{ flex: 1, color: '#CBD5E1' }}>{recipe.name}</div>
              <div style={{ width: '180px', fontSize: '24px', fontWeight: '700', color: '#60A5FA' }}>
                {recipe.price.toLocaleString()} ₽
              </div>
              <div style={{ display: 'flex', gap: '12px', width: '240px' }}>
                <button onClick={() => setEditingRecipe(recipe)} style={{ padding: '10px 20px', background: '#3B82F6', border: 'none', borderRadius: '9999px', color: 'white' }}>
                  Редактировать
                </button>
                <button onClick={() => setRecipes(prev => prev.filter(r => r.id !== recipe.id))} style={{ padding: '10px 20px', background: '#EF4444', border: 'none', borderRadius: '9999px', color: 'white' }}>
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