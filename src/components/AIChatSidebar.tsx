"use client";

/**
 * AIChatSidebar.tsx
 * -----------------------------------------------------------------------------
 * Panel AI di sisi kanan editor: quick action, riwayat percakapan, input pesan,
 * banner error, dan status kuota.
 *
 * Komponen ini TIDAK memegang state percakapan — semuanya datang lewat props
 * dari `useAIChat`. Bentuk props-nya sengaja dibuat mencerminkan return hook
 * itu, jadi halaman editor bisa menyambungkannya nyaris satu-satu.
 *
 * Satu-satunya state lokal di sini adalah urusan tampilan: isi kotak input dan
 * apakah user sedang menggulir ke atas membaca pesan lama.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { ActionButtons } from "./ActionButtons";
import { LoadingSpinner, TypingIndicator } from "./LoadingSpinner";
import type {
  AIActionType,
  ChatMessage,
  ChatMode,
  TokenUsage,
} from "@/lib/types";

// =============================================================================
// Konstanta
// =============================================================================

/**
 * Jarak dari dasar (px) yang masih dianggap "sedang di bawah".
 * Selama dalam ambang ini, pesan baru menggulir otomatis; di luar itu user
 * dianggap sedang membaca ke atas dan tidak boleh diseret turun.
 */
const AUTOSCROLL_THRESHOLD_PX = 80;

/** Batas panjang pesan, disamakan dengan batas di `gemini-client.ts`. */
const MAX_MESSAGE_LENGTH = 4_000;

// =============================================================================
// Props
// =============================================================================

export interface AIChatSidebarProps {
  messages: ChatMessage[];
  isLoading: boolean;
  activeAction: AIActionType | null;
  error: string | null;
  totalUsage: TokenUsage;
  remainingRequests: number;
  /** Sisa detik sebelum boleh mencoba lagi; `0` = bebas. */
  retryAfterSeconds: number;

  /** `false` = belum ada dokumen; semua aksi AI dinonaktifkan. */
  hasDocument: boolean;
  /** Teks yang sedang di-select di editor, ditampilkan sebagai penanda scope. */
  selectedText?: string | null;

  onSendMessage: (text: string, mode: ChatMode) => void;
  onExecuteAction: (action: AIActionType) => void;
  onClearChat: () => void;
  onRetry: () => void;
  onDismissError: () => void;

  className?: string;
}

// =============================================================================
// Komponen
// =============================================================================

