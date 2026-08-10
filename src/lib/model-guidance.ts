import type { GenerationFeature } from '@/lib/model-routing';

export type GuidanceLevel = 'excellent' | 'good' | 'specialist' | 'limited';

export interface ModelGuidance {
  family: 'Gemini' | 'Claude' | 'GPT / Codex' | 'Kimi' | 'GorillaWorkout';
  summary: string;
  strengths: string[];
  tradeoffs: string[];
  bestFor: string[];
  speed: 'Fast' | 'Moderate' | 'Deliberate' | 'Variable';
  reasoning: 'Light' | 'Balanced' | 'Deep';
  workflowFit: Record<GenerationFeature, GuidanceLevel>;
  note: string;
}

const BASE_FIT: Record<GenerationFeature, GuidanceLevel> = {
  'social-post': 'good',
  'video-script': 'good',
  'event-plan': 'good',
  'article-market-news': 'good',
  'market-research': 'good',
  'ai-research': 'good',
};

function fit(overrides: Partial<Record<GenerationFeature, GuidanceLevel>>): Record<GenerationFeature, GuidanceLevel> {
  return { ...BASE_FIT, ...overrides };
}

/** Operational guidance for MarketingOS; this is not a vendor benchmark or universal quality ranking. */
export function getModelGuidance(modelId: string): ModelGuidance {
  const lower = modelId.toLowerCase();

  if (modelId === 'pecut-free') {
    return {
      family: 'GorillaWorkout',
      summary: 'Pilihan tanpa biaya untuk eksperimen, draft awal, dan pekerjaan yang tidak dikejar waktu.',
      strengths: ['Tanpa biaya gateway', 'Cocok untuk eksplorasi prompt', 'Berguna sebagai opsi cadangan manual'],
      tradeoffs: ['Latency production dapat sangat bervariasi', 'Workflow multi-step dapat melewati batas waktu', 'Konsistensi format perlu diawasi'],
      bestFor: ['Draft non-urgent', 'Eksperimen internal', 'Menguji struktur brief'],
      speed: 'Variable', reasoning: 'Light',
      workflowFit: fit({ 'social-post': 'limited', 'video-script': 'limited', 'article-market-news': 'limited', 'market-research': 'limited' }),
      note: 'Observasi MarketingOS: tidak dijadikan default Social Post karena workflow empat completion pernah melewati timeout 300 detik.',
    };
  }

  if (lower.includes('gemini')) {
    const pro = lower.includes('pro');
    const low = lower.includes('low');
    return {
      family: 'Gemini',
      summary: pro ? 'Model general-purpose untuk synthesis yang lebih kompleks dan struktur panjang.' : 'Model cepat untuk iterasi konten, variasi hook, dan workflow dengan beberapa langkah.',
      strengths: pro
        ? ['Synthesis brief kompleks', 'Struktur panjang lebih terjaga', 'Cocok untuk planning dan review']
        : ['Respons cepat', 'Efisien untuk menghasilkan beberapa opsi', 'Baik untuk output terstruktur dan ide visual'],
      tradeoffs: pro
        ? ['Lebih lambat daripada varian Flash', 'Berlebihan untuk caption sederhana', 'Tetap memerlukan fact-check untuk klaim pasar']
        : ['Nuansa copy dapat terasa generik tanpa contoh brand', 'Reasoning mendalam lebih terbatas', low ? 'Varian low-compute perlu QC lebih ketat' : 'Long-form kompleks perlu review'],
      bestFor: pro ? ['Event plan', 'Long-form outline', 'Complex brief synthesis'] : ['Social Post', 'Video Script preview', 'Image prompt', 'High-volume iteration'],
      speed: pro ? 'Moderate' : 'Fast', reasoning: pro ? 'Deep' : 'Balanced',
      workflowFit: fit({
        'social-post': pro ? 'good' : 'excellent',
        'video-script': pro ? 'good' : 'excellent',
        'event-plan': pro ? 'excellent' : 'good',
        'article-market-news': pro ? 'good' : 'limited',
        'market-research': pro ? 'good' : 'limited',
      }),
      note: 'Panduan operasional berdasarkan karakter varian dan penggunaan MarketingOS; bukan hasil benchmark vendor.',
    };
  }

  if (lower.includes('claude')) {
    const opus = lower.includes('opus');
    const haiku = lower.includes('haiku');
    const thinking = lower.includes('thinking');
    return {
      family: 'Claude',
      summary: opus || thinking ? 'Model deliberatif untuk editorial judgment, reasoning, dan brief yang ambigu.' : haiku ? 'Model ringan untuk draft cepat dan transformasi copy.' : 'Model writing-first untuk copy bernuansa, narasi, dan struktur editorial.',
      strengths: opus || thinking
        ? ['Reasoning mendalam', 'Menangani instruksi kompleks', 'Kuat untuk critique dan editorial review']
        : haiku
          ? ['Cepat untuk rewrite', 'Efisien untuk klasifikasi', 'Cocok untuk draft singkat']
          : ['Natural writing dan tone', 'Storytelling serta alur narasi', 'Mengikuti style guidance dengan baik'],
      tradeoffs: opus || thinking
        ? ['Lebih lambat', 'Overkill untuk caption rutin', 'Output dapat terlalu panjang tanpa batas tegas']
        : haiku
          ? ['Nuansa dan reasoning lebih terbatas', 'Kurang cocok untuk report kompleks', 'Perlu QC editorial']
          : ['Dapat verbose', 'Perlu schema/panjang yang eksplisit', 'Fakta pasar tetap harus terikat source'],
      bestFor: opus || thinking ? ['Market research synthesis', 'Editorial review', 'Complex event plan'] : haiku ? ['Rewrite', 'Short caption draft', 'Content classification'] : ['Human-sounding Social Post', 'Video Script narration', 'Article structure'],
      speed: haiku ? 'Fast' : opus || thinking ? 'Deliberate' : 'Moderate', reasoning: opus || thinking ? 'Deep' : haiku ? 'Light' : 'Balanced',
      workflowFit: fit({
        'social-post': opus ? 'good' : haiku ? 'good' : 'excellent',
        'video-script': opus ? 'good' : haiku ? 'good' : 'excellent',
        'event-plan': opus || thinking ? 'excellent' : 'good',
        'article-market-news': haiku ? 'limited' : 'excellent',
        'market-research': opus || thinking ? 'excellent' : haiku ? 'limited' : 'good',
      }),
      note: 'Kelebihan writing adalah panduan pemilihan internal; kualitas aktual tetap dipengaruhi prompt, source evidence, dan QC manusia.',
    };
  }

  if (lower.startsWith('cx/') || lower.includes('gpt') || lower.includes('codex')) {
    const review = lower.includes('review');
    const mini = lower.includes('mini') || lower.includes('spark') || lower.includes('luna');
    const sol = lower.includes('sol');
    return {
      family: 'GPT / Codex',
      summary: review ? 'Varian review untuk mengecek struktur, konsistensi, dan kelemahan draft.' : mini ? 'Varian ringkas untuk pekerjaan cepat dan terstruktur.' : 'Model reasoning serbaguna untuk analisis, struktur, dan output dengan constraint ketat.',
      strengths: review
        ? ['Critique dan quality review', 'Mendeteksi inkonsistensi', 'Cocok sebagai second pass']
        : mini
          ? ['Cepat dan ekonomis', 'Baik untuk schema sederhana', 'Cocok untuk volume tinggi']
          : ['Reasoning terstruktur', 'Mengikuti constraint kompleks', 'Baik untuk research selection dan planning'],
      tradeoffs: review
        ? ['Bukan pilihan utama untuk draft kreatif', 'Menambah satu tahap workflow', 'Masih membutuhkan reviewer manusia']
        : mini
          ? ['Nuansa copy lebih terbatas', 'Analisis kompleks perlu model lebih besar', 'Perlu QC untuk long-form']
          : ['Dapat terdengar formal untuk social copy', sol ? 'Tier premium untuk tugas rutin' : 'Latency tergantung model', 'Tidak menggantikan source verification'],
      bestFor: review ? ['Draft review', 'Compliance pass', 'Editorial critique'] : mini ? ['Classification', 'Outline', 'Structured extraction'] : ['Market Research', 'Article Market News', 'Event planning', 'Complex structured output'],
      speed: mini ? 'Fast' : sol ? 'Deliberate' : 'Moderate', reasoning: mini ? 'Balanced' : 'Deep',
      workflowFit: fit({
        'social-post': review ? 'limited' : mini ? 'good' : 'good',
        'video-script': review ? 'specialist' : 'good',
        'event-plan': review ? 'specialist' : 'excellent',
        'article-market-news': review ? 'specialist' : mini ? 'good' : 'excellent',
        'market-research': review ? 'specialist' : mini ? 'good' : 'excellent',
      }),
      note: review ? 'Gunakan setelah draft utama, bukan sebagai generator default.' : 'Panduan internal; model tidak boleh mengarang source, quotation, atau fakta pasar.',
    };
  }

  if (lower.includes('kimi') || lower.includes('moonshot')) {
    const code = lower.includes('coding') || lower.includes('code');
    const thinking = lower.includes('thinking');
    const highspeed = lower.includes('highspeed');
    return {
      family: 'Kimi',
      summary: code ? 'Model berorientasi coding/struktur; lebih relevan untuk transformasi teknis daripada copy utama.' : 'Model long-context untuk membaca brief panjang dan merangkum banyak konteks.',
      strengths: code ? ['Struktur teknis', 'Transformasi format', 'Instruksi sistematis'] : ['Long-context synthesis', 'Meringkas brief panjang', 'Membandingkan banyak input'],
      tradeoffs: code ? ['Bukan writing model utama', 'Tone marketing perlu banyak arahan', 'Kurang cocok untuk caption final'] : ['Tone Bahasa Indonesia perlu divalidasi', 'Belum banyak data penggunaan internal', thinking ? 'Varian thinking lebih lambat' : 'Output perlu QC brand'],
      bestFor: code ? ['JSON/schema work', 'Technical transformation', 'Workflow utilities'] : ['Long brief analysis', 'Research digestion', 'Reference comparison'],
      speed: highspeed ? 'Fast' : thinking ? 'Deliberate' : 'Moderate', reasoning: thinking ? 'Deep' : 'Balanced',
      workflowFit: fit({
        'social-post': code ? 'limited' : 'good',
        'video-script': code ? 'limited' : 'good',
        'event-plan': code ? 'specialist' : 'good',
        'article-market-news': code ? 'limited' : 'good',
        'market-research': code ? 'specialist' : 'excellent',
      }),
      note: 'Gunakan sebagai opsi eksplorasi sampai MarketingOS memiliki cukup data rating internal untuk perbandingan yang lebih kuat.',
    };
  }

  return {
    family: 'GorillaWorkout', summary: 'Model gateway general-purpose yang belum memiliki profil penggunaan khusus.',
    strengths: ['Tersedia melalui satu gateway', 'Dapat diuji per workflow'], tradeoffs: ['Belum ada observasi internal yang cukup', 'Perlu pilot dan rating user'],
    bestFor: ['Controlled pilot'], speed: 'Variable', reasoning: 'Balanced', workflowFit: BASE_FIT,
    note: 'Panduan awal; bukan vendor benchmark. Evaluasi dengan brief nyata sebelum menjadi default.',
  };
}

export const FIT_LABELS: Record<GuidanceLevel, string> = {
  excellent: 'Highly recommended', good: 'Recommended', specialist: 'Specialist / second pass', limited: 'Use with caution',
};

export const GUIDANCE_FEATURE_LABELS: Record<GenerationFeature, string> = {
  'social-post': 'Social Post', 'video-script': 'Video Script', 'event-plan': 'Event Plan',
  'article-market-news': 'Article Market News', 'market-research': 'Market Research',
  'ai-research': 'AI Research Assistant',
};

export const MODEL_GUIDANCE_DISCLAIMER = 'Operational guidance for MarketingOS; not a vendor benchmark or universal quality ranking.';
