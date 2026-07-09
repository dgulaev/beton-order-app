import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — получение задач + имена (исправленный)
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Получаем задачи
    const { data: tasksData, error } = await supabase
      .from('tasks')
      .select('*')
      .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!tasksData || tasksData.length === 0) {
      return NextResponse.json({ success: true, tasks: [] });
    }

    // Получаем все уникальные user_id
    const userIds = [...new Set(tasksData.flatMap(t => [t.created_by, t.assigned_to]).filter(Boolean))];

    // Получаем имена пользователей
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('user_id, full_name, organization_name')
      .in('user_id', userIds);

    if (usersError) console.error('Users fetch error:', usersError);

    const usersMap = new Map((usersData || []).map(u => [u.user_id, u]));

    // Добавляем имена в задачи
    const enrichedTasks = tasksData.map(task => ({
      ...task,
      creator: usersMap.get(task.created_by) || null,
      assignee: usersMap.get(task.assigned_to) || null
    }));

    return NextResponse.json({ success: true, tasks: enrichedTasks });
  } catch (error: any) {
    console.error('GET tasks error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — создание задачи + уведомление
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, assigned_to, due_date, created_by } = body;

    if (!title || !created_by) {
      return NextResponse.json({ error: 'title and created_by are required' }, { status: 400 });
    }

    // Создаём задачу
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title,
        description: description || null,
        assigned_to: assigned_to || null,
        due_date: due_date || null,
        created_by,
        status: 'new'
      })
      .select()
      .single();

    if (error) throw error;

    // === Получаем имена ===
    let creatorName = 'Неизвестно';
    let assigneeName = 'Не назначен';

    // Имя создателя
    if (data && data.created_by) {
      const { data: creator } = await supabase
        .from('users')
        .select('full_name, organization_name')
        .eq('user_id', data.created_by)
        .single();
      
      creatorName = creator?.organization_name || creator?.full_name || 'Неизвестно';
    }

    // Имя исполнителя
    if (data && data.assigned_to) {
      const { data: assignee } = await supabase
        .from('users')
        .select('full_name, organization_name')
        .eq('user_id', data.assigned_to)
        .single();
      
      assigneeName = assignee?.organization_name || assignee?.full_name || 'Не назначен';
    }

    // === Уведомление ===
    if (data && assigned_to && String(assigned_to) !== String(created_by)) {
      await supabase
        .from('admin_notifications')
        .insert({
          user_id: assigned_to,
          type: 'task',
          title: 'Новая задача',
          message: `Вам назначена задача: "${title}"\nОт: ${creatorName}\nКому: ${assigneeName}`,
          is_read: false
        });
    }

    return NextResponse.json({ success: true, task: data });
  } catch (error: any) {
    console.error('POST task error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PATCH — обновление задачи (статус или полные данные)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, status, title, description, assigned_to, due_date, completion_note } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const updateData: any = { updated_at: new Date().toISOString() };

    if (status) updateData.status = status;
    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (assigned_to !== undefined) updateData.assigned_to = assigned_to;
    if (due_date !== undefined) updateData.due_date = due_date;
    if (completion_note) {
      updateData.completion_note = completion_note;
      updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, task: data });
  } catch (error: any) {
    console.error('PATCH task error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE — удаление задачи (только автором)
export async function DELETE(request: NextRequest) {
  try {
    const { taskId, userId } = await request.json();

    if (!taskId || !userId) {
      return NextResponse.json({ error: 'taskId and userId are required' }, { status: 400 });
    }

    const userIdNum = parseInt(userId);

    // Проверяем, что пользователь — автор задачи
    const { data: task, error: checkError } = await supabase
      .from('tasks')
      .select('created_by')
      .eq('id', taskId)
      .single();

    if (checkError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (String(task.created_by) !== String(userIdNum)) {
      return NextResponse.json({ error: 'Only creator can delete task' }, { status: 403 });
    }

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE task error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}