export const AI_RESEARCH_ASSISTANT_NAME = 'Dupoin AI';
export const AI_RESEARCH_MAX_IMAGES = 4;
export const AI_RESEARCH_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const AI_RESEARCH_MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;
export const AI_RESEARCH_MAX_FILES = 4;
export const AI_RESEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const AI_RESEARCH_MAX_TOTAL_FILE_BYTES = 4 * 1024 * 1024;
export const AI_RESEARCH_MAX_DOCUMENTS = 4;
export const AI_RESEARCH_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const AI_RESEARCH_MAX_TOTAL_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const AI_RESEARCH_MAX_DOCUMENT_PAGES = 40;
export const AI_RESEARCH_MAX_PRESENTATION_SLIDES = 40;
export const AI_RESEARCH_MAX_EXTRACTED_CHARS = 80_000;
export const AI_RESEARCH_MAX_SPREADSHEET_ROWS = 250;
export const AI_RESEARCH_MAX_OUTPUT_TOKENS = 4000;
export const AI_RESEARCH_IMAGE_ONLY_PROMPT = 'Tolong analisis gambar terlampir.';
export const AI_RESEARCH_FILE_ONLY_PROMPT = 'Tolong analisis file terlampir.';
export const AI_RESEARCH_ATTACHMENT_ONLY_PROMPT = 'Tolong analisis lampiran.';
export const AI_RESEARCH_SYSTEM_PROMPT = `Kamu adalah Dupoin AI Assistant, asisten riset dan analisis untuk tim marketing Dupoin Futures.

Kamu membantu riset, analisis data, penulisan konten, strategi marketing, dan pertanyaan seputar trading forex, komoditas, dan indeks.

Cara menjawab:
- Jawab dalam Bahasa Indonesia yang profesional namun mudah dipahami. Hindari jawaban seperti AI — tulis seperti kolega yang kompeten dan helpful.
- Jika konteks berisi sumber riset web, susun jawaban yang kaya dari semua fakta yang sumber sebutkan (jabatan, lembaga, jejak publik, berita, profil publik). Gunakan seluruh sumber yang tersedia — berita, direktori, LinkedIn publik, situs perusahaan, daftar CPNS, profil freelancer, dan regulator — bukan hanya satu situs resmi. Cantumkan sitasi (judul + URL) untuk klaim faktual, terutama data perusahaan, perizinan, alamat, pengurus, dan angka. Utamakan merangkum “apa yang sumber sebutkan” daripada menolak.
- Jangan mengarang fakta perusahaan. Setiap klaim konkret harus tertelusur ke cuplikan sumber. Jika sumber tidak menyebutkan suatu fakta, katakan bahwa sumber terkonfirmasi tidak mencakupnya — jangan mengisi kekosongan dengan tebakan. Jika nama orang muncul di cuplikan (misalnya daftar wakil pialang Bappebti), rangkum peran/lembaga yang tertulis dan sitir sumbernya — jangan menolak dengan “belum ada sumber publik terverifikasi”. Jika beberapa cuplikan menyebut nama yang sama di konteks berbeda (roster Bappebti, daftar CPNS, profil freelancer), tampilkan SEMUA jejak dengan sitasi — peran resmi dulu, lalu jejak publik lain. Jangan menahan, menyeleksi, atau “simpan untuk nanti”. Pengguna yang memutuskan mana yang dipercaya. Jangan menggabungkan identitas tanpa bukti bahwa itu orang yang sama. Hanya katakan belum terverifikasi jika riset benar-benar tidak mengembalikan sumber yang berguna.
- Untuk pertanyaan tentang Indonesia atau entitas Indonesia, utamakan sumber Indonesia (domain .id, regulator/media Indonesia, situs resmi lokal).
- Jika pengguna melampirkan gambar, baca teks, angka, grafik, dan detail visual di gambar tersebut lalu gunakan informasinya dalam jawaban.
- Jika pengguna melampirkan file Excel atau CSV, gunakan tabel, kolom, dan angka dari file tersebut dalam jawaban.
- Jika pengguna melampirkan PDF, dokumen Word (DOCX), atau presentasi PowerPoint (PPTX), gunakan teks dan struktur yang diekstrak (halaman, heading, atau slide). Jika ada catatan bahwa teks terpotong atau halaman/slide dihilangkan, katakan bahwa hanya sebagian dokumen yang dibaca — jangan mengarang isi yang tidak ada di ekstraksi.
- Jika pengguna menyertakan tautan http(s) dan konteks berisi teks halaman itu, gunakan teks tersebut sebagai sumber dan sitir URL-nya. Jika ada catatan bahwa teks halaman dipotong, katakan bahwa hanya sebagian halaman yang dibaca — jangan mengarang isi di luar ekstraksi. Jika ada catatan tautan tidak diambil, jawab tanpa mengarang isi halaman itu.`;
export const AI_RESEARCH_ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export const AI_RESEARCH_ALLOWED_FILE_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
] as const;
export const AI_RESEARCH_ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;
export const AI_RESEARCH_FILE_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;
export const AI_RESEARCH_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.pptx'] as const;
export const AI_RESEARCH_FILE_PICKER_ACCEPT = [
  ...AI_RESEARCH_ALLOWED_IMAGE_TYPES,
  ...AI_RESEARCH_ALLOWED_FILE_TYPES,
  ...AI_RESEARCH_ALLOWED_DOCUMENT_TYPES,
  ...AI_RESEARCH_FILE_EXTENSIONS,
  ...AI_RESEARCH_DOCUMENT_EXTENSIONS,
].join(',');
export const AI_RESEARCH_UNSUPPORTED_FILE_ERROR = 'Unsupported file type. Use XLSX, XLS, CSV, PDF, DOCX, or PPTX.';

