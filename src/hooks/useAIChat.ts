"use client";

/**
 * useAIChat.ts
 * -----------------------------------------------------------------------------
 * State percakapan dengan AI: riwayat pesan, pemanggilan `/api/ai-edit`,
 * rate limiting sisi client, dan pelacakan pemakaian token.
 *
 * Dua mode, keduanya lewat endpoint yang sama:
 * - `executeAIAction(action)` -> MODE EDIT. AI mengembalikan `EditOperation[]`
 *   yang lalu diteruskan ke `onApplyEdits` untuk diterapkan ke dokumen.
 * - `sendMessage(text)`       -> MODE CHAT. AI hanya menjawab, dokumen utuh.
 *
 * Catatan penyimpangan dari spec:
 * - Spec menulis `useAIChat(docContent: string)`. Yang dikirim ke API justru
 *   BUFFER dokumen, bukan teksnya: ekstraksi teks butuh `mammoth` + `Buffer`
 *   yang server-only (lihat `docx-parser.ts`), jadi parsing terjadi di server.
 *   Hook ini menerima object options supaya `selectedText` dan callback
 *   penerapan edit ikut masuk tanpa mengubah signature lagi nanti.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { arrayBufferToBase64 } from "@/lib/buffer-utils";

import { AI_ACTION_LABELS } from "@/lib/types";
import type {
  AIActionType,
  ApplyEditsResult,
  AIEditRequest,
  AIEditResponse,
  AppErrorCode,
  ChatMessage,
  ChatMode,
  EditOperation,
  SerializedChatMessage,
  TokenUsage,
} from "@/lib/types";

// =============================================================================
// Konstanta
// =============================================================================

/**
 * Rate limit sisi client, mencerminkan batas Gemini free tier (15 req/menit).
 * Diblokir di sini supaya user dapat pesan yang jelas, bukan error 429 mentah
 * setelah menunggu round trip.
 */
const RATE_LIMIT_MAX_REQUESTS = 15;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Jumlah pesan riwayat yang ikut dikirim sebagai konteks percakapan. */
const HISTORY_LIMIT = 10;

// =============================================================================
// Tipe
// =============================================================================

export interface UseAIChatOptions {
  /**
   * Mengambil isi dokumen TERKINI, dipanggil tepat sebelum request dikirim.
   *
   * Sengaja berupa fungsi, bukan nilai: `DocxEditorViewer` men-debounce
   * `editor.save()` selama 800ms, jadi buffer yang tersimpan di state bisa
   * tertinggal dari apa yang ada di layar. Mengirim teks basi ke AI berarti
   * string `find` yang dihasilkannya tidak cocok dengan dokumen hidup, dan
   * SELURUH edit dilewati diam-diam. Pemanggil harus mengembalikan hasil
   * `editor.save()` di sini, bukan salinan dari state.
   *
   * Kembalikan `null` kalau belum ada dokumen.
   */
  getDocBuffer: () => ArrayBuffer | null | Promise<ArrayBuffer | null>;
  /** Teks yang sedang di-select user, dipakai untuk mempersempit scope edit. */
  selectedText?: string | null;
  /**
   * Dipanggil dengan edit hasil AI. Pemanggil (halaman editor) yang punya
   * instance editor, jadi penerapan edit dilakukan di sana lewat
   * `applyEditsWithCore()`.
   */
  onApplyEdits?: (edits: EditOperation[]) => Promise<ApplyEditsResult>;
}

export interface UseAIChatResult {
  messages: ChatMessage[];
  isLoading: boolean;
  /** Quick action yang sedang berjalan, atau `null` (idle / mode chat). */
  activeAction: AIActionType | null;
  error: string | null;
  /** Total token terpakai sepanjang sesi ini. */
  totalUsage: TokenUsage;
  /** Sisa jatah request dalam jendela 1 menit terakhir. */
  remainingRequests: number;
  /**
   * Sisa detik sebelum boleh mencoba lagi setelah kena rate limit Gemini.
   * `0` = boleh mengirim. Angkanya dari Google, bukan tebakan.
   */
  retryAfterSeconds: number;

  /** @param mode "chat" hanya bertanya, "edit" boleh mengubah dokumen. */
  sendMessage: (text: string, mode: ChatMode) => Promise<void>;
  executeAIAction: (action: AIActionType) => Promise<void>;
  clearChat: () => void;
  retryLastMessage: () => Promise<void>;
  dismissError: () => void;
}

