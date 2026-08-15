/**
 * types.ts
 * -----------------------------------------------------------------------------
 * Single source of truth untuk semua TypeScript types di aplikasi DOCX Editor AI.
 *
 * Dipakai bersama oleh client (components/hooks) dan server (route handlers),
 * jadi file ini HARUS bebas dari import runtime apa pun (no side effects) supaya
 * aman di-import dari React Server Component maupun Client Component.
 *
 * Konvensi:
 * - Type di-export sebagai `interface` kalau merepresentasikan object shape.
 * - Union string literal dipakai (bukan `enum`) supaya aman untuk serialisasi
 *   JSON antara client <-> API route dan tidak menambah kode runtime.
 * - Payload yang lewat HTTP TIDAK boleh memakai `ArrayBuffer` (tidak
 *   JSON-serializable) — lihat `SerializedBuffer` di bawah.
 */

// =============================================================================
// SECTION 1 — Editor state
// =============================================================================

/**
 * State dokumen yang sedang dibuka di editor.
 * Disimpan di memory (POC); `docBuffer` adalah isi file .docx mentah.
 */
export interface EditorState {
  /** Isi file .docx mentah. `null` kalau belum ada dokumen yang dimuat. */
  docBuffer: ArrayBuffer | null;
  /** Nama file termasuk ekstensi, mis. "laporan-q3.docx". */
  fileName: string;
  /** `true` kalau ada perubahan yang belum disimpan/di-download. */
  isDirty: boolean;
  /** Waktu terakhir dokumen disimpan (localStorage/download). `null` = belum pernah. */
  lastSaved: Date | null;
  /** Teks yang sedang di-select user di editor, dipakai sebagai konteks AI. */
  selectedText: string | null;
}

/**
 * Metadata ringan tentang dokumen — dipakai untuk panel info & validasi
 * ukuran sebelum request dikirim ke AI.
 */
export interface DocumentMeta {
  fileName: string;
  /** Ukuran buffer dalam bytes. */
  sizeBytes: number;
  /** Jumlah karakter hasil ekstraksi teks. */
  charCount: number;
  /** Jumlah kata hasil ekstraksi teks. */
  wordCount: number;
  /** Jumlah paragraf non-kosong. */
  paragraphCount: number;
}

// =============================================================================
// SECTION 2 — Struktur dokumen hasil parsing
// =============================================================================

/** Jenis blok konten yang dikenali oleh docx-parser. */
export type DocumentBlockType = "heading" | "paragraph" | "list-item" | "table";

/**
 * Satu blok konten dari dokumen.
 * Struktur ini sengaja dibuat flat (bukan tree) supaya gampang di-serialize
 * ke prompt Gemini dan gampang dipetakan balik ke index untuk operasi edit.
 */
export interface DocumentBlock {
  /** Urutan blok di dalam dokumen, mulai dari 0. Dipakai sebagai `index` edit. */
  index: number;
  type: DocumentBlockType;
  /** Teks polos dari blok ini. Untuk `table`, baris digabung dengan newline. */
  text: string;
  /** Level heading 1-6. Hanya terisi kalau `type === "heading"`. */
  level?: number;
  /** Isi tabel sebagai array of rows. Hanya terisi kalau `type === "table"`. */
  rows?: string[][];
}

/**
 * Hasil lengkap parsing DOCX — dikirim ke Gemini sebagai konteks dokumen.
 */
export interface DocumentStructure {
  /** Seluruh isi dokumen sebagai teks polos (blok dipisah newline ganda). */
  plainText: string;
  /** Blok konten terurut sesuai urutan di dokumen. */
  blocks: DocumentBlock[];
  /** Statistik dokumen, berguna untuk UI dan guard rail ukuran prompt. */
  stats: Pick<DocumentMeta, "charCount" | "wordCount" | "paragraphCount">;
  /** Peringatan non-fatal saat parsing (mis. gambar di-skip, style tidak dikenali). */
  warnings: string[];
}

// =============================================================================
// SECTION 3 — Chat
// =============================================================================

export type ChatRole = "user" | "assistant";

