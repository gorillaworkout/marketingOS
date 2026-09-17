export interface LogTokenUsageParams {
  userId: string;
  taskId?: string | null;
  model: string;
  provider?: string;
  accountSource?: string;
  taskType: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/**
 * Inserts one `token_logs` row. `task_id` is omitted when the caller has no
 * `tasks` row (AI Research conversations) or the id is not yet committed.
 */
export async function logTokenUsage(params: LogTokenUsageParams): Promise<void> {
  try {
    const { queryOne, execute } = await import('@/lib/database');
    const { v4: uuidv4 } = await import('uuid');
    const task = params.taskId
      ? await queryOne('SELECT id FROM tasks WHERE id = ?', [params.taskId])
      : null;
    const deptRow = await queryOne<{ department_id: string | null }>(
      'SELECT department_id FROM users WHERE id = ?',
      [params.userId],
    );
    await execute(
      'INSERT INTO token_logs (id, user_id, task_id, model, provider, account_source, department_id, task_type, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        uuidv4(),
        params.userId,
        task ? params.taskId : null,
        params.model,
        params.provider || 'gorillaworkout',
        params.accountSource || 'office',
        deptRow?.department_id || null,
        params.taskType || '',
        params.inputTokens,
        params.outputTokens,
        params.cost,
      ],
    );
  } catch (error) {
    console.error('Failed to log token usage:', error);
  }
}
