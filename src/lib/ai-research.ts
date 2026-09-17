export const AI_RESEARCH_MAX_IMAGES = 4;
export const AI_RESEARCH_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const AI_RESEARCH_MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;
export const AI_RESEARCH_IMAGE_ONLY_PROMPT = 'Tolong analisis gambar terlampir.';
export const AI_RESEARCH_ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type AiResearchImageType = (typeof AI_RESEARCH_ALLOWED_IMAGE_TYPES)[number];

export interface AiResearchImage {
  mimeType: AiResearchImageType;
  dataUrl: string;
  name?: string;
}

export interface AiResearchChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: AiResearchImage[];
}

export type GatewayContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type GatewayMessage = {
  role: string;
  content: string | GatewayContentPart[];
};

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

export function isAllowedImageType(value: unknown): value is AiResearchImageType {
  return typeof value === 'string'
    && (AI_RESEARCH_ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export function imageAttachmentError(message: string): Error {
  const error = new Error(message);
  error.name = 'AiResearchImageError';
  return error;
}

function decodeBase64Length(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function validateImageAttachment(value: unknown, index = 0): AiResearchImage {
  if (!value || typeof value !== 'object') {
    throw imageAttachmentError(`Image ${index + 1} is invalid.`);
  }

  const image = value as { mimeType?: unknown; dataUrl?: unknown; name?: unknown };
  if (typeof image.dataUrl !== 'string') {
    throw imageAttachmentError(`Image ${index + 1} is missing image data.`);
  }

  const match = image.dataUrl.trim().match(DATA_URL_PATTERN);
  if (!match) {
    throw imageAttachmentError('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }

  const mimeType = match[1];
  if (!isAllowedImageType(mimeType)) {
    throw imageAttachmentError('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }
  if (typeof image.mimeType === 'string' && image.mimeType !== mimeType) {
    throw imageAttachmentError(`Image ${index + 1} type does not match the file data.`);
  }

  const bytes = decodeBase64Length(match[2]);
  if (bytes <= 0) {
    throw imageAttachmentError(`Image ${index + 1} is empty.`);
  }
  if (bytes > AI_RESEARCH_MAX_IMAGE_BYTES) {
    throw imageAttachmentError('Each image must be 4 MB or smaller.');
  }

  const name = typeof image.name === 'string' ? image.name.trim().slice(0, 120) : undefined;
  return { mimeType, dataUrl: `data:${mimeType};base64,${match[2]}`, name: name || undefined };
}

export function validateImageAttachments(value: unknown): AiResearchImage[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw imageAttachmentError('Images must be sent as a list.');
  }
  if (value.length > AI_RESEARCH_MAX_IMAGES) {
    throw imageAttachmentError(`You can attach up to ${AI_RESEARCH_MAX_IMAGES} images per message.`);
  }

  const images = value.map((item, index) => validateImageAttachment(item, index));
  const totalBytes = images.reduce((sum, image) => {
    const match = image.dataUrl.match(DATA_URL_PATTERN);
    return sum + (match ? decodeBase64Length(match[2]) : 0);
  }, 0);
  if (totalBytes > AI_RESEARCH_MAX_TOTAL_IMAGE_BYTES) {
    throw imageAttachmentError('Attached images exceed the 6 MB total limit.');
  }
  return images;
}

export function extractMessageText(message: { content?: unknown }): string {
  if (typeof message.content === 'string') return message.content.trim();
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map(part => (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function normalizeChatMessage(value: unknown): AiResearchChatMessage {
  if (!value || typeof value !== 'object') {
    throw imageAttachmentError('Each message must be an object.');
  }
  const raw = value as { role?: unknown; content?: unknown; images?: unknown };
  if (raw.role !== 'user' && raw.role !== 'assistant') {
    throw imageAttachmentError('Each message must have a user or assistant role.');
  }
  const images = validateImageAttachments(raw.images);
  const content = extractMessageText(raw);
  if (raw.role === 'assistant' && images.length > 0) {
    throw imageAttachmentError('Only user messages can include images.');
  }
  const message: AiResearchChatMessage = { role: raw.role, content };
  if (images.length) message.images = images;
  return message;
}

export function parseChatRequest(body: unknown): {
  messages: AiResearchChatMessage[];
  conversationId?: string;
} {
  if (!body || typeof body !== 'object') {
    throw imageAttachmentError('Invalid JSON body');
  }
  const raw = body as { messages?: unknown; conversationId?: unknown };
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    throw imageAttachmentError('Messages are required');
  }

  const messages = raw.messages.map(normalizeChatMessage);
  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== 'user') {
    throw imageAttachmentError('Last message must be from user with text or at least one image');
  }
  if (!lastMessage.content && !(lastMessage.images?.length)) {
    throw imageAttachmentError('Last message must be from user with text or at least one image');
  }
  if (!lastMessage.content && lastMessage.images?.length) {
    lastMessage.content = AI_RESEARCH_IMAGE_ONLY_PROMPT;
  }

  const conversationId = typeof raw.conversationId === 'string' && raw.conversationId.trim()
    ? raw.conversationId.trim()
    : undefined;
  return { messages, conversationId };
}

export function conversationTitleFromMessages(messages: AiResearchChatMessage[]): string {
  const firstUser = messages.find(message => message.role === 'user');
  if (!firstUser) return 'New conversation';
  const text = firstUser.content.trim();
  if (text && text !== AI_RESEARCH_IMAGE_ONLY_PROMPT) return text.slice(0, 80);
  if (firstUser.images?.length) return `Image analysis (${firstUser.images.length})`;
  return text.slice(0, 80) || 'New conversation';
}

export function buildMultimodalContent(text: string, images: AiResearchImage[] = []): string | GatewayContentPart[] {
  if (!images.length) return text;
  const parts: GatewayContentPart[] = [];
  if (text.trim()) parts.push({ type: 'text', text });
  for (const image of images) {
    parts.push({ type: 'image_url', image_url: { url: image.dataUrl } });
  }
  return parts;
}

export function storedMessageText(message: AiResearchChatMessage, includeImages: boolean): string {
  const text = message.content.trim();
  if (includeImages || !message.images?.length) return text;
  const note = `[${message.images.length} image(s) were attached to this message]`;
  return text ? `${text}\n\n${note}` : note;
}

export function buildGatewayMessages(
  systemPrompt: string,
  history: AiResearchChatMessage[],
  incoming: AiResearchChatMessage[],
  maxHistory = 20,
): GatewayMessage[] {
  const combined = [...history, ...incoming].slice(-maxHistory);
  const imageIndexes = combined
    .map((message, index) => (message.role === 'user' && message.images?.length ? index : -1))
    .filter(index => index >= 0);
  const keepImages = new Set(imageIndexes.slice(-2));

  return [
    { role: 'system', content: systemPrompt },
    ...combined.map((message, index) => {
      const includeImages = keepImages.has(index);
      return {
        role: message.role,
        content: buildMultimodalContent(
          storedMessageText(message, includeImages),
          includeImages ? message.images : undefined,
        ),
      };
    }),
  ];
}

export function parseStoredMessages(raw: string | null | undefined): AiResearchChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => {
      try {
        return normalizeChatMessage(item);
      } catch {
        if (!item || typeof item !== 'object') return null;
        const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
        if (!role) return null;
        return { role, content: extractMessageText(item) };
      }
    }).filter((item): item is AiResearchChatMessage => Boolean(item));
  } catch {
    return [];
  }
}
