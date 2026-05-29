// Loader for Groq keys from environment variables
const getGroqKeys = (): string[] => {
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

export async function callLLM(prompt: string, system: string, forceFallback = false): Promise<string> {
  const groqKeys = getGroqKeys();
  const hasGroqKeys = groqKeys.length > 0;
  
  // Check if we should directly force Gemini fallback
  const startIdx = (forceFallback || !hasGroqKeys) ? 1 : 0;
  
  if (startIdx === 1) {
    console.log("[MMP] Force Gemini fallback or no Groq keys configured. Using Gemini 1.5 Pro...");
    return callGemini(prompt, system);
  }
  
  // Try Groq Keys Sequentially
  console.log(`[MMP] Found ${groqKeys.length} Groq API keys in pool. Attempting Groq...`);
  
  for (let i = 0; i < groqKeys.length; i++) {
    const key = groqKeys[i];
    const keyAbbrev = key.length > 12 
      ? key.substring(0, 8) + "..." + key.substring(key.length - 4) 
      : "key_" + (i + 1);
      
    console.log(`[MMP] Trying Groq Key ${i + 1}/${groqKeys.length} (${keyAbbrev}) using llama-3.3-70b-versatile...`);
    
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
  
  // If all Groq keys failed, fall back to Gemini
  console.warn("[MMP] All Groq API keys failed. Falling back to Gemini 1.5 Pro...");
  return callGemini(prompt, system);
}

async function callGemini(prompt: string, system: string): Promise<string> {
  const geminiKey = process.env.LLM_FALLBACK_KEY;
  if (!geminiKey) {
    throw new Error("Gemini fallback key (LLM_FALLBACK_KEY) is not defined");
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiKey}`;
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
