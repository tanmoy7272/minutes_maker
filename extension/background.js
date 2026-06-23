/**
 * background.js — Meet Minutes Pro Service Worker v1.2.0 (Whisper Audio Capture Edition)
 *
 * Responsibilities:
 * 1. Coordinates offscreen tab audio capture document lifecycle.
 * 2. Maintains transcription state and recovery backups in chrome.storage.local (Stateless / Sleep-safe).
 * 3. Handles sequential Groq/Gemini API calls on Stop or Auto-Hangup.
 */

const PORTAL_URL = "https://minutes-maker-five.vercel.app/";

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

  chrome.alarms.create("offscreenHeartbeat", { periodInMinutes: 1 });

  if (details.reason === "install") {
    chrome.tabs.create({ url: PORTAL_URL });
  }

  console.log(`[Meet Minutes Pro] Whisper Audio Capture installed v1.2.0`);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("offscreenHeartbeat", { periodInMinutes: 1 });
});

// Helper to check if offscreen document is active with backward compatibility support
const hasOffscreenDocument = async () => {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"]
      });
      return contexts.length > 0;
    } catch (_) {
      return false;
    }
  }
  return false;
};

// ── Offscreen Audio Capturing Lifecycle Manager ──────────────────────────────
const startAudioCapture = async (tabId) => {
  try {
    const active = await hasOffscreenDocument();
    if (active) {
      console.log("[Meet Minutes Pro] Offscreen capture document already active.");
      return;
    }

    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Capture standard tab audio stream for Whisper speech-to-text"
      });
      console.log("[Meet Minutes Pro] Offscreen Audio Capture document created successfully.");
    } catch (createErr) {
      if (createErr.message && createErr.message.includes("Only one offscreen document")) {
        console.log("[Meet Minutes Pro] Offscreen capture document already active (via create error).");
      } else {
        throw createErr;
      }
    }
  } catch (err) {
    console.error("[Meet Minutes Pro] Failed to start active tab capture:", err);
    throw err;
  }
};

const stopAudioCapture = async () => {
  try {
    try {
      await chrome.runtime.sendMessage({ action: "stopCapture" });
    } catch (_) { }

    const active = await hasOffscreenDocument();
    if (active || (typeof chrome !== "undefined" && typeof chrome.runtime.getContexts === "undefined")) {
      try {
        await chrome.offscreen.closeDocument();
        console.log("[Meet Minutes Pro] Offscreen capture document closed.");
      } catch (closeErr) {
        if (closeErr.message && !closeErr.message.includes("No offscreen document")) {
          console.warn("[Meet Minutes Pro] Error closing offscreen document:", closeErr);
        }
      }
    }
  } catch (err) {
    console.warn("[Meet Minutes Pro] Error in stopAudioCapture:", err);
  }
};

// ── Tab Closed → Cleanup ─────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(["activeTabId"], (data) => {
    if (data.activeTabId && data.activeTabId === tabId) {
      console.log("[Meet Minutes Pro] Active Meet tab closed — tearing down capture.");
      cleanupActiveSession();
    }
  });
});

const cleanupActiveSession = () => {
  chrome.storage.local.set({
    capturing: false,
    activeTabId: null,
    captureStartTime: 0
  });

  stopAudioCapture();
};



