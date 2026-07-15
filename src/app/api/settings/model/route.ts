import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { AVAILABLE_MODELS } from '@/lib/openai';
import { v4 as uuidv4 } from 'uuid';

// GET: Return current user's preferred model + per-task preferences + available models
export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();
  const pref = db.prepare(
    'SELECT preferred_model FROM user_preferences WHERE user_id = ?'
  ).get(userId) as { preferred_model: string } | undefined;

  const currentModel = pref?.preferred_model || 'deepseek/deepseek-v4-flash';

  // Fetch per-task preferences
  const taskPrefs = db.prepare(
    'SELECT task_type, model FROM task_model_preferences WHERE user_id = ?'
  ).all(userId) as { task_type: string; model: string }[];

  const taskModelPreferences: Record<string, string> = {};
  for (const row of taskPrefs) {
    taskModelPreferences[row.task_type] = row.model;
  }

  return NextResponse.json({
    currentModel,
    models: AVAILABLE_MODELS.map(m => ({
      id: m.id,
      name: m.name,
      tier: m.tier,
      provider: m.provider,
      inputPrice: m.input,
      outputPrice: m.output,
    })),
    taskModelPreferences,
  });
}

// PUT: Save user's preferred model (global or per-task)
export async function PUT(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const body = await request.json();
  const { model, taskType } = body;

  if (!model || !AVAILABLE_MODELS.find(m => m.id === model)) {
    return NextResponse.json({ error: 'Invalid model' }, { status: 400 });
  }

  const db = await getDb();

  if (taskType) {
    // Save per-task preference
    const validTaskTypes = ['caption', 'image-prompt', 'video-script', 'event-plan'];
    if (!validTaskTypes.includes(taskType)) {
      return NextResponse.json({ error: 'Invalid task type' }, { status: 400 });
    }
    const modelInfo = AVAILABLE_MODELS.find(m => m.id === model);
    db.prepare(
      `INSERT INTO task_model_preferences (id, user_id, task_type, model, provider, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, task_type) DO UPDATE SET model = excluded.model, provider = excluded.provider, updated_at = datetime('now')`
    ).run(uuidv4(), userId, taskType, model, modelInfo?.provider || 'openrouter');
  } else {
    // Save global preference
    db.prepare(
      `INSERT INTO user_preferences (id, user_id, preferred_model, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET preferred_model = excluded.preferred_model, updated_at = datetime('now')`
    ).run(uuidv4(), userId, model);
  }
  saveDbToDisk();

  return NextResponse.json({ success: true, model, taskType: taskType || null });
}
