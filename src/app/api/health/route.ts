/**
 * GET /api/health
 * -----------------------------------------------------------------------------
 * Cek kesiapan aplikasi. Dua kegunaan utama:
 *
 *   1. Setup — menjawab pertanyaan pertama saat POC tidak jalan: "API key-nya
 *      kebaca tidak?" Tanpa ini, `GEMINI_API_KEY` yang belum di-set baru
 *      ketahuan setelah user mengunggah dokumen dan menekan tombol AI.
 *   2. Monitoring — endpoint standar untuk uptime check / container probe.
 *
 * KEAMANAN: endpoint ini hanya melaporkan apakah API key ADA, tidak pernah
 * isinya, panjangnya, atau potongannya. Response-nya aman dilihat publik.
 *
 * Sengaja TIDAK memanggil Gemini: satu panggilan nyata per health check akan
 * menghabiskan kuota free tier (1.500/hari) hanya untuk memastikan layanan
 * hidup. Yang diperiksa cuma konfigurasi.
 */

import { NextResponse } from "next/server";

import { isGeminiConfigured } from "@/lib/gemini-client";
import type { HealthResponse } from "@/lib/types";

export const runtime = "nodejs";

/** Selalu dievaluasi ulang — status yang di-cache tidak ada gunanya. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const geminiConfigured = isGeminiConfigured();

  const body: HealthResponse = {
    // "degraded", bukan "error": aplikasi tetap bisa membuka, mengedit, dan
    // mengunduh dokumen tanpa API key — hanya fitur AI-nya yang mati.
    status: geminiConfigured ? "ok" : "degraded",
    geminiConfigured,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    // 200 di kedua kondisi: konfigurasi yang belum lengkap bukan kegagalan
    // server. Pemanggil membaca `status`/`geminiConfigured`, bukan HTTP code.
    status: 200,
    headers: {
      // Health check tidak boleh dilayani dari cache mana pun di jalur request.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
