'use client';

const steps = [
  {
    number: '01',
    title: 'Research & Seleksi Topik',
    badge: 'Sumber awal',
    detail: 'Buka Investing.com, atur Bahasa Indonesia, lalu masuk ke News > Most Popular News. Periksa lima artikel teratas yang terbit hari ini atau paling baru.',
    outcome: 'Ada artikel relevan → gunakan sebagai referensi dan lanjut ke seleksi query.',
  },
  {
    number: '02',
    title: 'Research & Seleksi Query',
    badge: 'Validasi query',
    detail: 'Buka investasi.kontan.co.id > Investasi dan periksa lima artikel teratas dengan kriteria yang sama. Catat sumber, lima judul/waktu/URL, keyword teridentifikasi, dan status kesiapan.',
    outcome: 'Tidak ada topik relevan → hentikan penulisan dan ulangi riset setiap 10 menit.',
  },
  {
    number: '03',
    title: 'SEO Competitor Research',
    badge: 'Validasi SERP',
    detail: 'Gunakan Google Incognito dengan filter 24 jam terakhir. Ambil struktur H1/H2/H3 dari lima kompetitor teratas serta lima People Also Ask.',
    outcome: 'Pilih sudut terkuat dan rumuskan SEO H1.',
  },
  {
    number: '04',
    title: 'Draft Article',
    badge: 'Produksi',
    detail: 'Tulis artikel jurnalistik berbahasa Indonesia sepanjang 800–1000 kata. Judul memuat keyword utama dan maksimal 60 karakter.',
    outcome: 'Siapkan di DOCX atau Google Docs untuk pemeriksaan.',
  },
  {
    number: '05',
    title: 'Plagiarism Check',
    badge: 'Gate orisinalitas',
    detail: 'Periksa draf melalui SmallSEOTools plagiarism checker dan simpan hasil pemeriksaannya.',
    outcome: 'Skor >90% → siap terbit. Skor <90% → wajib revisi.',
  },
  {
    number: '06',
    title: 'Revise & Recheck',
    badge: 'Perbaikan',
    detail: 'Unduh laporan, tulis ulang segmen yang ditandai secara spesifik, lalu jalankan pemeriksaan kembali.',
    outcome: 'Ulangi sampai skor >90%, baru artikel dapat dipublikasikan.',
  },
];

const topicKeywords = ['Emas', 'Harga Emas', 'XAUUSD/XAU/USD', 'Rupiah', 'Dollar/Dolar', 'Wall Street', 'Minyak/Harga Minyak'];

