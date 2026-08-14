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

import {
  MAX_FAVORITE_ENTRIES,
  type RecentDocumentEntry,
} from "@/hooks/useRecentDocuments";

export interface RecentGeneratedPanelProps {
  entries: RecentDocumentEntry[];
  isLoading: boolean;
  error: string | null;
  onLoad: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onDismissError: () => void;
  className?: string;
}

export function RecentGeneratedPanel({
  entries,
  isLoading,
  error,
  onLoad,
  onToggleFavorite,
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

  const favoriteEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.isFavorite)
        .sort((a, b) =>
          (b.favoritedAt ?? b.generatedAt).localeCompare(
            a.favoritedAt ?? a.generatedAt,
          ),
        )
        .slice(0, MAX_FAVORITE_ENTRIES),
    [entries],
  );

  return (
    <aside
      className={`flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}
      aria-label="Riwayat generate"
    >
      <header className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Riwayat Generate</h2>
          {entries.length > 0 && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
              {favoriteEntries.length}/{MAX_FAVORITE_ENTRIES} favorit
            </span>
          )}
        </div>
        {/* Search hanya berguna kalau ada lebih dari segelintir entri —
            disembunyikan saat riwayat masih kosong supaya tidak menambah
            elemen yang tidak ada gunanya di EmptyState. */}
        {entries.length > 0 && (
          <SearchInput value={query} onChange={setQuery} resultCount={filteredEntries.length} />
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-4 py-7 text-center text-xs text-slate-400">Memuat riwayat…</p>
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <QuickAccess
              entries={favoriteEntries}
              onLoad={onLoad}
              onToggleFavorite={onToggleFavorite}
            />

            <section className="border-t border-slate-100 p-3" aria-labelledby="all-history-title">
              <div className="mb-2 flex items-center justify-between">
                <h3
                  id="all-history-title"
                  className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400"
                >
                  Semua riwayat
                </h3>
                <span className="text-[11px] text-slate-400">{filteredEntries.length} dokumen</span>
              </div>

              {filteredEntries.length === 0 ? (
                <NoResultsState query={query} onClear={() => setQuery("")} />
              ) : (
                <div className="space-y-2">
                  {filteredEntries.map((entry) => (
                    <RecentDocumentRow
                      key={entry.id}
                      entry={entry}
                      onLoad={onLoad}
                      onToggleFavorite={onToggleFavorite}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
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
  onToggleFavorite,
  onDelete,
}: {
  entry: RecentDocumentEntry;
  onLoad: (id: string) => void;
  onToggleFavorite: (id: string) => void;
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

        <FavoriteButton entry={entry} onToggle={onToggleFavorite} />

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

function QuickAccess({
  entries,
  onLoad,
  onToggleFavorite,
}: {
  entries: RecentDocumentEntry[];
  onLoad: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  return (
    <section className="bg-gradient-to-b from-amber-50/80 to-white p-3" aria-labelledby="quick-access-title">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 id="quick-access-title" className="text-xs font-bold text-slate-800">
            Quick Access
          </h3>
          <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
            Favorit siap dimuat tanpa perlu mencari.
          </p>
        </div>
        <StarIcon filled className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-amber-200 bg-white/70 px-3 py-3 text-center">
          <p className="text-[11px] font-medium text-slate-600">Belum ada favorit</p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Tekan ikon bintang pada riwayat untuk menambahkannya.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="group relative min-w-0 rounded-lg border border-amber-200 bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => onToggleFavorite(entry.id)}
                aria-label={`Hapus ${entry.fileName} dari Quick Access`}
                title="Hapus dari Quick Access"
                className="absolute right-1.5 top-1.5 rounded-md p-1 text-amber-500 hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <StarIcon filled className="h-3.5 w-3.5" />
              </button>
              <p className="line-clamp-2 min-h-8 break-words pr-6 text-[11px] font-semibold leading-4 text-slate-800" title={entry.fileName}>
                {entry.fileName}
              </p>
              <p className="mt-1 truncate text-[9px] text-slate-400">
                {formatDate(entry.generatedAt)}
              </p>
              <button
                type="button"
                onClick={() => onLoad(entry.id)}
                className="mt-2 w-full rounded-md bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-white transition hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
              >
                Load dokumen
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FavoriteButton({
  entry,
  onToggle,
}: {
  entry: RecentDocumentEntry;
  onToggle: (id: string) => void;
}) {
  const label = entry.isFavorite
    ? `Hapus ${entry.fileName} dari Quick Access`
    : `Tambahkan ${entry.fileName} ke Quick Access`;

  return (
    <button
      type="button"
      onClick={() => onToggle(entry.id)}
      aria-label={label}
      aria-pressed={entry.isFavorite}
      title={entry.isFavorite ? "Hapus dari Quick Access" : "Tambahkan ke Quick Access"}
      className={`shrink-0 rounded-md border p-1 transition-colors focus-visible:ring-2 focus-visible:ring-amber-500 ${
        entry.isFavorite
          ? "border-amber-200 bg-amber-50 text-amber-500 hover:bg-amber-100"
          : "border-slate-200 bg-white text-slate-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-500"
      }`}
    >
      <StarIcon filled={entry.isFavorite} className="h-3.5 w-3.5" />
    </button>
  );
}

function StarIcon({
  filled = false,
  className = "",
}: {
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 2.8 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.83l-5.5 2.89 1.05-6.12L3.1 9.27l6.15-.9L12 2.8Z" />
    </svg>
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
