# DOCX Editor + Gemini AI POC - Claude Build Prompt

Kamu akan membantu saya membuat POC (Proof of Concept) untuk aplikasi DOCX editor dengan AI capabilities menggunakan Gemini API (free tier). Berikut adalah specification lengkapnya:

---

## 📋 **PROJECT OVERVIEW**

**Goal:** Buat aplikasi Next.js yang memungkinkan user untuk:
1. ✅ Create/Upload DOCX files
2. ✅ Edit DOCX files di browser (WYSIWYG editor)
3. ✅ Chat dengan AI (Gemini 2.5 Flash) tentang dokumen
4. ✅ AI automatically update dokumen berdasarkan instruksi
5. ✅ Export/Download dokumen yang sudah diedit

**Tech Stack:**
- Framework: Next.js 14+ (App Router)
- Editor: `@docx-editor.dev/react` + `@docx-editor.dev/editor-api`
- AI: Google Gemini API (Free tier - 2.5 Flash model)
- Styling: Tailwind CSS
- Storage: Temporary in-memory (can add file upload later)
- Runtime: Node.js 18+

**Gemini Free Tier Limits:**
- 1,500 requests/day
- 15 requests/minute
- Function calling: ✅ Included
- No credit card needed

---

## 🏗️ **PROJECT STRUCTURE** (Fresh Next.js Install)

```
docx-editor-poc/
├── .env.local                    # Environment variables (GEMINI_API_KEY)
├── .gitignore
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── next.config.ts
│
├── public/
│   └── sample.docx              # Sample DOCX for testing
│
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Main dashboard/home
│   │   ├── editor/
│   │   │   └── page.tsx          # Editor page with DOCX + chat
│   │   └── api/
│   │       ├── ai-edit/
│   │       │   └── route.ts      # POST: AI edit dengan Gemini
│   │       ├── upload-doc/
│   │       │   └── route.ts      # POST: Upload/create DOCX
│   │       └── health/
│   │           └── route.ts      # GET: Health check
│   │
│   ├── components/
│   │   ├── DocxEditorViewer.tsx     # DOCX editor component
│   │   ├── AIChatSidebar.tsx        # Chat UI + AI actions
│   │   ├── ActionButtons.tsx        # Quick action buttons
│   │   └── LoadingSpinner.tsx       # Loading indicator
│   │
│   ├── lib/
│   │   ├── gemini-client.ts         # Gemini API wrapper
│   │   ├── docx-parser.ts           # Extract text dari DOCX
│   │   ├── editor-api-utils.ts      # Editor-API helpers
│   │   └── types.ts                 # TypeScript types/interfaces
│   │
│   ├── hooks/
│   │   ├── useDocxEditor.ts         # Custom hook untuk editor state
│   │   └── useAIChat.ts             # Custom hook untuk chat state
│   │
│   └── styles/
│       └── globals.css              # Global Tailwind styles
│
├── docs/
│   ├── SETUP.md                  # Setup instructions
│   ├── API_REFERENCE.md          # API endpoints documentation
│   └── TROUBLESHOOTING.md        # Common issues
│
└── README.md                     # Project overview
```

---

## 🔧 **SETUP INSTRUCTIONS** (Step-by-step)

### **Phase 1: Initialize Next.js Project**

```bash
# 1. Create new Next.js project
npx create-next-app@latest docx-editor-poc --typescript --tailwind --app

# 2. Navigate to project
cd docx-editor-poc

# 3. Install DOCX Editor dependencies
npm install @docx-editor.dev/react @docx-editor.dev/core @docx-editor.dev/editor-api

# 4. Install Gemini AI SDK
npm install @google/generative-ai

# 5. Install file handling libraries
npm install file-saver
npm install --save-dev @types/file-saver

# 6. Install DOCX parsing library (for extracting text)
npm install docx @types/docx

# 7. Verify installation
npm list
```

### **Phase 2: Environment Setup**

Create `.env.local`:
```
GEMINI_API_KEY=your_api_key_here
NEXT_PUBLIC_APP_NAME=DOCX Editor AI POC
```

**Get Gemini API Key (FREE):**
1. Visit: https://aistudio.google.com/apikey
2. Click "Create API key in new project"
3. Copy the key to `.env.local`
4. No credit card needed - free tier is automatic

### **Phase 3: Run Development Server**

```bash
npm run dev
# Open http://localhost:3000
```

---

