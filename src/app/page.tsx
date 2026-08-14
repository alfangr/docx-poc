/**
 * page.tsx — Halaman depan
 * -----------------------------------------------------------------------------
 * Ringkasan fitur, status setup, dan pintu masuk ke editor.
 *
 * Ini SERVER COMPONENT, dan itu disengaja: `isGeminiConfigured()` hanya bisa
 * membaca `process.env.GEMINI_API_KEY` di server. Dengan begitu, status setup
 * sudah terlihat begitu halaman dibuka — bukan setelah user mengunggah dokumen,
 * menekan tombol AI, dan baru menemukan API key-nya belum diisi.
 */

import Link from "next/link";

import { isGeminiConfigured } from "@/lib/gemini-client";
import { AI_ACTION_LABELS, MAX_FILE_SIZE_BYTES } from "@/lib/types";

/** Status env dibaca per request, bukan dibekukan saat build. */
export const dynamic = "force-dynamic";

export default function HomePage() {
  const geminiReady = isGeminiConfigured();
  const maxFileMb = Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024);

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-4xl px-6 py-12">
        {/* --- Judul --- */}
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            DOCX Editor + AI
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600">
            Buka dokumen Word di browser, edit langsung, dan minta Gemini
            meringkas, merapikan, atau menerjemahkan isinya — perubahannya
            diterapkan ke dokumen, bukan cuma dijawab di chat.
          </p>
        </header>

        {/* --- Status setup --- */}
        <div className="mt-8">
          <SetupStatus ready={geminiReady} />
        </div>

        {/* --- Tombol utama --- */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/editor"
            className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Mulai Mengedit
          </Link>

          <Link
            href="/editor"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Upload Dokumen
          </Link>
        </div>

        {/* --- Aksi AI --- */}
        <section className="mt-14">
          <h2 className="text-lg font-semibold text-slate-900">Aksi AI</h2>
          <p className="mt-1 text-sm text-slate-500">
            Satu klik, dan perubahannya langsung masuk ke dokumen.
          </p>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(AI_ACTION_LABELS).map(([key, action]) => (
              <li
                key={key}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <h3 className="text-sm font-semibold text-slate-800">
                  {action.label}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {action.description}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* --- Cara kerja --- */}
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-slate-900">Cara kerjanya</h2>

          <ol className="mt-4 space-y-3">
            {[
              "Upload file .docx, atau buat dokumen kosong dari nol.",
              "Edit langsung di browser — editor WYSIWYG lengkap dengan toolbar.",
              "Pilih aksi AI, atau tanya apa saja tentang isi dokumen lewat chat.",
              "Perubahan dari AI diterapkan ke dokumen; kamu bisa lanjut mengedit.",
              "Unduh hasilnya sebagai .docx yang tetap terbaca Microsoft Word.",
            ].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                  {index + 1}
                </span>
                <span className="text-sm text-slate-600">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* --- Batasan --- */}
        <section className="mt-12 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Batasan free tier & POC
          </h2>

          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Limit label="Model" value="Gemini 2.5 Flash" />
            <Limit label="Kuota harian" value="1.500 permintaan" />
            <Limit label="Kuota per menit" value="15 permintaan" />
            <Limit label="Ukuran file maksimum" value={`${maxFileMb} MB`} />
            <Limit label="Biaya" value="Gratis, tanpa kartu kredit" />
            <Limit label="Penyimpanan" value="Sementara di browser" />
          </dl>

          <p className="mt-4 text-xs text-slate-500">
            Dokumen disimpan sementara di memori dan localStorage browser —
            tidak ada database. Menutup tab tanpa mengunduh berarti kehilangan
            perubahan, dan dokumen di atas 3 MB tidak dipulihkan setelah refresh.
          </p>
        </section>

        <footer className="mt-12 pb-6 text-center text-xs text-slate-400">
          Proof of concept · Next.js · Gemini 2.5 Flash
        </footer>
      </main>
    </div>
  );
}

// =============================================================================
// Bagian tampilan
// =============================================================================

function SetupStatus({ ready }: { ready: boolean }) {
  if (ready) {
    return (
      <div
        className="mx-auto flex max-w-2xl items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
        role="status"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
          aria-hidden="true"
        />
        <p className="text-sm text-emerald-800">
          Gemini API terkonfigurasi. Semua fitur AI siap dipakai.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
      role="alert"
    >
      <div className="flex items-center gap-3">
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-amber-900">
          GEMINI_API_KEY belum diatur — fitur AI nonaktif.
        </p>
      </div>

      <p className="mt-2 text-sm text-amber-800">
        Mengedit dan mengunduh dokumen tetap bisa. Untuk mengaktifkan AI, ambil
        API key gratis di{" "}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          // `noopener` mencegah halaman tujuan mengakses `window.opener`.
          rel="noopener noreferrer"
          className="font-medium underline hover:no-underline"
        >
          Google AI Studio
        </a>
        , simpan di <code className="font-mono text-xs">.env.local</code> sebagai{" "}
        <code className="font-mono text-xs">GEMINI_API_KEY</code>, lalu jalankan
        ulang dev server.
      </p>
    </div>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}
