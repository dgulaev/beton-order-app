// app/api/adminCifra/clients/grouped/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('user_id, phone, full_name, organization_name, inn, created_at')
      .eq('role', 'client')
      .order('organization_name');

    if (error) throw error;

    const { data: allOrders } = await supabase
      .from('orders')
      .select('user_id, volume');

    // Очень агрессивная нормализация названия
    const normalizeName = (name: string): string => {
      if (!name) return 'no-name';
      return name
        .replace(/["«»]/g, '')           // убираем кавычки
        .replace(/ООО\s*/gi, '')         // убираем "ООО"
        .replace(/ИП\s*/gi, '')          // убираем "ИП"
        .replace(/\s+/g, '')             // убираем все пробелы
        .replace(/[^a-zA-Zа-яА-Я0-9]/g, '') // убираем все спецсимволы
        .toLowerCase()
        .trim();
    };

    const grouped = users.reduce((acc: any, user: any) => {
      const innKey = user.inn ? user.inn.trim() : 'no-inn';
      const nameKey = normalizeName(user.organization_name || user.full_name || '');

      const key = `${innKey}_${nameKey}`;

      if (!acc[key]) {
        acc[key] = {
          groupId: key,
          inn: user.inn,
          organization_name: user.organization_name || user.full_name,
          full_name: user.full_name,
          phones: [],
          totalVolume: 0,
          totalOrders: 0,
          clients: []
        };
      }

      if (user.phone) acc[key].phones.push(user.phone);
      acc[key].clients.push(user);

      return acc;
    }, {});

    // Распределяем заказы
    if (allOrders) {
      allOrders.forEach((order: any) => {
        Object.values(grouped).forEach((group: any) => {
          if (group.clients.some((c: any) => c.user_id === order.user_id)) {
            group.totalVolume += Number(order.volume || 0);
            group.totalOrders += 1;
          }
        });
      });
    }

    const result = Object.values(grouped);

    console.log(`✅ Сформировано ${result.length} групп (агрессивная нормализация)`);
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('❌ Grouped API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}