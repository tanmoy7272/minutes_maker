import { NextRequest, NextResponse } from "next/server";
import { getGroqKeys } from "../../../lib/llm";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new NextResponse(JSON.stringify({ error: "Missing audio file" }), { status: 400, headers: CORS_HEADERS });
    }

    const groqKeys = getGroqKeys();
    if (groqKeys.length === 0) {
      return new NextResponse(JSON.stringify({ error: "No Groq API keys configured in environment pool." }), { status: 500, headers: CORS_HEADERS });
    }

    let transcriptionText = "";
    let transcriptionSuccess = false;
    let lastErrorMsg = "";

    // Sequential key failover for speech-to-text
    for (let i = 0; i < groqKeys.length; i++) {
      const key = groqKeys[i];
      console.log(`[MMP-Transcribe] Attempting transcription with Groq Key ${i + 1}/${groqKeys.length}...`);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

        const groqFormData = new FormData();
        groqFormData.append("file", file);
        groqFormData.append("model", "whisper-large-v3");
        groqFormData.append("response_format", "json");

        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`
          },
          body: groqFormData,
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {
          const result = await response.json();
          transcriptionText = result.text || "";
          transcriptionSuccess = true;
          console.log(`[MMP-Transcribe] Transcription succeeded with Key ${i + 1}. Characters: ${transcriptionText.length}`);
          break;
        } else {
          const errText = await response.text();
          console.warn(`[MMP-Transcribe] Key ${i + 1} rejected request: ${response.status} - ${errText}`);
          lastErrorMsg = `HTTP ${response.status}: ${errText}`;
        }
      } catch (err: any) {
        console.warn(`[MMP-Transcribe] Key ${i + 1} request threw error: ${err.message || err}`);
        lastErrorMsg = err.message || String(err);
      }
    }

    if (!transcriptionSuccess) {
      return new NextResponse(JSON.stringify({ error: `All pooled Groq Whisper transcription keys failed. Last error: ${lastErrorMsg}` }), { status: 502, headers: CORS_HEADERS });
    }

    return new NextResponse(JSON.stringify({ text: transcriptionText }), { status: 200, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error("[MMP-Transcribe] Global transcription API error:", error);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
  }
}