/** Permintaan terakhir, disimpan supaya `retryLastMessage()` bisa mengulanginya. */
type LastRequest =
  | { kind: "chat"; text: string; mode: ChatMode }
  | { kind: "action"; action: AIActionType };

// =============================================================================
// Hook
// =============================================================================

export function useAIChat(options: UseAIChatOptions): UseAIChatResult {
  /**
   * Cermin options terbaru. Tanpa ini, `runRequest` dibuat ulang setiap kali
   * seleksi berubah — dan bersamanya `sendMessage`/`executeAIAction`, yang
   * membuat sidebar render ulang pada setiap gerakan kursor di editor.
   *
   * Aman dibaca di dalam handler: handler hanya berjalan setelah commit,
   * jadi ref-nya selalu sudah terisi.
   */
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<AIActionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalUsage, setTotalUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const [remainingRequests, setRemainingRequests] = useState(
    RATE_LIMIT_MAX_REQUESTS,
  );
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);

  /** Timestamp request dalam jendela rate limit berjalan. */
  const requestTimes = useRef<number[]>([]);
  const lastRequest = useRef<LastRequest | null>(null);
  const abortController = useRef<AbortController | null>(null);

  /**
   * Cermin `messages` untuk dibaca di dalam callback tanpa menjadikannya
   * dependency — supaya `sendMessage` tidak dibuat ulang tiap ada pesan baru.
   */
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Batalkan request yang masih jalan saat komponen unmount.
  useEffect(() => {
    return () => abortController.current?.abort();
  }, []);

  /**
   * Hitung mundur setelah kena rate limit.
   *
   * Menampilkan angka yang berkurang jauh lebih baik daripada "coba lagi
   * nanti": user tahu persis kapan boleh menekan tombol, dan tidak menghabiskan
   * kuota dengan percobaan yang pasti ditolak.
   */
  useEffect(() => {
    if (retryAfterSeconds <= 0) return;

    const timer = setInterval(() => {
      setRetryAfterSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);

    return () => clearInterval(timer);
  }, [retryAfterSeconds]);

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  /**
   * Sliding window: buang timestamp yang sudah lewat 60 detik, lalu cek sisa
   * jatah. Mengembalikan detik yang harus ditunggu, atau `0` kalau boleh jalan.
   */
  const checkRateLimit = useCallback((): number => {
    const now = Date.now();
    requestTimes.current = requestTimes.current.filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );

    const used = requestTimes.current.length;
    setRemainingRequests(Math.max(0, RATE_LIMIT_MAX_REQUESTS - used));

    if (used < RATE_LIMIT_MAX_REQUESTS) return 0;

    const oldest = requestTimes.current[0] ?? now;
    return Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000);
  }, []);

  // ---------------------------------------------------------------------------
  // Inti pemanggilan API
  // ---------------------------------------------------------------------------

  const runRequest = useCallback(
    async (request: LastRequest): Promise<void> => {
      setError(null);

      const { getDocBuffer, selectedText, onApplyEdits } = optionsRef.current;

      // Diambil dari editor hidup, bukan dari state — lihat catatan di
      // `UseAIChatOptions.getDocBuffer`.
      let docBuffer: ArrayBuffer | null;
      try {
        docBuffer = await getDocBuffer();
      } catch (err) {
        console.error("[useAIChat] Gagal membaca dokumen dari editor:", err);
        setError("Tidak bisa membaca isi dokumen dari editor. Coba lagi.");
        return;
      }

      if (!docBuffer) {
        setError("Belum ada dokumen. Upload atau buat dokumen dulu.");
        return;
      }

      if (retryAfterSeconds > 0) {
        setError(
          `Kuota Gemini masih penuh. Tunggu ${retryAfterSeconds} detik lagi.`,
        );
        return;
      }

      const waitSeconds = checkRateLimit();
      if (waitSeconds > 0) {
        setError(
          `Batas ${RATE_LIMIT_MAX_REQUESTS} permintaan per menit tercapai. Tunggu ${waitSeconds} detik lagi.`,
        );
        return;
      }

      lastRequest.current = request;

      // Batalkan request sebelumnya kalau user menembak dua kali beruntun.
      abortController.current?.abort();
      const controller = new AbortController();
      abortController.current = controller;

      const userText =
        request.kind === "chat"
          ? request.text
          : `Jalankan aksi: ${AI_ACTION_LABELS[request.action].label}`;

      const userMessage = createMessage("user", userText);
      const pendingMessage = createMessage("assistant", "", { pending: true });

      setMessages((prev) => [...prev, userMessage, pendingMessage]);
      setIsLoading(true);
      setActiveAction(request.kind === "action" ? request.action : null);
      requestTimes.current.push(Date.now());
      setRemainingRequests(
        Math.max(0, RATE_LIMIT_MAX_REQUESTS - requestTimes.current.length),
      );

      try {
        const body: AIEditRequest = {
          docBase64: arrayBufferToBase64(docBuffer),
          ...(request.kind === "action" ? { action: request.action } : {}),
          ...(request.kind === "chat"
            ? { userMessage: request.text, mode: request.mode }
            : {}),
          ...(selectedText ? { selectedText } : {}),
          history: serializeHistory(messagesRef.current),
        };

        const response = await fetch("/api/ai-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const result = (await response.json()) as AIEditResponse;

        if (!response.ok || !result.success) {
          // Kunci tombol selama jendela tunggu yang diberikan Google.
          if (result.retryAfterSeconds && result.retryAfterSeconds > 0) {
            setRetryAfterSeconds(result.retryAfterSeconds);
          }

          const message = friendlyError(result.errorCode, result.error);
          setError(message);
          replaceMessage(setMessages, pendingMessage.id, {
            content: message,
            pending: false,
            error: message,
          });
          return;
        }

        if (result.usage) {
          setTotalUsage((prev) => addUsage(prev, result.usage!));
        }

        // Rakit balasan: teks dari AI, lalu catatan hasil penerapan edit.
        const parts: string[] = [];
        if (result.summary) parts.push(result.summary);

        if (result.edits.length > 0) {
          if (onApplyEdits) {
            try {
              const applied = await onApplyEdits(result.edits);
              parts.push(formatApplyResult(applied, result.edits.length));
            } catch (err) {
              console.error("[useAIChat] Gagal menerapkan edit:", err);
              parts.push(
                "⚠️ AI menghasilkan perubahan, tapi gagal diterapkan ke dokumen.",
              );
            }
          } else {
            // Tidak ada handler — jangan diam-diam membuang hasil kerja AI.
            parts.push(
              `⚠️ ${result.edits.length} perubahan dihasilkan tapi editor belum siap menerimanya.`,
            );
          }
        }

        replaceMessage(setMessages, pendingMessage.id, {
          content: parts.join("\n\n") || "Tidak ada perubahan yang perlu dilakukan.",
          pending: false,
        });
      } catch (err) {
        // Abort itu disengaja (unmount / request baru), bukan kondisi error.
        if (err instanceof DOMException && err.name === "AbortError") {
          removeMessage(setMessages, pendingMessage.id);
          return;
        }

        console.error("[useAIChat] Request gagal:", err);
        const message =
          "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.";
        setError(message);
        replaceMessage(setMessages, pendingMessage.id, {
          content: message,
          pending: false,
          error: message,
        });
      } finally {
        // Jangan matikan loading kalau sudah ada request lain yang berjalan.
        if (abortController.current === controller) {
          abortController.current = null;
          setIsLoading(false);
          setActiveAction(null);
        }
      }
    },
    // `optionsRef` menjaga identitas fungsi ini tetap stabil sepanjang sesi.
    [checkRateLimit, retryAfterSeconds],
  );

  // ---------------------------------------------------------------------------
  // Aksi publik
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string, mode: ChatMode) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      await runRequest({ kind: "chat", text: trimmed, mode });
    },
    [runRequest],
  );

  const executeAIAction = useCallback(
    async (action: AIActionType) => {
      await runRequest({ kind: "action", action });
    },
    [runRequest],
  );

  const retryLastMessage = useCallback(async () => {
    const previous = lastRequest.current;
    if (!previous) {
      setError("Belum ada permintaan yang bisa diulang.");
      return;
    }

    // Buang pasangan pesan yang gagal supaya tidak menumpuk di riwayat.
    setMessages((prev) => {
      const lastError = findLastIndex(prev, (m) => Boolean(m.error));
      if (lastError === -1) return prev;
      // Hapus pesan error beserta pesan user yang memicunya.
      const start = lastError > 0 ? lastError - 1 : lastError;
      return [...prev.slice(0, start), ...prev.slice(lastError + 1)];
    });

    await runRequest(previous);
  }, [runRequest]);

  const clearChat = useCallback(() => {
    abortController.current?.abort();
    abortController.current = null;
    lastRequest.current = null;
    setMessages([]);
    setError(null);
    setIsLoading(false);
    setActiveAction(null);
    setRetryAfterSeconds(0);
    setTotalUsage(EMPTY_USAGE);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return {
    messages,
    isLoading,
    activeAction,
    error,
    totalUsage,
    remainingRequests,
    retryAfterSeconds,
    sendMessage,
    executeAIAction,
    clearChat,
    retryLastMessage,
    dismissError,
  };
}

// =============================================================================
// Helper
// =============================================================================

const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  responseTokens: 0,
  totalTokens: 0,
};

