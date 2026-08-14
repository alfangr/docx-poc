"use client";

/**
 * editor-api-utils.ts
 * -----------------------------------------------------------------------------
 * Menerapkan `EditOperation[]` hasil Gemini ke dokumen yang sedang terbuka di
 * editor, lewat `@docx-editor.dev/editor-api/browser`.
 *
 * PENTING — CLIENT ONLY. `createBrowser()` meminjam instance editor yang hidup
 * di DOM, jadi modul ini hanya jalan di browser.
 *
 * Model API-nya bergaya Office.js: queue -> `sync()` -> baca hasil.
 *   - Menulis itu dijadwalkan, belum langsung terjadi.
 *   - Membaca (mis. hasil `search()`) butuh `load()` lalu `await context.sync()`.
 *   - Satu `sync()` = satu batch = satu transaksi di sisi host.
 *
 * Konsekuensinya, setiap operasi berpola cari-lalu-ubah memerlukan dua fase:
 * sync untuk membaca hasil pencarian, lalu tulis yang di-flush di sync berikutnya.
 *
 * Catatan penyimpangan dari spec:
 * - `applyEditsToDocument()` mengembalikan `ApplyEditsResult`, bukan `void`.
 *   Edit dari LLM wajar kalau sebagian meleset (teks `find` tidak ketemu);
 *   pemanggil perlu tahu berapa yang benar-benar masuk untuk ditampilkan ke user.
 * - `formatText()` menargetkan `find` (teks), bukan `index` (nomor blok) —
 *   konsisten dengan tool schema di `gemini-client.ts`.
 */

import { DocxEditor, isDocxEditorError } from "@docx-editor.dev/editor-api/browser";
import type { Range, RequestContext } from "@docx-editor.dev/editor-api/browser";
import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";

import {
  AppError,
  type ApplyEditsResult,
  type EditOperation,
  type SkippedEdit,
  type TextFormatting,
} from "./types";

// Di-re-export supaya pemanggil lama tidak perlu diubah.
export type { ApplyEditsResult, SkippedEdit };

// =============================================================================
// Konstanta
// =============================================================================

/**
 * Batas panjang string pencarian, mengikuti batas Word (255 karakter).
 * Instruksi di `gemini-client.ts` sudah meminta model memakai `find` yang
 * pendek; guard ini menangkap kasus saat model tetap mengirim paragraf utuh.
 */
const MAX_SEARCH_CHARS = 255;

/**
 * Pencarian selalu case-sensitive. Model diminta menyalin teks apa adanya dari
 * dokumen, jadi pencocokan longgar justru berisiko mengubah bagian yang salah.
 */
const SEARCH_OPTIONS = { matchCase: true } as const;

/**
 * Karakter pemisah baris yang DITOLAK engine editor.
 *
 * Validator internalnya menolak teks pencarian maupun teks pengganti yang
 * memuat salah satu dari ini, dengan `InvalidArgument`. Batasannya masuk akal —
 * pencarian bekerja di dalam satu paragraf — tapi tidak terlihat dari typings,
 * jadi harus ditangani di sini.
 */
const LINE_BREAK_PATTERN = /[\r\n\v\f\u2028\u2029]/;

// =============================================================================
// Tipe hasil
// =============================================================================

// =============================================================================
// Public API
// =============================================================================

/**
 * Terapkan seluruh edit ke dokumen yang sedang terbuka.
 *
 * Semua edit berjalan dalam SATU `runtime.run()`. Kalau satu edit gagal
 * (misalnya teks `find`-nya tidak ada di dokumen), edit itu dicatat di
 * `skipped` dan proses lanjut ke edit berikutnya — perubahan yang berhasil
 * tetap tersimpan.
 *
 * @param editor Instance editor dari `useDocxEditor()` milik `@docx-editor.dev/react`.
 * @throws {AppError} EDIT_APPLY_FAILED kalau runtime-nya sendiri yang gagal.
 */