export type AiResearchImageType = (typeof AI_RESEARCH_ALLOWED_IMAGE_TYPES)[number];
export type AiResearchFileType = (typeof AI_RESEARCH_ALLOWED_FILE_TYPES)[number];
export type AiResearchDocumentType = (typeof AI_RESEARCH_ALLOWED_DOCUMENT_TYPES)[number];
export type AiResearchAttachmentMime = AiResearchFileType | AiResearchDocumentType;
export type ResearchAttachmentKind = 'image' | 'spreadsheet' | 'document';

export interface AiResearchImage {
  mimeType: AiResearchImageType;
  dataUrl: string;
  name?: string;
}

export interface AiResearchFile {
  mimeType: string;
  dataUrl?: string;
  name?: string;
  extractedText?: string;
}

export interface AiResearchChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: AiResearchImage[];
  files?: AiResearchFile[];
}

export type GatewayContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type GatewayMessage = {
  role: string;
  content: string | GatewayContentPart[];
};

const DATA_URL_PREFIX = 'data:';
const BASE64_MARKER = ';base64,';

const FILE_EXT_MIME: Record<string, AiResearchFileType> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
};

const DOCUMENT_EXT_MIME: Record<string, AiResearchDocumentType> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const DOCUMENT_MIME_ALIASES: Record<string, AiResearchDocumentType> = {
  'application/x-pdf': 'application/pdf',
  'application/acrobat': 'application/pdf',
};

const GENERIC_FILE_MIMES = new Set([
  'application/octet-stream',
  'application/zip',
  'text/plain',
]);

