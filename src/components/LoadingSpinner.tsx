/**
 * LoadingSpinner.tsx
 * -----------------------------------------------------------------------------
 * Indikator loading yang dipakai di seluruh aplikasi.
 *
 * Tiga bentuk, untuk tiga situasi berbeda:
 *   <LoadingSpinner />     - spinner biasa; tombol dan area konten
 *   <LoadingOverlay />     - menutupi area induknya; blokir interaksi saat proses
 *   <TypingIndicator />    - titik berdenyut; balasan AI yang sedang ditunggu
 *
 * Semuanya Server Component (tidak ada "use client"): murni presentasi, tanpa
 * state maupun event handler, jadi tidak perlu ikut ke bundle client.
 *
 * AKSESIBILITAS: animasi saja tidak cukup — screen reader tidak "melihat"
 * spinner berputar. Karena itu setiap varian punya `role="status"` dan teks
 * yang hanya terbaca screen reader, supaya statusnya benar-benar diumumkan.
 */

// =============================================================================
// LoadingSpinner
// =============================================================================

export type SpinnerSize = "sm" | "md" | "lg";

export interface LoadingSpinnerProps {
  size?: SpinnerSize;
  /** Teks di samping spinner. Kalau kosong, tetap dibacakan screen reader. */
  label?: string;
  /** Tampilkan `label` secara visual, bukan hanya untuk screen reader. */
  showLabel?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
};

export function LoadingSpinner({
  size = "md",
  label = "Memuat…",
  showLabel = false,
  className = "",
}: LoadingSpinnerProps) {
  return (
    <div
      className={`inline-flex items-center gap-2 ${className}`}
      role="status"
      // `polite`: jangan potong apa pun yang sedang dibacakan screen reader.
      aria-live="polite"
    >
      <span
        className={`
          ${SIZE_CLASSES[size]}
          animate-spin rounded-full
          border-slate-200 border-t-blue-600
          motion-reduce:animate-none
        `}
        // Bentuknya murni dekoratif; teks di bawah yang membawa maknanya.
        aria-hidden="true"
      />

      {showLabel ? (
        <span className="text-sm text-slate-600">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}

// =============================================================================
// LoadingOverlay
// =============================================================================

export interface LoadingOverlayProps {
  label?: string;
  /**
   * `true` untuk menutupi seluruh viewport, bukan hanya elemen induk.
   * Untuk mode non-fullscreen, induknya harus `position: relative`.
   */
  fullScreen?: boolean;
  className?: string;
}

/**
 * Menutupi area induknya selama proses berjalan.
 *
 * Latar semi-transparan sengaja dipakai supaya konten di baliknya masih terlihat
 * — user tetap tahu di mana dia berada. Backdrop-nya juga menangkap klik,
 * sehingga tombol di bawahnya tidak bisa ditekan dua kali saat proses berjalan.
 */
export function LoadingOverlay({
  label = "Memproses…",
  fullScreen = false,
  className = "",
}: LoadingOverlayProps) {
  return (
    <div
      className={`
        ${fullScreen ? "fixed" : "absolute"} inset-0 z-50
        flex items-center justify-center
        bg-white/70 backdrop-blur-[1px]
        ${className}
      `}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-6 py-4 shadow-lg ring-1 ring-slate-200">
        <LoadingSpinner size="lg" label={label} />
        <p className="text-sm font-medium text-slate-700">{label}</p>
      </div>
    </div>
  );
}

// =============================================================================
// TypingIndicator
// =============================================================================

export interface TypingIndicatorProps {
  label?: string;
  className?: string;
}

/**
 * Tiga titik berdenyut untuk pesan AI yang sedang ditunggu.
 *
 * Delay animasi tiap titik dibedakan lewat inline style, bukan class Tailwind:
 * Tailwind hanya menghasilkan class untuk nilai yang benar-benar ditulis di
 * source, jadi delay arbitrer lebih aman ditulis langsung seperti ini.
 */
export function TypingIndicator({
  label = "AI sedang mengetik…",
  className = "",
}: TypingIndicatorProps) {
  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      role="status"
      aria-live="polite"
    >
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
          aria-hidden="true"
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default LoadingSpinner;
