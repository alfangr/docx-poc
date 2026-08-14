/**
 * Stub browser untuk modul built-in Node `module`.
 *
 * `harfbuzzjs` — font shaper yang dipakai engine @docx-editor.dev — memuat
 * `createRequire` lewat `await import("module")`, di balik guard `IS_NODE`:
 *
 *     if (IS_NODE) { const { createRequire } = await import("module"); ... }
 *
 * Di browser cabang itu tidak pernah dieksekusi, tapi bundler tetap harus bisa
 * me-resolve import-nya saat build — dan `module` tidak ada di browser, jadi
 * build gagal dengan "Module not found: Can't resolve 'module'".
 *
 * File ini dipasang sebagai alias khusus kondisi `browser` di `next.config.ts`.
 * Isinya tidak pernah benar-benar dipanggil; keberadaannya saja yang dibutuhkan
 * agar resolusi modul berhasil.
 */

export function createRequire() {
  throw new Error(
    "createRequire() tidak tersedia di browser. Ini stub build-time; " +
      "kalau fungsi ini benar-benar terpanggil, berarti ada kode Node yang " +
      "bocor ke bundle client.",
  );
}

export default { createRequire };
