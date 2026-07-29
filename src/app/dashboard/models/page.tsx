'use client';

import { useEffect, useState } from 'react';

interface ModelInfo {
  id: string;
  name: string;
  tier: 'budget' | 'balanced' | 'premium';
  provider: 'openrouter' | 'codex' | 'claude-code' | 'gorillaworkout';
  input: number;
  output: number;
  inputPricePerM: number;
  outputPricePerM: number;
  pricingSource: 'openrouter-live' | 'fallback' | 'subscription' | 'gateway';
  sourceUrl: string | null;
}

interface ProviderInfo {
  label: string;
  icon: string;
  credits: string | null;
  status: string;
}

interface ModelsData {
  models: ModelInfo[];
  providers: Record<string, ProviderInfo>;
  generatedAt: string;
}

const tierConfig: Record<string, { label: string; dot: string; bg: string; text: string; desc: string }> = {
  budget: { label: 'Budget', dot: 'bg-green-400', bg: 'bg-green-500/15', text: 'text-green-400', desc: 'Cepat, ekonomis untuk tugas sederhana' },
  balanced: { label: 'Balanced', dot: 'bg-yellow-400', bg: 'bg-yellow-500/15', text: 'text-yellow-400', desc: 'Kualitas baik, harga wajar' },
  premium: { label: 'Premium', dot: 'bg-red-400', bg: 'bg-red-500/15', text: 'text-red-400', desc: 'Kualitas terbaik untuk tugas kompleks' },
};

const statusConfig: Record<string, { label: string; dot: string }> = {
  has_credits: { label: 'Tersedia', dot: 'bg-emerald-400' },
  low: { label: 'Hampir habis', dot: 'bg-amber-400' },
  error: { label: 'Gagal cek', dot: 'bg-red-400' },
  unreachable: { label: 'Tidak terjangkau', dot: 'bg-red-400' },
  not_configured: { label: 'Tidak dikonfigurasi', dot: 'bg-gray-500' },
  unknown: { label: 'Tidak diketahui', dot: 'bg-gray-500' },
  available: { label: 'Tersedia', dot: 'bg-emerald-400' },
};

const providerNames: Record<string, string> = {
  openrouter: 'OpenRouter',
  codex: 'Codex (ChatGPT Plus)',
  'claude-code': 'Claude Code',
  gorillaworkout: 'GorillaWorkout LLM API',
};

