import { v4 as uuidv4 } from 'uuid';
import {
  isHtmlAttachment,
  parseStoredMessages,
  type AiResearchChatMessage,
  type AiResearchExportAttachment,
  type AiResearchFile,
  readUploadId,
} from './ai-research';
import { deliverToThread, type HtmlFileDeps } from './ai-research-html-uploads';
import { CSV_MIME, rowsToCsvBuffer } from './ai-research-csv';
import {
  EXTRACTION_SYSTEM_PROMPT,
  ExtractionValidationError,
  XLSX_MIME,
  buildExtractionUserPrompt,
  buildWorkbook,
  htmlTablesToSheets,
  validateExtractionJson,
  xlsxFilename,
  type WorkbookSheet,
} from './ai-research-excel';

export const EXTRACTION_MAX_SOURCE_CHARS = 60_000;
export const EXTRACTION_MAX_OUTPUT_TOKENS = 8_000;

export type ExcelExportMode = 'tables' | 'extract';

export class ExcelExportError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ExcelExportError';
    this.status = status;
  }
}

export interface ExcelExportRequest {
  /** Existing conversation; optional when exporting straight from an upload. */
  conversationId: string | null;
  /** Stored HTML upload (ai_research_uploads); works before any message is sent. */
  uploadId?: string;
  projectId?: string | null;
  messageIndex: number;
  fileIndex: number;
  fileName?: string;
  mode: ExcelExportMode;
  instruction?: string;
  /** Extract only: write the extracted rows as CSV instead of Excel. */
  output?: 'xlsx' | 'csv';
}

export function parseExcelExportRequest(body: unknown): ExcelExportRequest {
  if (!body || typeof body !== 'object') throw new ExcelExportError('Invalid request.');
  const raw = body as Record<string, unknown>;
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId.trim() : '';
  const uploadId = readUploadId(raw.uploadId);
  if (!conversationId && !uploadId) throw new ExcelExportError('Upload the HTML file again, then export.');
  const mode = raw.mode === 'extract' ? 'extract' : raw.mode === 'tables' ? 'tables' : null;
  if (!mode) throw new ExcelExportError('Choose "tables" or "extract".');
  const instruction = typeof raw.instruction === 'string' ? raw.instruction.trim() : '';
  if (mode === 'extract' && instruction.length < 3) {
    throw new ExcelExportError('Describe what to extract, for example "product name, price, date".');
  }
  if (instruction.length > 1_000) throw new ExcelExportError('The instruction must be 1,000 characters or fewer.');
  const projectId = typeof raw.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : null;
  return {
    conversationId: conversationId || null,
    uploadId,
    projectId,
    messageIndex: Math.trunc(Number(raw.messageIndex)),
    fileIndex: Math.max(0, Math.trunc(Number(raw.fileIndex) || 0)),
    fileName: typeof raw.fileName === 'string' ? raw.fileName.trim().slice(0, 120) : undefined,
    mode,
    instruction: instruction || undefined,
    output: mode === 'extract' && raw.output === 'csv' ? 'csv' : 'xlsx',
  };
}

/**
 * Find the HTML file: the given message/file index when it matches, otherwise
 * the latest user HTML attachment with the same name (indices can drift).
 */
export function locateHtmlFile(
  messages: AiResearchChatMessage[],
  request: Pick<ExcelExportRequest, 'messageIndex' | 'fileIndex' | 'fileName'>,
): AiResearchFile | null {
  const atIndex = messages[request.messageIndex]?.files?.[request.fileIndex];
  if (
    messages[request.messageIndex]?.role === 'user'
    && atIndex
    && isHtmlAttachment(atIndex)
    && (!request.fileName || atIndex.name === request.fileName)
  ) {
    return atIndex;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' || !message.files?.length) continue;
    const match = message.files.find(file => isHtmlAttachment(file) && (!request.fileName || file.name === request.fileName));
    if (match) return match;
  }
  return null;
}

