# API Reference

Tiga endpoint, semuanya berjalan di Node runtime (`mammoth` dan `docx` butuh
API Node, jadi Edge runtime bukan pilihan).

**Base URL (dev):** `http://localhost:3000`

---

## Format bersama

### Buffer dikirim sebagai base64

Dokumen tidak pernah lewat sebagai `number[]`. `JSON.stringify` atas byte array
menghasilkan `"255,0,13,..."` — sekitar **3,5–4× ukuran asli**. Base64 hanya
1,33×, dan payload ini dikirim ulang setiap kali user menekan quick action.

Helper konversinya ada di `src/lib/buffer-utils.ts` dan jalan di browser
maupun Node.

### Bentuk error

Semua endpoint memakai bentuk yang sama:

```json
{
  "success": false,
  "error": "Kalimat yang bisa langsung ditampilkan ke user",
  "errorCode": "AI_QUOTA_EXCEEDED"
}
```

Pesan mentah dari Gemini dan potongan isi dokumen **tidak pernah** dikirim ke
client — semuanya hanya masuk log server.

Khusus `429`, response menyertakan `retryAfterSeconds` (dan header
`Retry-After`) berisi sisa waktu tunggu **dari Google**, bukan tebakan. UI
memakainya untuk hitung mundur dan mengunci tombol selama jendela itu.

### Kode error

| Kode | HTTP | Artinya |
|---|---|---|
| `INVALID_INPUT` | 400 | Body tidak sesuai kontrak |
| `FILE_TOO_LARGE` | 413 | Melebihi 10 MB |
| `INVALID_FILE_TYPE` | 415 | Bukan .docx (magic bytes ZIP tidak cocok) |
| `PARSE_FAILED` | 422 | File korup atau diproteksi password |
| `MISSING_API_KEY` | 500 | `GEMINI_API_KEY` belum diatur / tidak valid |
| `AI_QUOTA_EXCEEDED` | 429 | Kena batas free tier (lihat `retryAfterSeconds`) |
| `AI_MODEL_UNAVAILABLE` | 502 | Model di `GEMINI_MODEL` dihentikan Google |
| `AI_REQUEST_FAILED` | 502/504 | Gemini error atau timeout |
| `AI_INVALID_RESPONSE` | 502 | Model tidak mengembalikan hasil yang bisa dipakai |
| `UNKNOWN` | 500 | Selain di atas |

---

## `GET /api/health`

Cek kesiapan. **Tidak** memanggil Gemini — satu panggilan nyata per health
check akan menghabiskan kuota harian hanya untuk memastikan layanan hidup.

```bash
curl -s http://localhost:3000/api/health
```

```json
{
  "status": "ok",
  "geminiConfigured": true,
  "timestamp": "2026-08-13T01:11:50.698Z"
}
```

`status` bernilai `"degraded"` kalau API key belum diatur. **HTTP tetap 200**
di kedua kondisi: konfigurasi belum lengkap bukan kegagalan server, dan
aplikasi tetap bisa membuka, mengedit, serta mengunduh dokumen tanpa AI.
Baca `geminiConfigured`, bukan HTTP code.

Endpoint ini hanya melaporkan **ada/tidaknya** key — tidak pernah nilainya,
panjangnya, atau prefix-nya.

---

## `POST /api/upload-doc`

Dua mode, dibedakan dari `Content-Type`.

### Mode CREATE — `application/json`

```bash
curl -s -X POST http://localhost:3000/api/upload-doc \
  -H 'Content-Type: application/json' \
  -d '{"action":"create","fileName":"laporan-q3","title":"Laporan Kuartal 3"}'
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `action` | `"create"` | tidak | Penanda saja; mode ditentukan Content-Type |
| `fileName` | `string` | tidak | Default `untitled.docx`; `.docx` ditambahkan otomatis |
| `title` | `string` | tidak | Kalau diisi, jadi paragraf judul tebal |

### Mode UPLOAD — `multipart/form-data`

```bash
curl -s -X POST http://localhost:3000/api/upload-doc \
  -F 'file=@laporan.docx'
```

### Response (kedua mode)

```json
{
  "success": true,
  "fileName": "laporan-q3.docx",
  "docBase64": "UEsDBBQAAAAI...",
  "meta": {
    "fileName": "laporan-q3.docx",
    "sizeBytes": 8518,
    "charCount": 12,
    "wordCount": 2,
    "paragraphCount": 1
  }
}
```

### Sanitasi nama file

Nama dari client selalu dibersihkan sebelum dipakai:

| Masukan | Hasil |
|---|---|
| `../../../etc/passwd` | `passwd.docx` |
| `a<>:"\|?*b.docx` | `ab.docx` |
| `...` | `untitled.docx` |
| `laporan q3` | `laporan q3.docx` |
| 400 karakter | dipotong ≤255, ekstensi dipertahankan |

### Catatan

Mode UPLOAD **tidak dipakai UI**. `useDocxDocument.uploadDocument()` membaca
file langsung di browser — round trip 2× ukuran file semata untuk validasi itu
pemborosan. Endpoint-nya tetap ada dan berguna untuk cURL / integration test.

Validasi otoritatif memakai **magic bytes ZIP** (`PK\x03\x04`), bukan ekstensi
atau MIME type — keduanya sepele dipalsukan dari client.