export async function applyEditsToDocument(
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

  const runtime = DocxEditor.createBrowser(editor);

  try {
    await runtime.run(async (context) => {
      for (const edit of edits) {
        try {
          await applyEditOperation(context, edit);
          result.applied += 1;
        } catch (err) {
          // Kegagalan per-edit tidak menggagalkan batch. Yang paling sering
          // terjadi: `find` tidak persis sama dengan teks di dokumen.
          result.skipped.push({ edit, reason: describeError(err) });
        }
      }

      // Flush penutup: tulisan terakhir yang masih mengantre ikut ter-commit.
      await context.sync();
    });
  } catch (err) {
    throw new AppError(
      "EDIT_APPLY_FAILED",
      "Gagal menerapkan perubahan ke dokumen.",
      500,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    // Melepas runtime TIDAK menutup editor — editor punya lifetime sendiri.
    runtime.dispose();
  }

  return result;
}

/**
 * Terapkan satu `EditOperation`.
 * Dipisah dari fungsi batch supaya bisa dipakai ulang dan diuji sendiri.
 *
 * @throws {Error} kalau target tidak ditemukan atau argumennya tidak lengkap.
 */
export async function applyEditOperation(
  context: RequestContext,
  edit: EditOperation,
): Promise<void> {
  switch (edit.type) {
    case "insert":
      requireField(edit.text, "text");
      await insertText(context, edit.index, edit.text);
      return;

    case "replace":
      requireField(edit.find, "find");
      await replaceText(context, edit.find, edit.replace ?? "");
      return;

    case "delete":
      requireField(edit.find, "find");
      await deleteText(context, edit.find);
      return;

    case "format":
      requireField(edit.find, "find");
      requireField(edit.formatting, "formatting");
      await formatText(context, edit.find, edit.formatting);
      return;

    default: {
      // Exhaustiveness check: kalau `EditOperationType` bertambah, TypeScript
      // akan menandai baris ini saat compile.
      const unreachable: never = edit.type;
      throw new Error(`Tipe edit tidak dikenal: ${String(unreachable)}`);
    }
  }
}

// =============================================================================
// Operasi individual
// =============================================================================

/**
 * Sisipkan satu atau lebih paragraf.
 *
 * @param index Nomor paragraf yang akan didahului. `undefined` = tambahkan di
 *              akhir dokumen. `0` = sisipkan di paling atas.
 */
export async function insertText(
  context: RequestContext,
  index: number | undefined,
  text: string,
): Promise<void> {
  // Teks multi-baris dari AI dipecah jadi paragraf terpisah, bukan satu
  // paragraf berisi karakter newline.
  const parts = text
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === 0) {
    throw new Error("Teks yang akan disisipkan kosong.");
  }

  const body = context.document.body;

  if (index === undefined || index === null) {
    // Tambahkan di akhir dokumen, urutan maju.
    await insertOneByOne(context, parts, (part) => body.insertParagraph(part, "End"));
    return;
  }

  if (index === 0) {
    // TERBALIK, semuanya di "Start": paragraf terakhir disisipkan lebih dulu,
    // sehingga urutan akhirnya benar tanpa perlu menyentuh proxy hasil.
    await insertOneByOne(context, [...parts].reverse(), (part) =>
      body.insertParagraph(part, "Start"),
    );
    return;
  }

  // Index di tengah dokumen: perlu membaca daftar paragraf dulu.
  const paragraphs = body.paragraphs;
  // Hanya alamat item yang dipakai (diindeks lewat `items`), bukan teksnya.
  paragraphs.load();
  await context.sync();

  const target = paragraphs.items[index];

  // Index melebihi jumlah paragraf -> perlakukan sebagai "tambahkan di akhir"
  // daripada menggagalkan edit. LLM sering meleset soal angka.
  if (!target) {
    await insertOneByOne(context, parts, (part) => body.insertParagraph(part, "End"));
    return;
  }

  // Urutan maju, semuanya "Before" target yang sama: A sebelum T, lalu B
  // sebelum T, menghasilkan A, B, T.
  await insertOneByOne(context, parts, (part) =>
    target.insertParagraph(part, "Before"),
  );
}

