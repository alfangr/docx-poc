/**
 * POST /api/ai-edit
 * -----------------------------------------------------------------------------
 * Satu-satunya jalur aplikasi ini menuju Gemini. Melayani dua mode, dibedakan
 * dari ada-tidaknya `action` di body:
 *
 *   MODE EDIT  (`action` terisi)  -> menjalankan quick action, mengembalikan
 *                                    `edits` untuk diterapkan client-side.
 *   PESAN BEBAS (`action` kosong) -> arah ditentukan `mode` yang dipilih user:
 *                                    "chat" hanya menjawab, "edit" boleh
 *                                    menghasilkan `edits`.
 *
 * Alur:
 *   1. Validasi body (bentuk, ukuran, nilai enum).
 *   2. Decode base64 -> ArrayBuffer.
 *   3. Ekstrak teks dokumen (`docx-parser` sekaligus memvalidasi file-nya).
 *   4. Panggil Gemini.
 *   5. Kembalikan edit yang sudah tervalidasi + teks jawaban.
 *
 * API key tidak pernah meninggalkan server: `gemini-client` hanya di-import
 * di sini, tidak pernah dari komponen client.
 */

import { NextResponse } from "next/server";

import {
  base64ByteLength,
  base64ToArrayBuffer,
  isValidBase64,
} from "@/lib/buffer-utils";
import { extractTextFromDocx, getSelectedTextContext } from "@/lib/docx-parser";
import { converseWithDocument, editDocumentWithAI } from "@/lib/gemini-client";
import {
  AppError,
  MAX_FILE_SIZE_BYTES,
  isAppError,
  type AIActionType,
  type AIEditRequest,
  type AIEditResponse,
  type ChatMode,
  type SerializedChatMessage,
} from "@/lib/types";

/** `mammoth` butuh `Buffer` dari Node, jadi Edge runtime bukan pilihan. */
export const runtime = "nodejs";

/** Request AI selalu unik — tidak ada yang layak di-cache. */
export const dynamic = "force-dynamic";

/**
 * Gemini 2.5 Flash biasanya menjawab dalam beberapa detik, tapi dokumen panjang
 * bisa lebih lama. `gemini-client` sendiri sudah timeout di 60 detik; nilai ini
 * memberi ruang untuk parsing dan retry di atasnya.
 */
export const maxDuration = 120;

/** Nilai `action` yang diterima. Dijaga sinkron dengan `AIActionType`. */
const VALID_ACTIONS: readonly AIActionType[] = [
  "summarize",
  "expand",
  "fix-grammar",
  "rewrite",
  "translate",
];

// =============================================================================
// Handler
// =============================================================================

