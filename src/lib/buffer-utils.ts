/**
 * buffer-utils.ts
 * -----------------------------------------------------------------------------
 * Konversi ArrayBuffer <-> base64 yang jalan di browser MAUPUN di Node.
 *
 * Kenapa base64 dan bukan `number[]` seperti di spec:
 * `JSON.stringify(Array.from(bytes))` menghasilkan teks seperti `"255,0,13,..."`
 * — rata-rata ~3,5-4 karakter per byte. Dokumen 2 MB jadi ~7 MB JSON, dan
 * payload itu dikirim ulang setiap kali user menekan quick action. Base64 hanya
 * membengkak 1,33x (~2,7 MB) dengan perubahan kode yang sama sederhananya.
 *
 * ISOMORPHIC: dipakai `useAIChat` (browser) dan route handler (Node), jadi
 * modul ini tidak boleh mengimpor apa pun dan harus mendeteksi lingkungannya
 * sendiri saat runtime.
 */

/** Ukuran potongan saat encode (32 KB). Lihat catatan di `arrayBufferToBase64`. */
const CHUNK_SIZE = 0x8000;

/**
 * Encode ArrayBuffer jadi string base64.
 *
 * Di browser diproses per potongan: `String.fromCharCode(...bytes)` dengan array
 * besar melempar RangeError karena jumlah argumennya melebihi batas call stack.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // Jalur Node: jauh lebih cepat dan tanpa batasan call stack.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

/**
 * Decode string base64 kembali jadi ArrayBuffer.
 *
 * @throws {Error} kalau string-nya bukan base64 yang valid.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64, "base64");
    // Salin ke ArrayBuffer sendiri: Buffer dari Node bisa berbagi memori dengan
    // pool internal, jadi `.buffer`-nya sering lebih besar dari isi sebenarnya.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Perkiraan ukuran asli (dalam byte) dari sebuah string base64, tanpa perlu
 * men-decode-nya. Dipakai untuk menolak payload kebesaran lebih awal.
 */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Cek bentuk base64 secara sintaksis, sebelum decode yang lebih mahal. */
export function isValidBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
