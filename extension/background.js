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
  chrome.storage.local.get(["activeTabId", "capturing", "transcript"], (data) => {
    if (data.activeTabId && data.activeTabId === tabId) {
      console.log("[Meet Minutes Pro] Active Meet tab closed — checking if summary compilation is needed.");
      const hasTranscript = data.transcript && data.transcript.length > 0;
      if (data.capturing && hasTranscript) {
        console.log("[Meet Minutes Pro] Capturing was active with transcript. Setting isAutoStopping = true to trigger auto-summarization on offscreen cleanup.");
        chrome.storage.local.set({ isAutoStopping: true }, () => {
          // We wait for the offscreen document to notice the track ended,
          // flush the final audio, and send offscreenCleanupComplete.
          // If the offscreen document doesn't respond within 5 seconds, we run a safety cleanup.
          setTimeout(() => {
            chrome.storage.local.get(["activeTabId"], (status) => {
              if (status.activeTabId === tabId) {
                console.warn("[Meet Minutes Pro] Offscreen cleanup timed out after tab close. Forcing cleanup.");
                finalizeStopAndResponse();
              }
            });
          }, 5000);
        });
      } else {
        console.log("[Meet Minutes Pro] No active capturing or empty transcript. Tearing down immediately.");
        cleanupActiveSession();
      }
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
// Helper to save to local history in the service worker
const saveToExtensionHistory = (markdownText) => {
  const titleMatch = markdownText.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "Meeting Minutes";
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  chrome.storage.local.get(["extension_history"], (data) => {
    const history = data.extension_history || [];
    const isDuplicate = history.some(h => h.markdown === markdownText);
    if (isDuplicate) return;
    
    const newItem = {
      id: String(Date.now()),
      title,
      date: dateStr,
      markdown: markdownText
    };
    history.unshift(newItem);
    if (history.length > 10) history.pop();
    chrome.storage.local.set({ extension_history: history });
  });
};

const finalizeStopAndResponse = () => {
  chrome.storage.local.get(["transcript"], (data) => {
    const fullText = (data.transcript || []).join("\n");

    cleanupActiveSession();
    chrome.storage.local.set({ isAutoStopping: false });

    if (fullText.trim().length > 0) {
      console.log("[Meet Minutes Pro] Summarizing final transcript of length:", fullText.length);
      
      // Notify popup compilation has started
      try {
        chrome.runtime.sendMessage({ event: "compilationStarted" });
      } catch (_) {}

      callSummarizeAPI("", fullText)
        .then((summaryRes) => {
          // Save to local extension history
          saveToExtensionHistory(summaryRes.markdown);

          // Clear the transcript on successful compilation
          chrome.storage.local.set({ transcript: [] });

          const payload = JSON.stringify({ markdown: summaryRes.markdown, structuredData: summaryRes.structuredData });
          const bytes = new TextEncoder().encode(payload);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const encoded = btoa(binary);
          chrome.tabs.create({ url: `${PORTAL_URL}result#${encoded}` });

          // Notify popup compilation completed successfully
          try {
            chrome.runtime.sendMessage({ event: "compilationCompleted", success: true });
          } catch (_) {}
        })
        .catch((err) => {
          console.error("[Meet Minutes Pro] Summarization failed:", err);
          try {
            chrome.runtime.sendMessage({ event: "compilationCompleted", success: false, error: err.message || "Summarization failed" });
          } catch (_) {}
        });
    } else {
      console.log("[Meet Minutes Pro] Empty transcript, nothing to summarize.");
      try {
        chrome.runtime.sendMessage({ event: "compilationCompleted", success: false, error: "No transcription was recorded during the call." });
      } catch (_) {}
    }

    if (pendingStopResponse) {
      pendingStopResponse({ ok: true });
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
    return true; // Keep channel open async
  } else if (msg.action === "keepAlive") {
    sendResponse({ ok: true });
    return true; // Keep channel open async
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
    chrome.storage.local.get(["capturing", "activeTabId", "tempStreamId", "captureStartTime"], async (data) => {
      if (data.capturing) {
        // Skip check if capture started recently (within 15 seconds) to avoid startup race conditions
        const elapsed = Date.now() - (data.captureStartTime || 0);
        if (elapsed < 15000) {
          console.log("[MMP-Heartbeat] Capture session started recently. Skipping heartbeat check.");
          return;
        }

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
