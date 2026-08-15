# DOCX Editor + Gemini AI — POC

Editor Microsoft Word di browser dengan asisten AI yang **mengubah dokumennya**,
bukan sekadar menjawab di chat.

```bash
npm install
cp .env.example .env.local     # isi GEMINI_API_KEY
npm run dev
```

→ <http://localhost:3000> · Panduan lengkap: **[docs/SETUP.md](./docs/SETUP.md)**

---

## Apa yang bisa dilakukan

- **Buka & edit .docx** — WYSIWYG penuh: toolbar, ruler, style paragraf, font,
  tabel, komentar
- **6 aksi AI satu klik** — Ringkas, Perbaiki Tata Bahasa, Perluas, Persingkat,
  Tulis Ulang, Terjemahkan
- **Chat dua mode** — dropdown di atas kotak pesan: **Tanya** (AI hanya
  membaca) atau **Ubah** (perintah edit dengan kalimatmu sendiri, di luar
  6 aksi preset)
- **Edit terarah** — seleksi sebagian teks, dan aksi AI hanya berlaku di situ
- **Download .docx** — hasilnya tetap terbaca Microsoft Word
- **Riwayat generate** — setiap hasil generate disimpan sebagai versi baru di
  IndexedDB dan dapat dimuat kembali ke editor
- **Quick Access favorit** — tandai hingga 4 hasil generate agar bisa langsung
  di-load tanpa mencarinya di seluruh riwayat

Perubahan dari AI diterapkan sebagai operasi edit sungguhan pada dokumen hidup,
lalu dilaporkan apa adanya: *"⚠️ 8 dari 10 perubahan diterapkan. 2 dilewati:
teks tidak ditemukan."*

---

## Tech stack

| Lapisan | Pilihan |
|---|---|
| Framework | Next.js 16 (App Router) · React 19 |
| Editor | `@docx-editor.dev/react` (Apache-2.0) |
| Penerap edit | `@docx-editor.dev/core` (Apache-2.0) |
| AI | Gemini 3.6 Flash via `@google/genai` (function calling) |
| Baca .docx | `mammoth` |
| Tulis .docx | `docx` |
| Styling | Tailwind CSS v4 |

---

## Arsitektur

```
Browser                          │  Server
─────────────────────────────────┼──────────────────────────────────
useDocxDocument                  │  /api/upload-doc   buat / validasi
  buffer, nama file, dirty       │  /api/ai-edit      satu-satunya
  auto-save localStorage         │                    jalur ke Gemini
                                 │  /api/health       status setup
DocxEditorViewer                 │
  editor hidup; pemilik dokumen  │  docx-parser       .docx → teks
  save() debounce 800ms          │  gemini-client     tool + prompt
                                 │
useAIChat                        │  GEMINI_API_KEY tidak pernah
  rate limit 15/menit            │  meninggalkan server
  riwayat, retry                 │
                                 │
useRecentDocuments              │
  30 versi di IndexedDB          │
  maks. 4 favorit Quick Access   │
                                 │
editor-core-utils                │
  terapkan EditOperation[]       │
```

**Alur satu aksi AI:**

```
klik Ringkas
  → getDocBuffer()      ambil dari editor HIDUP (bukan state)
  → POST /api/ai-edit   base64
  → mammoth             .docx → teks berstruktur
  → Gemini              function calling → EditOperation[]
  → validasi            call cacat dibuang, tidak merusak dokumen
  → editor core         terapkan ke dokumen hidup
  → chat                "✅ 4 perubahan diterapkan."
```

---

## Empat keputusan yang menentukan

**1. Editor memiliki dokumen setelah mount.**
`docBuffer` hanya sumber saat mount, tidak pernah didorong balik tiap render.
Kalau didorong balik: editor reload, kursor lompat, undo history hilang.
Mount ulang hanya terjadi saat `documentId` berubah.

**2. Buffer untuk AI diambil dari editor hidup, bukan React state.**
State tertinggal sampai 800ms karena debounce simpan. Karena penerapan edit
memakai exact match, teks basi berarti **semua** edit dilewati diam-diam —
mode kegagalan utama desain ini.

**3. Edit menargetkan teks literal, bukan index blok.**
LLM konsisten salah menghitung posisi, tapi andal menyalin teks apa adanya.

**4. Niat chat dipilih user, bukan ditebak model.**
Dropdown Tanya/Ubah membuat mode Tanya read-only secara TEKNIS — tool editing
tidak dipasang, jadi salah tafsir tidak bisa berujung dokumen berubah.

---

## Struktur

