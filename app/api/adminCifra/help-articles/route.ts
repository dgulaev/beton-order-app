// GET — чтение смерженных инструкций (без auth: только тексты справки).
// PUT / DELETE — только admin.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { getDefaultHelpArticle } from '@/lib/help/defaultArticles';
import {
  buildArticleForUpsert,
  isHelpArticlesUnavailableError,
  loadMergedHelpArticles,
} from '@/lib/help/mergeArticles';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const TABLE_HINT =
  'Таблица help_articles недоступна API. Выполни scripts/help-articles-schema.sql в Supabase, затем Project Settings → API → Reload schema (или NOTIFY pgrst, \'reload schema\';).';

export async function GET() {
  const { articles, overrideIds, tableMissing } = await loadMergedHelpArticles();
  return NextResponse.json({
    articles,
    overrideIds,
    ...(tableMissing ? { warning: TABLE_HINT } : {}),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  const payload =
    body && typeof body === 'object' && 'article' in body
      ? (body as { article: unknown }).article
      : body;

  const built = buildArticleForUpsert(payload);
  if (built.error || !built.article) {
    return NextResponse.json({ error: built.error || 'Ошибка валидации' }, { status: 400 });
  }

  const a = built.article;
  const { error } = await supabaseAdmin.from('help_articles').upsert(
    {
      id: a.id,
      title: a.title,
      summary: a.summary,
      roles: a.roles,
      route: a.route ?? null,
      routes: a.routes ?? null,
      body: a.body,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.user_id,
    },
    { onConflict: 'id' },
  );

  if (error) {
    if (isHelpArticlesUnavailableError(error.message)) {
      return NextResponse.json({ error: TABLE_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const merged = await loadMergedHelpArticles();
  return NextResponse.json({
    success: true,
    article: merged.articles.find((x) => x.id === a.id) ?? a,
    articles: merged.articles,
    overrideIds: merged.overrideIds,
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  const id = request.nextUrl.searchParams.get('id')?.trim() || '';
  if (!id || !getDefaultHelpArticle(id)) {
    return NextResponse.json({ error: 'Неизвестный id статьи' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('help_articles').delete().eq('id', id);

  if (error) {
    if (isHelpArticlesUnavailableError(error.message)) {
      return NextResponse.json({ error: TABLE_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const merged = await loadMergedHelpArticles();
  return NextResponse.json({
    success: true,
    articles: merged.articles,
    overrideIds: merged.overrideIds,
  });
}
