"use client";

/**
 * useDocxDocument.ts
 * -----------------------------------------------------------------------------
 * State dokumen yang sedang dibuka: buffer, nama file, status dirty, seleksi,
 * plus operasi file (upload, buat baru, download) dan auto-save ke localStorage.
 *
 * CATATAN NAMA: spec menyebut hook ini `useDocxEditor`, tapi
 * `@docx-editor.dev/react` SUDAH mengekspor hook bernama `useDocxEditor()`
 * (yang mengembalikan `DocxEditorInstance` dari context). Dua hook dengan nama
 * identik di satu codebase adalah sumber bug import yang mahal, jadi hook ini
 * dinamai `useDocxDocument` — dia mengurus DOKUMEN-nya, bukan editor-nya.
 *
 * Pembagian tanggung jawab:
 * - Hook ini      -> buffer dokumen, metadata, persistensi.
 * - editor-core-utils -> menerapkan perubahan ke editor yang sedang tampil.
 * - useAIChat     -> percakapan dan pemanggilan AI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { saveAs } from "file-saver";

import { arrayBufferToBase64, base64ToArrayBuffer } from "@/lib/buffer-utils";
import {
  DOCX_MIME_TYPE,
  MAX_FILE_SIZE_BYTES,
  type UploadResponse,
} from "@/lib/types";

// =============================================================================
// Konstanta
// =============================================================================

const STORAGE_KEY = "docx-editor-poc:document";

/**
 * Batas ukuran dokumen yang di-auto-save ke localStorage.
 *
 * localStorage hanya menyimpan string, jadi buffer harus di-encode base64 —
 * yang membengkakkan ukurannya ~33%. Kuota localStorage umumnya 5 MB, jadi
 * 3 MB buffer (~4 MB base64) adalah batas aman. Dokumen yang lebih besar tetap
 * bisa diedit, hanya saja tidak dipulihkan setelah refresh.
 */
const AUTOSAVE_MAX_BYTES = 3 * 1024 * 1024;

/** Jeda sebelum auto-save dijalankan, dihitung dari perubahan terakhir. */
const AUTOSAVE_DEBOUNCE_MS = 1_500;

const DEFAULT_FILE_NAME = "untitled.docx";

// =============================================================================
// Tipe
// =============================================================================

interface PersistedDocument {
  fileName: string;
  /** Isi .docx dalam base64. */
  data: string;
  /** ISO 8601. */
  savedAt: string;
}

export interface UseDocxDocumentResult {
  // --- state ---
  docBuffer: ArrayBuffer | null;
  fileName: string;
  isDirty: boolean;
  lastSaved: Date | null;
  selectedText: string | null;
  /** `true` selama upload / pembuatan dokumen baru berlangsung. */
  isLoading: boolean;
  /** Pesan error terakhir yang layak ditampilkan ke user, atau `null`. */
  error: string | null;
  /** `true` kalau ada dokumen yang siap ditampilkan. */
  hasDocument: boolean;
  /**
   * Bertambah setiap kali dokumen yang BERBEDA dimuat (upload, buat baru,
   * pulihkan, tutup) — bukan saat isinya diedit. Dipakai sebagai `documentKey`
   * di `DocxEditorViewer`: editor hanya di-mount ulang saat nilai ini berubah.
   */
  documentId: number;

  // --- setter ---
  setDocBuffer: (buffer: ArrayBuffer | null, options?: { markDirty?: boolean }) => void;
  setFileName: (name: string) => void;
  setIsDirty: (dirty: boolean) => void;
  setSelectedText: (text: string | null) => void;

