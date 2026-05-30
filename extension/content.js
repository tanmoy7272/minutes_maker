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

  // 2. AUTO-CAPTIONS: Click captions button every 1.5s for up to 45s, verify with aria-live="polite"
  const startAutoCaptionsFlow = () => {
    let elapsed = 0;
    autoCapTimer = setInterval(() => {
      elapsed += 1500;
      if (elapsed > 45000) {
        clearInterval(autoCapTimer);
        console.log("[MMP] Auto-captions flow timeout (45s reached).");
        return;
      }

      const btn = document.querySelector('button[aria-label*="captions" i], button[aria-label*="(c)"], button[data-tooltip*="(c)"]');
      if (btn && btn.getAttribute("aria-pressed") !== "true") {
        btn.click();
        console.log("[MMP] Clicked captions button automatically.");
      }

      // Verify captions are active via the ORIGINAL working selector
      const liveDiv = document.querySelector('div[aria-live="polite"]');
      if (liveDiv) {
        console.log("[MMP] Captions flow verified active via aria-live='polite'.");
        clearInterval(autoCapTimer);
        try { chrome.runtime.sendMessage({ event: "captionsDetected" }); } catch (_) {}
      }
    }, 1500);
  };

  // 3. CAPTION CAPTURE — ORIGINAL WORKING LOGIC from commit 6bed6c8
  // Uses the W3C accessibility standard selector div[aria-live="polite"] which Google
  // is required to maintain for screen reader compliance. This is the selector that
  // WORKED PERFECTLY before it was removed in commit cadbf45.
  const lastTexts = new Set();

  const handleMutation = () => {
    if (!capturing) return;
    const now = Date.now();
    if (now - lastCheckTime < 333) return; // Throttle to 3 checks/sec
    lastCheckTime = now;

    // THE ORIGINAL WORKING SELECTOR — aria-live="polite" is a W3C WCAG standard, not a Google class name
    const el = document.querySelector('div[aria-live="polite"], [jsname="tgaKEf"]');
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

  // 5. OBSERVER: Target the captions container directly, fallback to document.body
  const startObserving = () => {
    disconnectObservers();
    capObserver = new MutationObserver(handleMutation);
    const target = document.querySelector('div[aria-live="polite"], [jsname="tgaKEf"]') || document.body;
    capObserver.observe(target, { childList: true, subtree: true, characterData: true });
    console.log(`[MMP] Observer registered on ${target === document.body ? 'document.body (fallback)' : 'captions container (direct)'}.`);
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
      clearInterval(autoCapTimer);
      
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
      startAutoCaptionsFlow();
      startObserving();
      sendResponse({ ok: true });
    } else if (msg.action === "stop") {
      capturing = false;
      captureStartTime = 0;
      disconnectObservers();
      clearInterval(autoCapTimer);

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
      const liveDiv = document.querySelector('div[aria-live="polite"]');
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
    clearInterval(autoCapTimer);
  });

  console.log("[MMP] Content script fully loaded.");
})();
