/**
 * docx-parser.ts
 * -----------------------------------------------------------------------------
 * Membaca file .docx dan mengubahnya jadi teks/struktur yang bisa dikirim ke Gemini.
 *
 * PENTING — SERVER ONLY (butuh `Buffer` dari Node.js).
 * Hanya di-import dari route handler di `src/app/api/**`.
 *
 * Kenapa `mammoth`, bukan `docx` seperti di spec:
 * library `docx` itu WRITE-ONLY — dia bisa membuat file .docx tapi tidak bisa
 * membacanya. `mammoth` adalah reader-nya. Keduanya tetap dipakai di proyek ini:
 * `mammoth` untuk baca (file ini), `docx` untuk membuat dokumen blank
 * di `/api/upload-doc`.
 *
 * Strategi parsing (dua lapis, dengan fallback):
 *   1. UTAMA — hook `transformDocument` dipakai untuk menangkap AST internal
 *      mammoth. Dari situ heading, list, dan tabel terbaca persis: `styleName`
 *      memberi level heading, `numbering` menandai list item.
 *   2. FALLBACK — kalau bentuk AST berubah di versi mammoth berikutnya (AST itu
 *      bertipe `any` di typings-nya, jadi bukan kontrak publik yang stabil),
 *      parser turun ke `extractRawText()` dan memperlakukan tiap baris sebagai
 *      satu paragraf. Kualitas struktur berkurang, tapi tidak pernah crash.
 */

import { createHash } from "node:crypto";
import mammoth from "mammoth";

import {
  AppError,
  DOCX_MIME_TYPE,
  MAX_FILE_SIZE_BYTES,
  type DocumentBlock,
  type DocumentMeta,
  type DocumentStructure,
} from "./types";

// =============================================================================
// Konstanta
// =============================================================================

/**
 * Magic bytes "PK\x03\x04" — signature arsip ZIP.
 * File .docx sebenarnya adalah ZIP berisi XML, jadi ini cek murah untuk
 * menolak file yang jelas-jelas bukan .docx sebelum parsing yang mahal.
 */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/** Jumlah blok tetangga yang diikutkan sebagai konteks di `getSelectedTextContext()`. */
const CONTEXT_BLOCK_RADIUS = 1;

/** Pemisah antar blok di output teks polos. */
const BLOCK_SEPARATOR = "\n\n";

// =============================================================================
// Bentuk AST mammoth (minimal, defensif)
// =============================================================================

/**
 * Mammoth mengetik AST-nya sebagai `any`. Interface di bawah hanya
 * mendeskripsikan field yang benar-benar dipakai, semuanya opsional, supaya
 * perubahan bentuk di versi mendatang tidak langsung membuat parser meledak.
 */
interface MammothNode {
  type?: string;
  children?: MammothNode[];
  /** Nilai teks; hanya ada di node bertipe "text". */
  value?: string;
  /** Nama style Word, mis. "Heading 1". */
  styleName?: string | null;
  /** ID style Word, mis. "Heading1". */
  styleId?: string | null;
  /** Terisi kalau paragraf ini bagian dari list. */
  numbering?: { isOrdered?: boolean; level?: string | number } | null;
  /** Jenis break pada node "break": "line" | "page" | "column". */
  breakType?: string;
}

// =============================================================================
// Cache
// =============================================================================

/**
 * Cache satu entri. `/api/ai-edit` mem-parse buffer yang sama berulang kali
 * (sekali per klik quick action), dan hashing SHA-1 jauh lebih murah daripada
 * unzip + parse XML ulang.
 */
let cache: { hash: string; structure: DocumentStructure } | null = null;

function hashBuffer(buffer: Buffer): string {
  return createHash("sha1").update(buffer).digest("hex");
}

/** Kosongkan cache — dipanggil saat dokumen baru di-upload. */
export function clearParserCache(): void {
  cache = null;
}

// =============================================================================
// Validasi
// =============================================================================

