"use client";

/**
 * editor-core-utils.ts
 * -----------------------------------------------------------------------------
 * Implementasi ALTERNATIF dari `editor-api-utils.ts`, memakai HANYA
 * `@docx-editor.dev/core` yang berlisensi Apache-2.0 — bebas dipakai di
 * produksi, tanpa perjanjian komersial.
 *
 * Signature-nya identik dengan `applyEditsToDocument()` sehingga keduanya bisa
 * ditukar lewat pemilih "Mesin edit" di halaman editor.
 *
 * ============================================================================
 * MODEL EDITOR HIDUP: SELEKSI, BUKAN ALAMAT
 * ============================================================================
 *
 * Ini perbedaan mendasarnya, dan hanya ketahuan lewat pengujian langsung —
 * typings sama sekali tidak menyiratkannya.
 *
 * `DocEdits` mendeklarasikan perintah beralamat seperti
 * `replaceText { target, text }`. Semuanya DITOLAK editor hidup:
 *
 *     exec({ type: "replaceText", target, text })
 *       -> "command 'replaceText' is not supported by the tree editor"
 *     exec({ type: "insertText", target, text })
 *       -> "DocTarget addressing is not supported; text inserts at the selection"
 *     exec({ type: "deleteText", target })
 *       -> "DocTarget addressing is not supported; deletion removes the selection"
 *
 * Perintah beralamat itu dilayani host AUTOMATION — yaitu `editor-api`, paket
 * yang berbayar. Editor hidup hanya bekerja pada SELEKSI.
 *
 * Jadi polanya selalu dua langkah: pindahkan seleksi ke target, lalu jalankan
 * perintah tanpa target.
 *
 *     const [match] = editor.findMatches(text, { matchCase: true });
 *     editor.selectMatch(match);
 *     editor.exec({ type: "insertText", text: pengganti });   // menimpa seleksi
 *
 * Bukan kebetulan `EditorCommandShape<T>` meng-`Omit` field `target` — bentuk
 * berbasis seleksi inilah kontrak resminya.
 *
 * ============================================================================
 * CAKUPAN DIBANDING editor-api
 * ============================================================================
 *
 *   replace  OK   seleksi + insertText (menimpa seleksi)
 *   delete   OK   seleksi + deleteText
 *   format   OK   toggleMark (bold/italic/underline) + setMarkAttr (ukuran/warna)
 *   insert   OK*  seleksi jangkar + insertText + insertBreak('line')
 *
 * (*) Satu perbedaan yang perlu diketahui: `splitParagraph` ditolak editor
 * hidup, jadi teks baru masuk sebagai BARIS di dalam paragraf yang sudah ada,
 * bukan sebagai paragraf `<w:p>` terpisah. Secara tampilan nyaris identik, dan
 * ini struktur Word yang sah — blok alamat surat justru berbentuk begitu:
 * satu paragraf dengan beberapa `<w:br/>` di dalamnya.
 */

import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";
import type { ExecResult } from "@docx-editor.dev/core";

import {
  AppError,
  type ApplyEditsResult,
  type EditOperation,
  type TextFormatting,
} from "./types";

// =============================================================================
// Konstanta
// =============================================================================

/** Batas panjang teks pencarian, disamakan dengan implementasi editor-api. */
const MAX_SEARCH_CHARS = 255;

/**
 * `setMarkAttr` untuk `fontSize` memakai satuan HALF-POINT, bukan point.
 * Terbukti dari pengujian: mengirim 24 menghasilkan `fontSizePt: 12`.
 */
const HALF_POINTS_PER_POINT = 2;

// =============================================================================
// Public API
// =============================================================================

/**
 * Terapkan seluruh edit ke dokumen yang sedang terbuka lewat `editor.exec()`.
 *
 * @param editor Instance dari `useDocxEditor()` milik `@docx-editor.dev/react`.
 * @throws {AppError} EDIT_APPLY_FAILED kalau editor belum siap.
 */