export interface ExcelExportDeps extends HtmlFileDeps {
  /** Runs the extraction prompt through the routed model with fallback. */
  generateJson: (input: { userId: string; system: string; user: string }) => Promise<{ content: string; fallbackLabel?: string | null }>;
  newId?: () => string;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export async function createExcelExport(
  userId: string,
  request: ExcelExportRequest,
  deps: ExcelExportDeps,
): Promise<{
  message: AiResearchChatMessage;
  attachment: AiResearchExportAttachment;
  conversationId: string;
  appended: AiResearchChatMessage[];
  created: boolean;
}> {
  let file: { name?: string; tables?: AiResearchFile['tables']; extractedText?: string };
  let messages: AiResearchChatMessage[] = [];
  const upload = request.uploadId ? await deps.loadUpload(userId, request.uploadId) : null;
  if (request.uploadId && !upload && !request.conversationId) {
    throw new ExcelExportError('That HTML upload was not found. Upload it again.', 404);
  }
  if (upload) {
    file = { name: upload.filename, tables: upload.tables, extractedText: upload.extractedText };
  } else {
    if (!request.conversationId) throw new ExcelExportError('Conversation not found.', 404);
    const row = await deps.loadConversation(userId, request.conversationId);
    if (!row) throw new ExcelExportError('Conversation not found.', 404);
    messages = parseStoredMessages(row.messages);
    const located = locateHtmlFile(messages, request);
    if (!located) throw new ExcelExportError('No HTML attachment was found in this conversation.', 404);
    file = located;
  }
  const sourceName = file.name || 'page.html';

  let sheets: WorkbookSheet[];
  let content: string;
  let fallbackLabel: string | null = null;
  if (request.mode === 'tables') {
    sheets = htmlTablesToSheets(file.tables || []);
    if (!sheets.length) throw new ExcelExportError(`No tables were found in ${sourceName}.`, 422);
    content = `Exported ${plural(sheets.length, 'table')} from ${sourceName} to Excel (one sheet per table).`;
  } else {
    const source = (file.extractedText || '').slice(0, EXTRACTION_MAX_SOURCE_CHARS);
    if (!source.trim()) throw new ExcelExportError(`${sourceName} has no readable content to extract.`, 422);
    const generated = await deps.generateJson({
      userId,
      system: EXTRACTION_SYSTEM_PROMPT,
      user: buildExtractionUserPrompt(request.instruction || '', sourceName, source),
    });
    let extraction;
    try {
      extraction = validateExtractionJson(generated.content);
    } catch (error) {
      if (error instanceof ExtractionValidationError) throw new ExcelExportError(error.message, 422);
      throw error;
    }
    fallbackLabel = generated.fallbackLabel || null;
    sheets = [{ name: extraction.sheetName, rows: [extraction.columns, ...extraction.rows] }];
    content = `Extracted ${plural(extraction.rows.length, 'row')} (${extraction.columns.join(', ')}) from ${sourceName} to ${request.output === 'csv' ? 'CSV' : 'Excel'}.`;
  }

  const csv = request.mode === 'extract' && request.output === 'csv';
  const data = csv ? rowsToCsvBuffer(sheets[0].rows) : await buildWorkbook(sheets);
  const id = (deps.newId ?? uuidv4)();
  const newConversationId = upload ? (deps.newId ?? uuidv4)() : undefined;
  const rowCount = sheets.reduce((sum, sheet) => sum + Math.max(0, sheet.rows.length - 1), 0);
  const xlsxName = xlsxFilename(sourceName, request.mode === 'tables' ? 'tables' : 'extract');
  const filename = csv ? xlsxName.replace(/\.xlsx$/, '.csv') : xlsxName;
  await deps.saveExport({
    id,
    userId,
    conversationId: request.conversationId ?? newConversationId ?? '',
    filename,
    mimeType: csv ? CSV_MIME : XLSX_MIME,
    kind: csv ? 'extract-csv' : request.mode,
    sheetCount: sheets.length,
    rowCount,
    data,
  });
  const attachment: AiResearchExportAttachment = {
    kind: csv ? 'csv' : 'xlsx',
    exportId: id,
    filename,
    source: request.mode,
    sheetCount: sheets.length,
    rowCount,
    byteSize: data.length,
  };
  const message: AiResearchChatMessage = { role: 'assistant', content, attachments: [attachment] };
  if (fallbackLabel) message.fallbackLabel = fallbackLabel;
  if (upload) {
    const delivered = await deliverToThread(userId, {
      upload,
      conversationId: request.conversationId,
      projectId: request.projectId,
      message,
      newConversationId,
    }, deps);
    return { message, attachment, ...delivered };
  }
  const conversationId = request.conversationId as string;
  await deps.saveConversationMessages(userId, conversationId, [...messages, message]);
  return { message, attachment, conversationId, appended: [message], created: false };
}

export function exportDownloadPath(exportId: string): string {
  return `/api/ai-research/exports/${encodeURIComponent(exportId)}`;
}

export { XLSX_MIME };
