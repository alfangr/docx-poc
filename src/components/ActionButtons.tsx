"use client";

/**
 * ActionButtons.tsx
 * -----------------------------------------------------------------------------
 * Tombol quick action AI: Ringkas, Perbaiki Tata Bahasa, Perluas, Persingkat,
 * Tulis Ulang, Terjemahkan.
 *
 * Komponen ini murni presentasi — dia tidak memanggil AI sendiri, hanya
 * melaporkan aksi mana yang ditekan lewat `onAction`. Semua logikanya
 * (rate limit, request, penerapan edit) tinggal di `useAIChat`.
 *
 * Label diambil dari `AI_ACTION_LABELS` di `types.ts`, BUKAN dari `AI_ACTIONS`
 * di `gemini-client.ts`: file itu server-only dan mengimpornya dari sini akan
 * menyeret API key ke bundle browser.
 */

import { AI_ACTION_LABELS, type AIActionType } from "@/lib/types";
import { LoadingSpinner } from "./LoadingSpinner";

// =============================================================================
// Props
// =============================================================================

export interface ActionButtonsProps {
  /** Dipanggil saat sebuah aksi ditekan. */
  onAction: (action: AIActionType) => void;

  /** Nonaktifkan semua tombol (belum ada dokumen, kuota habis, dsb). */
  disabled?: boolean;

  /**
   * Aksi yang sedang berjalan. Tombolnya menampilkan spinner, dan seluruh
   * tombol lain ikut dinonaktifkan — satu request AI pada satu waktu.
   */
  activeAction?: AIActionType | null;

  /** Alasan tombol dinonaktifkan, ditampilkan sebagai teks bantuan. */
  disabledReason?: string;

  /** `grid` (default, untuk sidebar) atau `row` (untuk toolbar horizontal). */
  layout?: "grid" | "row";

  className?: string;
}

/** Urutan tampil. Aksi yang paling sering dipakai diletakkan lebih dulu. */
const ACTION_ORDER: readonly AIActionType[] = [
  "summarize",
  "fix-grammar",
  "expand",
  "shorten",
  "rewrite",
  "translate",
];

// =============================================================================
// Komponen
// =============================================================================

export function ActionButtons({
  onAction,
  disabled = false,
  activeAction = null,
  disabledReason,
  layout = "grid",
  className = "",
}: ActionButtonsProps) {
  // Satu request AI pada satu waktu: kuota free tier hanya 15/menit, dan dua
  // batch edit yang berjalan bersamaan bisa saling menimpa di dokumen.
  const isBusy = activeAction !== null;
  const allDisabled = disabled || isBusy;

  return (
    <div className={className}>
      <div
        className={
          layout === "grid"
            ? "grid grid-cols-2 gap-2"
            : "flex flex-wrap items-center gap-2"
        }
      >
        {ACTION_ORDER.map((action) => {
          const { label, description } = AI_ACTION_LABELS[action];
          const isActive = activeAction === action;

          return (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action)}
              disabled={allDisabled}
              // Judul tetap menjelaskan aksinya; alasan nonaktif ditambahkan
              // supaya user tahu KENAPA tombolnya mati, bukan sekadar mati.
              title={
                disabled && disabledReason
                  ? `${description} — ${disabledReason}`
                  : description
              }
              aria-busy={isActive}
              className="
                flex items-center gap-2 rounded-md border border-slate-200
                bg-white px-3 py-2 text-left text-sm font-medium text-slate-700
                transition-colors
                hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700
                focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-blue-500 focus-visible:ring-offset-1
                disabled:cursor-not-allowed disabled:border-slate-200
                disabled:bg-slate-50 disabled:text-slate-400
                disabled:hover:border-slate-200 disabled:hover:bg-slate-50
              "
            >
              <span className="shrink-0" aria-hidden="true">
                {isActive ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <ActionIcon action={action} />
                )}
              </span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {disabled && disabledReason && (
        <p className="mt-2 text-xs text-slate-400">{disabledReason}</p>
      )}
    </div>
  );
}

// =============================================================================
// Ikon
// =============================================================================

/**
 * Ikon per aksi. SVG inline, bukan library ikon: enam ikon tidak sebanding
 * dengan menambah satu dependency lagi ke bundle.
 *
 * Semuanya `aria-hidden` — label tekstual di sebelahnya yang membawa makna.
 */
function ActionIcon({ action }: { action: AIActionType }) {
  const common = {
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };

  switch (action) {
    case "summarize":
      // Baris teks yang memendek — merepresentasikan pemadatan isi.
      return (
        <svg {...common}>
          <path d="M4 6h16M4 11h11M4 16h6" />
        </svg>
      );

    case "expand":
      // Panah keluar dari titik pusat.
      return (
        <svg {...common}>
          <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
        </svg>
      );

    case "shorten":
      // Panah menuju pusat — kebalikan visual dari ikon "expand".
      return (
        <svg {...common}>
          <path d="M4 14h6v6" />
          <path d="M20 10h-6V4" />
          <path d="M14 10l7-7" />
          <path d="M3 21l7-7" />
        </svg>
      );

    case "fix-grammar":
      // Tanda centang di atas garis teks.
      return (
        <svg {...common}>
          <path d="M4 17h9M4 12h16M4 7h16" />
          <path d="M15.5 18.5l2 2 4-4" />
        </svg>
      );

    case "rewrite":
      // Pena.
      return (
        <svg {...common}>
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );

    case "translate":
      // Globe dengan garis lintang.
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
        </svg>
      );
  }
}

export default ActionButtons;
