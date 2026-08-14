"use client";

/**
 * RecentGeneratedPanel.tsx
 * -----------------------------------------------------------------------------
 * Daftar dokumen yang sudah di-generate (lihat `useRecentDocuments`), dengan
 * aksi Load (buka kembali ke editor aktif) dan Hapus per entri.
 *
 * Bentuknya sengaja meniru `AIChatSidebar`: `<aside>` dengan `className` yang
 * bisa disuntik dari luar, supaya kedua panel bisa dipasang bergantian di
 * slot tab sidebar yang sama.
 */

import type { RecentDocumentEntry } from "@/hooks/useRecentDocuments";

export interface RecentGeneratedPanelProps {
  entries: RecentDocumentEntry[];
  isLoading: boolean;
  error: string | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onDismissError: () => void;
  className?: string;
}

export function RecentGeneratedPanel({
  entries,
  isLoading,
  error,
  onLoad,
  onDelete,
  onDismissError,
  className = "",
}: RecentGeneratedPanelProps) {
  return (
    <aside
      className={`flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}
      aria-label="Riwayat generate"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Riwayat Generate</h2>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <p className="px-1 py-4 text-center text-xs text-slate-400">Memuat riwayat…</p>
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : (
          entries.map((entry) => (
            <RecentDocumentRow
              key={entry.id}
              entry={entry}
              onLoad={onLoad}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      {error && (
        <div
          className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-3 py-2"
          role="alert"
        >
          <p className="flex-1 text-xs text-red-700">{error}</p>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="Tutup pesan error"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-100"
          >
            ✕
          </button>
        </div>
      )}
    </aside>
  );
}

function RecentDocumentRow({
  entry,
  onLoad,
  onDelete,
}: {
  entry: RecentDocumentEntry;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-800" title={entry.fileName}>
          {entry.fileName}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {formatBytes(entry.size)} · {formatDate(entry.generatedAt)}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onLoad(entry.id)}
        className="
          shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium
          text-slate-700 transition-colors hover:bg-slate-50
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        "
      >
        Load
      </button>

      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        aria-label={`Hapus ${entry.fileName} dari riwayat`}
        className="
          shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium
          text-red-700 transition-colors hover:bg-red-100
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500
        "
      >
        Hapus
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm font-medium text-slate-500">Belum ada dokumen yang di-generate</p>
      <p className="text-xs text-slate-400">
        Klik "Generate" di toolbar untuk membuat entri riwayat pertama.
      </p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default RecentGeneratedPanel;
