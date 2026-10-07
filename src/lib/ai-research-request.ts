import { parseCompareSides, type AiResearchCompareRequest } from './ai-research-compare';
import { normalizeProjectId } from './ai-research-projects';
import { parseAiResearchSkill, type AiResearchSkillId } from './ai-research-skills';
import { parseChatRequest, type AiResearchChatMessage, type AiResearchMode } from './ai-research';

export interface AiResearchChatBody {
  messages: AiResearchChatMessage[];
  conversationId?: string;
  projectId?: string;
  pinnedSourceUrls: string[];
  mode: AiResearchMode;
  compare?: AiResearchCompareRequest;
  skill?: AiResearchSkillId;
  retry: boolean;
}

export function parseAiResearchChatBody(body: unknown): AiResearchChatBody {
  const parsed = parseChatRequest(body);
  const raw = (body && typeof body === 'object') ? body as { projectId?: unknown; compare?: unknown; skill?: unknown; retry?: unknown } : {};
  return {
    ...parsed,
    projectId: normalizeProjectId(raw.projectId),
    compare: parseCompareSides(raw.compare),
    skill: parseAiResearchSkill(raw.skill),
    retry: raw.retry === true,
  };
}
