import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('user_id, full_name, organization_name, role')
      .in('role', ['admin', 'manager', 'dispatcher', 'operator'])  // Только сотрудники
      .order('organization_name', { ascending: true });

    if (error) throw error;

    console.log(`✅ Найдено сотрудников: ${data?.length || 0}`);

    return NextResponse.json({ 
      success: true, 
      employees: data || [] 
    });
  } catch (error: any) {
    console.error('Employees API error:', error);
    return NextResponse.json({ 
      success: true, 
      employees: [] 
    });
  }
}