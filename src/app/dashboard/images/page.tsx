'use client';
import { useState, useEffect, useCallback } from 'react';
import { Button, EmptyState, FilterGroup, LoadingState, Panel, PageHeader, PageStack, StatusBadge, Toolbar } from '@/components/ui/dashboard';

interface ImageItem {
  filename: string;
  url: string;
  createdAt: string;
  taskId: string | null;
  brief: string | null;
  title: string | null;
  userId: string | null;
  username: string | null;
  name: string | null;
  linked: boolean;
}

const FILTERS = [
  { key: 'all', label: 'All images' },
  { key: 'linked', label: 'Linked to tasks' },
  { key: 'unlinked', label: 'Standalone' },
];

export default function ImagesPage() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [lightbox, setLightbox] = useState<ImageItem | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const limit = 20;

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/images?filter=${filter}&limit=${limit}&offset=${offset}`);
      const data = await res.json();
      if (data.images) {
        setImages(data.images);
        setTotal(data.total);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, [filter, offset]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  useEffect(() => {
    setOffset(0);
  }, [filter]);

  const handleDownload = async (img: ImageItem) => {
    try {
      const res = await fetch(img.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = img.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // fallback: open in new tab
      window.open(img.url, '_blank');
    }
  };

  const handleCopyUrl = async (img: ImageItem) => {
    const fullUrl = `${window.location.origin}${img.url}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedUrl(img.filename);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      // fallback
      const input = document.createElement('input');
      input.value = fullUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedUrl(img.filename);
      setTimeout(() => setCopiedUrl(null), 2000);
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setLightbox(null);
    if (!lightbox) return;
    const idx = images.findIndex(i => i.filename === lightbox.filename);
    if (e.key === 'ArrowRight' && idx < images.length - 1) setLightbox(images[idx + 1]);
    if (e.key === 'ArrowLeft' && idx > 0) setLightbox(images[idx - 1]);
  }, [lightbox, images]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <PageStack>
      <PageHeader eyebrow="Library / Assets" title="Image gallery" description={`Browse and manage generated image assets · ${total} total`} actions={<Button onClick={fetchImages}>Refresh</Button>} />

      {/* Filters */}
      <Toolbar><FilterGroup>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              filter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-[var(--mos-raised)] text-[var(--mos-text-muted)] hover:text-white hover:bg-[var(--mos-raised)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </FilterGroup></Toolbar>

      {/* Loading */}
      {loading && (
        <LoadingState label="Loading images" />
      )}

      {/* Empty State */}
      {!loading && images.length === 0 && (
        <Panel padding="none"><EmptyState title="No images generated yet" description="Generate images from the Social Post or Image Generator to see them here." /></Panel>
      )}

      {/* Image Grid */}
      {!loading && images.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {images.map(img => (
              <Panel
                padding="none"
                key={img.filename}
                className="group transition-all hover:border-[var(--mos-border-strong)]"
              >
                {/* Image Thumbnail */}
                <div
                  className="relative aspect-square bg-[var(--mos-surface)] cursor-pointer overflow-hidden"
                  onClick={() => setLightbox(img)}
                >
                  <img
                    src={img.url}
                    alt={img.brief || img.filename}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                    <span className="text-white text-xs">Open preview</span>
                  </div>
                  {img.linked && (
                    <StatusBadge className="absolute right-2 top-2" tone="info">Linked</StatusBadge>
                  )}
                </div>

                {/* Card Info */}
                <div className="p-3">
                  {img.title && (
                    <p className="text-white text-sm font-medium truncate mb-1">{img.title}</p>
                  )}
                  {img.brief && !img.title && (
                    <p className="text-[var(--mos-text-secondary)] text-xs line-clamp-2 mb-1">{img.brief}</p>
                  )}
                  {!img.title && !img.brief && (
                    <p className="text-[var(--mos-text-faint)] text-xs truncate mb-1">{img.filename}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-[var(--mos-text-faint)] text-[11px]">{formatDate(img.createdAt)}</p>
                    {img.username && (
                      <p className="text-[var(--mos-text-faint)] text-[11px]">@{img.username}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--mos-border)]">
                    <button
                      onClick={() => handleDownload(img)}
                      className="flex-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs py-1.5 rounded-lg transition-colors"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => handleCopyUrl(img)}
                      className={`flex-1 text-xs py-1.5 rounded-lg transition-colors ${
                        copiedUrl === img.filename
                          ? 'bg-emerald-600/20 text-emerald-400'
                          : 'bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-muted)] hover:text-white'
                      }`}
                    >
                      {copiedUrl === img.filename ? 'Copied' : 'Copy URL'}
                    </button>
                  </div>
                </div>
              </Panel>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="px-3 py-2 rounded-lg text-sm bg-[var(--mos-raised)] text-[var(--mos-text-muted)] hover:text-white hover:bg-[var(--mos-raised)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <span className="text-[var(--mos-text-faint)] text-sm px-3">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total}
                className="px-3 py-2 rounded-lg text-sm bg-[var(--mos-raised)] text-[var(--mos-text-muted)] hover:text-white hover:bg-[var(--mos-raised)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] w-full" onClick={e => e.stopPropagation()}>
            {/* Close button */}
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-10 right-0 text-[var(--mos-text-muted)] hover:text-white text-sm"
            >
              ✕ Close (Esc)
            </button>

            {/* Navigation */}
            {images.findIndex(i => i.filename === lightbox.filename) > 0 && (
              <button
                onClick={() => {
                  const idx = images.findIndex(i => i.filename === lightbox.filename);
                  if (idx > 0) setLightbox(images[idx - 1]);
                }}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 text-[var(--mos-text-muted)] hover:text-white text-2xl"
              >
                ‹
              </button>
            )}
            {images.findIndex(i => i.filename === lightbox.filename) < images.length - 1 && (
              <button
                onClick={() => {
                  const idx = images.findIndex(i => i.filename === lightbox.filename);
                  if (idx < images.length - 1) setLightbox(images[idx + 1]);
                }}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 text-[var(--mos-text-muted)] hover:text-white text-2xl"
              >
                ›
              </button>
            )}

            {/* Image */}
            <img
              src={lightbox.url}
              alt={lightbox.brief || lightbox.filename}
              className="max-w-full max-h-[80vh] mx-auto rounded-lg object-contain"
            />

            {/* Info bar */}
            <div className="mt-4 flex items-center justify-between bg-[var(--mos-raised)] rounded-lg p-3">
              <div>
                {lightbox.title && <p className="text-white text-sm font-medium">{lightbox.title}</p>}
                {lightbox.brief && <p className="text-[var(--mos-text-muted)] text-xs mt-0.5 line-clamp-1">{lightbox.brief}</p>}
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-[var(--mos-text-faint)] text-[11px]">{formatDate(lightbox.createdAt)}</p>
                  {lightbox.username && (
                    <p className="text-[var(--mos-text-faint)] text-[11px]">Generated by @{lightbox.username}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDownload(lightbox)}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-4 py-2 rounded-lg transition-colors"
                >
                  Download
                </button>
                <button
                  onClick={() => handleCopyUrl(lightbox)}
                  className={`text-xs px-4 py-2 rounded-lg transition-colors ${
                    copiedUrl === lightbox.filename
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)]'
                  }`}
                >
                  {copiedUrl === lightbox.filename ? 'Copied' : 'Copy URL'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageStack>
  );
}
