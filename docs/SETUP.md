# Setup

Panduan dari nol sampai aplikasi jalan. Perkiraan waktu: 5 menit.

---

## Prasyarat

| Kebutuhan | Versi | Cek dengan |
|---|---|---|
| Node.js | 18.18+ (disarankan 20+) | `node -v` |
| npm | 9+ | `npm -v` |
| Browser | Chrome / Edge / Firefox / Safari terbaru | — |

Editor DOCX melukis halaman lewat Canvas dan memakai WebAssembly untuk font
shaping, jadi browser lawas tidak didukung.

---

## 1. Install dependency

```bash
cd docx-editor-poc
npm install
```

Sekitar 166 paket. Peringatan `deprecated node-domexception` itu wajar —
datang dari dependency transitif dan tidak berpengaruh.

---

## 2. Ambil Gemini API key (gratis)

1. Buka <https://aistudio.google.com/apikey>
2. Klik **Create API key**
3. Salin key-nya

Tidak perlu kartu kredit. Free tier aktif otomatis: **1.500 permintaan/hari**,
**15 permintaan/menit**, sudah termasuk function calling.

---

## 3. Buat `.env.local`

```bash
cp .env.example .env.local
```

Lalu isi:

```
GEMINI_API_KEY=AIzaSy...key-kamu-di-sini
NEXT_PUBLIC_APP_NAME=DOCX Editor AI POC

# Opsional. Default: gemini-3.6-flash
# GEMINI_MODEL=gemini-3.6-flash
```

> **Kalau nanti muncul error 404 "no longer available to new users":** Google
> menghentikan model itu. Setel `GEMINI_MODEL` ke model lain — tidak perlu
> mengubah kode. Lihat
> [TROUBLESHOOTING](./TROUBLESHOOTING.md#404--this-model-is-no-longer-available-to-new-users).

> **Jangan pernah commit `.env.local`.** File itu sudah masuk `.gitignore`.
> API key hanya dibaca di server (`src/app/api/**`) dan tidak pernah ikut ke
> bundle browser.

---

## 4. Jalankan

```bash
npm run dev
```

Buka <http://localhost:3000>. (Kalau port 3000 terpakai, Next.js otomatis
memakai port berikutnya — perhatikan output terminalnya.)

---

## 5. Pastikan setup benar

**Cara tercepat** — halaman depan menampilkan status setup:

- Banner **hijau** → API key terbaca, semua fitur AI siap
- Banner **kuning** → `GEMINI_API_KEY` belum terbaca

**Lewat endpoint:**

```bash
curl -s http://localhost:3000/api/health
```

```json
{ "status": "ok", "geminiConfigured": true, "timestamp": "..." }
```

Kalau `geminiConfigured: false`, lihat
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md#api-key-tidak-terbaca).

---

## Checklist pertama kali

- [ ] `npm install` selesai tanpa error
- [ ] `.env.local` ada dan berisi `GEMINI_API_KEY`
- [ ] `npm run dev` jalan
- [ ] Halaman depan menampilkan banner **hijau**
- [ ] Klik **Dokumen Baru** → editor muncul lengkap dengan toolbar dan ruler
- [ ] Ketik sesuatu → status bar berubah jadi **"Ada perubahan"**
- [ ] Klik **Ringkas** → ringkasan tersisip ke dokumen
- [ ] Dropdown di atas kotak pesan → pilih **Ubah**, ketik perintah sendiri
      (mis. "ganti kata X jadi Y") → dokumen berubah
- [ ] Kembali ke **Tanya**, minta perubahan → AI menolak, dokumen utuh
- [ ] Klik **Download** → file .docx terunduh dan bisa dibuka di Word

---

## Perintah lain

```bash
npm run build       # build produksi
npm start           # jalankan hasil build
npm run typecheck   # tsc --noEmit, tanpa build
npm run lint
```

---

## Dua konfigurasi yang tidak boleh dihapus

Keduanya tidak jelas kegunaannya sampai dihapus — dan keduanya bikin aplikasi
rusak kalau hilang.

**1. Import CSS editor** — `src/styles/globals.css`

```css
@import "@docx-editor.dev/core/styles/editor.css";
```

`@docx-editor.dev/react` tidak menyisipkan CSS-nya sendiri. Tanpa baris ini
editor tetap berfungsi, tapi seluruh chrome-nya (menu, toolbar, ruler,
navigation pane) render sebagai teks polos tanpa layout.

**2. Alias `module` untuk browser** — `next.config.ts`

```ts
turbopack: {
  resolveAlias: {
    module: { browser: "./src/stubs/node-module-browser.js" },
  },
}
```

`harfbuzzjs` (font shaper di balik editor) memanggil `await import("module")`
di cabang khusus Node. Cabangnya tidak pernah jalan di browser, tapi bundler
tetap harus bisa me-resolve-nya. Tanpa alias ini, **build gagal** dengan
`Module not found: Can't resolve 'module'`.

---

## Catatan lisensi

- `@docx-editor.dev/core` — Apache 2.0, bebas dipakai
- `@docx-editor.dev/editor-api` — **EigenPal Pro Evaluation License 1.0**

Editor-API dipakai untuk menerapkan hasil edit AI ke dokumen. Lisensinya
mengizinkan pemakaian internal non-produksi untuk evaluasi. Tidak ada gerbang
lisensi teknis di dalam paketnya — batasannya legal. **Untuk produksi,
hubungi EigenPal lebih dulu.**