/**
 * Niat user untuk satu pesan chat, dipilih lewat dropdown di atas kotak pesan.
 *
 * Dipilih USER, bukan disimpulkan model: tebakan yang salah berarti dokumen
 * berubah tanpa diminta. Di mode `"chat"` tool editing tidak dipasang sama
 * sekali, jadi read-only-nya dijamin secara teknis — bukan sekadar diminta
 * lewat prompt.
 */
export type ChatMode = "chat" | "edit";

/** Satu pesan di panel chat. */
export interface ChatMessage {
  /** ID unik pesan (crypto.randomUUID()). */
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  /** `true` selama respons AI masih di-stream/di-fetch. */
  pending?: boolean;
  /** Terisi kalau pesan ini gagal diproses, supaya bisa di-retry. */
  error?: string;
}

/**
 * Versi `ChatMessage` yang aman dikirim lewat HTTP.
 * `Date` tidak survive `JSON.stringify` -> pakai ISO string.
 */
export interface SerializedChatMessage extends Omit<ChatMessage, "timestamp"> {
  /** ISO 8601, mis. "2026-08-12T09:30:00.000Z". */
  timestamp: string;
}

// =============================================================================
// SECTION 4 — AI actions
// =============================================================================

/** Quick action yang tersedia di toolbar/sidebar. */
export type AIActionType =
  | "summarize"
  | "expand"
  | "shorten"
  | "fix-grammar"
  | "rewrite"
  | "translate";

export interface AIAction {
  type: AIActionType;
  /** Label pendek untuk ditampilkan di tombol / tooltip. */
  description: string;
  /** Instruksi yang dipakai sebagai prefix prompt ke Gemini. */
  prompt: string;
}

/**
 * Label UI untuk tiap quick action.
 *
 * Ada di sini, BUKAN di `gemini-client.ts`, karena file itu server-only —
 * mengimpornya dari komponen client akan menyeret API key ke bundle browser.
 * `AI_ACTIONS` di sana memegang PROMPT-nya (server); yang ini memegang
 * teks yang dilihat user (client). Keduanya dikunci ke `AIActionType` yang sama.
 */
export interface AIActionLabel {
  /** Teks pada tombol. */
  label: string;
  /** Kalimat penjelas untuk tooltip / teks pendukung. */
  description: string;
}

export const AI_ACTION_LABELS: Record<AIActionType, AIActionLabel> = {
  summarize: {
    label: "Ringkas",
    description: "Buat ringkasan singkat di panel chat, dokumen tidak diubah",
  },
  expand: {
    label: "Perluas",
    description: "Kembangkan isi dengan detail dan contoh tambahan",
  },
  shorten: {
    label: "Persingkat",
    description: "Padatkan kalimat yang bertele-tele tanpa mengubah makna",
  },
  "fix-grammar": {
    label: "Perbaiki Tata Bahasa",
    description: "Betulkan ejaan, tanda baca, dan tata bahasa",
  },
  rewrite: {
    label: "Tulis Ulang",
    description: "Ubah gaya bahasa jadi profesional dan formal",
  },
  translate: {
    label: "Terjemahkan",
    description: "Terjemahkan isi dokumen ke Bahasa Indonesia",
  },
};

// =============================================================================
// SECTION 5 — Edit operations
// =============================================================================

export type EditOperationType = "insert" | "replace" | "delete" | "format";

/** Formatting yang bisa diaplikasikan ke sebuah range teks. */
export interface TextFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Ukuran font dalam point (dikonversi ke half-point oleh editor core). */
  size?: number;
  /** Warna hex tanpa "#", mis. "FF0000". */
  color?: string;
}

/**
 * Satu perubahan yang diminta AI untuk diterapkan ke dokumen.
 *
 * Semua field opsional karena field yang dibutuhkan tergantung `type`:
 * - insert  -> `text` wajib; `index` opsional (default: akhir dokumen)
 * - replace -> `find` + `replace` wajib
 * - delete  -> `find` wajib
 * - format  -> `find` + `formatting` wajib
 *
 * `isValidEditOperation()` di bawah dipakai sebagai type guard sebelum edit
 * diterapkan oleh editor core.
 */
