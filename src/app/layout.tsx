/**
 * layout.tsx — Root layout
 * -----------------------------------------------------------------------------
 * Kerangka HTML untuk semua halaman.
 *
 * Sengaja tipis: halaman editor butuh tinggi penuh viewport tanpa header atau
 * footer global yang memakan ruang, jadi navigasi ditangani masing-masing
 * halaman. Layout ini hanya mengurus metadata, font, dan style global.
 *
 * Server Component (tanpa "use client") — tidak ada state maupun interaksi,
 * jadi tidak ada alasan mengirimnya ke browser.
 */

import type { Metadata, Viewport } from "next";

import "@/styles/globals.css";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "DOCX Editor AI POC";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Edit dokumen DOCX di browser dengan bantuan AI Gemini: ringkas, perluas, perbaiki tata bahasa, tulis ulang, dan terjemahkan.",
  // POC dengan data dokumen milik user — jangan sampai terindeks mesin pencari.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom TIDAK dikunci: mengunci zoom memblokir pembesaran teks bagi
  // pengguna dengan gangguan penglihatan.
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
