import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EVENT_PLAN_HISTORY_TYPE, isEventPlanHistoryType, restoreEventPlan } from '../src/lib/event-plan-history';

const root = process.cwd();

test('History exposes Event Plan filter and renders the persisted multi-option Event Plan format', async () => {
  const page = await readFile(resolve(root, 'src/app/dashboard/history/page.tsx'), 'utf8');
  assert.match(page, /Event Plans/);
  // Filtering moved server-side (see market-research-sharper.test.ts): the tab
  // now drives `?type=`, so the old client-side comparison is gone by design.
  assert.match(page, /'event-plan'/);
  assert.match(page, /type=\$\{encodeURIComponent\(typeFilter\)\}/);
  assert.match(page, /data\.options\?\.\[0\]/);
});

const savedOption = {
  style: 'professional',
  styleLabel: 'Professional',
  objective: 'Host a sourced outlook seminar.',
  concept: 'A compact Jakarta seminar with public venue prices only.',
  theme: 'Market outlook',
  venue: 'Jakarta — Hotel Indonesia Kempinski Jakarta',
  speakers: ['Named economist'],
  budget: { currency: 'IDR', total: null, items: [] },
  timeline: '09:00 Doors',
  research: {
    status: 'researched',
    queries: ['ballroom rental Jakarta'],
    sources: [{ url: 'https://hotel.example/price', title: 'Hotel Example', claim: 'No public price found on this page — request a quotation from the vendor' }],
    contacts: [{ vendor: 'Hotel Example', phone: '+62 21 5555 0101', email: 'events@hotel.example', sourceUrl: 'https://hotel.example/price', verified: true }],
  },
};

function persistedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-event-1',
    title: 'Event Plan: Bloomberg Awarding Night',
    brief: 'Bloomberg Awarding Night',
    created_at: '2026-09-24T02:30:00.000Z',
    type: EVENT_PLAN_HISTORY_TYPE,
    output_data: JSON.stringify({
      options: [savedOption],
      input: {
        eventName: 'Bloomberg Awarding Night',
        theme: 'Financial Awards',
        location: 'Jakarta',
        budget: 50000000,
        targetDate: '2026-11-12',
        researchUrls: ['https://hotel.example/price'],
      },
      model: 'ag/gemini-3.1-pro-low',
      ...overrides,
    }),
  };
}

test('history type matches generate persistence and the Event Plan page query', async () => {
  const page = await readFile(resolve(root, 'src/app/dashboard/event-plan/page.tsx'), 'utf8');
  const route = await readFile(resolve(root, 'src/app/api/event-plan/generate/route.ts'), 'utf8');
  const historyApi = await readFile(resolve(root, 'src/app/api/dashboard/history/route.ts'), 'utf8');
  assert.equal(EVENT_PLAN_HISTORY_TYPE, 'event-plan');
  assert.equal(isEventPlanHistoryType('event-plan'), true);
  assert.equal(isEventPlanHistoryType('market-research'), false);
  assert.match(route, /'event-plan'/);
  assert.match(route, /INSERT INTO tasks/);
  assert.match(route, /input: \{[\s\S]*eventName/);
  assert.match(historyApi, /searchParams\.get\('type'\)/);
  assert.match(page, /\/api\/dashboard\/history\?type=\$\{EVENT_PLAN_HISTORY_TYPE\}/);
  assert.match(page, /\/dashboard\/history\?type=\$\{EVENT_PLAN_HISTORY_TYPE\}/);
  assert.match(page, /restoreEventPlan/);
  assert.match(page, /Recent Generated/);
  assert.match(page, /View all history/);
  assert.match(page, /No saved event plans yet/);
  assert.match(page, /recentError/);
  assert.match(page, /response\.ok/);
  assert.match(page, /void fetchRecent\(\)/);
  assert.match(page, /Open history/);
});

test('restore maps a saved Event Plan and keeps sourced research contacts unverified', () => {
  const restored = restoreEventPlan(persistedTask());
  assert.equal(restored.historyId, 'task-event-1');
  assert.equal(restored.eventName, 'Bloomberg Awarding Night');
  assert.equal(restored.theme, 'Financial Awards');
  assert.equal(restored.location, 'Jakarta');
  assert.equal(restored.budget, '50000000');
  assert.equal(restored.targetDate, '2026-11-12');
  assert.equal(restored.researchLinks, 'https://hotel.example/price');
  assert.equal(restored.model, 'ag/gemini-3.1-pro-low');
  assert.equal(restored.options.length, 1);
  assert.equal(restored.options[0]?.styleLabel, 'Professional');
  const research = restored.options[0]?.research as { contacts: Array<{ verified: boolean; sourceUrl: string }> };
  assert.equal(research.contacts[0]?.verified, false);
  assert.equal(research.contacts[0]?.sourceUrl, 'https://hotel.example/price');
});

test('restore opens a legacy options-only Event Plan from the task brief', () => {
  const restored = restoreEventPlan({
    id: 'legacy-1',
    title: 'Event Plan: Legacy Night',
    brief: 'Legacy Night',
    created_at: '2026-08-01T00:00:00.000Z',
    output_data: JSON.stringify({ options: [{ concept: 'Saved concept', venue: 'Surabaya hall' }] }),
  });
  assert.equal(restored.eventName, 'Legacy Night');
  assert.equal(restored.location, 'Jakarta');
  assert.equal(restored.theme, '');
  assert.equal(restored.budget, '');
  assert.equal(restored.options[0]?.style, 'plan-1');
  assert.equal(restored.options[0]?.concept, 'Saved concept');
});

test('restore rejects incomplete or malformed saved Event Plans', () => {
  assert.throws(() => restoreEventPlan({
    id: 'broken',
    title: 'Broken',
    created_at: '2026-09-24T00:00:00.000Z',
    output_data: '{',
  }), /incomplete/i);
  assert.throws(() => restoreEventPlan({
    id: 'empty',
    title: 'Empty',
    created_at: '2026-09-24T00:00:00.000Z',
    output_data: JSON.stringify({ input: { eventName: 'Named' } }),
  }), /incomplete/i);
});