export default function SopPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-8">
      <header className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-950/70 via-gray-800/80 to-gray-800/50 p-6 md:p-8">
        <div className="absolute -right-10 -top-12 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300">
              <span>🔀</span> MarketingOS Resource · Standar Editorial
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-white md:text-4xl">SOP &amp; Flow</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-300 md:text-base">Alur kerja manual untuk menstandarkan riset, penulisan, dan quality gate artikel market news.</p>
          </div>
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 lg:max-w-sm">
            <span className="font-semibold">Tindakan SOP manual.</span> Kontrol di halaman ini adalah panduan kerja, bukan otomasi Google, Investing.com, Kontan, atau SmallSEOTools.
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-2xl border border-gray-700/60 bg-gray-800/50 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Tujuan</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Satu standar dari sinyal berita sampai siap terbit</h2>
          <p className="mt-3 text-sm leading-6 text-gray-400">Gunakan flow ini untuk memastikan artikel memiliki sumber aktual, query yang tervalidasi, struktur SEO yang terarah, dan orisinalitas yang lolos sebelum publikasi.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {topicKeywords.map(keyword => <span key={keyword} className="rounded-md border border-gray-600/60 bg-gray-900/50 px-2.5 py-1 text-xs text-gray-300">{keyword}</span>)}
          </div>
        </div>
        <aside className="rounded-2xl border border-red-500/25 bg-red-500/10 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-red-300">Non-negotiable</p>
          <ul className="mt-3 space-y-3 text-sm leading-5 text-red-100">
            <li>• Jangan membuat atau mengasumsikan fakta, angka, maupun kutipan.</li>
            <li>• Jangan menyebut broker kompetitor.</li>
            <li>• Jangan terbitkan jika riset belum menemukan topik valid atau skor orisinalitas belum memenuhi syarat.</li>
          </ul>
        </aside>
      </section>

      <section aria-labelledby="flow-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Workflow</p><h2 id="flow-title" className="mt-1 text-xl font-semibold text-white">Flow produksi artikel market news</h2></div>
          <span className="hidden rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-400 sm:block">Baca dari kiri ke kanan, lalu ke baris berikutnya</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {steps.map((step, index) => (
            <article key={step.number} className="relative flex min-h-64 flex-col rounded-2xl border border-gray-700/60 bg-gray-800/50 p-5 transition-colors hover:border-blue-500/40">
              <div className="flex items-start justify-between gap-3"><span className="text-3xl font-bold text-blue-400/80">{step.number}</span><span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-300">{step.badge}</span></div>
              <h3 className="mt-4 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">{step.detail}</p>
              <div className="mt-auto border-t border-gray-700/60 pt-3 text-sm font-medium leading-5 text-emerald-300">{step.outcome}</div>
              {index < steps.length - 1 && <span className="absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-gray-600 bg-gray-900 text-xs text-gray-400 md:hidden">↓</span>}
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">Cabang keputusan · riset</p>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-300"><span className="font-semibold text-white">Investing.com: ada artikel relevan?</span><br />Ya → jadikan referensi, lanjut ke SEO Competitor Research, dan lewati Kontan. Tidak → lanjut ke Kontan.</div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100"><span className="font-semibold">Kontan: masih tidak ada artikel relevan?</span><br />Hentikan penulisan. Ulangi kedua riset setiap <strong>10 menit</strong> sampai ada topik yang valid.</div>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Acceptance gate · sebelum publish</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4"><p className="text-2xl font-bold text-emerald-300">&gt;90%</p><p className="mt-1 text-sm text-emerald-100">SmallSEOTools: siap terbit bila seluruh checklist juga lengkap.</p></div>
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4"><p className="text-2xl font-bold text-red-300">&lt;90%</p><p className="mt-1 text-sm text-red-100">Wajib revisi segmen bertanda dan periksa ulang.</p></div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <div className="rounded-2xl border border-gray-700/60 bg-gray-800/50 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Data konten hari ini</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Metadata yang wajib dicatat</h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {['Tanggal & waktu riset', 'Sumber referensi', '5 judul + waktu + URL', 'Keyword teridentifikasi', 'SEO H1 & sudut artikel', 'Status: siap / menunggu / revisi', 'Skor plagiarism checker', 'Tautan DOCX / Google Docs'].map(item => (
              <div key={item} className="rounded-lg bg-gray-900/50 px-3 py-2.5"><dt className="text-gray-500">{item}</dt><dd className="mt-1 text-gray-300">Diisi oleh operator</dd></div>
            ))}
          </dl>
        </div>
        <div className="rounded-2xl border border-gray-700/60 bg-gray-800/50 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Catatan SOP & prompt</p>
          <div className="mt-4 space-y-3">
            <details className="group rounded-xl border border-gray-700 bg-gray-900/35 p-4"><summary className="cursor-pointer list-none font-medium text-white">Standar riset &amp; SEO <span className="float-right text-blue-400 group-open:rotate-45">+</span></summary><div className="mt-3 text-sm leading-6 text-gray-400">Gunakan artikel terkini yang mengandung salah satu keyword fokus. Di Google Incognito, ambil H1/H2/H3 dari lima kompetitor dan lima People Also Ask setelah menerapkan filter 24 jam terakhir.</div></details>
            <details className="group rounded-xl border border-gray-700 bg-gray-900/35 p-4"><summary className="cursor-pointer list-none font-medium text-white">Standar draf artikel <span className="float-right text-blue-400 group-open:rotate-45">+</span></summary><div className="mt-3 text-sm leading-6 text-gray-400">Sertakan keyword di paragraf pertama; gunakan H1/H2/H3 dan lima PAA sebagai heading. Cantumkan outlet serta tanggal sumber. Kutipan analis/institusi hanya boleh dipakai bila data sumber mendukungnya. Akhiri dengan CTA satu kalimat ke akun Dupoin.</div></details>
            <details className="group rounded-xl border border-gray-700 bg-gray-900/35 p-4"><summary className="cursor-pointer list-none font-medium text-white">Prompt pengingat editor <span className="float-right text-blue-400 group-open:rotate-45">+</span></summary><div className="mt-3 text-sm leading-6 text-gray-400">“Tulis secara faktual dan jurnalistik dalam Bahasa Indonesia, tanpa fabrikasi. Pertahankan konteks sumber, hindari penyebutan broker kompetitor, dan pastikan setiap klaim dapat ditelusuri ke data riset.”</div></details>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-700/60 bg-gray-800/50 p-5 md:p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Checklist output</p>
        <div className="mt-4 grid gap-x-8 gap-y-3 text-sm text-gray-300 md:grid-cols-2">
          {['Topik valid ditemukan dan sumber dicatat', 'Lima artikel Kontan (judul, waktu, URL) tercatat', 'H1 SEO dan lima PAA telah dipilih', 'Judul ≤60 karakter; draf 800–1000 kata', 'Keyword ada di paragraf pertama dan struktur H1/H2/H3 lengkap', 'Outlet/tanggal sumber serta fakta/kutipan tervalidasi', 'CTA satu kalimat menuju akun Dupoin tersedia', 'DOCX atau Google Docs siap; skor >90% terdokumentasi'].map(item => <div key={item} className="flex gap-3 rounded-lg border border-gray-700/50 bg-gray-900/30 px-3 py-2.5"><span className="text-blue-400">□</span><span>{item}</span></div>)}
        </div>
      </section>
    </div>
  );
}
