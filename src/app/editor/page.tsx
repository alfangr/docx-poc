"use client";

/**
 * /editor
 * -----------------------------------------------------------------------------
 * Halaman tempat semuanya tersambung: state dokumen, editor, dan asisten AI.
 *
 * Peta kepemilikan:
 *   useDocxDocument   -> buffer dokumen, nama file, dirty, auto-save
 *   DocxEditorViewer  -> editor hidup; memegang dokumen setelah mount
 *   useAIChat         -> percakapan, rate limit, pemanggilan API
 *   applyEditsToDocument -> menerapkan hasil AI ke editor
 *
 * Dua aturan yang menjaga integrasi ini tetap benar:
 *
 *   1. SEMUA callback yang turun ke `DocxEditorViewer` DI-MEMO. Callback yang
 *      identitasnya berubah tiap render akan memasang-lepas listener editor
 *      terus-menerus.
 *
 *   2. Buffer untuk AI diambil dari EDITOR HIDUP lewat `getDocBuffer`, bukan
 *      dari state. State tertinggal sampai 800ms karena debounce simpan, dan
 *      teks basi membuat string `find` dari AI tidak cocok — semua edit gagal.
 */

import { useCallback, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent, KeyboardEvent, ReactNode } from "react";
import Link from "next/link";

import { AIChatSidebar } from "@/components/AIChatSidebar";
import { DocxEditorViewer } from "@/components/DocxEditorViewer";
import { LoadingOverlay } from "@/components/LoadingSpinner";
import { RecentGeneratedPanel } from "@/components/RecentGeneratedPanel";
import { useAIChat } from "@/hooks/useAIChat";
import { useDocxDocument } from "@/hooks/useDocxDocument";
import { useRecentDocuments } from "@/hooks/useRecentDocuments";
import { applyEditsToDocument } from "@/lib/editor-api-utils";
import { applyEditsWithCore } from "@/lib/editor-core-utils";
import type { EditEngine, EditOperation } from "@/lib/types";
import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";

type SidebarTab = "chat" | "recent";

