import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: staff } = await supabase
      .from('users')
      .select('user_id, full_name, role')
      .in('role', ['admin', 'manager', 'dispatcher', 'operator'])
      .order('full_name');

    console.log('Staff count:', staff?.length);

    const result: any[] = [];

    for (const employee of staff || []) {
      const employeeId = employee.user_id;

      console.log(`Checking for ${employee.full_name} (ID: ${employeeId})`);

      const { data: clients, error } = await supabase
        .from('users')
        .select('user_id, full_name, organization_name, curator_id')
        .eq('curator_id', employeeId);

      console.log(`  Found clients: ${clients?.length || 0}`);

      const clientsList = clients || [];

      const totalVolume = clientsList.reduce((sum: number, c: any) => sum + (Number(c.total_volume) || 0), 0);
      const totalClients = clientsList.length;
      const avgVolume = totalClients > 0 ? totalVolume / totalClients : 0;

      let efficiency = totalClients > 0 ? 'Средне' : 'Требует внимания';
      let efficiencyColor = totalClients > 0 ? '#60A5FA' : '#EF4444';

      result.push({
        user_id: employee.user_id,
        full_name: employee.full_name,
        role: employee.role,
        clients_count: totalClients,
        total_volume: parseFloat(totalVolume.toFixed(1)),
        avg_volume_per_client: parseFloat(avgVolume.toFixed(1)),
        efficiency,
        efficiencyColor,
        clients: clientsList.map((c: any) => ({
          name: c.organization_name || c.full_name || '—',
          volume: 0
        }))
      });
    }

    console.log('Final result sent to frontend');
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Performance API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}