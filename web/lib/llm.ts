// Loader for Groq keys from environment variables
export const getGroqKeys = (): string[] => {
  const keys: string[] = [];

  // Parse comma-separated list if provided
  if (process.env.GROQ_API_KEYS) {
    keys.push(...process.env.GROQ_API_KEYS.split(",").map(k => k.trim()).filter(Boolean));
  }

  // Parse individual keys GROQ_API_KEY_1 to GROQ_API_KEY_5
  for (let i = 1; i <= 5; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key) {
      keys.push(key.trim());
    }
  }

  // De-duplicate keys to avoid double calls with identical keys
  return Array.from(new Set(keys));
};

const disabledKeys = new Map<string, number>();

export async function callLLM(prompt: string, system: string, forceFallback = false, customKey?: string): Promise<string> {
  const groqKeys = getGroqKeys();
  const hasGroqKeys = groqKeys.length > 0;

  // Check if we should directly force Gemini fallback (or if a custom key was supplied)
  const startIdx = (forceFallback || !hasGroqKeys || !!customKey) ? 1 : 0;

  if (startIdx === 1) {
    const model = process.env.LLM_FALLBACK_MODEL || "gemini-3.5-flash";
    console.log(`[MMP] Force Gemini fallback, no Groq keys, or custom key configured. Using ${model}...`);
    return callGemini(prompt, system, customKey);
  }

  // Filter keys that are not cooling down
  const activeKeys = groqKeys.filter(key => {
    const disableTime = disabledKeys.get(key) || 0;
    if (Date.now() < disableTime) {
      console.log(`[MMP] Skipping rate-limited Groq Key (cooling down for ${Math.round((disableTime - Date.now()) / 1000)}s)...`);
      return false;
    }
    return true;
  });

  if (activeKeys.length === 0) {
    const model = process.env.LLM_FALLBACK_MODEL || "gemini-3.5-flash";
    console.warn(`[MMP] All Groq API keys are currently rate-limited/cooling down. Falling back directly to ${model}...`);
    return callGemini(prompt, system, customKey);
  }

  console.log(`[MMP] Found ${activeKeys.length} active Groq API keys in pool (out of ${groqKeys.length}). Attempting Groq...`);

  for (let i = 0; i < activeKeys.length; i++) {
    const key = activeKeys[i];
    const keyAbbrev = key.length > 12
      ? key.substring(0, 8) + "..." + key.substring(key.length - 4)
      : "key_" + (i + 1);

    console.log(`[MMP] Trying Groq Key ${i + 1}/${activeKeys.length} (${keyAbbrev}) using llama-3.3-70b-versatile...`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt }
          ],
          temperature: 0,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        console.warn(`[MMP] Groq Key ${i + 1} rate-limited (429). Initiating 2-minute cooldown.`);
        disabledKeys.set(key, Date.now() + 120000); // 2 minutes cooldown
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty content in response");
      }

      console.log(`[MMP] Groq request succeeded using Key ${i + 1}.`);
      return content.replace(/```json|```/g, '').trim();
    } catch (err: any) {
      console.warn(`[MMP] Groq Key ${i + 1} failed: ${err.message || err}. Trying next key...`);
    }
  }

  // If all active Groq keys failed, fall back to Gemini
  const model = process.env.LLM_FALLBACK_MODEL || "gemini-3.5-flash";
  console.warn(`[MMP] All active Groq API keys failed. Falling back to ${model}...`);
  return callGemini(prompt, system, customKey);
}

async function callGemini(prompt: string, system: string, customKey?: string): Promise<string> {
  const geminiKey = customKey || process.env.GEMINI_API_KEY || process.env.LLM_FALLBACK_KEY;
  if (!geminiKey) {
    console.warn("[MMP-LLM] Gemini API key (GEMINI_API_KEY or LLM_FALLBACK_KEY) is not defined. Attempting Groq llama-3.3-70b-versatile as final self-healing fallback...");
    const groqKeys = getGroqKeys();
    if (groqKeys.length === 0) {
      throw new Error("Neither Groq API keys nor Gemini API key (GEMINI_API_KEY or LLM_FALLBACK_KEY) are configured in the environment.");
    }
    return callGroqFallback(prompt, system, groqKeys[0]);
  }

  const model = process.env.LLM_FALLBACK_MODEL || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: system + '\n\n' + prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error("Empty content in Gemini response");
    }

    console.log("[MMP] Gemini fallback summarization succeeded.");
    return content.replace(/```json|```/g, '').trim();
  } catch (err: any) {
    console.error("[MMP] Gemini fallback also failed:", err);
    throw new Error(`All LLM providers failed. Gemini Error: ${err.message || err}`);
  }
}

async function callGroqFallback(prompt: string, system: string, key: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ],
        temperature: 0.1, // slightly higher temperature to encourage creative structural compliance
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty content in Groq fallback response");
    }

    console.log("[MMP-LLM] Groq final self-healing fallback succeeded.");
    return content.replace(/```json|```/g, '').trim();
  } catch (err: any) {
    throw new Error(`Groq final self-healing fallback failed: ${err.message || err}`);
  }
}