export default function EditorPage() {
  const doc = useDocxDocument();
  const recent = useRecentDocuments();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("chat");

  /**
   * Instance editor disimpan di ref, bukan state: nilainya dibaca di dalam
   * callback dan tidak pernah dirender langsung. Kalau state, setiap
   * mount/unmount editor akan memicu render ulang seluruh halaman.
   */
  const editorRef = useRef<DocxEditorInstance | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Mesin yang menerapkan edit AI ke dokumen.
   *
   * Default `core` — Apache-2.0, bebas dipakai di produksi. `editor-api`
   * (berbayar, butuh perjanjian komersial) masih dipertahankan sebagai
   * pilihan di selector untuk perbandingan, belum dihapus.
   *
   * Disimpan di ref DAN state: ref dibaca `handleApplyEdits` tanpa membuat
   * identitas callback-nya berubah, state dipakai untuk merender pemilihnya.
   */
  const [editEngine, setEditEngine] = useState<EditEngine>("core");
  const editEngineRef = useRef<EditEngine>("core");

  // ---------------------------------------------------------------------------
  // Jembatan editor  (semua di-memo — lihat aturan 1 di header)
  // ---------------------------------------------------------------------------

  const handleEditorReady = useCallback((editor: DocxEditorInstance | null) => {
    editorRef.current = editor;
    setIsEditorReady(editor !== null);

    // Alat bantu development: memungkinkan mencoba perintah editor langsung
    // dari DevTools Console tanpa menghabiskan kuota Gemini —
    //   __editor.exec({ type: "deleteText", target: { paraId, search } })
    // Tidak ikut ter-bundle di build produksi.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __editor?: DocxEditorInstance | null }).__editor =
        editor;
    }
  }, []);

  const handleEditorChange = useCallback(
    (buffer: ArrayBuffer) => {
      // `markDirty: true` (default) — perubahan ini datang dari user.
      doc.setDocBuffer(buffer);
    },
    // `doc` utuh identitasnya berubah tiap render; setter-nya tidak.
    [doc.setDocBuffer],
  );

  const handleSelectionChange = useCallback(
    (text: string) => {
      // String kosong disimpan sebagai `null` supaya "tidak ada seleksi"
      // punya satu representasi saja.
      doc.setSelectedText(text.trim() ? text : null);
    },
    [doc.setSelectedText],
  );

  // ---------------------------------------------------------------------------
  // Jembatan AI
  // ---------------------------------------------------------------------------

  /**
   * Ambil isi dokumen langsung dari editor hidup.
   *
   * Kalau editor belum siap (dokumen dipulihkan dari localStorage tapi belum
   * ter-mount), jatuh ke buffer di state — masih lebih baik daripada gagal.
   */
  const getDocBuffer = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return doc.docBuffer;

    try {
      return await editor.save();
    } catch (err) {
      console.error("[editor] Gagal membaca dokumen dari editor:", err);
      return doc.docBuffer;
    }
  }, [doc.docBuffer]);

  const handleApplyEdits = useCallback(async (edits: EditOperation[]) => {
    const editor = editorRef.current;
    if (!editor) {
      throw new Error("Editor belum siap menerima perubahan.");
    }

    // Kedua mesin punya signature identik, jadi cukup dipilih di sini.
    const apply =
      editEngineRef.current === "core" ? applyEditsWithCore : applyEditsToDocument;

    const result = await apply(editor, edits);

    // Tandai dirty seketika. Event `change` dari editor juga akan memicunya,
    // tapi lewat debounce 800ms — indikator status tidak boleh menunggu selama itu.
    doc.setIsDirty(true);

    return result;
    // `doc.setIsDirty` stabil (useState setter), jadi identitas fungsi ini tetap.
  }, [doc.setIsDirty]);

  const chat = useAIChat({
    getDocBuffer,
    selectedText: doc.selectedText,
    onApplyEdits: handleApplyEdits,
  });

  // ---------------------------------------------------------------------------
  // Operasi file
  // ---------------------------------------------------------------------------

  const handleFilePicked = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void doc.uploadDocument(file);

      // Reset input: tanpa ini, memilih file yang SAMA dua kali berturut-turut
      // tidak memicu event `change` sama sekali.
      event.target.value = "";
    },
    [doc.uploadDocument],
  );

  const handleFileDrop = useCallback(
    (file: File) => {
      void doc.uploadDocument(file);
    },
    [doc.uploadDocument],
  );

  const handleClose = useCallback(() => {
    if (doc.isDirty && !window.confirm("Ada perubahan yang belum diunduh. Tutup dokumen?")) {
      return;
    }
    doc.clearDocument();
    chat.clearChat();
  }, [doc.isDirty, doc.clearDocument, chat.clearChat]);

  /**
   * Generate = download (seperti sebelumnya) + catat entri baru ke riwayat.
   * Buffer diambil dari editor hidup (bukan state `docBuffer`) supaya file
   * yang di-download persis sama dengan yang dicatat sebagai versi baru.
   */
  const handleGenerate = useCallback(async () => {
    const buffer = await getDocBuffer();
    doc.downloadDocument(buffer ?? undefined);
    if (buffer) void recent.addEntry(doc.fileName, buffer);
  }, [getDocBuffer, doc.downloadDocument, doc.fileName, recent.addEntry]);

  const handleLoadRecent = useCallback(
    async (id: string) => {
      if (
        doc.isDirty &&
        !window.confirm(
          "Ada perubahan yang belum di-generate. Timpa dokumen saat ini dengan versi ini?",
        )
      ) {
        return;
      }

      const entry = await recent.loadEntryBuffer(id);
      if (!entry) return;
      doc.loadBuffer(entry.data, entry.fileName);
    },
    [doc.isDirty, doc.loadBuffer, recent.loadEntryBuffer],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* --- Toolbar --- */}
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm font-semibold text-slate-800 hover:text-blue-600"
          >
            DOCX Editor AI
          </Link>

          {doc.hasDocument && (
            <FileNameEditor fileName={doc.fileName} onRename={doc.setFileName} />
          )}

          {!isEditorReady && doc.hasDocument && (
            <span className="text-xs text-slate-400">Memuat editor…</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            onChange={handleFilePicked}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />

          {/* Pemilih mesin edit — alat uji, bukan fitur untuk end user.
              Hapus blok ini setelah salah satu mesin dipilih permanen. */}
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="hidden sm:inline">Mesin edit</span>
            <select
              value={editEngine}
              onChange={(event) => {
                const next = event.target.value as EditEngine;
                setEditEngine(next);
                editEngineRef.current = next;
              }}
              className="
                rounded-md border border-slate-200 bg-white px-2 py-1 text-xs
                font-medium text-slate-700
                focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400
              "
            >
              <option value="editor-api">editor-api (berbayar)</option>
              <option value="core">core (Apache-2.0)</option>
            </select>
          </label>

          <ToolbarButton onClick={() => fileInputRef.current?.click()}>
            Upload
          </ToolbarButton>

          <ToolbarButton onClick={() => void doc.createNewDocument()}>
            Dokumen Baru
          </ToolbarButton>

          <ToolbarButton
            onClick={() => void handleGenerate()}
            disabled={!doc.hasDocument}
            primary
          >
            Generate
          </ToolbarButton>

          {doc.hasDocument && (
            <ToolbarButton onClick={handleClose}>Tutup</ToolbarButton>
          )}
        </div>
      </header>

      {/* --- Error dari operasi file --- */}
      {doc.error && (
        <div
          className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2"
          role="alert"
        >
          <p className="flex-1 text-sm text-red-700">{doc.error}</p>
          <button
            type="button"
            onClick={doc.dismissError}
            aria-label="Tutup pesan error"
            className="rounded px-2 py-0.5 text-sm text-red-500 hover:bg-red-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* --- Area utama: editor 70% / sidebar 30% --- */}
      <main className="relative flex flex-1 gap-3 overflow-hidden p-3">
        <div className="min-w-0 flex-[7]">
          <DocxEditorViewer
            docBuffer={doc.docBuffer}
            documentKey={doc.documentId}
            fileName={doc.fileName}
            isDirty={doc.isDirty}
            lastSaved={doc.lastSaved}
            onChange={handleEditorChange}
            onSelectionChange={handleSelectionChange}
            onEditorReady={handleEditorReady}
            onFileDrop={handleFileDrop}
          />
        </div>

        <div className="flex w-[380px] shrink-0 flex-col gap-2">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            <SidebarTabButton
              active={sidebarTab === "chat"}
              onClick={() => setSidebarTab("chat")}
            >
              AI Chat
            </SidebarTabButton>
            <SidebarTabButton
              active={sidebarTab === "recent"}
              onClick={() => setSidebarTab("recent")}
            >
              Riwayat Generate
              {recent.entries.length > 0 ? ` (${recent.entries.length})` : ""}
            </SidebarTabButton>
          </div>

          <div className="min-h-0 flex-1">
            {sidebarTab === "chat" ? (
              <AIChatSidebar
                className="h-full"
                messages={chat.messages}
                isLoading={chat.isLoading}
                activeAction={chat.activeAction}
                error={chat.error}
                totalUsage={chat.totalUsage}
                remainingRequests={chat.remainingRequests}
                retryAfterSeconds={chat.retryAfterSeconds}
                hasDocument={doc.hasDocument}
                selectedText={doc.selectedText}
                onSendMessage={chat.sendMessage}
                onExecuteAction={chat.executeAIAction}
                onClearChat={chat.clearChat}
                onRetry={chat.retryLastMessage}
                onDismissError={chat.dismissError}
              />
            ) : (
              <RecentGeneratedPanel
                className="h-full"
                entries={recent.entries}
                isLoading={recent.isLoading}
                error={recent.error}
                onLoad={(id) => void handleLoadRecent(id)}
                onDelete={(id) => void recent.deleteEntry(id)}
                onDismissError={recent.dismissError}
              />
            )}
          </div>
        </div>

        {doc.isLoading && <LoadingOverlay label="Menyiapkan dokumen…" />}
      </main>
    </div>
  );
}

// =============================================================================
// Tombol toolbar
// =============================================================================

function ToolbarButton({
  onClick,
  disabled = false,
  primary = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        rounded-md px-3 py-1.5 text-sm font-medium transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        focus-visible:ring-offset-1
        disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400
        ${
          primary
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }
      `}
    >
      {children}
    </button>
  );
}

// =============================================================================
// Nama dokumen (dipakai untuk download & pengelompokan versi di riwayat)
// =============================================================================

/** Karakter yang tidak valid di nama file pada kebanyakan OS. */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

function FileNameEditor({
  fileName,
  onRename,
}: {
  fileName: string;
  onRename: (name: string) => void;
}) {
  const stem = fileName.replace(/\.docx$/i, "");
  const [draft, setDraft] = useState(stem);
  const [isEditing, setIsEditing] = useState(false);

  const commit = useCallback(
    (event: FocusEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
      setIsEditing(false);
      const sanitized = draft.trim().replace(INVALID_FILENAME_CHARS, "").slice(0, 120);
      if (sanitized && sanitized !== stem) {
        onRename(`${sanitized}.docx`);
      } else {
        // Kosong atau tidak berubah — kembalikan ke nama semula.
        setDraft(stem);
      }
      event.currentTarget.blur();
    },
    [draft, stem, onRename],
  );

  return (
    <div className="flex items-center gap-1">
      <input
        value={isEditing ? draft : stem}
        onFocus={() => {
          setDraft(stem);
          setIsEditing(true);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event);
          }
          if (event.key === "Escape") {
            setDraft(stem);
            setIsEditing(false);
            event.currentTarget.blur();
          }
        }}
        aria-label="Nama dokumen"
        title="Klik untuk ubah nama dokumen"
        className="
          w-40 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm
          font-medium text-slate-700 transition-colors
          hover:border-slate-200
          focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400
        "
      />
      <span className="text-sm text-slate-400">.docx</span>
    </div>
  );
}

// =============================================================================
// Tab sidebar (AI Chat / Riwayat Generate)
// =============================================================================

function SidebarTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        ${active ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}
      `}
    >
      {children}
    </button>
  );
}
