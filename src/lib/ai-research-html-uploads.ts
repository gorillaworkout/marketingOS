import { v4 as uuidv4 } from 'uuid';
import {
  AI_RESEARCH_MAX_HTML_DOCUMENT_BYTES,
  isHtmlAttachment,
  parseStoredMessages,
  readUploadId,
  splitFileDataUrl,
  type AiResearchChatMessage,
  type AiResearchExportAttachment,
  type AiResearchFile,
  type AiResearchHtmlTable,
} from './ai-research';
import { extractHtmlContent, formatHtmlForResearch, loadSanitizedHtml } from './ai-research-html';
import { truncateExtractedText } from './ai-research-files';
import { CONVERT_LABEL, CONVERT_MIME, convertHtml, type HtmlConvertFormat } from './ai-research-html-convert';

/** Thrown with a user-facing English message and an HTTP status. */
export class HtmlFileError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'HtmlFileError';
    this.status = status;
  }
}

export interface HtmlUploadRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  filename: string;
  byteSize: number;
  title: string;
  sanitizedHtml: string;
  extractedText: string;
  tables: AiResearchHtmlTable[];
}

export type ExportKind = 'tables' | 'extract' | 'convert-xlsx' | 'convert-pdf' | 'convert-docx';

/** Database and model access, injected so the flow is testable without Postgres. */
export interface HtmlFileDeps {
  insertUpload: (row: HtmlUploadRecord) => Promise<void>;
  loadUpload: (userId: string, uploadId: string) => Promise<HtmlUploadRecord | null>;
  linkUpload: (userId: string, uploadId: string, conversationId: string) => Promise<void>;
  loadConversation: (userId: string, conversationId: string) => Promise<{ messages: unknown } | null | undefined>;
  createConversation: (userId: string, conversationId: string, messages: AiResearchChatMessage[], projectId: string | null) => Promise<void>;
  saveConversationMessages: (userId: string, conversationId: string, messages: AiResearchChatMessage[]) => Promise<void>;
  saveExport: (row: {
    id: string;
    userId: string;
    conversationId: string;
    filename: string;
    mimeType: string;
    kind: ExportKind;
    sheetCount: number;
    rowCount: number;
    data: Buffer;
  }) => Promise<void>;
  newId?: () => string;
}

export function readHtmlUploadBody(body: unknown): { name: string; dataUrl: string; conversationId: string | null } {
  if (!body || typeof body !== 'object') throw new HtmlFileError('Invalid request.');
  const raw = body as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : '';
  const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : '';
  if (!name || !dataUrl) throw new HtmlFileError('Attach an HTML file.');
  const conversationId = typeof raw.conversationId === 'string' && raw.conversationId.trim() ? raw.conversationId.trim() : null;
  return { name, dataUrl, conversationId };
}

/** Validate, sanitize, and extract an uploaded HTML file. */
export function prepareHtmlUpload(input: { name: string; dataUrl: string }): Omit<HtmlUploadRecord, 'id' | 'userId' | 'conversationId'> {
  const parsed = splitFileDataUrl(input.dataUrl, input.name);
  if (!parsed || !isHtmlAttachment({ mimeType: parsed.mimeType, name: input.name })) {
    throw new HtmlFileError('Only .html and .htm files can be converted.');
  }
  const bytes = Buffer.from(parsed.base64, 'base64');
  if (!bytes.length) throw new HtmlFileError('The HTML file is empty.');
  if (bytes.length > AI_RESEARCH_MAX_HTML_DOCUMENT_BYTES) throw new HtmlFileError('Each HTML file must be 10 MB or smaller.', 413);
  const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
  const $ = loadSanitizedHtml(html);
  const sanitizedHtml = $.html() || '';
  const extraction = extractHtmlContent(sanitizedHtml);
  return {
    filename: input.name,
    byteSize: bytes.length,
    title: extraction.title.slice(0, 200),
    sanitizedHtml,
    extractedText: truncateExtractedText(formatHtmlForResearch(extraction)),
    tables: extraction.tables,
  };
}

export async function createHtmlUpload(
  userId: string,
  input: { name: string; dataUrl: string; conversationId?: string | null },
  deps: HtmlFileDeps,
): Promise<HtmlUploadRecord> {
  const prepared = prepareHtmlUpload(input);
  const record: HtmlUploadRecord = {
    id: (deps.newId ?? uuidv4)(),
    userId,
    conversationId: input.conversationId || null,
    ...prepared,
  };
  await deps.insertUpload(record);
  return record;
}

export function uploadToChatFile(upload: HtmlUploadRecord): AiResearchFile {
  const file: AiResearchFile = {
    mimeType: 'text/html',
    name: upload.filename,
    extractedText: upload.extractedText,
    uploadId: upload.id,
  };
  if (upload.tables.length) file.tables = upload.tables;
  return file;
}

