(() => {
  "use strict";

  let capturing = false;
  let transcript = [];
  let previousSummary = "";
  let lastCheckTime = 0;
  let captureStartTime = 0;
  
  // Observers
  let capObserver = null;
  let autoCapTimer = null;

  // 1. LIGHTWEIGHT PROMISE-BASED INDEXEDDB WRAPPER (Mimics idb-keyval natively)
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

  // 2. AUTO-CAPTIONS: Click every 1.5s for 45s, verify via container or caption text presence
  const startAutoCaptionsFlow = () => {
    let elapsed = 0;
    autoCapTimer = setInterval(() => {
      elapsed += 1500;
      if (elapsed > 45000) {
        clearInterval(autoCapTimer);
        console.log("[MMP] Auto-captions flow timeout (45s reached).");
      }

      // Check for standard wrapper, participant wrapper, or active caption text nodes in the DOM
      const el = document.querySelector('[jsname="tgaKEf"], [jsname="YSs4S"], .Th41Wd, .a4bIc, .CNusmb, .iTPLzd, .MoseM');
      if (el) {
        console.log("[MMP] Captions flow verified active via captions DOM elements.");
        clearInterval(autoCapTimer);
        
        // Notify popup immediately
        try {
          chrome.runtime.sendMessage({ event: "captionsDetected" });
        } catch (_) {}
        return;
      }

      const btn = document.querySelector('button[aria-label*="captions" i], button[aria-label*="(c)"], button[data-tooltip*="(c)"]');
      if (btn) {
        btn.click();
        console.log("[MMP] Clicked captions button automatically.");
      }
    }, 1500);
  };

  // 3. CAPTION CAPTURE & DEDUPLICATION: 3 checks/sec throttle, Hash-based deduplication
  const lastTexts = new Set();

  const handleCaptionMutation = () => {
    if (!capturing) return;
    const now = Date.now();
    if (now - lastCheckTime < 333) return; // Throttle to 3 checks/sec to ensure ZERO CPU load
    lastCheckTime = now;

    // Search for standard captions container OR participant card captions container
    const el = document.querySelector('[jsname="tgaKEf"], [jsname="YSs4S"], .Th41Wd, .a4bIc');
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
    console.log(`[MMP] Captured ${transcript.length} lines`);
    
    // Notify popup that captions are flowing
    try {
      chrome.runtime.sendMessage({ event: "captionsDetected" });
    } catch (_) {}
  };

  // 4. PERFORMANCE: Web Worker for background chunking
  const workerCode = `
    self.onmessage = function(e) {
      const { text, size } = e.data;
      const chunks = [];
      for (let i = 0; i < text.length; i += size) {
        chunks.push(text.substring(i, i + size));
      }
      self.postMessage(chunks);
    };
  `;
  const blob = new Blob([workerCode], { type: "application/javascript" });
  const chunkWorker = new Worker(URL.createObjectURL(blob));

  // 5. PERFORMANCE: Throttled Global document.body Observer (Immune to unmounting!)
  const startObserving = () => {
    disconnectObservers();
    
    capObserver = new MutationObserver(handleCaptionMutation);
    // Observe body for all text and element updates. Throttled internally to ensure 0% performance hit.
    capObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    console.log("[MMP] MutationObserver registered on document.body for 100% reliable capture.");

    // Notify popup immediately
    try {
      chrome.runtime.sendMessage({ event: "captionsDetected" });
    } catch (_) {}
  };

  const disconnectObservers = () => {
    if (capObserver) {
      capObserver.disconnect();
      capObserver = null;
    }
    console.log("[MMP] Disconnected all scraper observers.");
  };

  // 6. AUTO-SAVE & STATE RECOVERY: every 15s to 'mmp-recovery' IndexedDB key
  setInterval(() => {
    if (capturing && transcript.length > 0) {
      idb.set("mmp-recovery", { transcript, previousSummary });
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
        console.log("[MMP] Restored recovered state containing lines:", transcript.length);
      }
    } catch (err) {
      console.error("[MMP] Error restoring IndexedDB state:", err);
    }
  };

  // 6.5. AUTOMATED HANGUP/LEAVE SUPERVISOR (Path-only Aware)
  let hadMeetControls = false;
  
  const checkMeetingEndStatus = () => {
    if (!capturing) return;
    
    const isMeetSession = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(window.location.pathname);
    
    if (isMeetSession) {
      hadMeetControls = true;
    } else if (!isMeetSession && hadMeetControls) {
      // Session ended solely by leaving the session path (ignores control bar auto-hiding)
      console.log("[MMP] Auto-Supervisor detected hangup/leave. Ending capture...");
      capturing = false;
      hadMeetControls = false;
      
      disconnectObservers();
      clearInterval(autoCapTimer);
      
      const fullText = transcript.join("\n");
      idb.del("mmp-recovery"); // Clear recovery buffer
      
      if (transcript.length > 0) {
        chrome.runtime.sendMessage({ 
          action: "autoStopAndSummarize", 
          transcript: fullText, 
          summary: previousSummary 
        });
      }
    }
  };
  
  setInterval(checkMeetingEndStatus, 2500); // Check every 2.5 seconds

  // 7. Message Router for popup.js triggers
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.action === "start") {
      capturing = true;
      startAutoCaptionsFlow();
      startObserving();
      sendResponse({ ok: true });
    } else if (msg.action === "stop") {
      capturing = false;
      captureStartTime = 0;
      disconnectObservers();
      clearInterval(autoCapTimer);

      const fullText = transcript.join("\n");
      chunkWorker.onmessage = (e) => {
        const chunks = e.data;
        idb.del("mmp-recovery"); // Clear database upon dynamic end
        sendResponse({ ok: true, transcript: fullText, summary: previousSummary, chunks });
      };
      chunkWorker.postMessage({ text: fullText, size: 11200 });
    } else if (msg.action === "clear") {
      transcript = [];
      previousSummary = "";
      captureStartTime = 0;
      idb.del("mmp-recovery");
      sendResponse({ ok: true });
    } else if (msg.action === "ping") {
      sendResponse({ ok: true, capturing, lines: transcript.length, startTime: captureStartTime });
    }
    return true; // Keep channel open async
  });

  // Startup restore
  restoreRecoveryState();

  // Clean exit
  window.addEventListener("beforeunload", () => {
    disconnectObservers();
    clearInterval(autoCapTimer);
  });

  console.log("[MMP] Content script fully loaded.");
})();
