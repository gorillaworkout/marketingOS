import { emptyImportDraft } from '../src/lib/chat-import-extract';
import type { ApproveCounts, ChatImportDeps, ChatImportRow } from '../src/lib/chat-import';
import type { MemoryKind } from '../src/lib/ai-research-memory';

type Memory = { id: string; userId: string; kind: MemoryKind; content: string; contentHash: string; mentionCount: number; confidence: number };
type Qa = { id: string; userId: string; questionNorm: string };

export function createMemoryImportDeps() {
  const rows: ChatImportRow[] = [];
  const memories: Memory[] = [];
  const qa: Qa[] = [];
  const mirrors: unknown[] = [];
  const edges: Array<{ sourceNodeId: string; importNodeId: string }> = [];
  const logs: Array<{ id: string; status: string }> = [];
  let enabled = true;
  let seq = 0;
  const deps: ChatImportDeps = {
    createId: () => `id-${++seq}`,
    isMemoryEnabled: async () => enabled,
    findByHash: async (userId, contentHash) => rows.find(row => row.userId === userId && row.contentHash === contentHash) || null,
    findById: async (userId, id) => rows.find(row => row.userId === userId && row.id === id) || null,
    list: async userId => rows.filter(row => row.userId === userId).slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    insertSavedChat: async row => {
      if (rows.some(item => item.userId === row.userId && item.contentHash === row.contentHash)) return 'duplicate';
      rows.push(row);
      return 'inserted';
    },
    saveDraft: async (userId, id, draft) => {
      const row = rows.find(item => item.userId === userId && item.id === id);
      if (!row) return;
      row.status = 'review';
      row.draft = draft;
      row.error = null;
    },
    saveExtractFailure: async (userId, id) => {
      const row = rows.find(item => item.userId === userId && item.id === id);
      if (!row) return;
      row.status = 'extract_failed';
      row.draft = emptyImportDraft();
      row.error = 'Fact extraction failed.';
    },
    findMemory: async (userId, contentHash) => {
      const row = memories.find(item => item.userId === userId && item.contentHash === contentHash);
      return row ? { id: row.id, mentionCount: row.mentionCount } : null;
    },
    bumpMemory: async (userId, id) => {
      const row = memories.find(item => item.userId === userId && item.id === id);
      if (row) row.mentionCount += 1;
    },
    writeMemory: async row => {
      memories.push({ ...row });
      return row.id;
    },
    findQa: async (userId, questionNorm) => qa.find(item => item.userId === userId && item.questionNorm === questionNorm) || null,
    writeQa: async row => {
      qa.push({ id: row.id, userId: row.userId, questionNorm: row.questionNorm });
      return row.id;
    },
    mirrorMemory: async input => {
      mirrors.push(input);
      return `node-${input.memoryId}`;
    },
    mirrorQa: async input => {
      mirrors.push(input);
      return `node-${input.qaId}`;
    },
    linkLearnedFrom: async (sourceNodeId, importNodeId) => {
      edges.push({ sourceNodeId, importNodeId });
    },
    markApproved: async (userId, id, result: ApproveCounts) => {
      const row = rows.find(item => item.userId === userId && item.id === id);
      if (!row) return;
      row.status = 'approved';
      row.draft = emptyImportDraft();
      row.error = null;
      row.approveResult = result;
    },
    markChatOnly: async (userId, id) => {
      const row = rows.find(item => item.userId === userId && item.id === id);
      if (!row || (row.status !== 'review' && row.status !== 'extract_failed')) return;
      row.status = 'chat_only';
      row.draft = emptyImportDraft();
      row.error = null;
    },
    embed: async () => [],
    complete: async () => '{"facts":[],"qa":[]}',
    log: (id, status) => { logs.push({ id, status }); },
  };
  return { deps, rows, memories, qa, mirrors, edges, logs, setEnabled: (value: boolean) => { enabled = value; } };
}
