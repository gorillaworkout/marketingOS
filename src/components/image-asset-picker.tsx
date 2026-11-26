'use client';

import { useEffect, useState } from 'react';
import { Button, StatusBadge } from '@/components/ui/dashboard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { prepareUpload, prepareUploadFromUrl, type PreparedUpload } from '@/lib/client-image-upload';
import { formatBytes, type ImageAssetItem, type ImageAssetListResponse } from '@/lib/image-assets-shared';

type Tab = 'mine' | 'shared' | 'generated';

interface GalleryImage {
  filename: string;
  url: string;
  brief: string | null;
  title: string | null;
}

interface PickItem {
  key: string;
  url: string;
  name: string;
  libraryAssetId?: string;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'mine', label: 'My assets' },
  { key: 'shared', label: 'Shared with team' },
  { key: 'generated', label: 'Generated images' },
];

/**
 * "Pick from library" for Generate Image. Own assets, team-shared assets and
 * previously generated images can be added as visual references or assets.
 * Picked images become the same in-browser uploads as a file input, so the
 * generate request does not change.
 */
export function ImageAssetPicker({
  open,
  kindLabel,
  room,
  onClose,
  onPick,
}: {
  open: boolean;
  kindLabel: string;
  room: number;
  onClose: () => void;
  onPick: (items: PreparedUpload[]) => void;
}) {
  const [tab, setTab] = useState<Tab>('mine');
  const [library, setLibrary] = useState<ImageAssetListResponse | null>(null);
  const [generated, setGenerated] = useState<GalleryImage[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<ImageAssetItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [assetsRes, imagesRes] = await Promise.all([
          fetch('/api/image-assets', { cache: 'no-store' }),
          fetch('/api/images?scope=all&limit=48&offset=0'),
        ]);
        const assets = await assetsRes.json().catch(() => null) as (ImageAssetListResponse & { error?: string }) | null;
        const images = await imagesRes.json().catch(() => null) as { images?: GalleryImage[] } | null;
        if (cancelled) return;
        if (!assetsRes.ok || !assets) setError(assets?.error || 'The asset library could not be loaded.');
        else setLibrary(assets);
        setGenerated(Array.isArray(images?.images) ? images.images : []);
      } catch {
        if (!cancelled) setError('The asset library could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
  }, [open, reloadKey]);

  const reload = () => setReloadKey(key => key + 1);

  const items: PickItem[] = tab === 'generated'
    ? (generated ?? []).map(image => ({ key: `g:${image.filename}`, url: image.url, name: image.filename }))
    : ((tab === 'mine' ? library?.mine : library?.shared) ?? []).map(asset => ({ key: `a:${asset.id}`, url: asset.url, name: asset.name, libraryAssetId: asset.id }));
  const assetById = new Map([...(library?.mine ?? []), ...(library?.shared ?? [])].map(asset => [asset.id, asset]));
  const loading = tab === 'generated' ? generated === null : library === null && !error;

  const toggle = (key: string) => {
    setError('');
    setSelected(prev => {
      if (prev.includes(key)) return prev.filter(item => item !== key);
      if (prev.length >= room) {
        setError(room === 0 ? `No room left: remove a ${kindLabel.toLowerCase()} first.` : `You can add ${room} more.`);
        return prev;
      }
      return [...prev, key];
    });
  };

  const close = () => {
    setSelected([]);
    setError('');
    onClose();
  };

  const addSelected = async () => {
    const byKey = new Map<string, PickItem>();
    for (const item of items) byKey.set(item.key, item);
    // Selections may span tabs; resolve every key from its own source.
    for (const key of selected) {
      if (byKey.has(key)) continue;
      if (key.startsWith('g:')) {
        const image = generated?.find(entry => `g:${entry.filename}` === key);
        if (image) byKey.set(key, { key, url: image.url, name: image.filename });
      } else {
        const asset = assetById.get(key.slice(2));
        if (asset) byKey.set(key, { key, url: asset.url, name: asset.name, libraryAssetId: asset.id });
      }
    }
    setBusy(true);
    setError('');
    try {
      const prepared: PreparedUpload[] = [];
      for (const key of selected) {
        const item = byKey.get(key);
        if (!item) continue;
        const upload = await prepareUploadFromUrl(item.url, item.name);
        prepared.push(item.libraryAssetId ? { ...upload, libraryAssetId: item.libraryAssetId } : upload);
      }
      onPick(prepared);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An image could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const uploadToLibrary = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        const prepared = await prepareUpload(file);
        const body = new FormData();
        body.append('file', await (await fetch(prepared.dataUrl)).blob(), file.name);
        const res = await fetch('/api/image-assets', { method: 'POST', body });
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (!res.ok) throw new Error(data.error || `${file.name} could not be saved.`);
      }
      setTab('mine');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleShared = async (asset: ImageAssetItem) => {
    setError('');
    const res = await fetch(`/api/image-assets/${encodeURIComponent(asset.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shared: !asset.shared }),
    });
    const data = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) setError(data.error || 'Sharing could not be changed.');
    reload();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/image-assets/${encodeURIComponent(pendingDelete.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setDeleteError(data.error || 'The asset could not be deleted.');
        return;
      }
      setSelected(prev => prev.filter(key => key !== `a:${pendingDelete.id}`));
      setPendingDelete(null);
      reload();
    } finally {
      setDeleting(false);
    }
  };

  const usage = library?.usage;

  return (
    <ModalDialog open={open} title={`Pick from library · ${kindLabel}`} onClose={close} testId="asset-picker">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Library source" className="inline-flex rounded-lg border border-[var(--mos-border)] p-0.5">
          {TABS.map(option => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              data-testid={`asset-picker-tab-${option.key}`}
              onClick={() => setTab(option.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === option.key ? 'bg-[var(--mos-accent)] text-white' : 'text-[var(--mos-text-muted)] hover:text-white'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {usage && (
            <span className="text-xs text-[var(--mos-text-faint)]" data-testid="asset-picker-usage">
              {formatBytes(usage.bytes)} of {formatBytes(usage.limit)} used
            </span>
          )}
          <label className="inline-flex h-8 cursor-pointer items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs font-medium text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]">
            Upload to library
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              data-testid="asset-picker-upload"
              disabled={busy}
              onChange={event => { void uploadToLibrary(event.target.files); event.target.value = ''; }}
            />
          </label>
        </div>
      </div>
      <p className="text-xs text-[var(--mos-text-faint)]">
        {tab === 'mine' && 'Only you can see these unless you share them. 8 MB per file, 500 MB in total.'}
        {tab === 'shared' && 'Assets your teammates shared with the team.'}
        {tab === 'generated' && 'The latest 48 images from the gallery.'}
      </p>

      {loading && <p className="text-sm text-[var(--mos-text-muted)]">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="rounded-[var(--mos-radius-control)] border border-dashed border-[var(--mos-border)] px-4 py-8 text-center text-sm text-[var(--mos-text-muted)]">
          {tab === 'mine' ? 'Your library is empty. Upload images here, or use "Save to library" on an upload.' : tab === 'shared' ? 'Nothing has been shared with the team yet.' : 'No generated images yet.'}
        </p>
      )}
      {!loading && items.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" data-testid="asset-picker-grid">
          {items.map(item => {
            const asset = item.libraryAssetId ? assetById.get(item.libraryAssetId) : undefined;
            const isSelected = selected.includes(item.key);
            return (
              <li key={item.key} className={`overflow-hidden rounded-[var(--mos-radius-control)] border ${isSelected ? 'border-[var(--mos-accent)] ring-2 ring-[var(--mos-accent-ring)]' : 'border-[var(--mos-border)]'} bg-[var(--mos-surface)]`}>
                <button type="button" aria-pressed={isSelected} onClick={() => toggle(item.key)} className="block w-full" data-testid="asset-picker-item">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.name} loading="lazy" className="h-28 w-full object-cover" />
                </button>
                <div className="space-y-1 px-2 py-1.5">
                  <p className="truncate text-[11px] text-[var(--mos-text-muted)]" title={item.name}>{item.name}</p>
                  {asset && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      {tab === 'shared' && asset.ownerName && <span className="text-[var(--mos-text-faint)]">by {asset.ownerName}</span>}
                      {asset.shared && tab === 'mine' && <StatusBadge tone="info">Shared</StatusBadge>}
                      {asset.canManage && (
                        <>
                          <button type="button" className="text-[var(--mos-accent-soft)] hover:underline" data-testid="asset-picker-share" onClick={() => void toggleShared(asset)}>
                            {asset.shared ? 'Make personal' : 'Share with team'}
                          </button>
                          <button type="button" className="text-red-300 hover:underline" data-testid="asset-picker-delete" onClick={() => { setDeleteError(null); setPendingDelete(asset); }}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex items-center justify-end gap-2 border-t border-[var(--mos-border)] pt-4">
        <span className="mr-auto text-xs text-[var(--mos-text-faint)]">{selected.length} selected · room for {room}</span>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" data-testid="asset-picker-add" disabled={busy || selected.length === 0} onClick={() => void addSelected()}>
          {busy ? 'Adding…' : selected.length ? `Add ${selected.length} as ${kindLabel.toLowerCase()}` : `Add as ${kindLabel.toLowerCase()}`}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this asset permanently?"
        confirmLabel="Delete permanently"
        busyLabel="Deleting…"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!deleting) setPendingDelete(null); }}
        testId="asset-delete-dialog"
      >
        <p>{pendingDelete?.name} is removed from the library{pendingDelete?.shared ? ' for everyone on the team' : ''}. Images already generated with it are not affected.</p>
      </ConfirmDialog>
    </ModalDialog>
  );
}