## 📁 **DETAILED FILE REQUIREMENTS**

### **1. `src/lib/types.ts` - Type Definitions**

```typescript
// Define all TypeScript interfaces yang akan digunakan throughout app

export interface EditorState {
  docBuffer: ArrayBuffer | null;
  fileName: string;
  isDirty: boolean;
  lastSaved: Date | null;
  selectedText: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface AIAction {
  type: "summarize" | "expand" | "fix-grammar" | "rewrite" | "translate";
  description: string;
  prompt: string;
}

export interface EditOperation {
  type: "insert" | "replace" | "delete" | "format";
  index?: number;
  find?: string;
  text?: string;
  replace?: string;
  formatting?: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    color?: string;
  };
}

export interface GeminiResponse {
  edits: EditOperation[];
  summary?: string;
  toolCalls: Array<{
    name: string;
    args: any;
  }>;
}

export interface UploadResponse {
  success: boolean;
  fileName: string;
  docBuffer?: ArrayBuffer;
  error?: string;
}
```

### **2. `src/lib/gemini-client.ts` - Gemini API Integration**

```typescript
// Wrapper untuk Gemini API dengan function calling support
// Handle tool definitions untuk DOCX editing operations
// Return structured edits yang bisa diapply ke editor-api

export async function editDocumentWithAI(
  docContent: string,
  action: string,
  userMessage?: string
): Promise<GeminiResponse>

export async function chatAboutDocument(
  docContent: string,
  conversationHistory: ChatMessage[],
  userMessage: string
): Promise<string>

export const AI_ACTIONS: Record<string, AIAction> = {
  summarize: {
    type: "summarize",
    description: "Summarize the entire document or selected text",
    prompt: "Create a concise summary of the following document content..."
  },
  expand: {
    type: "expand",
    description: "Expand the document with more details",
    prompt: "Expand the following content with more details and examples..."
  },
  fixGrammar: {
    type: "fix-grammar",
    description: "Fix grammar and spelling errors",
    prompt: "Review the following text and fix all grammar and spelling errors..."
  },
  rewrite: {
    type: "rewrite",
    description: "Rewrite in professional tone",
    prompt: "Rewrite the following content in a professional and formal tone..."
  },
  translate: {
    type: "translate",
    description: "Translate to Indonesian",
    prompt: "Translate the following English text to Indonesian..."
  }
};

// Define tools yang Gemini bisa gunakan untuk modify document
export const DOCX_EDITING_TOOLS = [
  {
    name: "insert_text",
    description: "Insert text at a specific location in the document",
    inputSchema: { ... }
  },
  {
    name: "replace_text",
    description: "Find and replace text in the document",
    inputSchema: { ... }
  },
  {
    name: "delete_text",
    description: "Delete text from the document",
    inputSchema: { ... }
  },
  {
    name: "format_text",
    description: "Apply formatting (bold, italic, size) to text",
    inputSchema: { ... }
  }
];
```

### **3. `src/lib/docx-parser.ts` - Extract Text dari DOCX**

```typescript
// Function untuk:
// 1. Extract plain text dari DOCX buffer
// 2. Preserve struktur (paragraphs, headings)
// 3. Handle tables dan lists
// 4. Return structured content untuk Gemini

export async function extractTextFromDocx(docBuffer: ArrayBuffer): Promise<string>
export async function getDocumentStructure(docBuffer: ArrayBuffer): Promise<DocumentStructure>
export async function getSelectedTextContext(docBuffer: ArrayBuffer, selectedText: string): Promise<string>
```

### **4. `src/lib/editor-api-utils.ts` - Editor-API Helpers**

```typescript
// Wrapper functions untuk @docx-editor.dev/editor-api/browser
// Untuk apply changes dari Gemini ke document

export async function applyEditsToDocument(
  editorRef: any,
  edits: EditOperation[]
): Promise<void>

export async function applyEditOperation(
  context: any,
  edit: EditOperation
): Promise<void>

// Handle specific operations
export async function insertText(context: any, index: number, text: string)
export async function replaceText(context: any, find: string, replace: string)
export async function formatText(context: any, index: number, formatting: any)
```

### **5. `src/hooks/useDocxEditor.ts` - Editor State Management**

