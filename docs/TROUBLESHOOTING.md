# Troubleshooting

Masalah yang benar-benar ditemui saat membangun POC ini, beserta perbaikannya.

---

## Build & startup

### `Module not found: Can't resolve 'module'`

```
./node_modules/harfbuzzjs/dist/harfbuzz.js:1:341
Error: Module not found: Can't resolve 'module'
```

**Sebab.** `harfbuzzjs` — font shaper di balik engine editor — memanggil
`await import("module")` di dalam cabang khusus Node:

```js
if (IS_NODE) { const { createRequire } = await import("module"); ... }
```

Cabang itu tidak pernah dieksekusi di browser, tapi bundler tetap harus bisa
me-resolve import-nya saat build — dan `module` adalah built-in Node yang tidak
ada di browser.

**Perbaikan.** Alias khusus kondisi `browser` di `next.config.ts`:

```ts
turbopack: {
  resolveAlias: {
    module: { browser: "./src/stubs/node-module-browser.js" },
  },
}
```

Stub-nya tidak pernah benar-benar dipanggil; keberadaannya saja yang dibutuhkan
agar resolusi berhasil. Jangan hapus `src/stubs/node-module-browser.js`.

---

### Editor muncul sebagai teks polos tanpa layout

Menu `File Format Insert Help`, ruler, dan navigation pane tampil sebagai teks
biasa bertumpuk, tanpa toolbar.

**Sebab.** `@docx-editor.dev/react` **tidak** menyisipkan CSS-nya sendiri.

**Perbaikan.** Pastikan `src/styles/globals.css` memuat:

```css
@import "@docx-editor.dev/core/styles/editor.css";
```

Letakkan **setelah** `@import "tailwindcss"` supaya preflight Tailwind tidak
menimpa reset milik editor.

---

## Runtime

### `Maximum update depth exceeded`

```
Error: Maximum update depth exceeded. React limits the number of
nested updates to prevent infinite loops.
  at forceStoreRerender (react-dom)
  at ... @docx-editor.dev/react
```

**Sebab.** Effect yang melaporkan instance editor ke atas menyatukan lapor dan
bersih-bersih:

```tsx
// SALAH — ping-pong state
useEffect(() => {
  onEditorReady?.(editor);
  return () => onEditorReady?.(null);   // false ... lalu true ... lalu false
}, [editor, onEditorReady]);
```

Setiap kali effect berjalan ulang, cleanup menyetel state ke `false` lalu badan
effect menyetelnya kembali ke `true`. Ketidakstabilan identitas `editor`
sekecil apa pun berubah jadi loop render tak berujung.

**Perbaikan.** Pisahkan jadi dua effect (lihat `DocxEditorViewer.tsx`):

```tsx
useEffect(() => { onEditorReady?.(editor); }, [editor, onEditorReady]);
useEffect(() => () => onEditorReady?.(null), [onEditorReady]);
```

Laporan berulang dengan nilai sama akan di-bail-out React dan tidak memicu
render baru.

**Pola umumnya:** jangan pernah menyetel state di badan effect DAN nilai
berlawanannya di cleanup effect yang sama.

---

### Editor reload sendiri, kursor lompat, undo history hilang

**Sebab.** Buffer dokumen didorong balik ke `<DocxEditor document={...}>` pada
setiap render. Lingkarannya: editor berubah → parent menyimpan buffer → buffer
turun lagi → editor reload.

**Perbaikan.** Setelah mount, **editor** yang memegang dokumen. `docBuffer`
hanya sumber saat mount. Editor di-mount ulang **hanya** saat `documentKey`
berubah — dan `documentId` naik hanya ketika dokumen yang benar-benar berbeda
dimuat, bukan saat isinya diedit.

---

### Perubahan AI "berhasil" tapi dokumen tidak berubah

Chat membalas `⚠️ 0 dari 8 perubahan diterapkan. 8 dilewati: Teks tidak
ditemukan di dokumen: "..."`.

