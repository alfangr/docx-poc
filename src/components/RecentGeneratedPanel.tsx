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

import { useMemo, useState } from "react";

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
  const [query, setQuery] = useState("");

  // Cocokkan berdasarkan nama file saja — itu satu-satunya info yang
  // ditampilkan per entri, jadi satu-satunya yang masuk akal dicari.
  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.fileName.toLowerCase().includes(needle));
  }, [entries, query]);

  return (
    <aside
      className={`flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}
      aria-label="Riwayat generate"
    >
      <header className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Riwayat Generate</h2>
        {/* Search hanya berguna kalau ada lebih dari segelintir entri —
            disembunyikan saat riwayat masih kosong supaya tidak menambah
            elemen yang tidak ada gunanya di EmptyState. */}
        {entries.length > 0 && (
          <SearchInput value={query} onChange={setQuery} resultCount={filteredEntries.length} />
        )}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <p className="px-1 py-4 text-center text-xs text-slate-400">Memuat riwayat…</p>
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : filteredEntries.length === 0 ? (
          <NoResultsState query={query} onClear={() => setQuery("")} />
        ) : (
          filteredEntries.map((entry) => (
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
    <div className="rounded-md border border-slate-200 px-3 py-2">
      {/* Baris judul: 2 baris penuh (line-clamp) + break-words, supaya nama
          file panjang tanpa spasi tetap terbaca daripada terpotong jadi
          beberapa karakter saja. Tombol Hapus jadi ikon kecil di sini supaya
          tidak ikut memperebutkan lebar dengan judul. */}
      <div className="flex items-start gap-2">
        <p
          className="line-clamp-2 min-w-0 flex-1 break-words text-xs font-semibold text-slate-800"
          title={entry.fileName}
        >
          {entry.fileName}
        </p>

        <button
          type="button"
          onClick={() => onDelete(entry.id)}
          aria-label={`Hapus ${entry.fileName} dari riwayat`}
          className="
            shrink-0 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs
            font-medium text-red-700 transition-colors hover:bg-red-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500
          "
        >
          ✕
        </button>
      </div>

      {/* Baris kedua: metadata di kiri, aksi utama (Load) di kanan — terpisah
          dari judul supaya judul dapat lebar penuh baris di atas. */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] text-slate-400">
          {formatBytes(entry.size)} · {formatDate(entry.generatedAt)}
        </p>

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
      </div>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  resultCount,
}: {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
}) {
  return (
    <div>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>

        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Cari nama file…"
          aria-label="Cari riwayat generate"
          className="
            w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-7 text-xs
            text-slate-700 placeholder:text-slate-400
            focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400
          "
        />

        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Hapus pencarian"
            className="
              absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-xs
              text-slate-400 hover:bg-slate-100 hover:text-slate-600
            "
          >
            ✕
          </button>
        )}
      </div>

      {value.trim() && (
        <p className="mt-1 px-0.5 text-[11px] text-slate-400">
          {resultCount === 0 ? "Tidak ada hasil" : `${resultCount} hasil`}
        </p>
      )}
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

function NoResultsState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm font-medium text-slate-500">
        Tidak ada file cocok dengan "{query.trim()}"
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-xs font-medium text-blue-600 hover:underline"
      >
        Hapus pencarian
      </button>
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
