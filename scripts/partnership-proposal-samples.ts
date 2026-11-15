/**
 * Renders sample proposals with a stub AI (no network, no database, no keys).
 * Usage: npx tsx scripts/partnership-proposal-samples.ts [outDir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildProposalDocument, draftProposalContent, parseProposalInput, type DraftDeps } from '../src/lib/partnership/proposal';
import { DEFAULT_PROPOSAL_SETTINGS } from '../src/lib/partnership/proposal-settings';
import { exportProposal } from '../src/lib/partnership/proposal-export';

const stub = (json: Record<string, unknown>): DraftDeps => ({ complete: async () => ({ content: JSON.stringify(json), model: 'stub' }) });

async function main() {
  const outDir = process.argv[2] || 'samples';
  await mkdir(outDir, { recursive: true });
  const settings = DEFAULT_PROPOSAL_SETTINGS;

  const tadakado = parseProposalInput({
    partnerName: 'Tadakado Indonesia',
    partnerDescription: 'Voucher and merchant rewards platform with selected merchants across Indonesia.',
    objective: 'User Acquisition',
    collaborationScheme: 'New users who download the Dupoin Futures Indonesia app and sign up are rewarded a voucher from Tadakado Indonesia.',
    userBenefit: 'Voucher value IDR 30K from Tadakado Indonesia, usable at selected merchants.',
    exposures: ['ig-feed-collab', 'ig-story', 'article', 'media-coverage'].map(itemId => ({ itemId, units: 1 })),
    offline: [],
    needs: [{ description: 'vouchers', quantity: 1000, unitValue: 30000 }, { description: 'Offline promotion material at some official merchants' }],
    language: 'en',
    template: 'slide',
    year: '2026',
  }, settings);
  if ('error' in tadakado) throw new Error(tadakado.error);
  const tadakadoDraft = await draftProposalContent(tadakado.value, stub({
    projectOverview: 'As part of efforts to increase brand awareness, Dupoin Futures Indonesia expands its brand visibility by joining the daily routines of potential users. Partnering with Tadakado Indonesia puts Dupoin in front of value-seeking shoppers who already redeem rewards at selected merchants, making the first step into Dupoin feel like a natural perk.',
    schemeGoal: 'Main Goals: User Acquisition',
    schemeHeading: 'Special Reward from Dupoin Indonesia',
    schemeBullets: ['New users who download the Dupoin Futures Indonesia app and sign up are rewarded a voucher from Tadakado Indonesia.', 'The IDR 30K Tadakado voucher can be enjoyed through selected merchants.'],
    userJourney: ['User sees the Dupoin & Tadakado collaboration poster at @dupoin.indonesia and @tadakado.id and scans the QR code.', 'User downloads and signs up at the Dupoin Futures app.', 'After signing up, user receives the Tadakado e-voucher in the message/inbox menu.'],
    exposureHighlights: ['1x Instagram collab post', '2x/week Instagram story', 'Collaboration article', 'Media coverage'],
    partnerSupport: ['Featured at brand offer catalog', 'Social media awareness (outside KV collab post)'],
    notes: ['Tax, if any, to be borne by Dupoin Futures Indonesia.'],
  }));

  const kopi = parseProposalInput({
    partnerName: 'Kopi Kenangan',
    partnerDescription: 'Indonesian grab-and-go coffee chain with offline stores nationwide.',
    objective: 'User Acquisition',
    collaborationScheme: 'Dupoin Futures Indonesia gives a benefit to Kopi Kenangan customers who download & register as new users of Dupoin Futures Indonesia.',
    userBenefit: 'Discount IDR 5k for every Kopi Kenangan Mantan purchase at offline stores, one time per registered user ID, valid for three months.',
    exposures: ['ig-feed-collab', 'ig-story', 'article', 'media-coverage', 'home-banner'].map(itemId => ({ itemId, units: 1 })),
    offline: [{ materialId: 'x-banner' }, { materialId: 'tent-card' }],
    language: 'id',
    template: 'document',
    year: '2026',
  }, settings);
  if ('error' in kopi) throw new Error(kopi.error);
  const kopiDraft = await draftProposalContent(kopi.value, stub({
    projectOverview: 'Sebagai bagian dari upaya meningkatkan brand awareness, Dupoin Futures Indonesia memperluas visibilitas brand dengan hadir dalam rutinitas harian calon pengguna. Kolaborasi dengan Kopi Kenangan menghadirkan Dupoin di momen ngopi sehari-hari, sehingga langkah pertama mengenal trading terasa dekat dan menyenangkan.',
    schemeGoal: 'Tujuan Utama: Akuisisi Pengguna',
    schemeHeading: 'Benefit untuk Pelanggan Kopi Kenangan',
    schemeBullets: ['Pelanggan Kopi Kenangan yang mengunduh dan mendaftar sebagai pengguna baru Dupoin Futures Indonesia mendapatkan benefit khusus.', 'Benefit berupa potongan IDR 5k untuk setiap pembelian Kopi Kenangan Mantan di toko offline.', 'Promo berlaku satu kali transaksi untuk setiap user ID yang terdaftar.', 'Promo berlaku selama tiga bulan.'],
    userJourney: ['Pengguna Kopi Kenangan klik banner promo Dupoin', 'Diarahkan ke App Store / Google Play', 'Unduh & daftar di aplikasi Dupoin', 'Terima kode voucher via email untuk pembelian di toko offline'],
    notes: ['Pajak, jika ada, ditanggung oleh Dupoin Futures Indonesia.'],
  }));

  const outputs: string[] = [];
  const write = async (name: string, data: Buffer) => { const file = path.join(outDir, name); await writeFile(file, data); outputs.push(`${file} (${data.length} bytes)`); };
  const tDoc = buildProposalDocument(tadakado.value, tadakadoDraft.content, settings, null);
  for (const [template, format] of [['slide', 'pdf'], ['slide', 'pptx'], ['document', 'pdf']] as const) {
    const out = await exportProposal(tDoc, template, format);
    await write(`tadakado-${template}.${format}`, out.data);
  }
  const kDoc = buildProposalDocument(kopi.value, kopiDraft.content, settings, null);
  for (const [template, format] of [['document', 'pdf'], ['slide', 'pdf'], ['slide', 'pptx']] as const) {
    const out = await exportProposal(kDoc, template, format);
    await write(`kopikenangan-${template}.${format}`, out.data);
  }
  console.log(outputs.join('\n'));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