function createMessage(
  role: ChatMessage["role"],
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: generateId(),
    role,
    content,
    timestamp: new Date(),
    ...extra,
  };
}

/**
 * `crypto.randomUUID()` hanya tersedia di secure context (HTTPS/localhost).
 * Fallback-nya cukup untuk membedakan pesan dalam satu sesi.
 */
function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function replaceMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  id: string,
  patch: Partial<ChatMessage>,
): void {
  setMessages((prev) =>
    prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  );
}

function removeMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  id: string,
): void {
  setMessages((prev) => prev.filter((m) => m.id !== id));
}

/**
 * Siapkan riwayat untuk dikirim ke server: buang pesan pending/gagal,
 * ubah `Date` jadi ISO string, dan batasi jumlahnya demi hemat token.
 */
function serializeHistory(
  messages: readonly ChatMessage[],
): SerializedChatMessage[] {
  return messages
    .filter((m) => !m.pending && !m.error && m.content.trim().length > 0)
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }));
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    responseTokens: a.responseTokens + b.responseTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** Kalimat status setelah edit diterapkan ke dokumen. */
function formatApplyResult(
  result: ApplyEditsResult,
  requested: number,
): string {
  if (result.skipped.length === 0) {
    return `✅ ${result.applied} perubahan diterapkan ke dokumen.`;
  }

  const reasons = result.skipped
    .slice(0, 3)
    .map((s) => `• ${s.reason}`)
    .join("\n");
  const more =
    result.skipped.length > 3
      ? `\n• …dan ${result.skipped.length - 3} lainnya`
      : "";

  return (
    `⚠️ ${result.applied} dari ${requested} perubahan diterapkan. ` +
    `${result.skipped.length} dilewati:\n${reasons}${more}`
  );
}