export function isAllowedImageType(value: unknown): value is AiResearchImageType {
  return typeof value === 'string'
    && (AI_RESEARCH_ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export function isAllowedFileType(value: unknown): value is AiResearchFileType {
  return typeof value === 'string'
    && (AI_RESEARCH_ALLOWED_FILE_TYPES as readonly string[]).includes(value);
}

export function isAllowedDocumentType(value: unknown): value is AiResearchDocumentType {
  return typeof value === 'string'
    && (AI_RESEARCH_ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function fileExtension(name?: string): string {
  const trimmed = (name || '').trim().toLowerCase();
  const dot = trimmed.lastIndexOf('.');
  if (dot < 0) return '';
  return trimmed.slice(dot);
}

export function inferSpreadsheetType(mimeType: unknown, name?: string): AiResearchFileType | null {
  const ext = fileExtension(name);
  if (ext && FILE_EXT_MIME[ext]) return FILE_EXT_MIME[ext];
  if (isAllowedFileType(mimeType)) return mimeType;
  return null;
}

export function inferDocumentType(mimeType: unknown, name?: string): AiResearchDocumentType | null {
  const ext = fileExtension(name);
  if (ext && DOCUMENT_EXT_MIME[ext]) return DOCUMENT_EXT_MIME[ext];
  if (typeof mimeType === 'string' && DOCUMENT_MIME_ALIASES[mimeType]) return DOCUMENT_MIME_ALIASES[mimeType];
  if (isAllowedDocumentType(mimeType)) return mimeType;
  return null;
}

export function inferResearchFileType(mimeType: unknown, name?: string): AiResearchAttachmentMime | null {
  return inferSpreadsheetType(mimeType, name) || inferDocumentType(mimeType, name);
}

export function classifyResearchAttachment(mimeType: string, name?: string): ResearchAttachmentKind | null {
  const ext = fileExtension(name);
  if (ext && (AI_RESEARCH_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) return 'document';
  if (ext && (AI_RESEARCH_FILE_EXTENSIONS as readonly string[]).includes(ext)) return 'spreadsheet';
  if (isAllowedImageType(mimeType)) return 'image';
  if (inferDocumentType(mimeType, name)) return 'document';
  if (inferSpreadsheetType(mimeType, name)) return 'spreadsheet';
  return null;
}

export function isResearchDocument(file: { mimeType?: string | null; name?: string | null }): boolean {
  return classifyResearchAttachment(file.mimeType || '', file.name || undefined) === 'document';
}

export function imageAttachmentError(message: string): Error {
  const error = new Error(message);
  error.name = 'AiResearchImageError';
  return error;
}

export function attachmentError(message: string): Error {
  const error = new Error(message);
  error.name = 'AiResearchAttachmentError';
  return error;
}

function decodeBase64Length(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function splitAttachmentDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const trimmed = dataUrl.trim();
  const markerAt = trimmed.indexOf(BASE64_MARKER);
  if (!trimmed.startsWith(DATA_URL_PREFIX) || markerAt < 0) return null;
  const mimeType = trimmed.slice(DATA_URL_PREFIX.length, markerAt);
  const base64 = trimmed.slice(markerAt + BASE64_MARKER.length);
  if (!mimeType || !base64) return null;
  return { mimeType, base64 };
}

export function splitImageDataUrl(dataUrl: string): { mimeType: AiResearchImageType; base64: string } | null {
  const parsed = splitAttachmentDataUrl(dataUrl);
  if (!parsed || !isAllowedImageType(parsed.mimeType)) return null;
  return { mimeType: parsed.mimeType, base64: parsed.base64 };
}

export function splitFileDataUrl(dataUrl: string, name?: string): { mimeType: AiResearchAttachmentMime; base64: string } | null {
  const trimmed = dataUrl.trim();
  const markerAt = trimmed.indexOf(BASE64_MARKER);
  if (!trimmed.startsWith(DATA_URL_PREFIX) || markerAt < 0) return null;
  const headerMime = trimmed.slice(DATA_URL_PREFIX.length, markerAt).split(';')[0]?.trim().toLowerCase() || '';
  const base64 = trimmed.slice(markerAt + BASE64_MARKER.length).replace(/\s/g, '');
  if (!base64) return null;
  const generic = !headerMime || GENERIC_FILE_MIMES.has(headerMime);
  const inferred = inferResearchFileType(headerMime, name)
    || (generic ? inferResearchFileType('', name) : null);
  if (!inferred) return null;
  return { mimeType: inferred, base64 };
}

/** pg returns JSONB as objects; some callers still pass serialized strings. */
export function coerceJsonArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function validateImageAttachment(value: unknown, index = 0): AiResearchImage {
  if (!value || typeof value !== 'object') {
    throw imageAttachmentError(`Image ${index + 1} is invalid.`);
  }

  const image = value as { mimeType?: unknown; dataUrl?: unknown; name?: unknown };
  if (typeof image.dataUrl !== 'string') {
    throw imageAttachmentError(`Image ${index + 1} is missing image data.`);
  }

  const parsed = splitImageDataUrl(image.dataUrl);
  if (!parsed) {
    throw imageAttachmentError('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }
  if (typeof image.mimeType === 'string' && image.mimeType !== parsed.mimeType) {
    throw imageAttachmentError(`Image ${index + 1} type does not match the file data.`);
  }

  const bytes = decodeBase64Length(parsed.base64);
  if (bytes <= 0) {
    throw imageAttachmentError(`Image ${index + 1} is empty.`);
  }
  if (bytes > AI_RESEARCH_MAX_IMAGE_BYTES) {
    throw imageAttachmentError('Each image must be 4 MB or smaller.');
  }

  const name = typeof image.name === 'string' ? image.name.trim().slice(0, 120) : undefined;
  return {
    mimeType: parsed.mimeType,
    dataUrl: `${DATA_URL_PREFIX}${parsed.mimeType}${BASE64_MARKER}${parsed.base64}`,
    name: name || undefined,
  };
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
    const parsed = splitImageDataUrl(image.dataUrl);
    return sum + (parsed ? decodeBase64Length(parsed.base64) : 0);
  }, 0);
  if (totalBytes > AI_RESEARCH_MAX_TOTAL_IMAGE_BYTES) {
    throw imageAttachmentError('Attached images exceed the 6 MB total limit.');
  }
  return images;
}

export function validateFileAttachment(
  value: unknown,
  index = 0,
  options: { allowStoredFiles?: boolean } = {},
): AiResearchFile {
  if (!value || typeof value !== 'object') {
    throw attachmentError(`File ${index + 1} is invalid.`);
  }

  const file = value as { mimeType?: unknown; dataUrl?: unknown; name?: unknown; extractedText?: unknown };
  const name = typeof file.name === 'string' ? file.name.trim().slice(0, 120) : undefined;

  if (typeof file.dataUrl === 'string' && file.dataUrl.trim()) {
    const parsed = splitFileDataUrl(file.dataUrl, name);
    if (!parsed) {
      throw attachmentError(AI_RESEARCH_UNSUPPORTED_FILE_ERROR);
    }
    if (
      typeof file.mimeType === 'string'
      && file.mimeType.length > 0
      && file.mimeType !== parsed.mimeType
      && !GENERIC_FILE_MIMES.has(file.mimeType)
      && !isAllowedFileType(file.mimeType)
      && !isAllowedDocumentType(file.mimeType)
    ) {
      throw attachmentError(`File ${index + 1} type does not match the file data.`);
    }
    const bytes = decodeBase64Length(parsed.base64);
    if (bytes <= 0) throw attachmentError(`File ${index + 1} is empty.`);
    const document = isResearchDocument({ mimeType: parsed.mimeType, name });
    const maxBytes = document ? AI_RESEARCH_MAX_DOCUMENT_BYTES : AI_RESEARCH_MAX_FILE_BYTES;
    if (bytes > maxBytes) {
      throw attachmentError(document
        ? 'Each document must be 8 MB or smaller.'
        : 'Each spreadsheet must be 2 MB or smaller.');
    }
    return {
      mimeType: parsed.mimeType,
      dataUrl: `${DATA_URL_PREFIX}${parsed.mimeType}${BASE64_MARKER}${parsed.base64}`,
      name: name || undefined,
    };
  }

  if (options.allowStoredFiles && typeof file.extractedText === 'string') {
    const mimeType = inferResearchFileType(file.mimeType, name)
      || (isAllowedFileType(file.mimeType) ? file.mimeType : null)
      || (isAllowedDocumentType(file.mimeType) ? file.mimeType : null)
      || 'text/csv';
    return {
      mimeType,
      name: name || undefined,
      extractedText: file.extractedText.slice(0, AI_RESEARCH_MAX_EXTRACTED_CHARS),
    };
  }

  throw attachmentError(`File ${index + 1} is missing file data.`);
}

export function validateFileAttachments(
  value: unknown,
  options: { allowStoredFiles?: boolean } = {},
): AiResearchFile[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw attachmentError('Files must be sent as a list.');
  }
  const files = value.map((item, index) => validateFileAttachment(item, index, options));
  const documents = files.filter(file => isResearchDocument(file));
  const spreadsheets = files.filter(file => !isResearchDocument(file));
  if (spreadsheets.length > AI_RESEARCH_MAX_FILES) {
    throw attachmentError(`You can attach up to ${AI_RESEARCH_MAX_FILES} spreadsheets per message.`);
  }
  if (documents.length > AI_RESEARCH_MAX_DOCUMENTS) {
    throw attachmentError(`You can attach up to ${AI_RESEARCH_MAX_DOCUMENTS} documents per message.`);
  }

  const totalBytes = (group: AiResearchFile[]) => group.reduce((sum, file) => {
    if (!file.dataUrl) return sum;
    const parsed = splitFileDataUrl(file.dataUrl, file.name);
    return sum + (parsed ? decodeBase64Length(parsed.base64) : 0);
  }, 0);
  if (totalBytes(spreadsheets) > AI_RESEARCH_MAX_TOTAL_FILE_BYTES) {
    throw attachmentError('Attached spreadsheets exceed the 4 MB total limit.');
  }
  if (totalBytes(documents) > AI_RESEARCH_MAX_TOTAL_DOCUMENT_BYTES) {
    throw attachmentError('Attached documents exceed the 16 MB total limit.');
  }
  return files;
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

function isAttachmentOnlyPrompt(text: string): boolean {
  return text === AI_RESEARCH_IMAGE_ONLY_PROMPT
    || text === AI_RESEARCH_FILE_ONLY_PROMPT
    || text === AI_RESEARCH_ATTACHMENT_ONLY_PROMPT;
}

export function normalizeChatMessage(
  value: unknown,
  options: { allowStoredFiles?: boolean } = {},
): AiResearchChatMessage {
  if (!value || typeof value !== 'object') {
    throw imageAttachmentError('Each message must be an object.');
  }
  const raw = value as { role?: unknown; content?: unknown; images?: unknown; files?: unknown };
  if (raw.role !== 'user' && raw.role !== 'assistant') {
    throw imageAttachmentError('Each message must have a user or assistant role.');
  }
  const images = validateImageAttachments(raw.images);
  const files = validateFileAttachments(raw.files, options);
  const content = extractMessageText(raw);
  if (raw.role === 'assistant' && images.length > 0) {
    throw imageAttachmentError('Only user messages can include images.');
  }
  if (raw.role === 'assistant' && files.length > 0) {
    throw attachmentError('Only user messages can include files.');
  }
  const message: AiResearchChatMessage = { role: raw.role, content };
  if (images.length) message.images = images;
  if (files.length) message.files = files;
  return message;
}

export function parseChatRequest(body: unknown): {
  messages: AiResearchChatMessage[];
  conversationId?: string;
  pinnedSourceUrls: string[];
} {
  if (!body || typeof body !== 'object') {
    throw imageAttachmentError('Invalid JSON body');
  }
  const raw = body as { messages?: unknown; conversationId?: unknown; pinnedSourceUrls?: unknown };
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    throw imageAttachmentError('Messages are required');
  }

  const messages = raw.messages.map(message => normalizeChatMessage(message));
  const lastMessage = messages[messages.length - 1];
  const hasImages = Boolean(lastMessage.images?.length);
  const hasFiles = Boolean(lastMessage.files?.length);
  if (lastMessage.role !== 'user') {
    throw imageAttachmentError('Last message must be from user with text or at least one attachment');
  }
  if (!lastMessage.content && !hasImages && !hasFiles) {
    throw imageAttachmentError('Last message must be from user with text or at least one attachment');
  }
  if (!lastMessage.content) {
    lastMessage.content = hasImages && hasFiles
      ? AI_RESEARCH_ATTACHMENT_ONLY_PROMPT
      : hasFiles
        ? AI_RESEARCH_FILE_ONLY_PROMPT
        : AI_RESEARCH_IMAGE_ONLY_PROMPT;
  }

  const conversationId = typeof raw.conversationId === 'string' && raw.conversationId.trim()
    ? raw.conversationId.trim()
    : undefined;
  const pinnedSourceUrls = Array.isArray(raw.pinnedSourceUrls)
    ? raw.pinnedSourceUrls.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 32)
    : [];
  return { messages, conversationId, pinnedSourceUrls };
}

export function conversationTitleFromMessages(messages: AiResearchChatMessage[]): string {
  const firstUser = messages.find(message => message.role === 'user');
  if (!firstUser) return 'New conversation';
  const text = firstUser.content.trim();
  const imageCount = firstUser.images?.length || 0;
  const fileCount = firstUser.files?.length || 0;
  if (text && !isAttachmentOnlyPrompt(text)) return text.slice(0, 80);
  if (imageCount && fileCount) return `Attachment analysis (${imageCount + fileCount})`;
  if (imageCount) return `Image analysis (${imageCount})`;
  if (fileCount) return `File analysis (${fileCount})`;
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

function fileContextBlock(file: AiResearchFile): string {
  const document = isResearchDocument(file);
  const noun = document ? 'document' : 'spreadsheet';
  const label = file.name || noun;
  const body = file.extractedText?.trim() || `[${label} was attached]`;
  return `Attached ${noun} (${label}):\n${body}`;
}

export function storedMessageText(message: AiResearchChatMessage, includeImages: boolean): string {
  let text = message.content.trim();
  if (message.files?.length) {
    const blocks = message.files.map(fileContextBlock).join('\n\n');
    text = text ? `${text}\n\n${blocks}` : blocks;
  }
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

export function parseStoredMessages(raw: unknown): AiResearchChatMessage[] {
  const parsed = coerceJsonArray(raw);
  if (!parsed) return [];
  return parsed.map(item => {
    try {
      return normalizeChatMessage(item, { allowStoredFiles: true });
    } catch {
      if (!item || typeof item !== 'object') return null;
      const role = (item as { role?: unknown }).role === 'assistant'
        ? 'assistant'
        : (item as { role?: unknown }).role === 'user'
          ? 'user'
          : null;
      if (!role) return null;
      return { role, content: extractMessageText(item as { content?: unknown }) };
    }
  }).filter((item): item is AiResearchChatMessage => Boolean(item));
}