```
src/
├── app/
│   ├── page.tsx              beranda + status setup (Server Component)
│   ├── editor/page.tsx       tempat semuanya tersambung
│   └── api/{ai-edit,upload-doc,health}/route.ts
├── components/
│   ├── DocxEditorViewer.tsx  pembungkus editor + jembatan event
│   ├── AIChatSidebar.tsx     chat, quick action, kuota
│   ├── RecentGeneratedPanel.tsx
│   │                         riwayat + Quick Access favorit
│   ├── ActionButtons.tsx
│   └── LoadingSpinner.tsx
├── hooks/
│   ├── useDocxDocument.ts    state dokumen, auto-save
│   ├── useRecentDocuments.ts riwayat generated di IndexedDB
│   └── useAIChat.ts          percakapan, rate limit
├── lib/
│   ├── types.ts              kontrak bersama
│   ├── gemini-client.ts      SERVER-ONLY
│   ├── docx-parser.ts        SERVER-ONLY
│   ├── editor-core-utils.ts  CLIENT-ONLY
│   └── buffer-utils.ts       isomorphic
└── stubs/node-module-browser.js   jangan dihapus — lihat SETUP.md
```

---

## Keamanan

- API key hanya di server; ada guard runtime yang melempar error kalau
  `gemini-client` sampai ter-import dari komponen client
- Isi dokumen diperlakukan sebagai **data**, bukan instruksi — instruksi yang
  menyamar di dalam dokumen diabaikan
- Validasi .docx memakai magic bytes, bukan ekstensi atau MIME type
- Nama file dibersihkan dari komponen path dan karakter kontrol
- Ukuran ditolak sebelum decode, agar payload raksasa tidak memakan memori
- Pesan error mentah tidak pernah sampai ke client

---

## Penerapan edit tanpa plugin berbayar

Semua edit AI diterapkan langsung dengan `@docx-editor.dev/core` yang
berlisensi Apache-2.0. Aplikasi tidak memasang atau memuat plugin editor
komersial. Editor core memakai resep dua langkah berbasis seleksi:

```ts
const [match] = editor.findMatches(text, { matchCase: true });
editor.selectMatch(match);
editor.exec({ type: "insertText", text: pengganti });  // menimpa seleksi
```

Seluruh aksi AI berjalan lewat jalur ini. Untuk penyisipan, editor core memakai
`insertBreak('line')` karena `splitParagraph` ditolak editor hidup—teks baru
menjadi baris di dalam paragraf, bukan paragraf `<w:p>` terpisah. Tampilannya
nyaris identik dan tetap merupakan struktur Word yang sah.

Detail lengkap beserta perintah apa saja yang ditolak editor hidup ada di
[TROUBLESHOOTING](./docs/TROUBLESHOOTING.md#penerapan-edit-dengan-editor-core).

---

## Batasan POC

| Hal | Kondisi |
|---|---|
| Penyimpanan | Dokumen aktif di memori/localStorage; riwayat generate di IndexedDB. **Tidak ada database server** |
| Riwayat generate | Maks. 30 versi; favorit Quick Access maks. 4 dokumen |
| Auto-save | Hanya dokumen < 3 MB |
| Ukuran file | Maks 10 MB |
| Kuota AI | 15/menit, 1.500/hari (free tier) |
| Multi-user | Tidak ada |
| Target edit | Harus dalam satu baris — pencarian tidak melintasi paragraf |

**Selalu Download sebelum menutup tab.**

---

## Status verifikasi

Terbukti jalan end-to-end dengan API key sungguhan:

- Build produksi + typecheck strict
- 59 assertion runtime (parser, ketiga route)
- Gemini menghasilkan edit yang benar (3 kalimat salah → 3 perbaikan tepat,
  masing-masing dengan `find` verbatim)
- Mode chat menjawab akurat atas dokumen bergambar dan berformat kompleks
- **Edit AI benar-benar diterapkan ke dokumen hidup** lewat editor core
- Perintah edit bebas dari chat (`mode: "edit"`) → 2 penggantian tepat
- Mode Tanya menolak permintaan mengubah dan mengarahkan ke mode Ubah
- Ketik → auto-save → restore setelah reload; Download menghasilkan .docx

---

## Lisensi

Editor dan penerap edit menggunakan `@docx-editor.dev/core` berlisensi
Apache-2.0. Tidak ada plugin editor berbayar/evaluasi yang dipasang.

Dokumentasi: [SETUP](./docs/SETUP.md) · [API](./docs/API_REFERENCE.md) ·
[TROUBLESHOOTING](./docs/TROUBLESHOOTING.md)