/**
 * Cek murah apakah buffer terlihat seperti file .docx.
 * Tidak menjamin file-nya valid — hanya menyaring input yang jelas salah.
 */
export function isDocxBuffer(docBuffer: ArrayBuffer): boolean {
  if (docBuffer.byteLength < ZIP_SIGNATURE.length) return false;
  const head = new Uint8Array(docBuffer, 0, ZIP_SIGNATURE.length);
  return ZIP_SIGNATURE.every((byte, i) => head[i] === byte);
}

/**
 * Validasi buffer sebelum diproses lebih jauh.
 *
 * @throws {AppError} INVALID_INPUT | FILE_TOO_LARGE | INVALID_FILE_TYPE
 */
export function validateDocxBuffer(docBuffer: ArrayBuffer): void {
  if (!docBuffer || docBuffer.byteLength === 0) {
    throw new AppError("INVALID_INPUT", "File kosong atau tidak terbaca.", 400);
  }

  if (docBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
    const limitMb = Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024);
    throw new AppError(
      "FILE_TOO_LARGE",
      `Ukuran file melebihi batas ${limitMb} MB.`,
      413,
    );
  }

  if (!isDocxBuffer(docBuffer)) {
    throw new AppError(
      "INVALID_FILE_TYPE",
      `File bukan dokumen .docx yang valid (diharapkan ${DOCX_MIME_TYPE}).`,
      415,
    );
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Ekstrak seluruh isi dokumen sebagai teks polos.
 * Ini yang dikirim ke Gemini sebagai konteks dokumen.
 *
 * @throws {AppError} INVALID_INPUT | FILE_TOO_LARGE | INVALID_FILE_TYPE | PARSE_FAILED
 */
export async function extractTextFromDocx(
  docBuffer: ArrayBuffer,
): Promise<string> {
  const structure = await getDocumentStructure(docBuffer);
  return structure.plainText;
}

/**
 * Parse dokumen jadi blok-blok terstruktur (heading, paragraf, list, tabel)
 * plus statistik dan peringatan.
 *
 * Hasilnya di-cache berdasarkan isi buffer, jadi aman dipanggil berkali-kali.
 *
 * @throws {AppError} INVALID_INPUT | FILE_TOO_LARGE | INVALID_FILE_TYPE | PARSE_FAILED
 */
export async function getDocumentStructure(
  docBuffer: ArrayBuffer,
): Promise<DocumentStructure> {
  validateDocxBuffer(docBuffer);

  const buffer = toNodeBuffer(docBuffer);
  const hash = hashBuffer(buffer);

  if (cache?.hash === hash) return cache.structure;

  const warnings: string[] = [];
  let mammothMessages: Array<{ type: string; message: string }> = [];

  // Ditampung di object, bukan variabel `let`. TypeScript tidak melacak
  // assignment yang terjadi di dalam callback, jadi variabel biasa akan tetap
  // ternarrow jadi `null` setelah blok try dan bikin compile error.
  const captured: { ast: MammothNode | null } = { ast: null };

  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        ignoreEmptyParagraphs: true,
        // Tangkap AST sambil lewat, lalu kembalikan apa adanya (tanpa transformasi).
        transformDocument: (element: MammothNode) => {
          captured.ast = element;
          return element;
        },
        // Kita membuang output HTML-nya, jadi jangan buang waktu meng-encode
        // gambar jadi data URI (bisa puluhan MB di dokumen berisi banyak gambar).
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      },
    );
    mammothMessages = result.messages;
  } catch (err) {
    // Gagal di tahap unzip/XML = file korup atau terenkripsi (password-protected).
    throw new AppError(
      "PARSE_FAILED",
      "Dokumen tidak bisa dibaca. Pastikan file .docx tidak korup dan tidak diproteksi password.",
      422,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Teruskan peringatan mammoth (style tidak dikenal, dsb) apa adanya —
  // sifatnya informatif, tidak menggagalkan parsing.
  for (const msg of mammothMessages) {
    if (msg.type === "warning" || msg.type === "error") {
      warnings.push(msg.message);
    }
  }

  let blocks: DocumentBlock[] = [];

  if (captured.ast) {
    try {
      blocks = walkDocument(captured.ast);
    } catch (err) {
      // Bentuk AST tak terduga — jangan gagalkan request, turun ke fallback.
      console.warn("[docx-parser] Gagal menelusuri AST mammoth:", err);
      warnings.push(
        "Struktur dokumen tidak terbaca penuh; jatuh ke ekstraksi teks polos.",
      );
      blocks = [];
    }
  }

  // Fallback: AST tidak tertangkap atau tidak menghasilkan blok apa pun.
  if (blocks.length === 0) {
    blocks = await extractPlainTextBlocks(buffer);
  }

  const structure: DocumentStructure = {
    plainText: blocks.map((b) => b.text).join(BLOCK_SEPARATOR),
    blocks,
    stats: computeStats(blocks),
    warnings,
  };

  cache = { hash, structure };
  return structure;
}

/**
 * Ambil potongan teks di sekitar teks yang di-select user.
 * Dipakai supaya AI mengedit dengan konteks kalimat sekitarnya, bukan potongan
 * yang menggantung tanpa konteks.
 *
 * Kalau teksnya tidak ketemu di dokumen (mis. user menyeleksi lintas blok atau
 * teks sudah berubah), fungsi ini mengembalikan seleksi itu sendiri — bukan
 * melempar error, karena ini jalur non-kritis.
 */
export async function getSelectedTextContext(
  docBuffer: ArrayBuffer,
  selectedText: string,
): Promise<string> {
  const selection = selectedText?.trim();
  if (!selection) return "";

  const { blocks } = await getDocumentStructure(docBuffer);

  // Normalisasi whitespace di kedua sisi: seleksi dari editor sering membawa
  // spasi/newline yang tidak sama persis dengan teks hasil parsing.
  const needle = normalizeWhitespace(selection).toLowerCase();
  const matchIndex = blocks.findIndex((block) =>
    normalizeWhitespace(block.text).toLowerCase().includes(needle),
  );

  if (matchIndex === -1) return selection;

  const start = Math.max(0, matchIndex - CONTEXT_BLOCK_RADIUS);
  const end = Math.min(blocks.length, matchIndex + CONTEXT_BLOCK_RADIUS + 1);

  return blocks
    .slice(start, end)
    .map((b) => b.text)
    .join(BLOCK_SEPARATOR);
}

/** Metadata ringkas untuk panel info dokumen di UI. */
export async function getDocumentMeta(
  docBuffer: ArrayBuffer,
  fileName: string,
): Promise<DocumentMeta> {
  const { stats } = await getDocumentStructure(docBuffer);
  return { fileName, sizeBytes: docBuffer.byteLength, ...stats };
}

// =============================================================================
// Penelusuran AST
// =============================================================================

/** Ubah node dokumen jadi daftar blok datar dan berurutan. */
function walkDocument(document: MammothNode): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];

  for (const child of document.children ?? []) {
    collectBlock(child, blocks);
  }

  return blocks;
}

