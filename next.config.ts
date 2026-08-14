import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `mammoth` dan `docx` memakai API Node (Buffer, stream) dan tidak boleh
   * ikut di-bundle oleh compiler server — biarkan Node yang me-require-nya
   * langsung saat runtime.
   */
  serverExternalPackages: ["mammoth", "docx"],

  experimental: {
    /**
     * Matikan penerusan console browser ke terminal.
     *
     * Next 16 meneruskannya secara default (level "warn"), dan hasilnya log
     * dev penuh oleh error EKSTENSI browser — MetaMask paling sering — yang
     * tampil dengan prefiks `[browser] ⨯ unhandledRejection` sehingga mudah
     * disangka error aplikasi.
     *
     * Error client milik aplikasi sendiri tetap terlihat di DevTools Console.
     * Kalau sedang mengejar bug sisi client dan ingin log-nya masuk terminal,
     * ubah sementara ke `"error"` atau `true`.
     */
    browserDebugInfoInTerminal: false,
  },

  turbopack: {
    resolveAlias: {
      /**
       * `harfbuzzjs` (font shaper di balik editor DOCX) memanggil
       * `await import("module")` di dalam cabang khusus Node. Cabangnya tidak
       * pernah jalan di browser, tapi bundler tetap harus bisa me-resolve
       * import-nya — dan `module` adalah built-in Node yang tidak ada di sana.
       *
       * Alias ini HANYA berlaku untuk kondisi `browser`; build server tetap
       * memakai modul `module` yang asli.
       */
      module: { browser: "./src/stubs/node-module-browser.js" },
    },
  },
};

export default nextConfig;