/**
 * Sisipkan paragraf satu per satu, dengan `sync()` di antara masing-masing.
 *
 * Satu sync per paragraf terlihat boros, tapi DUA batasan engine memaksanya —
 * keduanya baru ketahuan saat dijalankan sungguhan, bukan dari typings:
 *
 *   1. `ConflictingChanges` — dua penyisipan dalam satu batch yang menyentuh
 *      paragraf jangkar yang sama ditolak. Pesan errornya sendiri menyarankan
 *      "split them across two context.sync() calls".
 *   2. `InvalidObjectPath` — proxy Paragraph yang dikembalikan
 *      `insertParagraph()` belum punya alamat sampai `sync()` berikutnya, jadi
 *      merantai penyisipan pada hasilnya juga gagal.
 *
 * Jumlah paragraf per operasi insert kecil (satu ringkasan, satu bagian baru),
 * jadi biaya round trip-nya tidak terasa.
 */
async function insertOneByOne(
  context: RequestContext,
  parts: readonly string[],
  insert: (part: string) => unknown,
): Promise<void> {
  for (const part of parts) {
    insert(part);
    await context.sync();
  }
}

/**
 * Ganti kemunculan PERTAMA dari `find` dengan `replace`.
 *
 * Sengaja hanya yang pertama: model diminta mengirim satu operasi per kalimat,
 * jadi mengganti semua kemunculan bisa mengubah bagian dokumen yang tidak
 * dimaksudkan.
 */
export async function replaceText(
  context: RequestContext,
  find: string,
  replace: string,
): Promise<void> {
  const range = await findFirstRange(context, find);
  range.insertText(toReplacementText(replace), "Replace");
  await context.sync();
}

/** Hapus kemunculan pertama dari `find`. */
export async function deleteText(
  context: RequestContext,
  find: string,
): Promise<void> {
  const range = await findFirstRange(context, find);
  // Menimpa dengan string kosong = menghapus, sekaligus mempertahankan
  // paragraf induknya (berbeda dengan `paragraph.delete()`).
  range.insertText("", "Replace");
  await context.sync();
}

/**
 * Terapkan formatting karakter ke kemunculan pertama dari `find`.
 *
 * KETERBATASAN: `Font` di editor-api hanya mengekspos `bold`, `italic`,
 * `color`, `name`, dan `size` — tidak ada `underline`. Permintaan underline
 * dari AI diabaikan dengan peringatan di console, bukan dijadikan error,
 * supaya bagian formatting lain tetap masuk.
 */
export async function formatText(
  context: RequestContext,
  find: string,
  formatting: TextFormatting,
): Promise<void> {
  const range = await findFirstRange(context, find);
  const font = range.font;

  if (typeof formatting.bold === "boolean") font.bold = formatting.bold;
  if (typeof formatting.italic === "boolean") font.italic = formatting.italic;
  if (typeof formatting.size === "number") font.size = formatting.size;
  if (typeof formatting.color === "string") {
    font.color = normalizeColor(formatting.color);
  }

  if (formatting.underline !== undefined) {
    console.warn(
      "[editor-api-utils] Underline tidak didukung Font di editor-api; diabaikan.",
    );
  }

  await context.sync();
}

// =============================================================================
// Helper internal
// =============================================================================

/**
 * Cari `text` di body dokumen dan kembalikan hasil pertama.
 *
 * @throws {Error} kalau string terlalu panjang atau teksnya tidak ditemukan.
 *                 Pemanggil di `applyEditsToDocument()` menangkap ini dan
 *                 mencatatnya sebagai edit yang dilewati.
 */
async function findFirstRange(
  context: RequestContext,
  text: string,
): Promise<Range> {
  const needle = toSingleLine(text);

  if (!needle) {
    throw new Error("Teks pencarian kosong.");
  }

  if (needle.length > MAX_SEARCH_CHARS) {
    throw new Error(
      `Teks pencarian melebihi ${MAX_SEARCH_CHARS} karakter — perpendek potongan yang dicari.`,
    );
  }

  const results = context.document.body.search(needle, SEARCH_OPTIONS);

  // `load()` TANPA argumen — ini penting.
  //
  // `load("text")` terlihat masuk akal, tapi koleksi hasil pencarian tidak
  // punya properti `text`; engine menolaknya dengan `InvalidArgument`. Yang
  // menyesatkan: label koleksi itu `document.body.search`, jadi target
  // error-nya terbaca `document.body.search.text` — seolah argumen `search()`
  // yang salah, padahal `load()` yang salah.
  //
  // Kita hanya butuh alamat item-nya, bukan isinya, jadi `load()` polos sudah
  // benar sekaligus lebih murah. Ini juga bentuk yang dipakai README editor-api.
  results.load();
  await context.sync();

  const first = results.items[0];
  if (!first) {
    throw new Error(
      `Teks tidak ditemukan di dokumen: "${ellipsis(needle, 60)}"`,
    );
  }

  return first;
}