export interface EditOperation {
  type: EditOperationType;
  /** Index blok target (lihat `DocumentBlock.index`). */
  index?: number;
  /** Teks yang dicari (exact match, case-sensitive). */
  find?: string;
  /** Teks yang disisipkan (untuk `insert`). */
  text?: string;
  /** Teks pengganti (untuk `replace`). */
  replace?: string;
  formatting?: TextFormatting;
}

/**
 * Type guard: pastikan object dari Gemini benar-benar `EditOperation` yang
 * valid sebelum diterapkan ke dokumen. Model bisa saja mengembalikan argumen
 * yang tidak lengkap, jadi jangan pernah trust output-nya mentah-mentah.
 */
export function isValidEditOperation(value: unknown): value is EditOperation {
  if (typeof value !== "object" || value === null) return false;

  const op = value as Partial<EditOperation>;

  switch (op.type) {
    case "insert":
      return typeof op.text === "string" && op.text.length > 0;
    case "replace":
      return (
        typeof op.find === "string" &&
        op.find.length > 0 &&
        typeof op.replace === "string"
      );
    case "delete":
      return typeof op.find === "string" && op.find.length > 0;
    case "format":
      return (
        typeof op.find === "string" &&
        op.find.length > 0 &&
        typeof op.formatting === "object" &&
        op.formatting !== null
      );
    default:
      return false;
  }
}

/** Satu edit yang tidak berhasil diterapkan, beserta alasannya. */
export interface SkippedEdit {
  edit: EditOperation;
  reason: string;
}

/**
 * Ringkasan hasil penerapan satu batch edit.
 * `skipped` sengaja dikembalikan (bukan dilempar) supaya UI bisa bilang
 * "8 dari 10 perubahan diterapkan" alih-alih gagal total.
 */
export interface ApplyEditsResult {
  applied: number;
  skipped: SkippedEdit[];
}

// =============================================================================
// SECTION 6 — Gemini
// =============================================================================

/** Function call mentah yang dikembalikan Gemini sebelum divalidasi. */
export interface GeminiToolCall {
  /** Nama tool, mis. "replace_text". */
  name: string;
  /** Argumen dari model — `unknown` karena belum tervalidasi. */
  args: Record<string, unknown>;
}