function threadHasUpload(messages: AiResearchChatMessage[], uploadId: string): boolean {
  return messages.some(message => message.role === 'user' && message.files?.some(file => file.uploadId === uploadId));
}

/**
 * Put a generated attachment message in the thread. Works right after upload:
 * creates the conversation when there is none, and adds an "Uploaded <file>"
 * message first when the upload is not in the thread yet.
 */
export async function deliverToThread(
  userId: string,
  input: {
    upload: HtmlUploadRecord;
    conversationId?: string | null;
    projectId?: string | null;
    message: AiResearchChatMessage;
    /** Id to use if a new conversation is created. */
    newConversationId?: string;
  },
  deps: HtmlFileDeps,
): Promise<{ conversationId: string; appended: AiResearchChatMessage[]; created: boolean }> {
  const appended: AiResearchChatMessage[] = [];
  const uploadMessage: AiResearchChatMessage = {
    role: 'user',
    content: `Uploaded ${input.upload.filename}`,
    files: [uploadToChatFile(input.upload)],
  };
  const existing = input.conversationId ? await deps.loadConversation(userId, input.conversationId) : null;
  let conversationId: string;
  let created = false;
  if (existing && input.conversationId) {
    conversationId = input.conversationId;
    const messages = parseStoredMessages(existing.messages);
    if (!threadHasUpload(messages, input.upload.id)) appended.push(uploadMessage);
    appended.push(input.message);
    await deps.saveConversationMessages(userId, conversationId, [...messages, ...appended]);
  } else {
    conversationId = input.newConversationId ?? (deps.newId ?? uuidv4)();
    created = true;
    appended.push(uploadMessage, input.message);
    await deps.createConversation(userId, conversationId, appended, input.projectId ?? null);
  }
  if (input.upload.conversationId !== conversationId) {
    await deps.linkUpload(userId, input.upload.id, conversationId);
  }
  return { conversationId, appended, created };
}

export function readConvertBody(body: unknown): { uploadId: string; format: HtmlConvertFormat; conversationId: string | null; projectId: string | null } {
  if (!body || typeof body !== 'object') throw new HtmlFileError('Invalid request.');
  const raw = body as Record<string, unknown>;
  const uploadId = readUploadId(raw.uploadId);
  if (!uploadId) throw new HtmlFileError('Re-upload this HTML file to convert it.', 409);
  const format = raw.format === 'xlsx' || raw.format === 'pdf' || raw.format === 'docx' ? raw.format : null;
  if (!format) throw new HtmlFileError('Choose Excel, PDF, or Word.');
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return { uploadId, format, conversationId: text(raw.conversationId), projectId: text(raw.projectId) };
}

export function convertedFilename(sourceName: string, format: HtmlConvertFormat): string {
  const stem = (sourceName || 'page')
    .replace(/\.(html?)$/i, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'page';
  return `${stem}.${format}`;
}

/** Convert a stored upload to Excel, PDF, or Word and deliver it as an attachment message. */
export async function convertUpload(
  userId: string,
  request: { uploadId: string; format: HtmlConvertFormat; conversationId?: string | null; projectId?: string | null },
  deps: HtmlFileDeps,
): Promise<{ conversationId: string; appended: AiResearchChatMessage[]; created: boolean; attachment: AiResearchExportAttachment }> {
  const upload = await deps.loadUpload(userId, request.uploadId);
  if (!upload) throw new HtmlFileError('That HTML upload was not found. Upload it again.', 404);
  const converted = await convertHtml(upload.sanitizedHtml, request.format, upload.filename);
  const id = (deps.newId ?? uuidv4)();
  const filename = convertedFilename(upload.filename, request.format);
  const conversationId = request.conversationId ?? null;
  const attachment: AiResearchExportAttachment = {
    kind: request.format,
    exportId: id,
    filename,
    source: 'convert',
    sheetCount: converted.sheetCount,
    rowCount: converted.rowCount,
    byteSize: converted.data.length,
  };
  const detail = request.format === 'xlsx'
    ? converted.textBlocks
      ? ' The page has no tables, so each heading and paragraph is one row.'
      : ` ${converted.sheetCount} ${converted.sheetCount === 1 ? 'table' : 'tables'}, one sheet each.`
    : '';
  const message: AiResearchChatMessage = {
    role: 'assistant',
    content: `Converted ${upload.filename} to ${CONVERT_LABEL[request.format]}.${detail}`,
    attachments: [attachment],
  };
  // Store the file before the message that links to it.
  const newConversationId = (deps.newId ?? uuidv4)();
  await deps.saveExport({
    id,
    userId,
    conversationId: conversationId ?? newConversationId,
    filename,
    mimeType: CONVERT_MIME[request.format],
    kind: `convert-${request.format}`,
    sheetCount: converted.sheetCount,
    rowCount: converted.rowCount,
    data: converted.data,
  });
  const delivered = await deliverToThread(userId, { upload, conversationId, projectId: request.projectId, message, newConversationId }, deps);
  return { ...delivered, attachment };
}