/**
 * Ubah kode error dari server jadi kalimat yang bisa ditindaklanjuti user.
 * Pesan mentah dari server dipakai sebagai cadangan terakhir.
 */
function friendlyError(code?: AppErrorCode, fallback?: string): string {
  switch (code) {
    case "MISSING_API_KEY":
      return "GEMINI_API_KEY belum diatur di server. Cek file .env.local.";
    case "AI_MODEL_UNAVAILABLE":
      return (
        fallback ??
        "Model AI yang dikonfigurasi tidak tersedia. Setel GEMINI_MODEL di .env.local ke model yang masih aktif."
      );
    case "AI_QUOTA_EXCEEDED":
      // Pesan dari server sudah memuat sisa waktu tunggu dari Google —
      // jauh lebih berguna daripada tebakan "satu menit".
      return fallback ?? "Kuota Gemini free tier tercapai. Coba lagi sebentar.";
    case "AI_INVALID_RESPONSE":
      return "AI tidak memberikan perubahan yang bisa diterapkan. Coba perjelas instruksinya.";
    case "FILE_TOO_LARGE":
      return "Dokumen terlalu besar untuk diproses AI.";
    case "PARSE_FAILED":
      return "Isi dokumen tidak bisa dibaca. Pastikan file .docx tidak korup.";
    case "INVALID_INPUT":
      return fallback ?? "Permintaan tidak valid.";
    default:
      return fallback ?? "Terjadi kesalahan saat memproses permintaan AI.";
  }
}

/** `Array.prototype.findLastIndex` baru ada di ES2023; ini versi portabelnya. */
function findLastIndex<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return i;
  }
  return -1;
}
