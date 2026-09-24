import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_HANDOFF_MODULES,
  AI_RESEARCH_HANDOFF_STORAGE_KEY,
  buildArticleMarketNewsPrefill,
  buildSocialPostBrief,
  buildVideoScriptBrief,
  buildVideoScriptReferenceLinks,
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
  voiceDeniedMessage,
  voiceListeningStatus,
  voiceMissedMessage,
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
  assert.match(brief, /Research topic: Apa yang menggerakkan harga emas/);
  assert.match(brief, /https:\/\/www\.reuters\.com\/markets\/gold/);
  assert.doesNotMatch(brief, /127\.0\.0\.1/);
  assert.match(brief, /Not published yet/);
  assert.ok(brief.length < 4_000);

  const article = buildArticleMarketNewsPrefill(input);
  assert.equal(article.keyword.endsWith('?'), false);
  assert.match(article.keyword, /harga emas/);
  assert.ok(article.keyword.length <= 120);
  assert.match(article.angle, /Research question:/);
  assert.match(article.angle, /competitor structure and PAA/);
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
    'Send to Social Post',
    'Send to Article Market News',
    'Send to Video Script',
  ]);
  assert.equal(AI_RESEARCH_HANDOFF_MODULES[1]?.href, '/dashboard/sop?from=ai-research');
  assert.equal(AI_RESEARCH_HANDOFF_MODULES[2]?.href, '/dashboard/video-script?from=ai-research');
});

test('handoff prefills a video script brief and reference links without generating', () => {
  const sources = [
    { title: 'Reuters', url: 'https://www.reuters.com/markets/gold' },
    { title: 'skip', url: 'http://127.0.0.1/secret' },
  ];
  const input = {
    query: 'What moved gold this week?',
    answer: 'Spot gold rose after the central bank held rates. '.repeat(20),
    sources,
  };
  const brief = buildVideoScriptBrief(input);
  assert.match(brief, /Research topic: What moved gold/);
  assert.match(brief, /https:\/\/www\.reuters\.com\/markets\/gold/);
  assert.match(brief, /Not published yet/);
  assert.match(brief, /video script/);
  assert.doesNotMatch(brief, /127\.0\.0\.1/);
  assert.equal(buildVideoScriptReferenceLinks(sources), 'https://www.reuters.com/markets/gold');

  const raw = serializeAiResearchHandoff({
    target: 'video-script',
    query: input.query,
    answer: input.answer,
    sources,
    savedAt: new Date(NOW).toISOString(),
  });
  const video = parseAiResearchHandoff(raw, 'video-script', NOW + 1_000);
  assert.match(video?.brief || '', /Reuters/);
  assert.equal(video?.references, 'https://www.reuters.com/markets/gold');
  assert.equal(parseAiResearchHandoff(raw, 'social-post', NOW), null);
  assert.equal(parseAiResearchHandoff(raw, 'article-market-news', NOW), null);

  const page = read('src/app/dashboard/video-script/page.tsx');
  const tools = read('src/components/AiResearchAnswerTools.tsx');
  assert.match(page, /readAiResearchHandoff\('video-script'\)/);
  assert.match(page, /setEvent\(handoff\.brief\)/);
  assert.match(page, /setReferences\(handoff\.references\)/);
  assert.match(page, /Do not call handleGeneratePreview/);
  assert.match(page, /data-testid="video-script-research-handoff"/);
  assert.match(page, /Not published yet/);
  assert.match(tools, /writeAiResearchHandoff/);
  assert.match(tools, /AI_RESEARCH_HANDOFF_MODULES/);
  assert.doesNotMatch(tools, /\/api\/video-script\/generate/);
});

test('handoff lands on the existing forms and does not generate', () => {
  const social = read('src/app/dashboard/social-post/page.tsx');
  const article = read('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx');
  const tools = read('src/components/AiResearchAnswerTools.tsx');
  assert.match(social, /readAiResearchHandoff\('social-post'\)/);
  assert.match(social, /setBrief\(handoff\.brief\)/);
  assert.match(social, /Not published yet/);
  assert.match(social, /data-testid="social-post-research-handoff"/);
  assert.match(article, /readAiResearchHandoff\('article-market-news'\)/);
  assert.match(article, /setKeyword\(handoff\.keyword\)/);
  assert.match(article, /setAngle\(handoff\.angle\)/);
  assert.match(article, /Do not call generateArticle/);
  assert.match(article, /data-testid="article-research-handoff"/);
  assert.match(tools, /writeAiResearchHandoff/);
  assert.match(tools, /Send to Social Post|AI_RESEARCH_HANDOFF_MODULES/);
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
  assert.match(voiceUnsupportedMessage(), /Chrome, Edge, or Safari/);
  assert.match(voiceDeniedMessage(), /Microphone access was denied/);
  assert.match(voiceMissedMessage(), /No speech was captured/);
  assert.equal(voiceListeningStatus(), 'Listening… tap mic to stop');
  assert.match(voiceListeningStatus(true), /Switching to English\./);
  assert.match(voiceListeningStatus(true), /Listening… tap mic to stop/);

  const button = read('src/components/AiResearchVoiceButton.tsx');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(button, /data-testid="ai-research-voice"/);
  assert.match(button, /data-listening=\{listening \? 'true' : 'false'\}/);
  assert.match(button, /aria-pressed=\{listening\}/);
  assert.match(button, /voiceListeningStatus\(lang === VOICE_LANG_EN\), 'listening'/);
  assert.match(button, /listening\s*\?\s*'ai-research-voice-active bg-red-500 text-white/);
  assert.match(button, /\{listening && <span className="ai-research-voice-ripple"/);
  assert.match(button, /data-testid="ai-research-voice-bars"/);
  assert.match(button, /@keyframes ai-research-voice-pulse/);
  assert.match(button, /@keyframes ai-research-voice-bar/);
  assert.match(button, /prefers-reduced-motion: reduce/);
  assert.match(button, /VOICE_LANG_ID/);
  assert.match(button, /nextSpeechLang/);
  assert.doesNotMatch(button, /fetch\(|\/api\/.*stt|whisper/i);
  assert.doesNotMatch(button, /Mendengarkan|Input suara|Mikrofon ditolak/);
  assert.match(page, /AiResearchVoiceButton/);
  assert.match(page, /appendVoiceTranscript/);
  assert.match(page, /data-testid="ai-research-voice-status"/);
  assert.match(page, /data-tone=\{voiceStatus\.tone\}/);
  assert.match(page, /voiceStatus\.tone === 'error' \? 'alert' : 'status'/);
  assert.match(page, /voiceStatus\.tone === 'listening'/);
  assert.match(page, /Web Speech API/);
});