  // --- aksi ---
  uploadDocument: (file: File) => Promise<void>;
  createNewDocument: (fileName?: string) => Promise<void>;
  /**
   * `bufferOverride` dipakai saat pemanggil sudah punya buffer terbaru dari
   * editor hidup (mis. lewat `editor.save()`) dan ingin memastikan yang
   * di-download persis sama dengan yang dicatat ke riwayat — tanpa ini ada
   * risiko file ter-download beda dari state `docBuffer` yang telat sampai
   * 800ms karena debounce.
   */
  downloadDocument: (bufferOverride?: ArrayBuffer) => void;
  /** Muat buffer yang sudah ada (mis. dari riwayat generate) ke editor. */
  loadBuffer: (buffer: ArrayBuffer, fileName: string) => void;
  clearDocument: () => void;
  dismissError: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useDocxDocument(
  initialBuffer?: ArrayBuffer,
): UseDocxDocumentResult {
  const [docBuffer, setDocBufferState] = useState<ArrayBuffer | null>(
    initialBuffer ?? null,
  );
  const [fileName, setFileName] = useState<string>(DEFAULT_FILE_NAME);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState(0);

  /** Menahan timer debounce auto-save antar render. */
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Menandai apakah pemulihan dari localStorage sudah dijalankan.
   * Mencegah auto-save menimpa data tersimpan sebelum sempat dibaca.
   */
  const hasHydrated = useRef(false);

  // ---------------------------------------------------------------------------
  // Setter
  // ---------------------------------------------------------------------------

  const setDocBuffer = useCallback(
    (buffer: ArrayBuffer | null, options?: { markDirty?: boolean }) => {
      setDocBufferState(buffer);
      // Default `true`: perubahan dari editor selalu bikin dokumen dirty.
      // Pemuatan awal (upload / restore) memakai `markDirty: false`.
      setIsDirty(options?.markDirty ?? true);
    },
    [],
  );

  const dismissError = useCallback(() => setError(null), []);

  // ---------------------------------------------------------------------------
  // Pemulihan dari localStorage (sekali, saat mount)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (hasHydrated.current) return;
    hasHydrated.current = true;

    // Buffer awal yang diberikan pemanggil menang atas isi localStorage.
    if (initialBuffer) return;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as PersistedDocument;
      if (!parsed?.data || !parsed?.fileName) return;

      setDocBufferState(base64ToArrayBuffer(parsed.data));
      setFileName(parsed.fileName);
      setLastSaved(new Date(parsed.savedAt));
      setIsDirty(false);
      setDocumentId((id) => id + 1);
    } catch (err) {
      // Data rusak atau format lama — buang, jangan bikin app gagal start.
      console.warn("[useDocxDocument] Gagal memulihkan dokumen tersimpan:", err);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Mode privat / storage diblokir: tidak ada yang bisa dilakukan.
      }
    }
    // Sengaja hanya jalan sekali saat mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-save (debounced)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasHydrated.current) return;
    if (!docBuffer || !isDirty) return;

    if (docBuffer.byteLength > AUTOSAVE_MAX_BYTES) {
      // Terlalu besar untuk localStorage — biarkan saja, jangan sampai
      // melempar QuotaExceededError setiap kali user mengetik.
      return;
    }

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);

    autosaveTimer.current = setTimeout(() => {
      try {
        const payload: PersistedDocument = {
          fileName,
          data: arrayBufferToBase64(docBuffer),
          savedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setLastSaved(new Date());
      } catch (err) {
        // Kuota penuh atau storage diblokir. Auto-save itu kenyamanan, bukan
        // fitur kritis — cukup catat, jangan ganggu user.
        console.warn("[useDocxDocument] Auto-save gagal:", err);
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [docBuffer, isDirty, fileName]);

  // ---------------------------------------------------------------------------
  // Aksi
  // ---------------------------------------------------------------------------

  /**
   * Muat file .docx dari disk.
   *
   * Validasi di sini sengaja ringan (ekstensi + ukuran) demi umpan balik instan
   * tanpa round trip. Validasi otoritatif — magic bytes ZIP, isi yang bisa
   * di-parse — dilakukan di server saat dokumen dikirim ke `/api/ai-edit`.
   */
  const uploadDocument = useCallback(async (file: File) => {
    setError(null);

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Hanya file .docx yang didukung.");
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const limitMb = Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024);
      setError(`Ukuran file melebihi batas ${limitMb} MB.`);
      return;
    }

    if (file.size === 0) {
      setError("File kosong.");
      return;
    }

    setIsLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      setDocBufferState(buffer);
      setDocumentId((id) => id + 1);
      setFileName(file.name);
      setIsDirty(false); // baru dimuat = belum ada perubahan
      setLastSaved(null);
      setSelectedText(null);
    } catch (err) {
      console.error("[useDocxDocument] Gagal membaca file:", err);
      setError("File tidak bisa dibaca. Coba file lain.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Minta server membuat dokumen .docx kosong.
   *
   * Pembuatannya di server karena library `docx` (write-only) berat kalau
   * ikut ter-bundle ke browser, sementara halaman ini hanya butuh hasilnya.
   */
  const createNewDocument = useCallback(async (name?: string) => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/upload-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          fileName: name ?? DEFAULT_FILE_NAME,
        }),
      });

      const result = (await response.json()) as UploadResponse;

      if (!response.ok || !result.success || !result.docBase64) {
        setError(result.error ?? "Gagal membuat dokumen baru.");
        return;
      }

      setDocBufferState(base64ToArrayBuffer(result.docBase64));
      setDocumentId((id) => id + 1);
      setFileName(result.fileName);
      setIsDirty(false);
      setLastSaved(null);
      setSelectedText(null);
    } catch (err) {
      console.error("[useDocxDocument] Gagal membuat dokumen:", err);
      setError("Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Unduh buffer saat ini (atau `bufferOverride`) sebagai file .docx. */
  const downloadDocument = useCallback(
    (bufferOverride?: ArrayBuffer) => {
      const buffer = bufferOverride ?? docBuffer;
      if (!buffer) {
        setError("Belum ada dokumen untuk diunduh.");
        return;
      }

      try {
        saveAs(new Blob([buffer], { type: DOCX_MIME_TYPE }), fileName);
        // Sudah diunduh = tersimpan di disk user, jadi tidak dirty lagi.
        setIsDirty(false);
        setLastSaved(new Date());
      } catch (err) {
        console.error("[useDocxDocument] Gagal mengunduh:", err);
        setError("Gagal mengunduh dokumen.");
      }
    },
    [docBuffer, fileName],
  );

  /**
   * Muat buffer yang sudah ada ke editor — dipakai saat "Load" entri riwayat
   * generate. Mengikuti urutan yang sama dengan `uploadDocument`/
   * `createNewDocument`: `documentId` WAJIB bertambah supaya
   * `DocxEditorViewer` di-mount ulang, karena instance editor yang sudah
   * mount tidak menerima buffer baru lewat prop.
   */
  const loadBuffer = useCallback((buffer: ArrayBuffer, name: string) => {
    setDocBufferState(buffer);
    setDocumentId((id) => id + 1);
    setFileName(name);
    setIsDirty(false);
    setLastSaved(null);
    setSelectedText(null);
  }, []);

  /** Tutup dokumen dan bersihkan salinan tersimpannya. */
  const clearDocument = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);

    setDocBufferState(null);
    setDocumentId((id) => id + 1);
    setFileName(DEFAULT_FILE_NAME);
    setIsDirty(false);
    setLastSaved(null);
    setSelectedText(null);
    setError(null);

    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage diblokir — tidak masalah, tidak ada yang perlu dihapus.
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Peringatan sebelum menutup tab dengan perubahan belum tersimpan
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isDirty) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browser modern mengabaikan pesan kustom, tapi `returnValue` masih
      // dibutuhkan sebagian browser untuk memunculkan dialog konfirmasi.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  return {
    docBuffer,
    fileName,
    isDirty,
    lastSaved,
    selectedText,
    isLoading,
    error,
    hasDocument: docBuffer !== null,
    documentId,

    setDocBuffer,
    setFileName,
    setIsDirty,
    setSelectedText,

    uploadDocument,
    createNewDocument,
    downloadDocument,
    loadBuffer,
    clearDocument,
    dismissError,
  };
}
