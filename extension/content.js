(() => {
  "use strict";

  let capturing = false;
  let transcript = [];
  let previousSummary = "";
  let lastCheckTime = 0;
  let captureStartTime = 0;
  
  // Observers
  let capObserver = null;

  // 1. LIGHTWEIGHT PROMISE-BASED INDEXEDDB WRAPPER
  const DB_NAME = "MMP_RECOVERY_DB";
  const STORE_NAME = "recovery";
  
  const getDBStore = () => new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
  });

  const idb = {
    get: async (key) => {
      const db = await getDBStore();
      return new Promise((resolve) => {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
      });
    },
    set: async (key, val) => {
      const db = await getDBStore();
      db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(val, key);
    },
    del: async (key) => {
      const db = await getDBStore();
      db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key);
    }
  };

  // 3. CAPTION CAPTURE & DEDUPLICATION: Enhanced first commit manual engine
  const lastTexts = new Set();

  const handleMutation = () => {
    if (!capturing) return;
    const now = Date.now();
    if (now - lastCheckTime < 333) return; // Throttle to 3 checks/sec
    lastCheckTime = now;

    // Observe targeted landmarks to avoid notification hijacking, fall back to standard selectors
    const el = document.querySelector('[role="region"][aria-label*="caption" i], [role="region"][aria-label*="subt" i], div[aria-live="polite"], [jsname="tgaKEf"]');
    if (!el) return;

    const text = el.textContent.trim();
    if (!text) return;

    // Hash-based deduplication
    const hash = text.toLowerCase();
    if (lastTexts.has(hash)) return;
    lastTexts.add(hash);

    // Limit set size to prevent memory leak
    if (lastTexts.size > 200) {
      const first = lastTexts.values().next().value;
      lastTexts.delete(first);
    }

    transcript.push(text);
    console.log(`[MMP] Captured line ${transcript.length}: "${text.substring(0, 80)}"`);
    
    // Notify popup that captions are flowing
    try {
      chrome.runtime.sendMessage({ event: "captionsDetected" });
    } catch (_) {}
  };

  // 5. PERFORMANCE: Keep observers active on document.body to survive container unmounts
  const startObserving = () => {
    disconnectObservers();
    capObserver = new MutationObserver(handleMutation);
    // Always observe body globally to remain immune to captions container unmounting
    capObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    console.log("[MMP] MutationObserver active globally on document.body.");
  };

  const disconnectObservers = () => {
    if (capObserver) {
      capObserver.disconnect();
      capObserver = null;
    }
  };

  // 6. AUTO-SAVE & STATE RECOVERY: every 15s to IndexedDB
  setInterval(() => {
    if (capturing && transcript.length > 0) {
      idb.set("mmp-recovery", { transcript, previousSummary, captureStartTime });
      console.log("[MMP] Auto-saved recovery state to IndexedDB");
    }
  }, 15000);

  // Restore on load
  const restoreRecoveryState = async () => {
    try {
      const recovered = await idb.get("mmp-recovery");
      if (recovered && recovered.transcript) {
        transcript = recovered.transcript;
        previousSummary = recovered.previousSummary || "";
        captureStartTime = recovered.captureStartTime || 0;
        
        // Re-seed dedup set from recovered transcript
        for (const line of transcript) {
          lastTexts.add(line.toLowerCase());
        }
        
        if (captureStartTime > 0) {
          capturing = true;
          startObserving();
          console.log("[MMP] Auto-resumed capturing from recovered state.");
        }
        
        console.log("[MMP] Restored recovered state containing lines:", transcript.length);
      }
    } catch (err) {
      console.error("[MMP] Error restoring IndexedDB state:", err);
    }
  };

  // 6.5. AUTOMATED HANGUP/LEAVE SUPERVISOR (Path-only, no DOM button dependency)
  let hadMeetControls = false;
  
  const checkMeetingEndStatus = () => {
    if (!capturing) return;
    
    const isMeetSession = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(window.location.pathname);
    
    if (isMeetSession) {
      hadMeetControls = true;
    } else if (!isMeetSession && hadMeetControls) {
      console.log("[MMP] Auto-Supervisor detected hangup/leave. Ending capture...");
      capturing = false;
      hadMeetControls = false;
      
      disconnectObservers();
      
      const fullText = transcript.join("\n");
      idb.del("mmp-recovery");
      
      if (transcript.length > 0) {
        chrome.runtime.sendMessage({ 
          action: "autoStopAndSummarize", 
          transcript: fullText, 
          summary: previousSummary 
        });
      }
    }
  };
  
  setInterval(checkMeetingEndStatus, 2500);

  // 7. Message Router for popup.js triggers
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.action === "start") {
      capturing = true;
      captureStartTime = Date.now();
      startObserving();
      sendResponse({ ok: true });
    } else if (msg.action === "stop") {
      capturing = false;
      captureStartTime = 0;
      disconnectObservers();

      const fullText = transcript.join("\n");
      
      // Synchronous chunking (avoids CSP Worker block that killed the original Web Worker approach)
      const chunks = [];
      for (let i = 0; i < fullText.length; i += 11200) {
        chunks.push(fullText.substring(i, i + 11200));
      }

      idb.del("mmp-recovery");
      console.log(`[MMP] Stop: sending ${transcript.length} lines (${fullText.length} chars) to popup.`);
      sendResponse({ ok: true, transcript: fullText, summary: previousSummary, chunks });
    } else if (msg.action === "clear") {
      transcript = [];
      lastTexts.clear();
      previousSummary = "";
      captureStartTime = 0;
      idb.del("mmp-recovery");
      sendResponse({ ok: true });
    } else if (msg.action === "ping") {
      const liveDiv = document.querySelector('[role="region"][aria-label*="caption" i], [role="region"][aria-label*="subt" i], div[aria-live="polite"], [jsname="tgaKEf"]');
      const isCaptionsOn = capturing || transcript.length > 0 || !!liveDiv;
      sendResponse({ ok: true, capturing, lines: transcript.length, startTime: captureStartTime, isCaptionsOn });
    }
    return true; // Keep channel open async
  });

  // Startup restore
  restoreRecoveryState();

  // Clean exit
  window.addEventListener("beforeunload", () => {
    disconnectObservers();
  });

  console.log("[MMP] Content script fully loaded.");
})();
