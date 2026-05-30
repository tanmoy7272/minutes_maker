/**
 * background.js — Meet Minutes Pro Service Worker v1.2.0 (Whisper Audio Capture Edition)
 *
 * Responsibilities:
 * 1. Coordinates offscreen tab audio capture document lifecycle.
 * 2. Maintains transcription state and recovery backups in chrome.storage.local.
 * 3. Handles sequential Groq/Gemini API calls on Stop or Auto-Hangup.
 */

const PORTAL_URL = "https://minutes-maker-five.vercel.app/";

// State variables maintained in storage and service worker memory
let capturing = false;
let transcript = [];
let captureStartTime = 0;
let activeTabId = null;

// ── Install / Update ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.set({ 
    version: "1.2.0", 
    portalUrl: PORTAL_URL,
    capturing: false,
    transcript: [],
    captureStartTime: 0,
    activeTabId: null
  });

  // alarm to check on active capture state
  chrome.alarms.create("healthCheck", { periodInMinutes: 1 });

  if (details.reason === "install") {
    chrome.tabs.create({ url: PORTAL_URL });
  }

  console.log(`[Meet Minutes Pro] Whisper Audio Capture installed v1.2.0`);
});

// Sync local service worker memory state from storage on load
const syncMemoryFromStorage = () => {
  chrome.storage.local.get(["capturing", "transcript", "captureStartTime", "activeTabId"], (data) => {
    capturing = !!data.capturing;
    transcript = data.transcript || [];
    captureStartTime = data.captureStartTime || 0;
    activeTabId = data.activeTabId || null;
  });
};
syncMemoryFromStorage();

// ── Offscreen Audio Capturing Lifecycle Manager ──────────────────────────────
const startAudioCapture = async (tabId) => {
  try {
    // 1. Check if offscreen context is already active
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    
    if (contexts.length > 0) {
      console.log("[Meet Minutes Pro] Offscreen capture document already active.");
      return;
    }

    // 2. Query standard stream ID for the active tab context
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(id);
        }
      });
    });

    // 3. Launch offscreen document with user media reason
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Capture standard tab audio stream for Whisper speech-to-text"
    });

    // 4. Send token to offscreen document to mount mediaRecorder
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: "initiateCapture",
        streamId,
        tabId
      });
    }, 500);

    console.log("[Meet Minutes Pro] Offscreen Audio Capture pipeline started successfully.");
  } catch (err) {
    console.error("[Meet Minutes Pro] Failed to start active tab capture:", err);
    throw err;
  }
};

const stopAudioCapture = async () => {
  try {
    // Notify offscreen script to stop recording and release AudioContext
    try {
      await chrome.runtime.sendMessage({ action: "stopCapture" });
    } catch (_) {}

    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    
    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
      console.log("[Meet Minutes Pro] Offscreen capture document closed.");
    }
  } catch (err) {
    console.warn("[Meet Minutes Pro] Error closing offscreen document:", err);
  }
};

// ── Tab Closed → Cleanup ─────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabId && activeTabId === tabId) {
    console.log("[Meet Minutes Pro] Active Meet tab closed — tearing down capture.");
    cleanupActiveSession();
  }
});

const cleanupActiveSession = () => {
  capturing = false;
  captureStartTime = 0;
  activeTabId = null;
  transcript = [];
  
  chrome.storage.local.set({
    capturing: false,
    activeTabId: null,
    captureStartTime: 0,
    transcript: []
  });

  stopAudioCapture();
};

// ── Health-Check Alarm ───────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "healthCheck") return;

  chrome.storage.local.get(["capturing", "activeTabId"], (data) => {
    if (!data.capturing || !data.activeTabId) return;

    // Send a safe ping message to tab to see if it's still alive
    chrome.tabs.sendMessage(
      data.activeTabId,
      { action: "ping" },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          console.warn("[Meet Minutes Pro] Health check failed — tearing down capturing.");
          cleanupActiveSession();
        }
      }
    );
  });
});

// ── Background API Summarizer (Force Upgrade safe) ───────────────────────────
const callSummarizeAPI = async (prevSummary, transcriptText, isRetry = false) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000); // 15s timeout
  try {
    const res = await fetch(`${PORTAL_URL}api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        previousSummary: prevSummary, 
        chunk: transcriptText,
        version: chrome.runtime.getManifest().version
      }),
      signal: controller.signal
    });
    clearTimeout(t);
    
    if (res.status === 426) {
      throw new Error("Update required");
    }
    
    if (!res.ok) throw new Error("Server rejected request");
    const data = await res.json();
    return data.markdown || "";
  } catch (e) {
    clearTimeout(t);
    if (e.message === "Update required") throw e;
    if (!isRetry) return callSummarizeAPI(prevSummary, transcriptText, true); // Retry once
    throw e;
  }
};

// ── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "start") {
    const tabId = sender.tab?.id || msg.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing active tab ID" });
      return;
    }

    capturing = true;
    captureStartTime = Date.now();
    activeTabId = tabId;
    transcript = [];

    chrome.storage.local.set({
      capturing: true,
      captureStartTime,
      activeTabId,
      transcript: []
    });

    startAudioCapture(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        cleanupActiveSession();
        sendResponse({ ok: false, error: err.message });
      });

    return true; // Keep channel open async
  } else if (msg.action === "stop") {
    // Notify offscreen to close down
    stopAudioCapture();

    const fullText = transcript.join("\n");
    const startTime = captureStartTime;

    cleanupActiveSession();

    // Split text into chunks for safe transmission
    const chunks = [];
    for (let i = 0; i < fullText.length; i += 11200) {
      chunks.push(fullText.substring(i, i + 11200));
    }

    sendResponse({ ok: true, transcript: fullText, summary: "", chunks });
    return true; // Keep channel open async
  } else if (msg.action === "clear") {
    cleanupActiveSession();
    sendResponse({ ok: true });
  } else if (msg.action === "ping") {
    sendResponse({ 
      ok: true, 
      capturing, 
      lines: transcript.length, 
      startTime: captureStartTime,
      isCaptionsOn: capturing || transcript.length > 0
    });
  } else if (msg.action === "audioSegmentTranscribed") {
    // Append the newly transcribed text segment from offscreen.js
    const cleanText = msg.text?.trim();
    if (cleanText) {
      transcript.push(cleanText);
      chrome.storage.local.set({ transcript });
      
      // Notify active popup that new transcript text has flowed in
      try {
        chrome.runtime.sendMessage({ event: "captionsDetected" });
      } catch (_) {}
    }
  } else if (msg.action === "autoStopAndSummarize") {
    console.log("[Meet Minutes Pro] Supervisor detected hangup. Auto-summarizing...");
    
    const fullText = transcript.join("\n");
    cleanupActiveSession();

    if (fullText.trim().length > 0) {
      callSummarizeAPI("", fullText)
        .then((markdown) => {
          const bytes = new TextEncoder().encode(markdown);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const encoded = btoa(binary);
          chrome.tabs.create({ url: `${PORTAL_URL}result#${encoded}` });
        })
        .catch((err) => {
          console.error("[Meet Minutes Pro] Auto-summarization failed:", err);
        });
    }
  }
});
