import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request);
    if (auth.error) return auth.error;

    const { data: users, error } = await supabase
      .from('users')
      .select('user_id, phone, full_name, organization_name, inn')
      .eq('role', 'client')
      .not('inn', 'is', null)
      .order('inn');

    if (error) throw error;

    const grouped = (users || []).reduce((acc: any, user: any) => {
      const inn = user.inn?.trim();
      if (!inn) return acc;

      if (!acc[inn]) {
        acc[inn] = {
          inn,
          organization_name: user.organization_name,
          clients: [],
        };
      }

      acc[inn].clients.push({
        user_id: user.user_id,
        phone: user.phone,
        full_name: user.full_name,
        organization_name: user.organization_name,
      });

      return acc;
    }, {});

    const duplicates = Object.values(grouped).filter((g: any) => g.clients.length > 1);

    return NextResponse.json(duplicates);
  } catch (error: any) {
    console.error('❌ Duplicates API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
