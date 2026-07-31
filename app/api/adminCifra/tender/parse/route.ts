import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { fetchAndParseTenderUrl } from '@/lib/tender/parseTenderPage';

export const maxDuration = 120;

/** POST { url } — разобрать карточку ЭТП (lot-online и др.) в поля формы. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return NextResponse.json({ success: false, error: 'Нужна ссылка url' }, { status: 400 });
    }
    const fields = await fetchAndParseTenderUrl(url);
    return NextResponse.json({ success: true, fields });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка разбора';
    console.error('[tender/parse]', message);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