**Sebab paling umum.** AI membaca isi dokumen yang sudah basi, jadi string
`find`-nya tidak cocok persis dengan dokumen hidup. Penerapan edit memakai
exact match — meleset satu karakter berarti dilewati.

Ini bisa terjadi kalau buffer diambil dari React state, yang tertinggal sampai
800ms karena debounce simpan.

**Perbaikan.** `useAIChat` menerima `getDocBuffer()` — sebuah **fungsi**, bukan
nilai — dan halaman editor mengembalikan hasil `editor.save()` langsung dari
editor hidup. Jangan ganti balik jadi nilai.

**Sebab lain yang mungkin:**
- Teks `find` melebihi 255 karakter → dilewati dengan pesan jelas
- Dokumen berubah di antara baca dan tulis → `StaleDocument` (biasanya karena
  user mengetik saat AI bekerja)
- AI meminta `underline`, yang tidak didukung `Font` di editor-api

### `InvalidArgument (document.body.search.text)`

Chat membalas `⚠️ 0 dari 1 perubahan diterapkan. 1 dilewati: InvalidArgument:
the argument is not one this API accepts. (document.body.search.text)`.

**Sebab: argumen `load()`, BUKAN argumen `search()`.**

Target error-nya sangat menyesatkan. `document.body.search` adalah label
KOLEKSI HASIL pencarian; akhiran `.text` datang dari properti yang diminta
`load()`. Jadi yang ditolak adalah ini:

```ts
const results = context.document.body.search(needle, { matchCase: true });
results.load("text");   // ← SALAH: koleksi hasil tidak punya properti `text`
```

Bentuk yang benar, dan yang dipakai README editor-api:

```ts
results.load();         // tanpa argumen — cukup alamat item-nya
await context.sync();
const first = results.items[0];
```

Berlaku juga untuk `body.paragraphs.load()`.

**Kenapa lama tidak ketahuan:** aksi **Ringkas** memakai `insertParagraph`, yang
tidak menyentuh `search()` sama sekali — jadi jalur itu berhasil sejak awal.
Setiap operasi berbasis pencarian (`replace`, `delete`, `format`) gagal, dan
itu mencakup Perbaiki Tata Bahasa, Tulis Ulang, Terjemahkan, serta semua
perintah edit bebas dari chat.

Validator pencarian di engine sendiri sangat longgar:

```js
function yA(e){ return typeof e === "string" && e.length > 0 && e.length <= 256 }
```

Hanya: string, tidak kosong, maksimal 256 karakter. Tidak ada larangan
line break di situ — jadi kalau menemui error ini, **jangan** mencurigai isi
teks pencarian lebih dulu; periksa `load()`.

---

### Teks pencarian melintasi beberapa baris

Satu paragraf Word bisa memuat beberapa baris lewat `<w:br/>` — blok alamat
surat adalah contoh paling umum. Parser membacanya sebagai satu blok ber-`\n`,
dan AI bisa menyalin seluruhnya ke `find`.

Engine tidak menolaknya, tapi pencarian bekerja **di dalam satu baris**, jadi
teks seperti itu tidak akan pernah cocok — hasilnya "teks tidak ditemukan"
tanpa petunjuk kenapa.

`toSingleLine()` di `editor-api-utils.ts` mengubahnya jadi error yang jelas,
dan tetap meloloskan kasus tersering (AI menambahkan newline di ujung). Schema
tool juga sudah menyatakan `find` wajib satu baris.

Teks PENGGANTI berbeda: di sana line break benar-benar ditolak engine
(`insertText` memvalidasi `/[\r\n\v\f\u2028\u2029]/`), jadi
`toReplacementText()` meratakannya jadi spasi alih-alih menggagalkan edit.

---

### `ConflictingChanges` atau `InvalidObjectPath` saat menyisipkan teks

```
ConflictingChanges: two changes in this batch affect the same paragraph.
Split them across two context.sync() calls.

InvalidObjectPath: the object cannot be addressed. An object an item accessor
answered is usable after the next await context.sync().
```

