(() => {
  "use strict";

  let capturing = false;
  let transcript = [];
  let previousSummary = "";
  let lastText = "";
  let lastCheckTime = 0;
  
  // Observers
  let capObserver = null;
  let autoCapObs = null;
  let autoCapTimer = null;
  let observingBody = false;

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

  // 2. AUTO-CAPTIONS: Click every 1.5s for 45s, verify with button pressed state
  const startAutoCaptionsFlow = () => {
    let elapsed = 0;
    autoCapTimer = setInterval(() => {
      elapsed += 1500;
      if (elapsed > 45000) {
        clearInterval(autoCapTimer);
        console.log("[MMP] Auto-captions flow timeout (45s reached).");
      }

      const btn = document.querySelector('button[aria-label*="captions" i], button[aria-label*="(c)"], button[data-tooltip*="(c)"]');
      if (btn) {
        if (btn.getAttribute("aria-pressed") !== "true") {
          btn.click();
          console.log("[MMP] Clicked captions button automatically.");
        } else {
          console.log("[MMP] Captions flow verified active via button state.");
          clearInterval(autoCapTimer);
        }
      }
    }, 1500);
  };

  // 3. CAPTION CAPTURE & DEDUPLICATION: 3 checks/sec throttle, Hash-based deduplication
  const lastTexts = new Set();

  const handleMutation = () => {
    if (!capturing) return;
    const now = Date.now();
    if (now - lastCheckTime < 333) return; // Throttle to 3 checks/sec
    lastCheckTime = now;

    // Observe ONLY the real captions container
    const el = document.querySelector('[jsname="tgaKEf"]');
    if (!el) return;

    // Upgrade observer to target container if we were observing fallback body
    if (observingBody) {
      console.log("[MMP] Captions container detected. Upgrading observer for maximum CPU efficiency.");
      startObserving();
      return;
    }

    // Capture only when captions block is finalized (opacity=1)
    const style = window.getComputedStyle(el);
    if (style.opacity !== "1") return;

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

  // 5. PERFORMANCE: Keep observers active on actual captions container
  const startObserving = () => {
    if (capObserver) capObserver.disconnect();
    capObserver = new MutationObserver(handleMutation);
    const target = document.querySelector('[jsname="tgaKEf"]');
    if (target) {
      capObserver.observe(target, { childList: true, subtree: true, characterData: true });
      observingBody = false;
      console.log("[MMP] Observer registered directly on captions container.");
    } else {
      capObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      observingBody = true;
      console.log("[MMP] Observer registered on fallback document.body.");
    }
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

  // 6.5. AUTOMATED HANGUP/LEAVE SUPERVISOR
  let hadMeetControls = false;
  
  const checkMeetingEndStatus = () => {
    if (!capturing) return;
    
    // Target Google Meet's active hangup button
    const hangupBtn = document.querySelector('button[aria-label*="leave" i], button[aria-label*="call" i]');
    
    if (hangupBtn) {
      hadMeetControls = true;
    } else if (hadMeetControls) {
      // The call was active, but controls are now unmounted (meeting left/ended!)
      console.log("[MMP] Auto-Supervisor detected hangup/leave. Ending capture...");
      capturing = false;
      hadMeetControls = false;
      
      if (capObserver) capObserver.disconnect();
      clearInterval(autoCapTimer);
      
      const fullText = transcript.join("\n");
      idb.del("mmp-recovery"); // Clear recovery buffer
      
      if (transcript.length > 0) {
        // Send directly to background service worker to summarize and launch tab
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
      if (capObserver) capObserver.disconnect();
      clearInterval(autoCapTimer);

      // Process final chunk compilation in background thread via Web Worker
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
      idb.del("mmp-recovery");
      sendResponse({ ok: true });
    } else if (msg.action === "ping") {
      sendResponse({ ok: true, capturing, lines: transcript.length });
    }
    return true; // Keep channel open async
  });

  // Startup restore
  restoreRecoveryState();

  // Clean exit
  window.addEventListener("beforeunload", () => {
    if (capObserver) capObserver.disconnect();
    clearInterval(autoCapTimer);
  });

  console.log("[MMP] Content script fully loaded.");
})();
