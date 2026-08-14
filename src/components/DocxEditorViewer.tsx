"use client";

/**
 * DocxEditorViewer.tsx
 * -----------------------------------------------------------------------------
 * Membungkus `<DocxEditor>` dari `@docx-editor.dev/react` dan menjembatani
 * event-nya ke state aplikasi kita.
 *
 * KEPEMILIKAN DOKUMEN — ini bagian terpenting untuk dipahami:
 *
 *   Setelah mount, EDITOR yang memegang dokumen hidup. `docBuffer` hanya dipakai
 *   sebagai sumber SAAT MOUNT, tidak pernah didorong balik ke editor setiap
 *   render. Kalau didorong balik, akan terjadi lingkaran klasik:
 *   editor berubah -> parent simpan buffer -> buffer turun lagi -> editor
 *   reload -> kursor lompat, undo history hilang.
 *
 *   Editor hanya di-mount ulang kalau `documentKey` berubah (dokumen yang
 *   BERBEDA: hasil upload atau dokumen baru), lewat prop `key` React.
 *
 * Dua props di library ini TIDAK reaktif dan hanya berlaku saat mount:
 *   - `mode` ('edit' | 'view')  -> makanya `readOnly` ikut masuk ke `key`
 *   - dokumen awal              -> makanya `documentKey` ada
 *
 * Perubahan mengalir ke atas lewat `onChange`, hasil dari `editor.save()` yang
 * di-debounce — serialisasi .docx per ketikan terlalu mahal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { DocxEditor, useDocxEditor } from "@docx-editor.dev/react";
import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";

// =============================================================================
// Konstanta
// =============================================================================

/**
 * Jeda sebelum dokumen diserialisasi setelah perubahan terakhir.
 * `editor.save()` menulis ulang seluruh file .docx, jadi memanggilnya per
 * ketikan akan membuat editor tersendat.
 */
const SAVE_DEBOUNCE_MS = 800;

// =============================================================================
// Props
// =============================================================================

export interface DocxEditorViewerProps {
  /** Isi .docx untuk dimuat saat mount. `null` = tampilkan area kosong. */
  docBuffer: ArrayBuffer | null;

  /**
   * Identitas dokumen. Editor di-mount ulang saat nilai ini berubah.
   * Ganti nilainya HANYA saat memuat dokumen yang benar-benar berbeda —
   * bukan setiap kali isinya berubah.
   */
  documentKey?: string | number;

  fileName?: string;
  isDirty?: boolean;
  lastSaved?: Date | null;
  readOnly?: boolean;

  /**
   * Dipanggil dengan isi dokumen terbaru setelah user berhenti mengetik.
   *
   * PENTING: bungkus dengan `useCallback` di pemanggil. Callback yang identitasnya
   * berubah tiap render akan memasang-lepas listener editor terus-menerus.
   */
  onChange?: (buffer: ArrayBuffer) => void;

  /** Dipanggil saat seleksi berubah, dengan teks yang sedang di-select. */
  onSelectionChange?: (text: string) => void;

  /**
   * Menyerahkan instance editor ke atas. Dibutuhkan `applyEditsToDocument()`
   * untuk menerapkan hasil AI. Dipanggil `null` saat editor dilepas.
   */
  onEditorReady?: (editor: DocxEditorInstance | null) => void;

  /** Dipanggil saat file .docx dilepas (drag-drop) ke area editor. */
  onFileDrop?: (file: File) => void;

  className?: string;
}

// =============================================================================
// Komponen utama
// =============================================================================

export function DocxEditorViewer({
  docBuffer,
  documentKey,
  fileName = "untitled.docx",
  isDirty = false,
  lastSaved = null,
  readOnly = false,
  onChange,
  onSelectionChange,
  onEditorReady,
  onFileDrop,
  className = "",
}: DocxEditorViewerProps) {
  const [isDragging, setIsDragging] = useState(false);

  /**
   * `mode` dan dokumen awal hanya berlaku saat mount, jadi keduanya harus
   * ikut menentukan kapan editor di-mount ulang.
   */
  const mountKey = `${documentKey ?? fileName}:${readOnly ? "view" : "edit"}`;

  /**
   * Judul yang tampil di title bar bawaan editor (di atas menu File/Format/
   * Insert/Help) — tanpa `onTitleChange` dia read-only dan cuma mengikuti
   * prop ini, jadi cukup diturunkan dari `fileName` yang sama dipakai
   * `StatusBar`. Sumber rename tetap satu: input nama dokumen di toolbar app.
   */
  const documentTitle = fileName.replace(/\.docx$/i, "");

  // ---------------------------------------------------------------------------
  // Drag & drop
  // ---------------------------------------------------------------------------

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!onFileDrop) return;
      // Tanpa preventDefault, browser membuka file itu dan meninggalkan halaman.
      event.preventDefault();
      setIsDragging(true);
    },
    [onFileDrop],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    // Abaikan perpindahan antar elemen anak; hanya reaksi saat benar-benar keluar.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!onFileDrop) return;
      event.preventDefault();
      setIsDragging(false);

      const file = event.dataTransfer.files?.[0];
      // File non-.docx dibiarkan lewat: memvalidasinya di sini akan
      // menduplikasi pesan error yang sudah ditangani hook.
      if (file) onFileDrop(file);
    },
    [onFileDrop],
  );

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="relative flex-1 overflow-hidden">
        {docBuffer ? (
          <DocxEditor
            key={mountKey}
            document={docBuffer}
            mode={readOnly ? "view" : "edit"}
            title={documentTitle}
            className="h-full"
          >
            <EditorEventBridge
              onChange={onChange}
              onSelectionChange={onSelectionChange}
              onEditorReady={onEditorReady}
            />
          </DocxEditor>
        ) : (
          <EmptyState hasDropHandler={Boolean(onFileDrop)} />
        )}

        {isDragging && <DropOverlay />}
      </div>

      <StatusBar
        fileName={fileName}
        isDirty={isDirty}
        lastSaved={lastSaved}
        readOnly={readOnly}
        hasDocument={Boolean(docBuffer)}
      />
    </div>
  );
}

