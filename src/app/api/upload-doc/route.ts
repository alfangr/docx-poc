/**
 * POST /api/upload-doc
 * -----------------------------------------------------------------------------
 * Menyediakan dokumen untuk editor, lewat dua jalur yang dibedakan dari
 * Content-Type request:
 *
 *   application/json      -> MODE CREATE. Membuat .docx kosong dari nol.
 *                            Body: { action: "create", fileName?, title? }
 *
 *   multipart/form-data   -> MODE UPLOAD. Memvalidasi file .docx yang diunggah
 *                            dan mengembalikannya beserta metadata.
 *                            Body: FormData dengan field `file`.
 *
 * Kenapa pembuatan dokumen dilakukan di server: library `docx` itu write-only
 * dan cukup berat; halaman editor hanya butuh hasilnya, jadi tidak ada gunanya
 * ikut ter-bundle ke browser.
 *
 * Catatan soal MODE UPLOAD: `useDocxDocument.uploadDocument()` membaca file
 * langsung di browser tanpa memanggil endpoint ini — round trip 2x ukuran file
 * hanya untuk validasi itu pemborosan. Endpoint upload tetap disediakan sesuai
 * spec, dan berguna untuk pemanggil non-browser (cURL, integration test).
 */

import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";

import { arrayBufferToBase64 } from "@/lib/buffer-utils";
import {
  clearParserCache,
  getDocumentMeta,
  validateDocxBuffer,
} from "@/lib/docx-parser";
import {
  AppError,
  MAX_FILE_SIZE_BYTES,
  isAppError,
  type UploadResponse,
} from "@/lib/types";

/** `docx` dan `mammoth` sama-sama butuh API Node. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_FILE_NAME = "untitled.docx";

/** Batas panjang nama file, mengikuti batas umum filesystem. */
const MAX_FILE_NAME_LENGTH = 255;

// =============================================================================
// Handler
// =============================================================================

export async function POST(request: Request): Promise<NextResponse<UploadResponse>> {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      return await handleUpload(request);
    }

    if (contentType.includes("application/json")) {
      return await handleCreate(request);
    }

    throw new AppError(
      "INVALID_INPUT",
      "Content-Type harus application/json (create) atau multipart/form-data (upload).",
      415,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

// =============================================================================
// Mode CREATE
// =============================================================================

/**
 * Buat dokumen .docx kosong.
 *
 * Dokumen selalu berisi minimal satu paragraf: file .docx tanpa paragraf sama
 * sekali ditolak sebagian editor sebagai dokumen tidak valid.
 */
async function handleCreate(request: Request): Promise<NextResponse<UploadResponse>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw new AppError("INVALID_INPUT", "Body request bukan JSON yang valid.", 400);
  }

  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;

  const fileName = sanitizeFileName(
    typeof input.fileName === "string" ? input.fileName : DEFAULT_FILE_NAME,
  );
  const title = typeof input.title === "string" ? input.title.trim() : "";

  const children = title
    ? [
        new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })] }),
        new Paragraph({ text: "" }),
      ]
    : [new Paragraph({ text: "" })];

  const doc = new Document({ sections: [{ children }] });

  let buffer: ArrayBuffer;
  try {
    const nodeBuffer = await Packer.toBuffer(doc);
    // `Buffer` Node bisa berbagi memori dengan pool internal, jadi disalin ke
    // ArrayBuffer sendiri agar ukurannya persis isi dokumen.
    buffer = nodeBuffer.buffer.slice(
      nodeBuffer.byteOffset,
      nodeBuffer.byteOffset + nodeBuffer.byteLength,
    ) as ArrayBuffer;
  } catch (err) {
    throw new AppError(
      "UNKNOWN",
      "Gagal membuat dokumen baru.",
      500,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Dokumen baru menggantikan yang lama di cache parser satu-entri.
  clearParserCache();

  return NextResponse.json({
    success: true,
    fileName,
    docBase64: arrayBufferToBase64(buffer),
    meta: await getDocumentMeta(buffer, fileName),
  });
}

// =============================================================================
// Mode UPLOAD
// =============================================================================

/** Validasi file .docx yang diunggah lalu kembalikan isinya beserta metadata. */
async function handleUpload(request: Request): Promise<NextResponse<UploadResponse>> {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch (err) {
    throw new AppError(
      "INVALID_INPUT",
      "Form data tidak bisa dibaca.",
      400,
      err instanceof Error ? err.message : String(err),
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new AppError(
      "INVALID_INPUT",
      "Field `file` wajib ada dan harus berupa file.",
      400,
    );
  }

  if (file.size === 0) {
    throw new AppError("INVALID_INPUT", "File kosong.", 400);
  }

  // Ukuran dicek sebelum `arrayBuffer()`, supaya file raksasa tidak sempat
  // dimuat seluruhnya ke memori.
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const limitMb = Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024);
    throw new AppError(
      "FILE_TOO_LARGE",
      `Ukuran file melebihi batas ${limitMb} MB.`,
      413,
    );
  }

  const fileName = sanitizeFileName(file.name || DEFAULT_FILE_NAME);
  const buffer = await file.arrayBuffer();

  // Validasi otoritatif: magic bytes ZIP. Ekstensi dan MIME type dari client
  // gampang dipalsukan, isi file tidak.
  validateDocxBuffer(buffer);

  // Dokumen berbeda dari yang tersimpan sebelumnya.
  clearParserCache();

  // Sekaligus membuktikan file-nya benar-benar bisa di-parse: kalau korup,
  // `getDocumentMeta` melempar PARSE_FAILED di sini, bukan nanti saat user
  // sudah menekan tombol AI.
  const meta = await getDocumentMeta(buffer, fileName);

  return NextResponse.json({
    success: true,
    fileName,
    docBase64: arrayBufferToBase64(buffer),
    meta,
  });
}