**Sebab.** Dua batasan engine editor yang tidak terlihat dari typings, dan
hanya muncul saat dijalankan sungguhan:

1. Dua `insertParagraph()` dalam **satu batch** yang menyentuh paragraf jangkar
   yang sama ditolak.
2. Proxy `Paragraph` yang dikembalikan `insertParagraph()` **belum punya
   alamat** sampai `context.sync()` berikutnya — jadi merantai
   `.insertParagraph(..., "After")` pada hasilnya selalu gagal.

**Perbaikan.** `insertOneByOne()` di `editor-api-utils.ts` menyisipkan paragraf
satu per satu dengan `sync()` di antara masing-masing, dan penyisipan di awal
dokumen dilakukan **terbalik** di `"Start"` supaya tidak perlu menyentuh proxy
hasil sama sekali. Jangan gabungkan kembali jadi satu batch.

---

## Dua mesin penerap edit

Aplikasi ini punya dua implementasi untuk menerapkan edit AI, dipilih dari
dropdown **Mesin edit** di toolbar. Keduanya menerima `EditOperation[]` yang
sama dan mengembalikan `ApplyEditsResult` yang sama.

### Kenapa perintah beralamat gagal di mesin `core`

`DocEdits` di `@docx-editor.dev/core` mendeklarasikan perintah beralamat
(`replaceText { target, text }` dan seterusnya). Terlihat seperti pengganti
langsung untuk `editor-api` — tapi **semuanya ditolak editor hidup**:

```
exec({ type: "replaceText", target, text })
  -> "command 'replaceText' is not supported by the tree editor"
exec({ type: "insertText", target, text })
  -> "DocTarget addressing is not supported; text inserts at the selection"
exec({ type: "deleteText", target })
  -> "DocTarget addressing is not supported; deletion removes the selection"
exec({ type: "splitParagraph" })
  -> "command 'splitParagraph' is not supported by the tree editor"
```

Perintah beralamat itu dilayani host AUTOMATION — yaitu paket `editor-api`
yang berlisensi evaluasi. Editor hidup hanya bekerja pada **seleksi**. Petunjuk
ini sebenarnya ada di typings: `EditorCommandShape<T>` meng-`Omit` field
`target`.

### Resep yang benar untuk mesin `core`

```ts
const [match] = editor.findMatches(text, { matchCase: true });
editor.selectMatch(match);
editor.exec({ type: "insertText", text: pengganti });   // menimpa seleksi
editor.exec({ type: "deleteText" });                    // hapus seleksi
editor.exec({ type: "toggleMark", mark: "bold" });      // MENGGANTI-BALIK
```

Dua satuan yang gampang salah:

- `setMarkAttr` untuk `fontSize` memakai **half-point** — kirim `24` untuk 12pt.
- `setMarkAttr` untuk `color` meminta **string hex polos** (`"FF0000"`), bukan
  object `ColorValue`; mengirim `{ kind: "hex", value }` ditolak `invalidArgs`.
- `toggleMark` membalik keadaan, jadi baca `query({ type: "selectionFormatting" })`
  dulu — kalau sudah bold dan diminta bold, memanggilnya justru mematikannya.

### Menyisipkan teks di mesin `core`

`insertText` **menimpa** seleksi, dan tidak ada cara menaruh caret lewat API.
Jadi menyisipkan tanpa menghapus apa pun berarti menulis ULANG teks jangkarnya:

```ts
selectMatch(jangkar);
exec({ type: "insertText",  text: jangkar.text });  // kembalikan yang tertimpa
exec({ type: "insertBreak", kind: "line" });
exec({ type: "insertText",  text: "baris baru" });
```

`match.text` dipakai apa adanya supaya penulisan ulangnya identik. Tab dan
indentasi di awal paragraf aman karena tidak ikut terseleksi.

Hasilnya BARIS baru di dalam paragraf jangkar, bukan paragraf `<w:p>` terpisah
(`splitParagraph` ditolak editor hidup). Word menyimpannya sebagai `<w:br/>` —
struktur yang sah dan tampil sebagai baris terpisah.

