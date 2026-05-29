// app/api/adminCifra/staff/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Получаем всех сотрудников
    const { data: staffList, error } = await supabase
      .from('users')
      .select('user_id, full_name, username, phone, role, created_at')
      .in('role', ['admin', 'manager', 'dispatcher', 'operator', 'logist'])
      .order('full_name');

    if (error) throw error;

    // Для каждого сотрудника считаем статистику
    const staffWithStats = await Promise.all(
      staffList.map(async (staff: any) => {
        // Клиенты, привязанные к этому сотруднику
        const { data: clients, error: clientsError } = await supabase
          .from('users')
          .select('user_id')
          .eq('assigned_to', staff.user_id);

        if (clientsError) {
          console.error('Clients error for', staff.user_id, clientsError);
        }

        const clientIds = clients?.map(c => c.user_id) || [];

        // Объём заказов по этим клиентам
        let totalVolume = 0;
        if (clientIds.length > 0) {
          const { data: orders } = await supabase
            .from('orders')
            .select('volume')
            .in('user_id', clientIds);

          totalVolume = orders?.reduce((sum: number, o: any) => sum + (Number(o.volume) || 0), 0) || 0;
        }

        return {
          ...staff,
          clients_count: clientIds.length,
          total_volume: totalVolume
        };
      })
    );

    return NextResponse.json(staffWithStats);
  } catch (error: any) {
    console.error('Staff API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}