/**
 * Proses satu node level-atas jadi satu blok (atau lebih).
 * Node yang tidak dikenal ditelusuri anak-anaknya, supaya konten di dalam
 * wrapper yang tidak kita pahami tetap ikut terbaca.
 */
function collectBlock(node: MammothNode, blocks: DocumentBlock[]): void {
  switch (node.type) {
    case "paragraph": {
      const text = normalizeWhitespace(collectText(node));
      if (!text) return; // buang paragraf kosong

      const headingLevel = getHeadingLevel(node);

      if (headingLevel !== null) {
        blocks.push({
          index: blocks.length,
          type: "heading",
          text,
          level: headingLevel,
        });
      } else if (node.numbering) {
        blocks.push({ index: blocks.length, type: "list-item", text });
      } else {
        blocks.push({ index: blocks.length, type: "paragraph", text });
      }
      return;
    }

    case "table": {
      const rows = collectTableRows(node);
      if (rows.length === 0) return;

      blocks.push({
        index: blocks.length,
        type: "table",
        // Representasi pipe-delimited: kompak dan mudah dibaca model.
        text: rows.map((row) => row.join(" | ")).join("\n"),
        rows,
      });
      return;
    }

    default: {
      // Wrapper tak dikenal (mis. bookmark, comment range) — telusuri isinya.
      for (const child of node.children ?? []) {
        collectBlock(child, blocks);
      }
    }
  }
}