function formatPrice(price: number): string {
  return price < 1
    ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    : price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ModelsPage() {
  const [data, setData] = useState<ModelsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 p-6 flex items-center justify-center">
        <p className="text-gray-400">Memuat informasi model...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <p className="text-red-400">Gagal memuat data model.</p>
      </div>
    );
  }

  const providers = (['gorillaworkout', 'codex', 'claude-code', 'openrouter'] as const)
    .filter(p => p in data.providers);
  const provider = data.providers;

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-1">🧠 Models & Pricing</h1>
        <p className="text-sm text-gray-400 mb-6">
          Semua model AI yang tersedia untuk content generation. Harga OpenRouter adalah harga mulai dari provider aktif per 1 juta token.
          Diperbarui: {new Date(data.generatedAt).toLocaleString('id-ID')}
        </p>

        {/* Provider Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {providers.map(pk => {
            const p = provider[pk];
            const s = statusConfig[p.status] || statusConfig.unknown;
            return (
              <div key={pk} className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{p.icon}</span>
                    <h3 className="text-sm font-semibold text-white">{p.label}</h3>
                  </div>
                  <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`}></span>
                </div>
                <p className={`text-xs ${s.dot.replace('bg-', 'text-')}`}>{s.label}</p>
                {p.credits !== null && (
                  <p className="text-xs text-gray-400 mt-1">
                    💰 ${p.credits} tersisa
                  </p>
                )}
                <p className="text-[10px] text-gray-500 mt-2">
                  {pk === 'codex' && 'Termasuk langganan ChatGPT Plus · Tidak ada biaya per token'}
                  {pk === 'claude-code' && 'Termasuk langganan Claude · Tidak ada biaya per token'}
                  {pk === 'openrouter' && 'Bayar per token via saldo OpenRouter'}
                  {pk === 'gorillaworkout' && 'Model tersedia melalui llm.gorillaworkout.id API'}
                </p>
              </div>
            );
          })}
        </div>

        {/* Models by Provider */}
        {providers.map(pk => {
          const models = data.models.filter(m => m.provider === pk);
          const p = provider[pk];
          if (models.length === 0) return null;

          return (
            <div key={pk} className="mb-8">
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <span>{p.icon}</span>
                <span>{providerNames[pk] || p.label}</span>
                <span className="text-xs text-gray-500 font-normal">— {models.length} model</span>
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-left">
                      <th className="py-2.5 px-3 text-gray-400 font-medium text-xs uppercase tracking-wider">Model</th>
                      <th className="py-2.5 px-3 text-gray-400 font-medium text-xs uppercase tracking-wider">Tier</th>
                      <th className="py-2.5 px-3 text-gray-400 font-medium text-xs uppercase tracking-wider">Input mulai / 1M</th>
                      <th className="py-2.5 px-3 text-gray-400 font-medium text-xs uppercase tracking-wider">Output mulai / 1M</th>
                      <th className="py-2.5 px-3 text-gray-400 font-medium text-xs uppercase tracking-wider">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map(m => {
                      const tc = tierConfig[m.tier];
                      const isFree = m.input === 0 && m.output === 0;
                      return (
                        <tr key={m.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                          <td className="py-3 px-3">
                            <div className="text-white font-medium">{m.name}</div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{m.id}</div>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${tc.bg} ${tc.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${tc.dot}`}></span>
                              {tc.label}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-gray-300">
                              {isFree ? (
                                <span className="text-emerald-400">✓ Included</span>
                              ) : m.inputPricePerM > 0 ? (
                                `$${formatPrice(m.inputPricePerM)}`
                              ) : '< $0.01'}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-gray-300">
                              {isFree ? (
                                <span className="text-emerald-400">✓ Included</span>
                              ) : m.outputPricePerM > 0 ? (
                                `$${formatPrice(m.outputPricePerM)}`
                              ) : '< $0.01'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-xs text-gray-400">
                            {isFree
                              ? pk === 'codex'
                                ? 'Sumber: Codex · Paket ChatGPT Plus'
                                : pk === 'claude-code'
                                  ? 'Sumber: Claude Code · Paket Claude subscription'
                                  : pk === 'gorillaworkout'
                                    ? 'Sumber: GorillaWorkout LLM API'
                                    : 'Sumber: OpenRouter'
                              : <div className="space-y-1">
                                  <div>Mulai dari provider aktif · {tc.desc}</div>
                                  {m.sourceUrl && (
                                    <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                                      Lihat harga resmi OpenRouter
                                    </a>
                                  )}
                                  {m.pricingSource === 'fallback' && (
                                    <div className="text-amber-400">Live pricing tidak terjangkau — menampilkan fallback terakhir.</div>
                                  )}
                                </div>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {/* Pricing Note */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 mt-4">
          <h3 className="text-sm font-semibold text-white mb-2">💡 Catatan Biaya</h3>
          <ul className="text-xs text-gray-400 space-y-1.5">
            <li>• <strong className="text-gray-300">OpenRouter</strong> — bayar per token dari saldo akun. Harga diambil dari endpoint provider resmi OpenRouter.</li>
            <li>• <strong className="text-gray-300">Harga dapat berbeda antar-provider</strong> — angka yang tampil adalah harga termurah dari provider aktif saat data dimuat, bukan quotation tetap.</li>
            <li>• <strong className="text-gray-300">Codex (ChatGPT Plus)</strong> — termasuk dalam langganan ChatGPT Plus $20/bulan. Tidak ada biaya per token.</li>
            <li>• <strong className="text-gray-300">Claude Code</strong> — termasuk dalam langganan Claude. Tidak ada biaya per token.</li>
            <li>• Model budget cocok untuk tugas sederhana & testing. Premium untuk kualitas terbaik.</li>
          </ul>
        </div>

        {/* Hermes Config Note */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 mt-4">
          <h3 className="text-sm font-semibold text-white mb-2">⚙️ Model Default Hermes Agent</h3>
          <p className="text-xs text-gray-400">
            Hermes Agent (asisten Telegram) dikonfigurasi terpisah via terminal: <code className="text-emerald-400">hermes config set model &lt;id&gt;</code> dan <code className="text-emerald-400">hermes config set provider &lt;provider&gt;</code>.
            Provider yang tersedia: <code className="text-cyan-400">openai-codex</code>, <code className="text-cyan-400">openrouter</code>, <code className="text-cyan-400">anthropic</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