// ── Background API Summarizer (Force Upgrade safe) ───────────────────────────
const callSummarizeAPI = async (prevSummary, transcriptText, isRetry = false) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 60000); // 60s timeout
  try {
    const dataStorage = await new Promise((resolve) => {
      chrome.storage.local.get(["customGeminiKey"], resolve);
    });
    const headers = { "Content-Type": "application/json" };
    if (dataStorage && dataStorage.customGeminiKey) {
      headers["x-custom-gemini-key"] = dataStorage.customGeminiKey;
    }

    const res = await fetch(`${PORTAL_URL}api/summarize`, {
      method: "POST",
      headers,
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
    return data;
  } catch (e) {
    clearTimeout(t);
    if (e.message === "Update required") throw e;
    if (!isRetry) return callSummarizeAPI(prevSummary, transcriptText, true); // Retry once
    throw e;
  }
};

// ── Coordinated Stop & Queue State Variables ─────────────────────────────────
let pendingStopResponse = null;
let isAutoStopping = false;
let transcriptQueue = Promise.resolve();

// ── Serialization Queue Helper to prevent concurrent storage overwrite races ──
const appendToTranscript = (cleanText) => {
  transcriptQueue = transcriptQueue.then(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get(["transcript"], (data) => {
        const currentTranscript = data.transcript || [];
        currentTranscript.push(cleanText);
        chrome.storage.local.set({ transcript: currentTranscript }, () => {
          // Notify active popup that new transcript text has flowed in
          try {
            chrome.runtime.sendMessage({ event: "captionsDetected" });
          } catch (_) { }
          resolve();
        });
      });
    });
  });
};

// ── Coordinated Shutdown & Finalization Handlers ─────────────────────────────
const finalizeStopAndResponse = () => {
  chrome.storage.local.get(["transcript", "isAutoStopping"], (data) => {
    const fullText = (data.transcript || []).join("\n");
    const isAuto = !!data.isAutoStopping;

    cleanupActiveSession();
    chrome.storage.local.set({ isAutoStopping: false });

    if (isAuto) {
      if (fullText.trim().length > 0) {
        console.log("[Meet Minutes Pro] Auto-summarizing final transcript of length:", fullText.length);
        callSummarizeAPI("", fullText)
          .then((summaryRes) => {
            const payload = JSON.stringify({ markdown: summaryRes.markdown, structuredData: summaryRes.structuredData });
            const bytes = new TextEncoder().encode(payload);
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
    } else if (pendingStopResponse) {
      const chunks = [];
      for (let i = 0; i < fullText.length; i += 11200) {
        chunks.push(fullText.substring(i, i + 11200));
      }
      pendingStopResponse({ ok: true, transcript: fullText, summary: "", chunks });
      pendingStopResponse = null;
    }
  });
};

const triggerStopFlow = async () => {
  try {
    const active = await hasOffscreenDocument();
    if (active || (typeof chrome !== "undefined" && typeof chrome.runtime.getContexts === "undefined")) {
      console.log("[Meet Minutes Pro] Active offscreen context found. Requesting stop Capture...");
      chrome.runtime.sendMessage({ action: "stopCapture" }, () => {
        if (chrome.runtime.lastError) {
          console.warn("[Meet Minutes Pro] Error messaging offscreen:", chrome.runtime.lastError);
          finalizeStopAndResponse();
        }
      });
    } else {
      console.log("[Meet Minutes Pro] No active offscreen document found during stop flow. Finalizing immediately.");
      finalizeStopAndResponse();
    }
  } catch (err) {
    console.error("[Meet Minutes Pro] Error in triggerStopFlow:", err);
    finalizeStopAndResponse();
  }
};

// ── Message Router (Stateless / Storage-driven to prevent Service Worker sleep races) ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "start") {
    const tabId = sender.tab?.id || msg.tabId;
    const streamId = msg.streamId;

    if (!tabId || !streamId) {
      sendResponse({ ok: false, error: "Missing active tab ID or capture stream ID" });
      return;
    }

    const startTime = Date.now();

    chrome.storage.local.set({
      capturing: true,
      captureStartTime: startTime,
      activeTabId: tabId,
      tempStreamId: streamId,
      transcript: []
    }, () => {
      startAudioCapture(tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          cleanupActiveSession();
          sendResponse({ ok: false, error: err.message });
        });
    });

    return true; // Keep channel open async
  } else if (msg.action === "launchOffscreen") {
    startAudioCapture()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // Keep channel open async
  } else if (msg.action === "startCaptureState") {
    const startTime = Date.now();
    chrome.storage.local.set({
      capturing: true,
      captureStartTime: startTime,
      activeTabId: msg.tabId,
      tempStreamId: msg.streamId, // Store the stream ID!
      transcript: []
    }, () => {
      sendResponse({ ok: true, startTime });
    });
    return true; // Keep channel open async
  } else if (msg.action === "stop") {
    pendingStopResponse = sendResponse;
    isAutoStopping = false;
    triggerStopFlow();
    return true; // Keep channel open async
  } else if (msg.action === "clear") {
    chrome.storage.local.set({ transcript: [] }, () => {
      cleanupActiveSession();
      sendResponse({ ok: true });
    });
  } else if (msg.action === "ping") {
    chrome.storage.local.get(["capturing", "transcript", "captureStartTime"], (data) => {
      console.log("[MMP-SW-Sync] SW Ping received. Current local storage state:", data);
      const isCap = !!data.capturing;
      const lines = data.transcript ? data.transcript.length : 0;
      sendResponse({
        ok: true,
        capturing: isCap,
        lines,
        startTime: data.captureStartTime || 0,
        isCaptionsOn: isCap || lines > 0
      });
    });
    return true; // Keep channel open async
  } else if (msg.action === "audioSegmentTranscribed") {
    const cleanText = msg.text?.trim();
    if (cleanText) {
      appendToTranscript(cleanText);
    }
  } else if (msg.action === "autoStopAndSummarize") {
    chrome.storage.local.get(["capturing"], (data) => {
      if (!data.capturing) return; // Already manually stopped or not capturing

      console.log("[Meet Minutes Pro] Supervisor detected hangup. Initiating auto-stop...");
      chrome.storage.local.set({ isAutoStopping: true }, () => {
        pendingStopResponse = null;
        triggerStopFlow();
      });
    });
  } else if (msg.action === "offscreenCleanupComplete") {
    console.log("[Meet Minutes Pro] Offscreen cleanup completed. Waiting for writing queue to drain...");
    transcriptQueue = transcriptQueue.then(() => {
      return new Promise((resolveQueue) => {
        console.log("[Meet Minutes Pro] Offscreen cleanup completed. Closing document...");
        chrome.offscreen.closeDocument()
          .then(() => {
            console.log("[Meet Minutes Pro] Offscreen capture document closed successfully.");
          })
          .catch(err => console.log("[Meet Minutes Pro] Error closing offscreen document:", err))
          .finally(() => {
            finalizeStopAndResponse();
            resolveQueue();
          });
      });
    });
  }
});