```typescript
// Custom React hook untuk manage DOCX editor state
// Responsibilities:
// - Track current document buffer
// - Handle file upload/download
// - Track changes (dirty state)
// - Integration dengan DocxEditor component

export function useDocxEditor(initialBuffer?: ArrayBuffer) {
  return {
    docBuffer,
    setDocBuffer,
    fileName,
    setFileName,
    isDirty,
    setIsDirty,
    selectedText,
    setSelectedText,
    downloadDocument,
    uploadDocument,
    createNewDocument
  };
}
```

### **6. `src/hooks/useAIChat.ts` - Chat State Management**

```typescript
// Custom React hook untuk manage AI chat
// Responsibilities:
// - Track chat messages history
// - Send messages ke AI
// - Track loading state
// - Handle errors

export function useAIChat(docContent: string) {
  return {
    messages,
    isLoading,
    error,
    sendMessage,
    executeAIAction,
    clearChat,
    retryLastMessage
  };
}
```

### **7. `src/components/DocxEditorViewer.tsx`**

```typescript
// Component yang render DOCX editor
// Menggunakan @docx-editor.dev/react
// Props:
// - docBuffer: ArrayBuffer | null
// - onChange: (buffer: ArrayBuffer) => void
// - readOnly?: boolean
// - onSelectionChange?: (text: string) => void

// Features:
// - Full WYSIWYG editing
// - Toolbar dengan formatting options
// - Handle file drag-drop
// - Show document status (dirty, last saved, etc)
```

### **8. `src/components/AIChatSidebar.tsx`**

```typescript
// Sidebar component dengan:
// 1. Chat messages display
// 2. Input field untuk user messages
// 3. Quick action buttons (summarize, expand, etc)
// 4. AI response display
// 5. Loading indicator
// 6. Error messages

// Features:
// - Auto-scroll ke latest message
// - Streaming responses (if applicable)
// - Show token usage
// - Clear chat button
```

### **9. `src/app/api/ai-edit/route.ts`**

```typescript
// POST endpoint untuk AI edit operations
// Request body:
// {
//   docBuffer: number[] (Uint8Array as array),
//   action: "summarize" | "expand" | "fix-grammar" | "rewrite" | "translate",
//   userMessage?: string,
//   selectedText?: string
// }

// Response:
// {
//   success: boolean,
//   edits: EditOperation[],
//   summary?: string,
//   error?: string
// }

// Implementation:
// 1. Receive DOCX buffer
// 2. Extract text dari document
// 3. Call Gemini API dengan action prompt
// 4. Parse function calls dari Gemini
// 5. Convert ke EditOperation objects
// 6. Return edits untuk frontend apply
```

### **10. `src/app/api/upload-doc/route.ts`**

```typescript
// POST endpoint untuk upload/create dokumen
// Support:
// 1. Create blank DOCX
// 2. Upload existing DOCX file
// 3. Download as DOCX (dari buffer)

// Request body (for upload):
// FormData with file

// Response:
// {
//   success: boolean,
//   fileName: string,
//   docBuffer?: ArrayBuffer (as array),
//   error?: string
// }
```

### **11. `src/app/editor/page.tsx`**

```typescript
// Main editor page component
// Layout:
// - Left side (70%): DOCX Editor
// - Right side (30%): AI Chat Sidebar
// - Top: Action buttons (Save, Download, Upload, etc)

// State management:
// - Use useDocxEditor hook
// - Use useAIChat hook
// - Handle file operations

// Features:
// - Drag-drop file upload
// - Auto-save to localStorage
// - Download DOCX button
// - Document info display
// - Error boundaries
```

### **12. `src/app/page.tsx`**

```typescript
// Home/Dashboard page
// Content:
// 1. Welcome message
// 2. Feature overview
// 3. "Start Editing" button → /editor
// 4. "Upload Document" button
// 5. Sample documents list (optional)
// 6. Feature highlights
// 7. Gemini free tier info
```

### **13. `src/app/layout.tsx`**

```typescript
// Root layout dengan:
// - Metadata (title, description)
// - Tailwind CSS + globals.css
// - Navigation/header
// - Footer
// - Error boundary (optional)
// - Provider setup (if using Context API)
```

### **14. `tailwind.config.ts`**

```typescript
// Tailwind configuration dengan:
// - Custom colors
// - Custom font sizes
// - Custom spacing
// - Dark mode support (optional)
```

### **15. Documentation Files**

**`docs/SETUP.md`:**
- Step-by-step installation instructions
- Environment variable setup
- Running development server
- First time setup checklist

