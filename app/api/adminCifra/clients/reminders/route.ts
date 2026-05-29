// app/api/adminCifra/clients/reminders/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get('userId');

    if (!userIdParam) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const currentUserId = parseInt(userIdParam);

    console.log(`🔍 [Reminders Debug] Запрос для userId: ${currentUserId}`);

    const { data: currentUser } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', currentUserId)
      .single();

    console.log(`👤 Роль: ${currentUser?.role}`);

    const today = new Date().toISOString().split('T')[0];

    // Получаем ВСЕХ клиентов с next_contact
    const { data: allClients, error } = await supabase
      .from('users')
      .select('user_id, full_name, organization_name, phone, next_contact, predicted_next_order, assigned_to, inn')
      .eq('role', 'client')
      .not('next_contact', 'is', null)
      .lte('next_contact', today + 'T23:59:59')
      .order('next_contact', { ascending: true });

    if (error) throw error;

    console.log(`📊 Всего клиентов с next_contact: ${allClients?.length || 0}`);

    let filtered = allClients || [];

    // Фильтрация
    if (currentUser?.role !== 'admin') {
      filtered = filtered.filter((c: any) => {
        const isAssigned = c.assigned_to === currentUserId;
        if (isAssigned) {
          console.log(`✅ Найден привязанный клиент: ${c.organization_name} (ID ${c.user_id})`);
        }
        return isAssigned;
      });
    }

    const result = filtered.map((c: any) => ({
      ...c,
      groupId: c.inn 
        ? `${c.inn}_${(c.organization_name || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '')}` 
        : null,
      isOverdue: new Date(c.next_contact) < new Date()
    }));

    console.log(`📢 [Reminders] Итогово найдено ${result.length} напоминаний`);

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Reminders API error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}