---

## `POST /api/ai-edit`

Satu-satunya jalur menuju Gemini. Dua mode, dibedakan dari ada-tidaknya
`action`.

### Request

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `docBase64` | `string` | **ya** | Isi .docx dalam base64 |
| `action` | `AIActionType` | tidak | Ada → quick action. Kosong → pesan bebas |
| `mode` | `"chat"` \| `"edit"` | tidak | Hanya untuk pesan bebas. Default `"chat"` |
| `userMessage` | `string` | tergantung | **Wajib untuk pesan bebas**, opsional di quick action |
| `selectedText` | `string` | tidak | Mempersempit scope edit ke potongan ini |
| `history` | `SerializedChatMessage[]` | tidak | 10 pesan terakhir dipakai sebagai konteks |

`action` yang valid: `summarize`, `expand`, `fix-grammar`, `rewrite`,
`translate`.

### Mode EDIT

```bash
curl -s -X POST http://localhost:3000/api/ai-edit \
  -H 'Content-Type: application/json' \
  -d "{\"docBase64\":\"$(base64 -i laporan.docx | tr -d '\n')\",\"action\":\"summarize\"}"
```

```json
{
  "success": true,
  "edits": [
    { "type": "insert", "text": "Ringkasan\nPenjualan naik 18%...", "index": 0 },
    { "type": "replace", "find": "naik 18 persen", "replace": "naik 18%" }
  ],
  "summary": "Saya menambahkan ringkasan di awal dokumen.",
  "usage": { "promptTokens": 812, "responseTokens": 143, "totalTokens": 955 }
}
```

`edits` diterapkan **di client** lewat `applyEditsToDocument()`, bukan di
server — server tidak memegang dokumen hidup milik editor.

### Pesan bebas — `mode: "chat"` (default)

```bash
curl -s -X POST http://localhost:3000/api/ai-edit \
  -H 'Content-Type: application/json' \
  -d "{\"docBase64\":\"...\",\"mode\":\"chat\",\"userMessage\":\"Berapa pertumbuhan penjualannya?\"}"
```

```json
{
  "success": true,
  "edits": [],
  "summary": "Dokumen menyebutkan penjualan naik 18% dibanding kuartal lalu."
}
```

**Read-only-nya dijamin secara teknis, bukan lewat prompt:** di mode ini tool
editing tidak dipasang sama sekali, jadi model tidak punya cara mengubah
dokumen. Diminta mengubah pun, dia menolak dan mengarahkan user ke mode "Ubah".

### Pesan bebas — `mode: "edit"`

Instruksi perubahan dengan kalimat sendiri, di luar 5 quick action.

```bash
curl -s -X POST http://localhost:3000/api/ai-edit \
  -H 'Content-Type: application/json' \
  -d "{\"docBase64\":\"...\",\"mode\":\"edit\",\"userMessage\":\"Ganti '18 percent' jadi '25 percent'\"}"
```

```json
{
  "success": true,
  "edits": [
    { "type": "replace", "find": "18 percent", "replace": "25 percent" }
  ],
  "summary": "Saya mengubah 18 percent menjadi 25 percent."
}
```

Kalau instruksinya ambigu atau teks targetnya tidak ada, model diminta
**bertanya balik** dalam teks biasa alih-alih menebak — `edits` kosong,
dokumen tidak berubah.

Nilai `mode` selain `"edit"` — termasuk field yang hilang atau tidak dikenal —
jatuh ke `"chat"`. Default-nya sengaja yang read-only.

### Bentuk EditOperation

| `type` | Field wajib | Efek |
|---|---|---|
| `insert` | `text` | Sisip paragraf. `index` opsional (0 = paling atas, kosong = akhir) |
| `replace` | `find`, `replace` | Ganti kemunculan **pertama** |
| `delete` | `find` | Hapus kemunculan pertama |
| `format` | `find`, `formatting` | `bold`, `italic`, `size`, `color` |

Semua target berupa **teks literal**, bukan index numerik — LLM konsisten
salah menghitung posisi blok, tapi andal menyalin teks apa adanya.

> **`underline` tidak didukung.** `Font` di editor-api hanya mengekspos `bold`,
> `italic`, `color`, `name`, dan `size`. Permintaan underline diabaikan dengan
> peringatan di console, bukan dijadikan error.

---

## Batas & kuota

| Batas | Nilai | Ditegakkan di |
|---|---|---|
| Ukuran file | 10 MB | Client + server |
| Isi dokumen ke AI | 60.000 karakter | `gemini-client.ts` (dipotong) |
| Panjang pesan user | 4.000 karakter | Client + server |
| Function call per respons | 25 | Instruksi sistem |
| Pencarian teks (`find`) | 255 karakter | `editor-api-utils.ts` |
| Permintaan Gemini | berbeda per model | Rate limit client (15/menit) + Google |
| Model | `gemini-3.6-flash` (ubah via `GEMINI_MODEL`) | `gemini-client.ts` |
| Timeout request | 60 detik | `gemini-client.ts` |
| Retry | 2× (backoff 1s, 2s) | Hanya untuk 429/500/503 |

Rate limit sisi client (sliding window 15/60 detik) ada supaya user mendapat
pesan "tunggu N detik" seketika, bukan HTTP 429 setelah menunggu round trip.
