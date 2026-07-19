// app/api/adminCifra/delivery-settings/route.ts
// Тарифы расчёта стоимости доставки — одна строка настроек (id=1), см.
// scripts/delivery-settings-schema.sql и lib/deliveryPricing.ts.
// Редактируется только на вкладке «Тарифы доставки» страницы «Миксеры»
// (доступ туда — только роль admin, проверяется на клиенте, см.
// app/adminCifra/mixers/page.tsx), но читают её ВСЕ формы создания заявки
// (десктоп, мобильная админка, клиентская страница заказа) — поэтому GET
// здесь открыт всем ролям.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_DELIVERY_SETTINGS } from '@/lib/deliveryPricing';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabase.from('delivery_settings').select('*').eq('id', 1).maybeSingle();

  // Таблица могла ещё не быть создана (см. scripts/delivery-settings-schema.sql)
  // или запрос мог упасть по другой причине — не роняем формы заявок из-за
  // этого, просто отдаём захардкоженные значения по умолчанию (те же, что
  // были в коде до появления этой настройки).
  if (error || !data) {
    return NextResponse.json(DEFAULT_DELIVERY_SETTINGS);
  }

  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, updated_at, ...rest } = body;

  const numericFields = [
    'price_tier_10',
    'price_tier_12',
    'price_tier_trip',
    'price_per_m3_over_50',
    'price_per_km',
    'road_curvature_coefficient',
  ] as const;

  const updateData: Record<string, number> = {};
  for (const field of numericFields) {
    const value = Number(rest[field]);
    if (!Number.isFinite(value) || value < 0) {
      return NextResponse.json({ error: `Некорректное значение поля ${field}` }, { status: 400 });
    }
    updateData[field] = value;
  }
  (updateData as any).updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('delivery_settings')
    .update(updateData)
    .eq('id', 1)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