**`docs/API_REFERENCE.md`:**
- All API endpoints
- Request/response formats
- Example cURL requests
- Rate limit info

**`docs/TROUBLESHOOTING.md`:**
- Common errors dan solutions
- Gemini API quota issues
- DOCX parsing issues
- Browser compatibility

---

## 🎯 **FEATURES TO IMPLEMENT**

### **Priority 1 (MVP):**
- ✅ Upload DOCX atau create blank
- ✅ Edit DOCX di browser
- ✅ AI Summarize action
- ✅ AI Fix Grammar action
- ✅ AI Expand action
- ✅ Download DOCX

### **Priority 2 (Nice to have):**
- ✅ Chat about document
- ✅ Rewrite in different tone
- ✅ AI suggestions appear as comments (if using pro features)
- ✅ Undo/Redo for AI edits
- ✅ Multiple documents support
- ✅ Auto-save to localStorage

### **Priority 3 (Future):**
- File persistence (database)
- Real-time collaboration
- More AI models (Claude, etc)
- Batch processing
- Custom prompts

---

## 🔐 **SECURITY & BEST PRACTICES**

1. **API Key Security:**
   - Use `.env.local` (never commit)
   - API key only in server-side (`/app/api`)
   - Never expose to client

2. **File Handling:**
   - Validate file size (max 10MB for POC)
   - Check MIME type
   - Store in-memory only (POC)

3. **AI Rate Limiting:**
   - Track Gemini API usage
   - Implement client-side rate limiting
   - Show quota status to user

4. **Error Handling:**
   - Try-catch all async operations
   - User-friendly error messages
   - Log errors server-side

5. **Input Validation:**
   - Validate all API inputs
   - Sanitize user messages
   - Check buffer size

---

## 📊 **COMPONENT DATA FLOW**

```
User Upload
    ↓
    ├─→ POST /api/upload-doc
    │      ↓
    │   Validate & store buffer
    │      ↓
    │   Return buffer to frontend
    │      ↓
    └─→ DocxEditorViewer (render)
            ↓
       User edit & chat
            ↓
    ┌──────┴──────┐
    ↓             ↓
Click AI Action  User message
    ↓             ↓
    └──────┬──────┘
           ↓
     POST /api/ai-edit
     (send doc buffer + action)
           ↓
     Gemini API (function calling)
           ↓
     Parse edits
           ↓
     Return EditOperations
           ↓
     Editor-API apply changes
           ↓
     Update DocxEditor
           ↓
    Display result & chat response
```

---

## 🚀 **TESTING CHECKLIST** (Before Demo)

- [ ] Create blank DOCX
- [ ] Upload DOCX file
- [ ] Edit text in browser
- [ ] Save/Download DOCX
- [ ] Summarize action (check Gemini usage)
- [ ] Fix grammar action
- [ ] Expand action
- [ ] Chat about document
- [ ] Error handling (network down, quota exceeded)
- [ ] File size limits
- [ ] Browser compatibility (Chrome, Firefox, Safari)

---

## 💡 **GEMINI API TIPS**

**Free tier best practices:**
1. Use Gemini 2.5 Flash (fastest, lowest latency)
2. Cache long prompts if possible
3. Batch similar requests
4. Monitor quota at: https://aistudio.google.com/
5. For production, use Anthropic Claude atau paid Gemini tier

**Function calling:**
- Keep tool definitions simple
- Use clear parameter names
- Validate tool outputs before applying

---

## 📝 **NOTES**

- DOCX Editor core is Apache 2.0 (free)
- Editor-API requires evaluation license (free for POC, $500/mo for production)
- Gemini API free tier: 1,500 req/day (sufficient for POC testing)
- All code should use TypeScript for better dev experience
- Use React Server Components where applicable (Next.js 14+)

---

## 🎬 **STARTING POINT**

1. Run `npx create-next-app@latest docx-editor-poc --typescript --tailwind --app`
2. Install dependencies as listed in Phase 1
3. Create `.env.local` dengan Gemini API key
4. Create folder structure in `src/`
5. Create each file with stubs/comments
6. Implement step-by-step:
   - Types first
   - API routes second
   - Hooks third
   - Components last
7. Test each component individually before integration

---

**Ready to start? Begin with:** `npx create-next-app@latest docx-editor-poc --typescript --tailwind --app`

Setelah semua ini setup, pastikan untuk test setiap endpoint dan component secara isolated sebelum integration testing.

Good luck with your POC! 🚀
