"use client";

/**
 * useRecentDocuments.ts
 * -----------------------------------------------------------------------------
 * Riwayat dokumen yang sudah di-generate, disimpan di IndexedDB (bukan
 * localStorage — buffer .docx per versi bisa besar, dan menyimpan banyak
 * versi lewat cepat menghabiskan kuota ~5MB localStorage).
 *
 * Setiap generate ulang dengan nama dasar yang sama menambah ENTRI BARU
 * dengan versi yang naik (v1, v2, ...) — tidak pernah menimpa entri lama.
 *
 * State React (`entries`) hanya menyimpan metadata (tanpa buffer penuh) supaya
 * list tetap ringan; buffer diambil on-demand lewat `loadEntryBuffer` saat
 * user memilih "Load".
 */

import { useCallback, useEffect, useRef, useState } from "react";

// =============================================================================
// Konstanta
// =============================================================================

const DB_NAME = "docx-editor-poc";
const DB_VERSION = 1;
const STORE_NAME = "recent-documents";

/** Batas jumlah entri tersimpan; entri tertua dibuang begitu terlampaui. */
const MAX_ENTRIES = 30;

/** Batas favorit sengaja kecil agar Quick Access tetap benar-benar ringkas. */
export const MAX_FAVORITE_ENTRIES = 4;

// =============================================================================
// Tipe
// =============================================================================

export interface RecentDocumentEntry {
  id: string;
  /** Nama dasar dokumen, tanpa ekstensi dan tanpa suffix versi. */
  baseName: string;
  version: number;
  /** Nama file lengkap yang ditampilkan, termasuk penanda versi. */
  fileName: string;
  size: number;
  /** ISO 8601. */
  generatedAt: string;
  isFavorite: boolean;
  /** Dipakai untuk mengurutkan favorit yang terakhir dipasang. */
  favoritedAt?: string;
}

interface RecentDocumentRecord extends RecentDocumentEntry {
  data: ArrayBuffer;
}

export interface UseRecentDocumentsResult {
  entries: RecentDocumentEntry[];
  isLoading: boolean;
  error: string | null;

  addEntry: (fileName: string, buffer: ArrayBuffer) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  loadEntryBuffer: (
    id: string,
  ) => Promise<{ fileName: string; data: ArrayBuffer } | null>;
  dismissError: () => void;
}

// =============================================================================
// Helper IndexedDB
// =============================================================================

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("generatedAt", "generatedAt");
        store.createIndex("baseName", "baseName");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllRecords(db: IDBDatabase): Promise<RecentDocumentRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as RecentDocumentRecord[]);
    request.onerror = () => reject(request.error);
  });
}

function getVersionsByBaseName(db: IDBDatabase, baseName: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("baseName");
    const request = index.getAll(baseName);
    request.onsuccess = () =>
      resolve((request.result as RecentDocumentRecord[]).map((r) => r.version));
    request.onerror = () => reject(request.error);
  });
}

