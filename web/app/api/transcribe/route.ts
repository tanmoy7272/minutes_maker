import { NextRequest, NextResponse } from "next/server";
import { getGroqKeys } from "../../../lib/llm";
import { rateLimit } from "../../../lib/rateLimit";

export const maxDuration = 60;

function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = (origin.startsWith("chrome-extension://") || origin.includes("localhost") || origin.includes("127.0.0.1")) 
    ? origin 
    : "*";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const headers = getCorsHeaders(request);
  try {
    // 1. Dynamic CORS origin verification
    const origin = request.headers.get("origin") || "";
    const isAllowedOrigin = origin.startsWith("chrome-extension://") || origin.includes("localhost") || origin.includes("127.0.0.1") || process.env.NODE_ENV === "development";
    if (!isAllowedOrigin) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized request origin." }), { status: 403, headers });
    }

    // 2. In-Memory Rate Limiting
    const ip = (request as any).ip || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";
    const rateResult = rateLimit(ip, 600, 3600000); // 600 requests per hour
    if (!rateResult.success) {
      return new NextResponse(JSON.stringify({ error: "Rate limit exceeded. Max 600 transcriptions per hour." }), {
        status: 429,
        headers: {
          ...headers,
          "Retry-After": String(Math.ceil((rateResult.reset - Date.now()) / 1000))
        }
      });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new NextResponse(JSON.stringify({ error: "Missing audio file" }), { status: 400, headers });
    }

    const groqKeys = getGroqKeys();
    const customKey = (request.headers.get("x-custom-gemini-key") || "").trim();
    const geminiKey = customKey || process.env.GEMINI_API_KEY || process.env.LLM_FALLBACK_KEY;

    if (groqKeys.length === 0 && !geminiKey) {
      return new NextResponse(JSON.stringify({ error: "No transcription API keys configured in environment pool." }), { status: 500, headers });
    }

    let transcriptionText = "";
    let transcriptionSuccess = false;
    let lastErrorMsg = "";

    // 3. Transcription flow: try Groq Whisper first if keys exist, unless custom key is supplied
    if (groqKeys.length > 0 && !customKey) {
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
    }

    // 4. Gemini Fallback Audio Transcription
    if (!transcriptionSuccess && geminiKey) {
      console.log(`[MMP-Transcribe] Using Gemini fallback audio transcription...`);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString("base64");
        const mimeType = file.type || "audio/webm";
        const model = process.env.LLM_FALLBACK_MODEL || "gemini-2.5-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                  }
                },
                {
                  text: "Please transcribe the spoken audio verbatim. Do not summarize, paraphrase, or add any introductory or explanatory text. If the audio is silent or contains no speech, return an empty string."
                }
              ]
            }],
            generationConfig: {
              temperature: 0.0
            }
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {
          const result = await response.json();
          transcriptionText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
          transcriptionSuccess = true;
          console.log(`[MMP-Transcribe] Gemini transcription succeeded. Characters: ${transcriptionText.length}`);
        } else {
          const errText = await response.text();
          console.warn(`[MMP-Transcribe] Gemini rejected request: ${response.status} - ${errText}`);
          lastErrorMsg = `Gemini HTTP ${response.status}: ${errText}`;
        }
      } catch (err: any) {
        console.error(`[MMP-Transcribe] Gemini fallback threw error:`, err);
        lastErrorMsg = err.message || String(err);
      }
    }

    if (!transcriptionSuccess) {
      return new NextResponse(JSON.stringify({ error: `All transcription methods failed. Last error: ${lastErrorMsg}` }), { status: 502, headers });
    }

    return new NextResponse(JSON.stringify({ text: transcriptionText }), { status: 200, headers });
  } catch (error: any) {
    console.error("[MMP-Transcribe] Global transcription API error:", error);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
