import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_HANDOFF_MODULES,
  AI_RESEARCH_HANDOFF_STORAGE_KEY,
  buildArticleMarketNewsPrefill,
  buildSocialPostBrief,
  parseAiResearchHandoff,
  serializeAiResearchHandoff,
} from '../src/lib/ai-research-handoff';
import {
  VOICE_LANG_EN,
  VOICE_LANG_ID,
  appendVoiceTranscript,
  finalTranscript,
  getSpeechRecognitionConstructor,
  nextSpeechLang,
  voiceUnsupportedMessage,
} from '../src/lib/ai-research-voice';

const read = (path: string) => readFileSync(path, 'utf8');
const NOW = Date.parse('2026-09-23T00:00:00.000Z');

test('handoff prefills social brief and article keyword without publishing', () => {
  const sources = [
    { title: 'Reuters', url: 'https://www.reuters.com/markets/gold' },
    { title: 'skip', url: 'http://127.0.0.1/secret' },
  ];
  const input = {
    query: 'Apa yang menggerakkan harga emas hari ini?',
    answer: 'Harga emas mengikuti dolar dan imbal hasil. '.repeat(80),
    sources,
  };
  const brief = buildSocialPostBrief(input);
  assert.match(brief, /Topik riset: Apa yang menggerakkan harga emas/);
  assert.match(brief, /https:\/\/www\.reuters\.com\/markets\/gold/);
  assert.doesNotMatch(brief, /127\.0\.0\.1/);
  assert.match(brief, /Belum dipublikasikan/);
  assert.ok(brief.length < 4_000);

  const article = buildArticleMarketNewsPrefill(input);
  assert.equal(article.keyword.endsWith('?'), false);
  assert.match(article.keyword, /harga emas/);
  assert.ok(article.keyword.length <= 120);
  assert.match(article.angle, /Pertanyaan riset:/);
  assert.match(article.angle, /struktur kompetitor dan PAA/);
  assert.doesNotMatch(article.angle, /127\.0\.0\.1/);

  const raw = serializeAiResearchHandoff({
    target: 'social-post',
    query: input.query,
    answer: input.answer,
    sources,
    savedAt: new Date(NOW).toISOString(),
  });
  const social = parseAiResearchHandoff(raw, 'social-post', NOW + 1_000);
  assert.match(social?.brief || '', /Reuters/);
  assert.equal(parseAiResearchHandoff(raw, 'article-market-news', NOW), null);
  assert.equal(parseAiResearchHandoff(raw, 'social-post', NOW + 3 * 60 * 60 * 1000), null);

  assert.deepEqual(AI_RESEARCH_HANDOFF_MODULES.map(module => module.label), [
    'Kirim ke Social Post',
    'Kirim ke Article Market News',
  ]);
  assert.equal(AI_RESEARCH_HANDOFF_MODULES[1]?.href, '/dashboard/sop?from=ai-research');
});

test('handoff lands on the existing forms and does not generate', () => {
  const social = read('src/app/dashboard/social-post/page.tsx');
  const article = read('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx');
  const tools = read('src/components/AiResearchAnswerTools.tsx');
  assert.match(social, /readAiResearchHandoff\('social-post'\)/);
  assert.match(social, /setBrief\(handoff\.brief\)/);
  assert.match(social, /Belum dipublikasikan/);
  assert.match(social, /data-testid="social-post-research-handoff"/);
  assert.match(article, /readAiResearchHandoff\('article-market-news'\)/);
  assert.match(article, /setKeyword\(handoff\.keyword\)/);
  assert.match(article, /setAngle\(handoff\.angle\)/);
  assert.match(article, /Do not call generateArticle/);
  assert.match(article, /data-testid="article-research-handoff"/);
  assert.match(tools, /writeAiResearchHandoff/);
  assert.match(tools, /Kirim ke Social Post|AI_RESEARCH_HANDOFF_MODULES/);
  assert.match(tools, /window\.location\.assign\(href\)/);
  assert.doesNotMatch(tools, /\/api\/social-post\/generate|\/api\/article-market-news\/generate/);
  assert.match(read('src/lib/ai-research-handoff.ts'), new RegExp(AI_RESEARCH_HANDOFF_STORAGE_KEY.replace(/\./g, '\\.')));
});

test('voice input appends transcripts and falls back from id-ID to English', () => {
  assert.equal(appendVoiceTranscript('', '  harga   emas  '), 'harga emas');
  assert.equal(appendVoiceTranscript('Riset', 'hari ini'), 'Riset hari ini');
  assert.equal(appendVoiceTranscript('Riset ', 'hari ini'), 'Riset hari ini');
  assert.equal(appendVoiceTranscript('Riset', '   '), 'Riset');
  assert.equal(nextSpeechLang(VOICE_LANG_ID, 'language-not-supported'), VOICE_LANG_EN);
  assert.equal(nextSpeechLang(VOICE_LANG_EN, 'language-not-supported'), null);
  assert.equal(nextSpeechLang(VOICE_LANG_ID, 'not-allowed'), null);
  assert.equal(finalTranscript({
    resultIndex: 1,
    results: [
      { isFinal: true, 0: { transcript: 'abaikan ' } },
      { isFinal: false, 0: { transcript: 'sementara' } },
      { isFinal: true, 0: { transcript: 'emas' } },
    ],
  }), 'emas');
  assert.equal(getSpeechRecognitionConstructor(null), null);
  assert.equal(getSpeechRecognitionConstructor({}), null);
  const ctor = class {
    lang = '';
    continuous = false;
    interimResults = false;
    onresult = null;
    onerror = null;
    onend = null;
    start() {}
    stop() {}
  };
  assert.equal(getSpeechRecognitionConstructor({ webkitSpeechRecognition: ctor }), ctor);
  assert.match(voiceUnsupportedMessage(), /Chrome, Edge, atau Safari/);

  const button = read('src/components/AiResearchVoiceButton.tsx');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(button, /data-testid="ai-research-voice"/);
  assert.match(button, /VOICE_LANG_ID/);
  assert.match(button, /nextSpeechLang/);
  assert.doesNotMatch(button, /fetch\(|\/api\/.*stt|whisper/i);
  assert.match(page, /AiResearchVoiceButton/);
  assert.match(page, /appendVoiceTranscript/);
  assert.match(page, /data-testid="ai-research-voice-status"/);
  assert.match(page, /Web Speech API/);
});