// ── Heartbeat Alarm Event Handler ──────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "offscreenHeartbeat") {
    chrome.storage.local.get(["capturing", "activeTabId", "tempStreamId"], async (data) => {
      if (data.capturing) {
        const active = await hasOffscreenDocument();
        if (!active) {
          console.warn("[MMP-Heartbeat] Capturing state is TRUE but offscreen document is missing. Recreating...");
          try {
            await startAudioCapture(data.activeTabId);
            if (data.tempStreamId) {
              setTimeout(() => {
                chrome.runtime.sendMessage({ action: "initiateCapture", streamId: data.tempStreamId });
              }, 1000);
            }
          } catch (err) {
            console.error("[MMP-Heartbeat] Crash recovery failed:", err);
          }
        } else {
          try {
            chrome.runtime.sendMessage({ action: "pingOffscreen" }, (res) => {
              if (chrome.runtime.lastError || !res || !res.ok) {
                console.warn("[MMP-Heartbeat] Offscreen failed to respond. Recreating stream...");
                stopAudioCapture().then(() => {
                  startAudioCapture(data.activeTabId).then(() => {
                    if (data.tempStreamId) {
                      chrome.runtime.sendMessage({ action: "initiateCapture", streamId: data.tempStreamId });
                    }
                  });
                });
              }
            });
          } catch (_) {}
        }
      }
    });
  }
});