// =============================================================================
// Jembatan event editor
// =============================================================================

interface EditorEventBridgeProps {
  onChange?: (buffer: ArrayBuffer) => void;
  onSelectionChange?: (text: string) => void;
  onEditorReady?: (editor: DocxEditorInstance | null) => void;
}

/**
 * Komponen tak terlihat yang dirender DI DALAM `<DocxEditor>`.
 *
 * `useDocxEditor()` membaca instance editor dari context milik Root, jadi hook
 * itu hanya bisa dipanggil dari dalam subtree editor — bukan dari komponen
 * pembungkusnya. Karena itu jembatan ini ada, dan karena itu dia render `null`:
 * tugasnya cuma berlangganan event, bukan menampilkan apa pun.
 */
function EditorEventBridge({
  onChange,
  onSelectionChange,
  onEditorReady,
}: EditorEventBridgeProps) {
  // `null` sampai effect mount milik Root membuat instance-nya.
  const editor = useDocxEditor();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- serahkan instance ke atas ---
  //
  // Melapor dan membersihkan SENGAJA dipisah jadi dua effect.
  //
  // Versi sebelumnya menyatukan keduanya — `onEditorReady(editor)` di badan
  // effect, `onEditorReady(null)` di cleanup-nya. Bentuk itu memicu
  // "Maximum update depth exceeded": setiap kali effect berjalan ulang,
  // cleanup menyetel state ke `false` lalu badan effect menyetelnya kembali ke
  // `true` — ping-pong yang mengubah ketidakstabilan identitas `editor` sekecil
  // apa pun menjadi loop render tak berujung.
  //
  // Dipisah begini, laporan berulang dengan nilai yang sama akan di-bail-out
  // React (state-nya identik) dan tidak memicu render baru.
  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // Bersihkan hanya saat benar-benar dilepas, supaya pemanggil tidak memegang
  // instance mati dan mencoba menerapkan edit ke editor yang sudah tiada.
  useEffect(() => {
    return () => onEditorReady?.(null);
  }, [onEditorReady]);

  // --- perubahan dokumen -> serialisasi (debounced) ---
  useEffect(() => {
    if (!editor || !onChange) return;

    const unsubscribe = editor.on("change", () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);

      saveTimer.current = setTimeout(async () => {
        try {
          onChange(await editor.save());
        } catch (err) {
          // Serialisasi gagal bukan alasan menghentikan pengeditan; user tetap
          // bisa mengetik, dan percobaan berikutnya mungkin berhasil.
          console.error("[DocxEditorViewer] Gagal menyerialisasi dokumen:", err);
        }
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      // Batalkan simpan yang tertunda: menjalankannya setelah unmount akan
      // memanggil `save()` pada editor yang sudah dihancurkan.
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editor, onChange]);

  // --- perubahan seleksi ---
  useEffect(() => {
    if (!editor || !onSelectionChange) return;

    return editor.on("selectionChange", () => {
      try {
        onSelectionChange(editor.query({ type: "selectedText" }));
      } catch (err) {
        console.warn("[DocxEditorViewer] Gagal membaca teks terseleksi:", err);
      }
    });
  }, [editor, onSelectionChange]);

  return null;
}

// =============================================================================
// Bagian tampilan
// =============================================================================

function EmptyState({ hasDropHandler }: { hasDropHandler: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <svg
        className="h-12 w-12 text-slate-300"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25M9 16.5v.75m3-3v3M15 12v5.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      </svg>

      <p className="text-sm font-medium text-slate-600">Belum ada dokumen</p>
      <p className="max-w-xs text-sm text-slate-400">
        {hasDropHandler
          ? "Tarik file .docx ke sini, atau pakai tombol Upload / Dokumen Baru di atas."
          : "Upload file .docx atau buat dokumen baru untuk mulai mengedit."}
      </p>
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-blue-400 bg-blue-50/80">
      <p className="text-sm font-medium text-blue-700">Lepaskan file .docx di sini</p>
    </div>
  );
}

interface StatusBarProps {
  fileName: string;
  isDirty: boolean;
  lastSaved: Date | null;
  readOnly: boolean;
  hasDocument: boolean;
}

function StatusBar({
  fileName,
  isDirty,
  lastSaved,
  readOnly,
  hasDocument,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
      <span className="truncate font-medium text-slate-700" title={fileName}>
        {fileName}
      </span>

      <div className="flex shrink-0 items-center gap-3">
        {readOnly && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">
            Hanya baca
          </span>
        )}

        {hasDocument && (
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isDirty ? "bg-amber-500" : "bg-emerald-500"
              }`}
              aria-hidden="true"
            />
            {isDirty ? "Ada perubahan" : "Tersimpan"}
          </span>
        )}

        {lastSaved && (
          <span suppressHydrationWarning>
            {/* `suppressHydrationWarning`: format waktu bergantung locale
                browser, jadi hasil render server dan client bisa berbeda. */}
            Auto-save {formatTime(lastSaved)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default DocxEditorViewer;