### Bereksperimen tanpa memakai kuota Gemini

Di mode development, instance editor diekspos ke console:

```js
__editor.query({ type: "paragraphs" })
__editor.findMatches("teks", { matchCase: true })
__editor.exec({ type: "deleteText" })
```

Jauh lebih cepat daripada menguji lewat AI, dan tidak menghabiskan kuota.
Hook ini tidak ikut ter-bundle di build produksi.

---

## Gemini API

### `404` — "This model is no longer available to new users"

```
{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer
available to new users. Please update your code to use a newer model..."}}
```

**Sebab.** Google menghentikan model lama cukup cepat, dan model yang sudah
ditutup **tetap muncul** di endpoint daftar model — jadi daftar itu tidak bisa
dipercaya sebagai bukti model masih hidup.

**Perbaikan.** Setel model lain di `.env.local`, tanpa mengubah kode:

```
GEMINI_MODEL=gemini-3.6-flash
```

Lihat model yang aktif untuk API key kamu:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | python3 -c "import json,sys;[print(m['name'].replace('models/','')) for m in json.load(sys.stdin)['models'] if 'generateContent' in m.get('supportedGenerationMethods',[])]"
```

Aplikasi memetakan 404 ini ke `AI_MODEL_UNAVAILABLE` dengan pesan yang
menyebut jalan keluarnya, jadi kejadian berikutnya tidak perlu ditebak.

---

### `400 INVALID_ARGUMENT` saat memanggil model baru

Model Gemini 3.x **menolak `thinkingBudget: 0`** — konfigurasi yang berlaku di
Gemini 2.5. Penggantinya `thinkingLevel` (`MINIMAL` / `LOW` / …), dan model
yang berbeda menerima varian yang berbeda.

Aplikasi ini menangani sendiri: kalau model menolak `thinkingConfig`,
`callGemini()` otomatis mengulang sekali tanpa konfigurasi itu, lalu mencatat
peringatan. Jadi `GEMINI_MODEL` bisa diganti ke model apa pun tanpa menyentuh kode.

---

### API key tidak terbaca

Halaman depan menampilkan banner kuning, atau `/api/health` menjawab
`geminiConfigured: false`.

**Cek berurutan:**

1. Nama file harus **`.env.local`** — bukan `.env`, bukan `env.local`
2. File berada di **root proyek**, sejajar `package.json`
3. Isinya `GEMINI_API_KEY=AIza...` — tanpa tanda kutip, tanpa spasi di sekitar `=`
4. **Restart dev server.** Next.js membaca env hanya saat start
5. Key berisi spasi saja tetap dianggap kosong (sengaja)

```bash
# verifikasi tanpa membocorkan nilainya
grep -c '^GEMINI_API_KEY=.\+' .env.local   # harus 1
```

---

### `AI_QUOTA_EXCEEDED` (HTTP 429)

**Batas free tier berbeda per model** — jangan berpatokan pada satu angka.
`gemini-3.6-flash` misalnya jauh lebih ketat daripada `gemini-2.5-flash` yang
dulu 15/menit:

```
Quota exceeded for metric: generate_content_free_tier_requests,
limit: 20, model: gemini-3.6-flash
Please retry in 27.7s
```

Aplikasi **membaca sisa waktu tunggu dari Google** dan menampilkannya sebagai
hitung mundur; selama itu tombol aksi, input, dan pemilih mode dikunci agar
percobaan yang pasti ditolak tidak ikut memakan kuota. Response-nya juga
membawa header `Retry-After` dan field `retryAfterSeconds`.

**Kalau sering kena saat pengembangan,** pakai model lite yang kuotanya lebih
longgar:

```
GEMINI_MODEL=gemini-3.5-flash-lite
```

Catatan: rate limiter sisi client (15/menit) hanya menghitung request dari UI.
Panggilan cURL langsung ke endpoint melewatinya dan tetap memakan kuota Google.

Pantau pemakaian di <https://ai.dev/rate-limit>.

---

### `AI_INVALID_RESPONSE` — "AI tidak mengembalikan perubahan apa pun"

Model membalas teks tanpa satu pun function call.

**Coba:**
- Perjelas instruksinya lewat kotak chat, bukan hanya menekan tombol aksi
- Seleksi bagian tertentu sebelum menjalankan aksi, agar scope-nya sempit
- Naikkan `thinkingBudget` di `gemini-client.ts` (sekarang `0` demi kecepatan
  dan hemat kuota):

```ts
thinkingConfig: { thinkingBudget: 1024 },
```

---

### Request AI timeout

Default 60 detik (`REQUEST_TIMEOUT_MS` di `gemini-client.ts`).

Dokumen panjang otomatis dipotong di 60.000 karakter sebelum dikirim. Kalau
masih timeout, kecilkan `MAX_DOC_CHARS_FOR_AI` di `src/lib/types.ts`.

---

## Dokumen

### `PARSE_FAILED` — "Dokumen tidak bisa dibaca"

Penyebab yang mungkin:

- **Diproteksi password** → buka proteksinya di Word lebih dulu
- **Sebenarnya `.doc`, bukan `.docx`** → format lama tidak didukung; Simpan
  Sebagai `.docx` di Word
- **File korup** → coba buka di Word, lalu simpan ulang
- **Bukan file Word** (mis. `.pages` yang di-rename) → magic bytes ZIP-nya
  tidak cocok

### `FILE_TOO_LARGE`

Batas 10 MB (`MAX_FILE_SIZE_BYTES` di `src/lib/types.ts`). Ukuran dicek dari
panjang base64 **sebelum** decode, supaya payload raksasa ditolak tanpa
mengalokasikan memori.

### Dokumen hilang setelah refresh

Auto-save ke localStorage hanya untuk dokumen **di bawah 3 MB**.

localStorage cuma bisa menyimpan string, jadi buffer harus di-encode base64 —
membengkak ~33%, sementara kuota umumnya 5 MB. Dokumen lebih besar tetap bisa
diedit, hanya tidak dipulihkan.

Auto-save juga tidak jalan di **mode privat Safari** (localStorage diblokir).
Kegagalannya ditangkap diam-diam supaya tidak mengganggu pengeditan.

> **Selalu Download sebelum menutup tab.** POC ini tidak punya database.

### Struktur dokumen tidak terbaca penuh

`DocumentStructure.warnings` berisi
`"Struktur dokumen tidak terbaca penuh; jatuh ke ekstraksi teks polos."`

Parser memakai AST internal `mammoth` untuk mengenali heading, list, dan tabel.
AST itu bertipe `any` di typings-nya — bukan kontrak publik yang stabil. Kalau
bentuknya berubah di versi mammoth berikutnya, parser turun ke `extractRawText()`:
struktur hilang, isi tetap sampai ke AI. Aplikasi tidak crash, tapi kualitas
edit menurun. Kunci versi `mammoth` kalau ini terjadi.

---

## Browser

| Gejala | Sebab | Solusi |
|---|---|---|
| Editor tidak muncul sama sekali | WebAssembly diblokir | Aktifkan WASM / matikan extension pemblokir |
| Font terlihat salah | Font dokumen tidak terpasang | Wajar — engine mensubstitusi font |
| Dua scrollbar bersarang | `body { overflow: hidden }` terhapus | Kembalikan di `globals.css` |
| Drag-drop membuka file di tab baru | `preventDefault()` tidak jalan | Lepaskan file di dalam area editor |

Browser lawas (IE, Chrome <90) tidak didukung: engine editor butuh Canvas dan
WebAssembly.

---

## Diagnostik cepat

```bash
npm run typecheck                          # error tipe
npm run build                              # error build/bundling
curl -s localhost:3000/api/health          # status API key
```

Untuk error runtime, buka DevTools → Console. Log aplikasi berprefiks nama
modulnya: `[useAIChat]`, `[docx-parser]`, `[editor-api-utils]`,
`[DocxEditorViewer]`, `[api/ai-edit]`.