/** Hasil olahan satu panggilan AI untuk mengedit dokumen. */
export interface GeminiResponse {
  /** Edit yang sudah lolos validasi dan siap diterapkan. */
  edits: EditOperation[];
  /** Penjelasan naratif dari AI untuk ditampilkan di chat. */
  summary?: string;
  /** Function call mentah — berguna untuk debugging/logging. */
  toolCalls: GeminiToolCall[];
  /** Pemakaian token, kalau dikembalikan oleh API. */
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

// =============================================================================
// SECTION 7 — API contracts (client <-> route handlers)
// =============================================================================

/**
 * Representasi buffer biner yang JSON-safe: string base64.
 *
 * `ArrayBuffer` hilang isinya saat `JSON.stringify`, jadi harus di-encode.
 * Spec menyebut `number[]`, tapi bentuk itu membengkakkan payload ~3,5-4x
 * (`"255,0,13,..."`), sementara base64 hanya 1,33x. Konversinya ada di
 * `buffer-utils.ts` dan jalan di browser maupun Node.
 */
export type SerializedBuffer = string;

/**
 * Body request ke `POST /api/ai-edit`.
 *
 * Endpoint ini melayani dua mode, dibedakan dari ada-tidaknya `action`:
 * - `action` terisi -> MODE EDIT. Menjalankan quick action dan mengembalikan
 *   `edits` untuk diterapkan ke dokumen.
 * - `action` kosong -> PESAN BEBAS. Arahnya ditentukan `mode`:
 *   `"chat"` (default) hanya menjawab; `"edit"` boleh menghasilkan `edits`.
 */
export interface AIEditRequest {
  /** Isi dokumen .docx sebagai string base64. */
  docBase64: SerializedBuffer;
  /** Quick action yang dipilih user. Kosongkan untuk pesan bebas. */
  action?: AIActionType;
  /**
   * Niat pesan bebas. Hanya dipakai kalau `action` kosong.
   * Default `"chat"` (read-only) — default yang aman kalau field ini hilang.
   */
  mode?: ChatMode;
  /** Pesan bebas dari user. Wajib di mode chat, opsional di mode edit. */
  userMessage?: string;
  /** Teks yang sedang di-select, kalau ada — mempersempit scope edit. */
  selectedText?: string;
  /** Riwayat chat untuk menjaga konteks percakapan. */
  history?: SerializedChatMessage[];
}

/** Response dari `POST /api/ai-edit`. */
export interface AIEditResponse {
  success: boolean;
  /** Perubahan yang siap diterapkan. Bisa terisi di kedua mode. */
  edits: EditOperation[];
  /** Teks jawaban AI untuk ditampilkan di panel chat — terisi di kedua mode. */
  summary?: string;
  usage?: TokenUsage;
  error?: string;
  /** Kode error stabil untuk penanganan di UI (lihat `AppErrorCode`). */
  errorCode?: AppErrorCode;
  /**
   * Sisa detik sebelum boleh mencoba lagi. Hanya terisi pada 429, dan nilainya
   * berasal dari Google — bukan tebakan kita. Dipakai UI untuk hitung mundur
   * dan menonaktifkan tombol selama itu.
   */
  retryAfterSeconds?: number;
}

/** Response dari `POST /api/upload-doc`. */
export interface UploadResponse {
  success: boolean;
  fileName: string;
  /** Isi .docx sebagai string base64; ada hanya kalau `success === true`. */
  docBase64?: SerializedBuffer;
  meta?: DocumentMeta;
  error?: string;
  errorCode?: AppErrorCode;
}

/** Response dari `GET /api/health`. */
export interface HealthResponse {
  status: "ok" | "degraded";
  /** `true` kalau GEMINI_API_KEY ter-set di server. */
  geminiConfigured: boolean;
  timestamp: string;
}

// =============================================================================
// SECTION 8 — Error handling
// =============================================================================

/**
 * Kode error stabil yang dipakai lintas layer.
 * UI memetakan kode ini ke pesan yang ramah user; jangan pernah menampilkan
 * pesan error mentah dari Gemini ke user (bisa membocorkan detail internal).
 */
export type AppErrorCode =
  | "INVALID_INPUT" // body request tidak sesuai kontrak
  | "FILE_TOO_LARGE" // melebihi MAX_FILE_SIZE_BYTES
  | "INVALID_FILE_TYPE" // bukan .docx
  | "PARSE_FAILED" // DOCX korup / tidak bisa dibaca
  | "MISSING_API_KEY" // GEMINI_API_KEY tidak ter-set
  | "AI_QUOTA_EXCEEDED" // kena rate limit free tier
  | "AI_MODEL_UNAVAILABLE" // model di GEMINI_MODEL dihapus / tidak bisa diakses
  | "AI_REQUEST_FAILED" // error lain dari Gemini
  | "AI_INVALID_RESPONSE" // model balas format yang tidak bisa dipakai
  | "EDIT_APPLY_FAILED" // gagal menerapkan edit ke editor
  | "UNKNOWN";

/**
 * Error terstruktur milik aplikasi.
 * Dilempar di server, lalu diserialisasi jadi `{ error, errorCode }` di response.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  /** HTTP status yang sesuai untuk error ini. */
  readonly status: number;
  /** Detail tambahan untuk log server-side — JANGAN dikirim ke client. */
  readonly details?: unknown;
  /** Sisa detik sebelum boleh mencoba lagi; hanya relevan untuk rate limit. */
  readonly retryAfterSeconds?: number;

  constructor(
    code: AppErrorCode,
    message: string,
    status = 500,
    details?: unknown,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;

    // Menjaga stack trace tetap rapi saat di-extend (V8).
    Error.captureStackTrace?.(this, AppError);
  }
}

/** Narrowing helper untuk `catch (err: unknown)`. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

// =============================================================================
// SECTION 9 — Konstanta bersama
// =============================================================================

/** Batas ukuran file untuk POC: 10 MB. */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** MIME type resmi untuk .docx (OOXML). */
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Batas jumlah karakter dokumen yang dikirim ke Gemini dalam satu request.
 * Gemini 2.5 Flash punya context window besar, tapi prompt yang terlalu panjang
 * memboroskan kuota free tier (1.500 req/hari) dan memperlambat respons.
 */
export const MAX_DOC_CHARS_FOR_AI = 60_000;