export async function POST(request: Request): Promise<NextResponse<AIEditResponse>> {
  try {
    const body = await parseBody(request);
    const docBuffer = decodeDocument(body.docBase64);

    // Sekaligus memvalidasi dokumen: melempar PARSE_FAILED kalau file korup
    // atau diproteksi password.
    const docText = await extractTextFromDocx(docBuffer);

    // Seleksi user diperkaya dengan blok tetangganya, supaya AI mengedit
    // dengan konteks kalimat sekitarnya.
    const selectedContext = body.selectedText
      ? await getSelectedTextContext(docBuffer, body.selectedText)
      : undefined;

    // --- MODE EDIT -----------------------------------------------------------
    if (body.action) {
      const result = await editDocumentWithAI(
        docText,
        body.action,
        body.userMessage,
        selectedContext,
      );

      return NextResponse.json({
        success: true,
        edits: result.edits,
        summary: result.summary,
        usage: result.usage,
      });
    }

    // --- MODE CHAT -----------------------------------------------------------
    if (!body.userMessage?.trim()) {
      throw new AppError(
        "INVALID_INPUT",
        "Mode chat memerlukan `userMessage`.",
        400,
      );
    }

    // `mode` menentukan apakah tool editing dipasang. Default "chat"
    // (read-only) — kalau field-nya hilang atau tidak dikenal, jangan sampai
    // dokumen ikut berubah.
    const result = await converseWithDocument(
      docText,
      toConversation(body.history),
      body.userMessage,
      body.mode ?? "chat",
      selectedContext,
    );

    return NextResponse.json({
      success: true,
      edits: result.edits,
      summary: result.summary,
      usage: result.usage,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// =============================================================================
// Validasi input
// =============================================================================

/**
 * Baca dan validasi body request.
 *
 * Semua data dari client dianggap tidak tepercaya: bentuknya diperiksa field
 * per field, bukan sekadar di-cast ke `AIEditRequest`.
 *
 * @throws {AppError} INVALID_INPUT | FILE_TOO_LARGE
 */
async function parseBody(request: Request): Promise<AIEditRequest> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw new AppError("INVALID_INPUT", "Body request bukan JSON yang valid.", 400);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new AppError("INVALID_INPUT", "Body request harus berupa object.", 400);
  }

  const input = raw as Record<string, unknown>;

  // --- docBase64 (wajib) ---
  const docBase64 = input.docBase64;
  if (typeof docBase64 !== "string" || docBase64.length === 0) {
    throw new AppError(
      "INVALID_INPUT",
      "Field `docBase64` wajib diisi dengan string base64.",
      400,
    );
  }

  // --- action (opsional; menentukan mode) ---
  let action: AIActionType | undefined;
  if (input.action !== undefined && input.action !== null) {
    if (!VALID_ACTIONS.includes(input.action as AIActionType)) {
      throw new AppError(
        "INVALID_INPUT",
        `Action tidak dikenal. Pilihan yang valid: ${VALID_ACTIONS.join(", ")}.`,
        400,
      );
    }
    action = input.action as AIActionType;
  }

  // Hanya "edit" yang diterima sebagai mode non-default; nilai lain apa pun
  // jatuh ke "chat" yang read-only.
  const mode: ChatMode = input.mode === "edit" ? "edit" : "chat";

  return {
    docBase64,
    action,
    mode,
    userMessage: asOptionalString(input.userMessage),
    selectedText: asOptionalString(input.selectedText),
    history: asHistory(input.history),
  };
}

/**
 * Decode dokumen dan tegakkan batas ukuran.
 *
 * Ukuran dicek dari panjang string base64 SEBELUM decode, supaya payload
 * raksasa ditolak tanpa perlu mengalokasikan buffer-nya lebih dulu.
 *
 * @throws {AppError} INVALID_INPUT | FILE_TOO_LARGE
 */
function decodeDocument(docBase64: string): ArrayBuffer {
  if (!isValidBase64(docBase64)) {
    throw new AppError(
      "INVALID_INPUT",
      "Field `docBase64` bukan base64 yang valid.",
      400,
    );
  }

  if (base64ByteLength(docBase64) > MAX_FILE_SIZE_BYTES) {
    const limitMb = Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024);
    throw new AppError(
      "FILE_TOO_LARGE",
      `Ukuran dokumen melebihi batas ${limitMb} MB.`,
      413,
    );
  }

  try {
    return base64ToArrayBuffer(docBase64);
  } catch (err) {
    throw new AppError(
      "INVALID_INPUT",
      "Dokumen tidak bisa di-decode.",
      400,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Ambil hanya entri riwayat yang bentuknya benar; sisanya dibuang. */
function asHistory(value: unknown): SerializedChatMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const messages = value.filter((item): item is SerializedChatMessage => {
    if (typeof item !== "object" || item === null) return false;
    const msg = item as Record<string, unknown>;
    return (
      (msg.role === "user" || msg.role === "assistant") &&
      typeof msg.content === "string"
    );
  });

  return messages.length > 0 ? messages : undefined;
}

/** Sempitkan riwayat ke bentuk minimal yang dibutuhkan `converseWithDocument`. */
function toConversation(history: SerializedChatMessage[] | undefined) {
  return (history ?? []).map((m) => ({ role: m.role, content: m.content }));
}

// =============================================================================
// Error handling
// =============================================================================

/**
 * Ubah error apa pun jadi response JSON yang konsisten.
 *
 * Yang dikirim ke client hanya `message` (sudah ramah user) dan `code`.
 * `details` — yang bisa memuat pesan mentah Gemini atau potongan isi dokumen —
 * hanya masuk log server.
 */
function errorResponse(err: unknown): NextResponse<AIEditResponse> {
  if (isAppError(err)) {
    console.error(`[api/ai-edit] ${err.code}: ${err.message}`, err.details ?? "");

    return NextResponse.json(
      {
        success: false,
        edits: [],
        error: err.message,
        errorCode: err.code,
        ...(err.retryAfterSeconds
          ? { retryAfterSeconds: err.retryAfterSeconds }
          : {}),
      },
      {
        status: err.status,
        // Header standar HTTP, supaya proxy dan klien non-browser ikut paham.
        ...(err.retryAfterSeconds
          ? { headers: { "Retry-After": String(err.retryAfterSeconds) } }
          : {}),
      },
    );
  }

  console.error("[api/ai-edit] Error tak terduga:", err);

  return NextResponse.json(
    {
      success: false,
      edits: [],
      error: "Terjadi kesalahan di server.",
      errorCode: "UNKNOWN" as const,
    },
    { status: 500 },
  );
}