// =============================================================================
// Helper
// =============================================================================

/**
 * Bersihkan nama file dari client.
 *
 * Nama ini memang tidak dipakai untuk menulis ke disk (POC menyimpan semuanya
 * di memori), tapi tetap diteruskan ke `saveAs()` di browser — jadi komponen
 * path dan karakter kontrol dibuang, dan ekstensi `.docx` dipastikan ada.
 */
function sanitizeFileName(name: string): string {
  // Ambil basename-nya saja: buang segmen path pada pemisah gaya POSIX maupun Windows.
  const base = name.split(/[/\\]/).pop() ?? "";

  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F<>:"|?*]/g, "") // karakter kontrol & ilegal di Windows
    .replace(/^\.+/, "") // cegah nama file tersembunyi / ".."
    .trim();

  if (!cleaned) return DEFAULT_FILE_NAME;

  const withExtension = cleaned.toLowerCase().endsWith(".docx")
    ? cleaned
    : `${cleaned}.docx`;

  if (withExtension.length <= MAX_FILE_NAME_LENGTH) return withExtension;

  // Terlalu panjang: potong bagian namanya, ekstensi dipertahankan.
  return `${withExtension.slice(0, MAX_FILE_NAME_LENGTH - 5)}.docx`;
}

/** Bentuk response error yang konsisten; `details` hanya masuk log server. */
function errorResponse(err: unknown): NextResponse<UploadResponse> {
  if (isAppError(err)) {
    console.error(`[api/upload-doc] ${err.code}: ${err.message}`, err.details ?? "");

    return NextResponse.json(
      {
        success: false,
        fileName: "",
        error: err.message,
        errorCode: err.code,
      },
      { status: err.status },
    );
  }

  console.error("[api/upload-doc] Error tak terduga:", err);

  return NextResponse.json(
    {
      success: false,
      fileName: "",
      error: "Terjadi kesalahan di server.",
      errorCode: "UNKNOWN" as const,
    },
    { status: 500 },
  );
}
