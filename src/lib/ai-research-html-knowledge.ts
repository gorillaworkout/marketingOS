import { createHash } from 'node:crypto';
import { isHtmlAttachment, type AiResearchChatMessage } from './ai-research';
import { persistKnowledgeQuietly, type PersistKnowledgeInput } from './knowledge-persist';

export const HTML_KNOWLEDGE_TASK = 'ai-research';
const OUTPUT_CHAR_LIMIT = 8_000;

/** Same content → same task id, so a re-upload updates instead of duplicating. */
export function htmlUploadKnowledgeTaskId(text: string): string {
  return `html-${createHash('sha256').update(text).digest('hex').slice(0, 40)}`;
}

/** Knowledge Graph row for one uploaded HTML file, shaped like FAQ & Guides uploads. */
export function htmlUploadKnowledgePayload(input: {
  userId: string;
  name?: string;
  text: string;
  conversationId?: string | null;
  projectId?: string | null;
}): PersistKnowledgeInput | null {
  const selectedOutput = input.text.replace(/\s+/g, ' ').trim().slice(0, OUTPUT_CHAR_LIMIT);
  if (!input.userId || selectedOutput.length < 8) return null;
  const title = (input.text.match(/^Page title: (.+)$/m)?.[1] || input.name || 'HTML page')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return {
    userId: input.userId,
    taskType: HTML_KNOWLEDGE_TASK,
    taskId: htmlUploadKnowledgeTaskId(input.text),
    brief: `Uploaded HTML: ${title}`.slice(0, 2_000),
    selectedOutput,
    action: 'complete',
    conversationId: input.conversationId ?? null,
    projectId: input.projectId ?? null,
    updateStylePreferences: false,
    upsertTask: true,
  };
}

/** Save every HTML attachment of the incoming messages to the Knowledge Graph. */
export async function persistHtmlUploadsToKnowledge(input: {
  userId: string;
  messages: AiResearchChatMessage[];
  conversationId?: string | null;
  projectId?: string | null;
}): Promise<number> {
  let saved = 0;
  for (const message of input.messages) {
    if (message.role !== 'user' || !message.files?.length) continue;
    for (const file of message.files) {
      if (!isHtmlAttachment(file) || !file.extractedText) continue;
      const payload = htmlUploadKnowledgePayload({
        userId: input.userId,
        name: file.name,
        text: file.extractedText,
        conversationId: input.conversationId,
        projectId: input.projectId,
      });
      if (!payload) continue;
      const result = await persistKnowledgeQuietly(payload);
      if (result && !result.skipped) saved += 1;
    }
  }
  return saved;
}