export async function applyEditsWithCore(
  editor: DocxEditorInstance,
  edits: readonly EditOperation[],
): Promise<ApplyEditsResult> {
  const result: ApplyEditsResult = { applied: 0, skipped: [] };

  if (edits.length === 0) return result;

  if (!editor) {
    throw new AppError(
      "EDIT_APPLY_FAILED",
      "Editor belum siap. Tunggu dokumen selesai dimuat lalu coba lagi.",
      409,
    );
  }

  for (const edit of edits) {
    try {
      const outcome = applyOne(editor, edit);

      if (!outcome.ok) {
        result.skipped.push({ edit, reason: describeExecError(outcome) });
      } else if (outcome.changed) {
        result.applied += 1;
      } else {
        // Perintah diterima tapi tidak mengubah apa pun — mis. mengganti teks
        // dengan teks yang sama persis. Bukan kegagalan, tapi juga bukan
        // perubahan, jadi tidak dihitung sebagai "diterapkan".
        result.skipped.push({
          edit,
          reason: "Tidak ada yang berubah (isinya sudah sama).",
        });
      }
    } catch (err) {
      // Kegagalan satu edit tidak menggagalkan sisanya.
      result.skipped.push({
        edit,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// =============================================================================
// Dispatch per operasi
// =============================================================================

function applyOne(editor: DocxEditorInstance, edit: EditOperation): ExecResult {
  switch (edit.type) {
    case "replace": {
      selectTarget(editor, requireField(edit.find, "find"));
      // `insertText` di atas seleksi = menimpa seleksi itu.
      return editor.exec({ type: "insertText", text: edit.replace ?? "" });
    }

    case "delete": {
      selectTarget(editor, requireField(edit.find, "find"));
      return editor.exec({ type: "deleteText" });
    }

    case "format": {
      selectTarget(editor, requireField(edit.find, "find"));
      return applyFormatting(editor, requireField(edit.formatting, "formatting"));
    }

    case "insert":
      return insertParagraphs(editor, edit.index, requireField(edit.text, "text"));

    default: {
      const unreachable: never = edit.type;
      throw new Error(`Tipe edit tidak dikenal: ${String(unreachable)}`);
    }
  }
}

// =============================================================================
// Seleksi target
// =============================================================================

/**
 * Pindahkan seleksi editor ke kemunculan pertama dari `find`.
 *
 * Semua perintah edit bekerja pada seleksi, jadi ini prasyarat untuk
 * replace/delete/format.
 *
 * @throws {Error} kalau teksnya tidak ditemukan atau seleksi gagal dipindah.
 */
function selectTarget(editor: DocxEditorInstance, find: string): void {
  const needle = toSingleLine(find);

  if (!needle) {
    throw new Error("Teks pencarian kosong.");
  }

  if (needle.length > MAX_SEARCH_CHARS) {
    throw new Error(
      `Teks pencarian melebihi ${MAX_SEARCH_CHARS} karakter — perpendek potongan yang dicari.`,
    );
  }

  const matches = editor.findMatches(needle, { matchCase: true });
  const first = matches[0];

  if (!first) {
    throw new Error(`Teks tidak ditemukan di dokumen: "${ellipsis(needle, 60)}"`);
  }

  const outcome = editor.selectMatch(first);
  if (!outcome.ok) {
    throw new Error(`Gagal menyeleksi teks target: ${describeExecError(outcome)}`);
  }
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Terapkan formatting ke teks yang sedang diseleksi.
 *
 * Dua jenis perintah dipakai:
 * - `toggleMark` untuk bold/italic/underline. Sifatnya MENGGANTI-BALIK, jadi
 *   keadaan saat ini dibaca dulu lewat `selectionFormatting`; kalau sudah
 *   sesuai permintaan, perintahnya dilewati agar tidak justru mematikannya.
 * - `setMarkAttr` untuk ukuran dan warna, yang nilainya bukan boolean.
 */
function applyFormatting(
  editor: DocxEditorInstance,
  formatting: TextFormatting,
): ExecResult {
  const current = editor.query({ type: "selectionFormatting" });
  const results: ExecResult[] = [];

  const toggles = [
    ["bold", "bold"],
    ["italic", "italic"],
    ["underline", "underline"],
  ] as const;

  for (const [key, mark] of toggles) {
    const wanted = formatting[key];
    if (typeof wanted !== "boolean") continue;

    // `current` bisa `null` kalau seleksinya campur; anggap belum aktif.
    const active = Boolean(current?.[mark]);
    if (active === wanted) continue;

    results.push(editor.exec({ type: "toggleMark", mark }));
  }

  if (typeof formatting.size === "number") {
    results.push(
      editor.exec({
        type: "setMarkAttr",
        mark: "fontSize",
        attr: "value",
        value: formatting.size * HALF_POINTS_PER_POINT,
      }),
    );
  }

  if (typeof formatting.color === "string") {
    // Engine meminta hex enam digit POLOS ("FF0000"), bukan object ColorValue —
    // mengirim `{ kind: "hex", value }` ditolak dengan `invalidArgs`.
    const hex = formatting.color.trim().replace(/^#/, "").toUpperCase();
    if (/^[0-9A-F]{6}$/.test(hex)) {
      results.push(
        editor.exec({
          type: "setMarkAttr",
          mark: "color",
          attr: "value",
          value: hex,
        }),
      );
    }
  }

  if (results.length === 0) {
    throw new Error("Tidak ada properti formatting yang bisa diterapkan.");
  }

  // Kegagalan pertama dilaporkan apa adanya; kalau semuanya lolos, dianggap
  // berubah bila minimal satu perintah benar-benar mengubah sesuatu.
  const failure = results.find((outcome) => !outcome.ok);
  if (failure) return failure;

  return {
    ok: true,
    changed: results.some((outcome) => outcome.ok && outcome.changed),
  };
}

// =============================================================================
// Penyisipan
// =============================================================================

/**
 * Sisipkan satu atau lebih baris teks baru.
 *
 * KENAPA BEGINI BENTUKNYA
 *
 * Editor hidup tidak punya cara menaruh caret di sebuah posisi lewat API —
 * semua perintah bekerja pada seleksi. Dan `insertText` MENIMPA seleksi.
 * Jadi untuk menyisipkan tanpa menghapus apa pun, teks jangkar harus ditulis
 * ULANG berikut teks barunya:
 *
 *     selectMatch(jangkar)
 *     insertText(jangkar.text)      <- kembalikan yang tadi tertimpa
 *     insertBreak('line')
 *     insertText("baris baru")
 *
 * `match.text` dipakai apa adanya supaya penulisan ulangnya identik — termasuk
 * kapitalisasi dan tanda baca. Tab/indentasi di awal paragraf aman karena tidak
 * ikut terseleksi.
 *
 * KETERBATASAN: `splitParagraph` ditolak editor hidup, jadi yang dihasilkan
 * adalah BARIS baru di dalam paragraf jangkar, bukan paragraf terpisah.
 */
function insertParagraphs(
  editor: DocxEditorInstance,
  index: number | undefined,
  text: string,
): ExecResult {
  const parts = text
    .split(/[\r\n\u2028\u2029]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error("Teks yang akan disisipkan kosong.");
  }

  // `index === 0` berarti "di paling atas dokumen"; selain itu ditambahkan
  // setelah isi yang sudah ada.
  const atTop = index === 0;
  const anchor = findAnchor(editor, atTop);

  const results: ExecResult[] = [];
  const write = (value: string) =>
    results.push(editor.exec({ type: "insertText", text: value }));
  const lineBreak = () =>
    results.push(editor.exec({ type: "insertBreak", kind: "line" }));

  if (anchor === null) {
    // DOKUMEN KOSONG — tidak ada teks yang perlu dipertahankan, jadi tidak
    // perlu jangkar sama sekali. Caret ditaruh lewat `focus()`, lalu ditulis
    // langsung. Ini alur "buat dokumen baru, minta AI menyusun isinya", yang
    // sebelumnya ditolak dengan pesan "ketik sesuatu dulu".
    const focused = editor.focus();
    if (!focused.ok) {
      throw new Error(
        `Tidak bisa menaruh kursor di dokumen kosong: ${focused.reason ?? "ditolak editor"}`,
      );
    }

    parts.forEach((part, i) => {
      if (i > 0) lineBreak();
      write(part);
    });

    return summarize(results);
  }

  if (atTop) {
    // Teks baru lebih dulu, lalu jangkar dikembalikan di bawahnya.
    parts.forEach((part, i) => {
      if (i > 0) lineBreak();
      write(part);
    });
    lineBreak();
    write(anchor);
  } else {
    // Jangkar dikembalikan lebih dulu, teks baru menyusul di bawahnya.
    write(anchor);
    for (const part of parts) {
      lineBreak();
      write(part);
    }
  }

  return summarize(results);
}

/** Gabungkan beberapa `ExecResult` jadi satu: gagal pertama menang. */
function summarize(results: readonly ExecResult[]): ExecResult {
  const failure = results.find((outcome) => !outcome.ok);
  if (failure) return failure;

  return {
    ok: true,
    changed: results.some((outcome) => outcome.ok && outcome.changed),
  };
}

/**
 * Seleksi sepotong teks yang jadi titik tumpu penyisipan, dan kembalikan teks
 * persisnya untuk ditulis ulang.
 *
 * @param atTop `true` -> baris pertama dokumen; `false` -> baris terakhir.
 * @returns Teks jangkar, atau `null` kalau dokumen belum punya teks sama
 *          sekali — penanganannya beda dan ditangani pemanggil.
 */
function findAnchor(
  editor: DocxEditorInstance,
  atTop: boolean,
): string | null {
  const paragraphs = editor
    .query({ type: "paragraphs" })
    .filter((paragraph) => paragraph.text.trim().length > 0);

  // Dokumen kosong bukan kondisi error — hanya berarti tidak ada yang perlu
  // dipertahankan saat menulis.
  if (paragraphs.length === 0) return null;

  const paragraph = atTop ? paragraphs[0] : paragraphs[paragraphs.length - 1];

  // Satu paragraf bisa memuat beberapa baris; ambil baris terluar sesuai arah
  // penyisipan, karena pencarian tidak bisa melintasi baris.
  const lines = paragraph.text
    .split(/[\r\n\u2028\u2029]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const line = atTop ? lines[0] : lines[lines.length - 1];
  const snippet = line.slice(0, MAX_SEARCH_CHARS);

  const match = editor.findMatches(snippet, { matchCase: true })[0];
  if (!match) {
    throw new Error("Tidak menemukan titik sisip yang bisa dijadikan acuan.");
  }

  const outcome = editor.selectMatch(match);
  if (!outcome.ok) {
    throw new Error(`Gagal menyeleksi titik sisip: ${describeExecError(outcome)}`);
  }

  // Yang dikembalikan adalah teks yang BENAR-BENAR terseleksi, supaya penulisan
  // ulangnya tidak mengubah apa pun.
  return match.text;
}

// =============================================================================
// Helper
// =============================================================================

/**
 * Sempitkan teks pencarian jadi satu baris.
 *
 * Paragraf yang memakai line break di dalamnya (blok alamat surat) terbaca
 * sebagai satu blok ber-newline, dan AI bisa menyalinnya utuh ke `find`.
 * Pencarian bekerja dalam satu baris, jadi teks seperti itu tidak akan cocok.
 */
function toSingleLine(text: string): string {
  const lines = text
    .split(/[\r\n\u2028\u2029]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return "";

  if (lines.length > 1) {
    throw new Error(
      `Teks pencarian melintasi ${lines.length} baris; pencarian hanya bisa dalam satu paragraf. ` +
        `Sebut bagian yang lebih spesifik, mis. "${ellipsis(lines[0], 40)}".`,
    );
  }

  return lines[0];
}

/** Ubah kegagalan `exec()` jadi kalimat yang bisa ditindaklanjuti user. */
function describeExecError(outcome: Extract<ExecResult, { ok: false }>): string {
  switch (outcome.code) {
    case "notFound":
      return "Teks yang dituju tidak ditemukan di dokumen.";
    case "ambiguous":
      return "Teks yang dituju muncul lebih dari sekali — sebut bagian yang lebih spesifik.";
    case "locked":
      return "Dokumen sedang dalam mode baca, jadi tidak bisa diubah.";
    case "outOfBounds":
      return "Posisi yang dituju di luar jangkauan dokumen.";
    case "unsupported":
      return `Tidak didukung: ${outcome.reason}`;
    case "invalidArgs":
      return `Argumen perintah tidak valid: ${outcome.reason}`;
    default:
      return `${outcome.code}: ${outcome.reason}`;
  }
}

function requireField<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Field "${name}" wajib diisi untuk operasi ini.`);
  }
  return value;
}

function ellipsis(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