export function AIChatSidebar({
  messages,
  isLoading,
  activeAction,
  error,
  totalUsage,
  remainingRequests,
  retryAfterSeconds,
  hasDocument,
  selectedText,
  onSendMessage,
  onExecuteAction,
  onClearChat,
  onRetry,
  onDismissError,
  className = "",
}: AIChatSidebarProps) {
  const [draft, setDraft] = useState("");

  /**
   * Default `"chat"` (read-only). Kalau user lupa mengganti mode, hasil
   * terburuknya cuma jawaban teks — bukan dokumen yang berubah tanpa diminta.
   */
  const [mode, setMode] = useState<ChatMode>("chat");
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * Apakah user sedang menempel di dasar daftar. Disimpan di ref, bukan state:
   * nilainya dibaca di dalam effect dan handler scroll, dan menjadikannya state
   * akan memicu render ulang pada setiap piksel gulir.
   */
  const isPinnedToBottom = useRef(true);

  // Terkunci juga selama hitung mundur: menekan tombol saat kuota masih penuh
  // hanya menghasilkan error yang sama sekali lagi.
  const isRateLimited = retryAfterSeconds > 0;
  const canSubmit = hasDocument && !isLoading && !isRateLimited;

  // ---------------------------------------------------------------------------
  // Auto-scroll
  // ---------------------------------------------------------------------------

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isPinnedToBottom.current = distanceFromBottom <= AUTOSCROLL_THRESHOLD_PX;
  }, []);

  /**
   * `useLayoutEffect`, bukan `useEffect`: gulir dijalankan sebelum browser
   * melukis, jadi pesan baru tidak sempat terlihat "melompat".
   *
   * Guard `isPinnedToBottom` penting — menyeret user turun saat dia sedang
   * membaca pesan lama adalah salah satu gangguan paling menjengkelkan di UI chat.
   */
  useLayoutEffect(() => {
    if (!isPinnedToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || !canSubmit) return;

    onSendMessage(text, mode);
    setDraft("");
  }, [draft, canSubmit, mode, onSendMessage]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter mengirim, Shift+Enter menambah baris — konvensi yang sudah
      // dikenal user dari aplikasi chat lain.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  // Bersihkan draft saat dokumen ditutup, supaya pesan tidak "nyangkut"
  // dan terkirim ke dokumen berikutnya.
  useEffect(() => {
    if (!hasDocument) setDraft("");
  }, [hasDocument]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <aside
      className={`flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}
      aria-label="Asisten AI"
    >
      {/* --- Header --- */}
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Asisten AI</h2>
          {isLoading && <LoadingSpinner size="sm" />}
        </div>

        <button
          type="button"
          onClick={onClearChat}
          disabled={messages.length === 0}
          className="
            rounded px-2 py-1 text-xs text-slate-500 transition-colors
            hover:bg-slate-100 hover:text-slate-700
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
            disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent
          "
        >
          Bersihkan
        </button>
      </header>

      {/* --- Quick actions --- */}
      <div className="border-b border-slate-200 p-3">
        <ActionButtons
          onAction={onExecuteAction}
          disabled={!canSubmit}
          activeAction={activeAction}
          disabledReason={
            !hasDocument
              ? "Buka dokumen dulu untuk memakai aksi AI."
              : isRateLimited
                ? `Kuota Gemini penuh — tersedia lagi dalam ${retryAfterSeconds} detik.`
                : undefined
          }
        />

        {selectedText && (
          <div className="mt-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5">
            <p className="text-xs font-medium text-blue-800">
              Aksi berlaku untuk teks terpilih
            </p>
            <p className="mt-0.5 truncate text-xs text-blue-600" title={selectedText}>
              “{selectedText}”
            </p>
          </div>
        )}
      </div>

      {/* --- Riwayat pesan --- */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-3 overflow-y-auto p-3"
        // `log` + `polite`: pesan baru diumumkan screen reader tanpa memotong
        // apa pun yang sedang dibacakan.
        role="log"
        aria-live="polite"
        aria-label="Riwayat percakapan"
      >
        {messages.length === 0 ? (
          <ChatEmptyState hasDocument={hasDocument} />
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} onRetry={onRetry} />
          ))
        )}
      </div>

      {/* --- Banner error --- */}
      {error && (
        <div
          className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-3 py-2"
          role="alert"
        >
          <p className="flex-1 text-xs text-red-700">{error}</p>

          <button
            type="button"
            onClick={onRetry}
            disabled={isRateLimited}
            className="
              shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-red-700
              hover:bg-red-100
              disabled:cursor-not-allowed disabled:text-red-300 disabled:hover:bg-transparent
            "
          >
            {isRateLimited ? `Tunggu ${retryAfterSeconds}s` : "Coba lagi"}
          </button>

          <button
            type="button"
            onClick={onDismissError}
            aria-label="Tutup pesan error"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* --- Input --- */}
      <div className="border-t border-slate-200 p-3">
        {/* Pemilih mode. Menentukan apakah tool editing dipasang di server —
            di mode "Tanya", AI secara teknis tidak punya cara mengubah apa pun. */}
        <div className="mb-2">
          <label htmlFor="chat-mode" className="sr-only">
            Mode pesan
          </label>

          <select
            id="chat-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as ChatMode)}
            disabled={!canSubmit}
            className="
              w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs
              font-medium text-slate-700
              focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400
              disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400
            "
          >
            <option value="chat">Tanya — AI hanya membaca dokumen</option>
            <option value="edit">Ubah — AI mengedit dokumen</option>
          </select>

          {/* Peringatan hanya muncul di mode yang MENGUBAH sesuatu. Di mode
              baca, label option-nya sudah cukup menjelaskan. */}
          {mode === "edit" && (
            <p className="mt-1 text-xs text-amber-700">
              Perubahan langsung diterapkan ke dokumen.
            </p>
          )}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            onKeyDown={handleKeyDown}
            disabled={!canSubmit}
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={
              isRateLimited
                ? `Kuota Gemini penuh — tunggu ${retryAfterSeconds} detik`
                : !hasDocument
                ? "Buka dokumen dulu untuk mulai"
                : mode === "edit"
                  ? "Contoh: ganti \"18 persen\" jadi \"20 persen\""
                  : "Tanya apa saja tentang dokumen ini…"
            }
            aria-label={
              mode === "edit"
                ? "Instruksi perubahan untuk asisten AI"
                : "Pertanyaan untuk asisten AI"
            }
            className="
              flex-1 resize-none rounded-md border border-slate-200 px-3 py-2 text-sm
              placeholder:text-slate-400
              focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400
              disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400
            "
          />

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || draft.trim().length === 0}
            className="
              shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white
              transition-colors hover:bg-blue-700
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
              focus-visible:ring-offset-1
              disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400
            "
          >
            {mode === "edit" ? "Ubah" : "Kirim"}
          </button>
        </div>

        <QuotaFooter
          totalUsage={totalUsage}
          remainingRequests={remainingRequests}
          retryAfterSeconds={retryAfterSeconds}
        />
      </div>
    </aside>
  );
}

// =============================================================================
// Bagian tampilan
// =============================================================================

function MessageBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry: () => void;
}) {
  const isUser = message.role === "user";

  if (message.pending) {
    return (
      <div className="flex justify-start">
        <div className="rounded-lg bg-slate-100 px-3 py-2">
          <TypingIndicator />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`
          max-w-[85%] rounded-lg px-3 py-2 text-sm
          ${
            isUser
              ? "bg-blue-600 text-white"
              : message.error
                ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                : "bg-slate-100 text-slate-800"
          }
        `}
      >
        {/* `whitespace-pre-wrap`: balasan AI mengandung newline yang bermakna
            (daftar perubahan, poin-poin) dan harus dipertahankan. */}
        <p className="whitespace-pre-wrap break-words">
          {renderBold(message.content)}
        </p>

        {message.error && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1.5 text-xs font-medium text-red-700 underline hover:no-underline"
          >
            Coba lagi
          </button>
        )}

        <time
          dateTime={message.timestamp.toISOString()}
          className={`mt-1 block text-[10px] ${
            isUser ? "text-blue-200" : "text-slate-400"
          }`}
          // Format jam bergantung locale browser, jadi hasil render server
          // dan client bisa berbeda.
          suppressHydrationWarning
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
    </div>
  );
}

/**
 * Render `**tebal**` sebagai teks tebal sungguhan.
 *
 * Gemini memakai markdown di balasannya tanpa diminta, dan tanpa ini bintangnya
 * tampil mentah di gelembung chat. Sengaja HANYA menangani bold: memasang
 * parser markdown penuh berarti menambah dependency dan permukaan XSS, untuk
 * satu-satunya sintaks yang benar-benar sering muncul.
 *
 * Aman dari injeksi: hasilnya berupa React node, bukan HTML mentah — tidak ada
 * `dangerouslySetInnerHTML` di mana pun.
 */
function renderBold(text: string): ReactNode[] {
  // Bagian dengan index ganjil adalah isi di antara sepasang `**`.
  return text.split(/\*\*(.+?)\*\*/gs).map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

function ChatEmptyState({ hasDocument }: { hasDocument: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm font-medium text-slate-500">
        {hasDocument ? "Mulai percakapan" : "Belum ada dokumen"}
      </p>
      <p className="text-xs text-slate-400">
        {hasDocument
          ? "Pakai tombol aksi di atas, atau tanyakan apa pun tentang isi dokumen."
          : "Upload atau buat dokumen untuk mulai memakai asisten AI."}
      </p>
    </div>
  );
}

function QuotaFooter({
  totalUsage,
  remainingRequests,
  retryAfterSeconds,
}: {
  totalUsage: TokenUsage;
  remainingRequests: number;
  retryAfterSeconds: number;
}) {
  // Diberi peringatan lebih awal, sebelum kuota benar-benar habis.
  const isLow = remainingRequests <= 3;

  return (
    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
      <span>
        {retryAfterSeconds > 0
          ? `Menunggu kuota Gemini · ${retryAfterSeconds} detik`
          : "Enter kirim · Shift+Enter baris baru"}
      </span>

      <span className="flex items-center gap-2">
        {totalUsage.totalTokens > 0 && (
          <span title="Total token terpakai di sesi ini">
            {totalUsage.totalTokens.toLocaleString("id-ID")} token
          </span>
        )}
        <span
          className={isLow ? "font-medium text-amber-600" : undefined}
          title="Sisa permintaan dalam 1 menit terakhir (batas free tier: 15/menit)"
        >
          {remainingRequests}/15
        </span>
      </span>
    </div>
  );
}

export default AIChatSidebar;
