import { parseCompareSides, type AiResearchCompareRequest } from './ai-research-compare';
import { normalizeProjectId } from './ai-research-projects';
import { parseChatRequest, type AiResearchChatMessage, type AiResearchMode } from './ai-research';

export interface AiResearchChatBody {
  messages: AiResearchChatMessage[];
  conversationId?: string;
  projectId?: string;
  pinnedSourceUrls: string[];
  mode: AiResearchMode;
  compare?: AiResearchCompareRequest;
}

export function parseAiResearchChatBody(body: unknown): AiResearchChatBody {
  const parsed = parseChatRequest(body);
  const raw = (body && typeof body === 'object') ? body as { projectId?: unknown; compare?: unknown } : {};
  return {
    ...parsed,
    projectId: normalizeProjectId(raw.projectId),
    compare: parseCompareSides(raw.compare),
  };
}
