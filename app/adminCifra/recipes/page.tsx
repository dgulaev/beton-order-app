'use client';

import { useState } from 'react';

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<any[]>([
    { id: 1, code: 'М300', name: 'Бетон М300', cement: 340, sand: 680, gravel: 1100, water: 180, additive: 2.5 },
    { id: 2, code: 'М350', name: 'Бетон М350', cement: 380, sand: 650, gravel: 1050, water: 175, additive: 3.0 },
    { id: 3, code: 'М400', name: 'Бетон М400', cement: 420, sand: 620, gravel: 1020, water: 170, additive: 3.5 },
  ]);

  return (
    <div style={{ 
      backgroundColor: '#0F172A', 
      minHeight: '100vh', 
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>

      {/* Верхняя панель */}
      <div style={{
        backgroundColor: '#1E2937',
        padding: '20px 40px',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button 
            onClick={() => window.location.href = '/adminCifra/reports'}
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              color: '#94A3B8',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              padding: '8px 16px',
              borderRadius: '9999px'
            }}
          >
            ← Назад к отчётам
          </button>

          <div>
            <div style={{ fontSize: '28px', fontWeight: '700' }}>Рецепты производства MEKA</div>
            <div style={{ color: '#94A3B8', fontSize: '15px' }}>База рецептур и расход материалов</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '40px' }}>
        <div style={{ maxWidth: '1600px', margin: '0 auto' }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '700' }}>Рецепты бетона</h1>
            <button style={{
              backgroundColor: '#10B981',
              color: 'white',
              padding: '14px 32px',
              borderRadius: '9999px',
              border: 'none',
              fontWeight: '600',
              cursor: 'pointer'
            }}>
              + Добавить новый рецепт
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px' }}>
            {recipes.map(recipe => (
              <div key={recipe.id} style={{
                backgroundColor: '#1E2937',
                padding: '24px',
                borderRadius: '20px'
              }}>
                <div style={{ fontSize: '22px', fontWeight: '700', marginBottom: '16px' }}>
                  {recipe.code} — {recipe.name}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '15px' }}>
                  <div>Цемент: <strong>{recipe.cement} кг</strong></div>
                  <div>Песок: <strong>{recipe.sand} кг</strong></div>
                  <div>Щебень: <strong>{recipe.gravel} кг</strong></div>
                  <div>Вода: <strong>{recipe.water} кг</strong></div>
                  <div>Добавка: <strong>{recipe.additive} кг</strong></div>
                </div>

                <div style={{ marginTop: '20px', display: 'flex', gap: '8px' }}>
                  <button style={{ flex: 1, padding: '10px', backgroundColor: '#3B82F6', border: 'none', borderRadius: '9999px', color: 'white', cursor: 'pointer' }}>
                    Редактировать
                  </button>
                  <button style={{ flex: 1, padding: '10px', backgroundColor: '#EF4444', border: 'none', borderRadius: '9999px', color: 'white', cursor: 'pointer' }}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}