function putRecord(db: IDBDatabase, record: RecentDocumentRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteRecords(db: IDBDatabase, ids: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getRecord(db: IDBDatabase, id: string): Promise<RecentDocumentRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () =>
      resolve(request.result as RecentDocumentRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Nama dasar untuk pengelompokan versi: buang ekstensi `.docx` dan suffix
 * versi lama `" (vN)"` kalau ada — supaya generate ulang dari entri yang
 * sudah versioned tetap masuk ke kelompok nama yang sama.
 */
function extractBaseName(fileName: string): string {
  const stem = fileName.replace(/\.docx$/i, "");
  const withoutVersion = stem.replace(/\s*\(v\d+\)$/i, "").trim();
  return withoutVersion || "untitled";
}

function toMetadata(record: RecentDocumentRecord): RecentDocumentEntry {
  const { data: _data, ...metadata } = record;
  return { ...metadata, isFavorite: metadata.isFavorite ?? false };
}

// =============================================================================
// Hook
// =============================================================================

export function useRecentDocuments(): UseRecentDocumentsResult {
  const [entries, setEntries] = useState<RecentDocumentEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dbRef = useRef<IDBDatabase | null>(null);

  const getDb = useCallback(async () => {
    if (dbRef.current) return dbRef.current;
    const db = await openDb();
    dbRef.current = db;
    return db;
  }, []);

  const refresh = useCallback(async () => {
    const db = await getDb();
    const records = await getAllRecords(db);
    const metadata = records
      .map(toMetadata)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    setEntries(metadata);
  }, [getDb]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (cancelled) return;
        // IndexedDB tidak tersedia (mis. mode privat) — riwayat cuma tidak
        // ada, bukan alasan untuk menggagalkan halaman.
        console.warn("[useRecentDocuments] Gagal memuat riwayat:", err);
        setError("Riwayat generate tidak tersedia di browser ini.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const addEntry = useCallback(
    async (fileName: string, buffer: ArrayBuffer) => {
      try {
        const db = await getDb();
        const baseName = extractBaseName(fileName);
        const existingVersions = await getVersionsByBaseName(db, baseName);
        const version =
          existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

        const record: RecentDocumentRecord = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          baseName,
          version,
          fileName: `${baseName} (v${version}).docx`,
          size: buffer.byteLength,
          generatedAt: new Date().toISOString(),
          isFavorite: false,
          data: buffer,
        };

        await putRecord(db, record);

        const all = await getAllRecords(db);
        if (all.length > MAX_ENTRIES) {
          // Favorit adalah jalur cepat milik user, jadi jangan hilangkan diam-diam
          // saat batas riwayat tercapai. Empat slot favorit memastikan selalu ada
          // cukup entri non-favorit yang bisa dipangkas terlebih dahulu.
          const oldest = all
            .filter((entry) => !entry.isFavorite)
            .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
            .slice(0, all.length - MAX_ENTRIES)
            .map((r) => r.id);
          await deleteRecords(db, oldest);
        }

        await refresh();
      } catch (err) {
        console.error("[useRecentDocuments] Gagal menyimpan riwayat:", err);
        setError("Gagal menyimpan dokumen ke riwayat generate.");
      }
    },
    [getDb, refresh],
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      try {
        const db = await getDb();
        await deleteRecords(db, [id]);
        setEntries((prev) => prev.filter((entry) => entry.id !== id));
      } catch (err) {
        console.error("[useRecentDocuments] Gagal menghapus riwayat:", err);
        setError("Gagal menghapus dokumen dari riwayat.");
      }
    },
    [getDb],
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      try {
        const db = await getDb();
        const record = await getRecord(db, id);
        if (!record) return;

        const isFavorite = record.isFavorite ?? false;
        if (!isFavorite) {
          const all = await getAllRecords(db);
          const favoriteCount = all.filter((entry) => entry.isFavorite).length;
          if (favoriteCount >= MAX_FAVORITE_ENTRIES) {
            setError(
              `Quick Access maksimal ${MAX_FAVORITE_ENTRIES} dokumen. Hapus salah satu favorit terlebih dahulu.`,
            );
            return;
          }
        }

        const updated: RecentDocumentRecord = {
          ...record,
          isFavorite: !isFavorite,
          favoritedAt: isFavorite ? undefined : new Date().toISOString(),
        };
        await putRecord(db, updated);
        setEntries((previous) =>
          previous.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  isFavorite: updated.isFavorite,
                  favoritedAt: updated.favoritedAt,
                }
              : entry,
          ),
        );
        setError(null);
      } catch (err) {
        console.error("[useRecentDocuments] Gagal mengubah favorit:", err);
        setError("Gagal memperbarui favorit dokumen.");
      }
    },
    [getDb],
  );

  const loadEntryBuffer = useCallback(
    async (id: string) => {
      try {
        const db = await getDb();
        const record = await getRecord(db, id);
        if (!record) return null;
        return { fileName: record.fileName, data: record.data };
      } catch (err) {
        console.error("[useRecentDocuments] Gagal memuat dokumen:", err);
        setError("Gagal memuat dokumen dari riwayat.");
        return null;
      }
    },
    [getDb],
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    entries,
    isLoading,
    error,
    addEntry,
    deleteEntry,
    toggleFavorite,
    loadEntryBuffer,
    dismissError,
  };
}
