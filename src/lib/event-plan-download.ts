import type { EventPlanResearch } from './event-plan-research';

type BudgetItem = { category?: unknown; estimatedCost?: unknown; notes?: unknown };
type EventPlanOption = { style?: unknown; styleLabel?: unknown; objective?: unknown; concept?: unknown; theme?: unknown; venue?: unknown; speakers?: unknown; budget?: unknown; timeline?: unknown; research?: EventPlanResearch };
export type EventPlanDownloadInput = { eventName: string; location?: string; theme?: string; targetDate?: string; option: EventPlanOption };

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function asAmount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
function idr(value: unknown) { return `Rp ${asAmount(value).toLocaleString('id-ID')}`; }

export function eventPlanDownloadFilename(eventName: string, extension: 'doc' | 'json', date = new Date()) {
  const safeName = eventName.normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Event';
  const datePart = date.toISOString().slice(0, 10);
  return `DUPOIN_${safeName}_EventPlan_V1_${datePart}.${extension}`;
}

export function buildEventPlanDownload(input: EventPlanDownloadInput, format: 'doc' | 'json') {
  if (format === 'json') return { content: JSON.stringify(input, null, 2), mimeType: 'application/json;charset=utf-8' };
  const option = input.option;
  const budget = option.budget && typeof option.budget === 'object' ? option.budget as Record<string, unknown> : {};
  const items = Array.isArray(budget.items) ? budget.items as BudgetItem[] : [];
  const research = option.research || { status: 'unverified', sources: [], contacts: [] };
  const details = [['Event name', input.eventName], ['Location', input.location], ['Theme', input.theme], ['Target date', input.targetDate], ['Plan style', option.styleLabel || option.style], ['Objective', option.objective], ['Concept', option.concept], ['Venue', option.venue]]
    .filter(([, value]) => value).map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('');
  const speakers = Array.isArray(option.speakers) ? option.speakers.filter((speaker) => typeof speaker === 'string').map((speaker) => `<li>${escapeHtml(speaker)}</li>`).join('') : '';
  const budgetRows = items.map((item) => `<tr><td>${escapeHtml(item.category || 'Other')}</td><td>${escapeHtml(item.notes || '—')}</td><td class="amount">${idr(item.estimatedCost)}</td></tr>`).join('') || '<tr><td colspan="3">No itemized budget details were provided.</td></tr>';
  const sourceRows = research.sources.map((source) => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.url)}</a> — ${escapeHtml(source.claim)}</li>`).join('') || '<li>No source supplied. All prices are AI estimates.</li>';
  const contactRows = research.contacts.filter((contact) => contact.sourceUrl).map((contact) => `<li>${escapeHtml(contact.vendor)} — ${escapeHtml(contact.phone)}; ${escapeHtml(contact.email)} (Source: <a href="${escapeHtml(contact.sourceUrl)}">${escapeHtml(contact.sourceUrl)}</a>)</li>`).join('') || '<li>No source-linked contacts supplied.</li>';
  return { mimeType: 'application/msword', content: `<!doctype html><html><head><meta charset="utf-8"><title>Event Plan</title><style>body{font-family:Arial,sans-serif;color:#111;line-height:1.4}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #999;padding:8px;text-align:left}.amount{text-align:right}h1,h2{color:#c2410c}</style></head><body><h1>DUPOIN Event Plan</h1><table>${details}</table><h2>Budget Breakdown (IDR)</h2><table><thead><tr><th>Category</th><th>Notes</th><th>Estimated cost</th></tr></thead><tbody>${budgetRows}</tbody><tfoot><tr><th colspan="2">Contingency</th><td class="amount">${idr(budget.contingency)}</td></tr><tr><th colspan="2">Total</th><td class="amount">${idr(budget.total)}</td></tr></tfoot></table><h2>Timeline</h2><p>${escapeHtml(option.timeline || 'Not provided').replace(/\n/g, '<br>')}</p>${speakers ? `<h2>Speakers</h2><ul>${speakers}</ul>` : ''}<h2>Research status</h2><p>${escapeHtml(research.status)}</p><p>Sources and any contacts require manual quotation verification. This document does not confirm vendor rates or contact details.</p><h2>Sources</h2><ul>${sourceRows}</ul><h2>Contacts</h2><ul>${contactRows}</ul></body></html>` };
}