/**
 * Sempitkan teks pencarian jadi SATU baris.
 *
 * Paragraf yang memakai line break di dalamnya (blok alamat, daftar bertingkat)
 * terbaca sebagai satu blok ber-`\n` oleh parser, dan AI menyalinnya verbatim
 * ke `find` — persis seperti yang diminta instruksinya. Engine lalu menolaknya
 * dengan `InvalidArgument`.
 *
 * Kalau setelah baris kosong dibuang hanya tersisa SATU baris berisi, baris itu
 * yang dipakai — ini menangani kasus paling umum, yaitu AI menyertakan newline
 * di ujung. Kalau tersisa lebih dari satu, targetnya memang melintasi paragraf
 * dan tidak bisa dicari; error-nya menyebutkan itu supaya bisa ditindaklanjuti.
 */
function toSingleLine(text: string): string {
  const rawLines = text.split(/[\r\n\u2028\u2029]+/);
  const nonEmptyLines = rawLines.filter((line) => line.trim().length > 0);

  if (nonEmptyLines.length === 0) return "";

  if (nonEmptyLines.length > 1) {
    throw new Error(
      `Teks pencarian melintasi ${nonEmptyLines.length} baris; pencarian hanya bisa dalam satu paragraf. ` +
        `Sebut bagian yang lebih spesifik, mis. "${ellipsis(nonEmptyLines[0].trim(), 40)}".`,
    );
  }

  // Baris yang tersisa dikembalikan APA ADANYA (tidak di-trim): spasi di
  // ujung `find` kadang disengaja model untuk menjaga spasi tunggal setelah
  // sebuah kata/frasa di tengah kalimat dihapus \u2014 men-trim di sini diam-diam
  // membatalkan itu dan meninggalkan spasi ganda di dokumen.
  return nonEmptyLines[0];
}

/**
 * Rapikan teks pengganti agar diterima engine.
 *
 * Validator yang menolak line break di teks pencarian juga dipakai untuk teks
 * pengganti. Di sini line break DIRATAKAN jadi spasi, bukan dijadikan error:
 * mendapat teks yang benar dalam satu paragraf jauh lebih berguna bagi user
 * daripada perubahan yang gagal total.
 */
function toReplacementText(text: string): string {
  if (!LINE_BREAK_PATTERN.test(text)) return text;

  console.warn(
    "[editor-api-utils] Teks pengganti memuat line break; diratakan jadi spasi.",
  );
  return text.replace(/[\r\n\v\f\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ");
}

/**
 * Normalisasi warna ke bentuk `#RRGGBB`.
 *
 * `gemini-client.ts` sudah membuang "#" dan meng-uppercase-kan nilainya; di
 * sini "#" dipasang kembali karena engine editor mengikuti konvensi CSS/Office.
 * Nilai yang tidak berbentuk hex 6 digit diteruskan apa adanya, supaya nama
 * warna CSS seperti "red" tetap bisa dipakai.
 */
function normalizeColor(color: string): string {
  const value = color.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(value) ? `#${value.toUpperCase()}` : color.trim();
}

/** Pastikan field wajib terisi sebelum operasi dijalankan. */
function requireField<T>(value: T | undefined, name: string): asserts value is T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Field "${name}" wajib diisi untuk operasi ini.`);
  }
}

/** Ubah error apa pun jadi kalimat pendek yang layak ditampilkan ke user. */
function describeError(err: unknown): string {
  if (isDocxEditorError(err)) {
    // `StaleDocument` artinya dokumen berubah di antara baca dan tulis —
    // biasanya karena user mengetik saat AI sedang bekerja.
    return `${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function ellipsis(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