/** Gabungkan seluruh teks di bawah sebuah node, rekursif. */
function collectText(node: MammothNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type === "tab") return "\t";
  if (node.type === "break") return node.breakType === "line" ? "\n" : " ";

  // Node tanpa representasi teks (image, commentReference, noteReference)
  // otomatis menghasilkan string kosong karena tidak punya anak bertipe text.
  return (node.children ?? []).map(collectText).join("");
}

/** Ubah node tabel jadi array baris berisi teks tiap sel. */
function collectTableRows(table: MammothNode): string[][] {
  const rows: string[][] = [];

  for (const rowNode of table.children ?? []) {
    if (rowNode.type !== "tableRow") continue;

    const cells = (rowNode.children ?? [])
      .filter((cell) => cell.type === "tableCell")
      .map((cell) => normalizeWhitespace(collectText(cell)));

    // Lewati baris yang seluruh selnya kosong.
    if (cells.some((cell) => cell.length > 0)) rows.push(cells);
  }

  return rows;
}

/**
 * Tentukan level heading dari style Word.
 * Dicek dari `styleName` ("Heading 1", "heading 2") maupun `styleId`
 * ("Heading1"), karena dokumen dari sumber berbeda mengisi keduanya berbeda.
 *
 * @returns 1-6, atau `null` kalau bukan heading.
 */
function getHeadingLevel(node: MammothNode): number | null {
  const source = node.styleName ?? node.styleId ?? "";
  const match = /^heading\s*([1-6])$/i.exec(source.trim());
  return match ? Number(match[1]) : null;
}

// =============================================================================
// Fallback & utilitas
// =============================================================================

/**
 * Jalur fallback: ekstrak teks mentah lalu perlakukan tiap baris tak-kosong
 * sebagai satu paragraf. Struktur (heading/list/tabel) hilang, tapi isi
 * dokumen tetap sampai ke AI.
 */
async function extractPlainTextBlocks(buffer: Buffer): Promise<DocumentBlock[]> {
  try {
    const { value } = await mammoth.extractRawText({ buffer });

    return value
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line.length > 0)
      .map((text, index) => ({
        index,
        type: "paragraph" as const,
        text,
      }));
  } catch (err) {
    throw new AppError(
      "PARSE_FAILED",
      "Dokumen tidak bisa dibaca sama sekali.",
      422,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function computeStats(blocks: readonly DocumentBlock[]): DocumentStructure["stats"] {
  const text = blocks.map((b) => b.text).join(BLOCK_SEPARATOR);

  return {
    charCount: text.length,
    wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
    paragraphCount: blocks.length,
  };
}

/**
 * Rapikan whitespace: non-breaking space jadi spasi biasa, spasi/tab beruntun
 * jadi satu spasi, tapi newline dipertahankan (penting untuk soft line break
 * di dalam paragraf).
 */
function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00A0/g, " ") // non-breaking space -> spasi biasa
    .replace(/[ \t]+/g, " ") // spasi/tab beruntun -> satu spasi
    .replace(/ *\n */g, "\n") // rapikan spasi di sekitar newline
    .trim();
}

/**
 * Konversi `ArrayBuffer` (bentuk yang dipakai di client) ke `Buffer` Node
 * yang dibutuhkan mammoth.
 */
function toNodeBuffer(docBuffer: ArrayBuffer): Buffer {
  if (typeof Buffer === "undefined") {
    throw new AppError(
      "UNKNOWN",
      "docx-parser hanya boleh dipakai di server (API route).",
      500,
    );
  }
  return Buffer.from(docBuffer);
}
