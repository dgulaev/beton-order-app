// app/api/adminCifra/clients/duplicates/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Простой запрос без сложных join
    const { data: users, error } = await supabase
      .from('users')
      .select('user_id, phone, full_name, organization_name, inn')
      .eq('role', 'client')
      .not('inn', 'is', null)
      .order('inn');

    if (error) throw error;

    // Группируем по ИНН
    const grouped = users.reduce((acc: any, user: any) => {
      const inn = user.inn?.trim();
      if (!inn) return acc;

      if (!acc[inn]) {
        acc[inn] = {
          inn: inn,
          organization_name: user.organization_name,
          clients: []
        };
      }

      acc[inn].clients.push({
        user_id: user.user_id,
        phone: user.phone,
        full_name: user.full_name,
        organization_name: user.organization_name
      });

      return acc;
    }, {});

    const duplicates = Object.values(grouped).filter((g: any) => g.clients.length > 1);

   // console.log(`🔍 Найдено групп дублей: ${duplicates.length}`);
    return NextResponse.json(duplicates);

  } catch (error: any) {
    console.error('❌ Duplicates API Error:', error.message);
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 });
  }
}