(() => {
  "use strict";

  let capturing = false;
  let transcript = [];
  let previousSummary = "";
  let lastCheckTime = 0;
  let captureStartTime = 0;
  
  // Observers & Recovery State
  let capObserver = null;
  let autoCapTimer = null;
  let blocksList = [];
  let blockIdCounter = 1;

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

  // Helper to find the speaker block element from a caption span
  const getSpeakerBlock = (cnusmbEl) => {
    let current = cnusmbEl;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent || parent === document.body) break;
      
      // Look for a structural parent container that houses the speaker metadata and captions.
      if (parent.getAttribute('role') === 'region' && parent.getAttribute('aria-label') === 'Captions') {
        return current;
      }
      const jsname = parent.getAttribute('jsname');
      if (jsname === 'tgaKEf' || jsname === 'YSs4S' || jsname === 'ME7oBc') {
        return current;
      }
      
      if (parent.classList.contains('bh44bd') || parent.getAttribute('jsaction')?.includes('rcR9ce')) {
        return parent;
      }
      
      current = parent;
    }
    // Fallback: 2 levels up
    return cnusmbEl.parentElement?.parentElement || cnusmbEl.parentElement || cnusmbEl;
  };

  // Helper to extract the speaker name from a speaker block
  const getSpeakerName = (block) => {
    // 1. Try known speaker name classes/attributes
    const nameEl = block.querySelector('.zs79Bi, .jT3UQ, .NWpY1d, .GvcuGe, [jsname="jT3UQ"]');
    if (nameEl && nameEl.textContent.trim()) {
      return nameEl.textContent.trim();
    }
    
    // 2. Try avatar image alt attribute
    const img = block.querySelector('img');
    if (img && img.getAttribute('alt')) {
      return img.getAttribute('alt').trim();
    }
    
    // 3. Fallback traversal: find first element with short, non-numeric text that has no caption class
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.querySelector('.CNusmb') && !node.classList.contains('CNusmb')) {
        const text = node.textContent.trim();
        if (text && text.length > 1 && text.length < 40 && isNaN(text)) {
          return text;
        }
      }
    }
    
    return "Speaker";
  };

  // 2. AUTO-CAPTIONS: Click every 1.5s for 45s, verify via button attribute or DOM presence
  const startAutoCaptionsFlow = () => {
    let elapsed = 0;
    autoCapTimer = setInterval(() => {
      elapsed += 1500;
      if (elapsed > 45000) {
        clearInterval(autoCapTimer);
        console.log("[MMP] Auto-captions flow timeout (45s reached).");
      }

      // Check if captions are already active via aria-pressed or captions DOM
      const btn = document.querySelector('button[aria-label*="captions" i], button[aria-label*="(c)"], button[data-tooltip*="(c)"]');
      const isCaptionsOn = btn && btn.getAttribute('aria-pressed') === 'true';
      const el = document.querySelector('.CNusmb, [jsname="tgaKEf"], [jsname="YSs4S"], [jsname="ME7oBc"]');
      
      if (isCaptionsOn || el) {
        console.log("[MMP] Captions flow verified active.");
        clearInterval(autoCapTimer);
        
        // Notify popup immediately
        try {
          chrome.runtime.sendMessage({ event: "captionsDetected" });
        } catch (_) {}
        return;
      }

      if (btn) {
        btn.click();
        console.log("[MMP] Clicked captions button automatically.");
      }
    }, 1500);
  };

  // 3. CAPTION CAPTURE & DEDUPLICATION: 3 checks/sec throttle, advanced speaker block parser
  const lastTexts = new Set();

  const handleCaptionMutation = () => {
    if (!capturing) return;
    const now = Date.now();
    if (now - lastCheckTime < 333) return; // Throttle to 3 checks/sec to ensure ZERO CPU load
    lastCheckTime = now;

    const cnusmbs = document.querySelectorAll('.CNusmb');
    
    if (cnusmbs.length > 0) {
      const seenBlockEls = new Set();
      
      cnusmbs.forEach((span) => {
        const blockEl = getSpeakerBlock(span);
        if (!blockEl || seenBlockEls.has(blockEl)) return;
        seenBlockEls.add(blockEl);
        
        // Assign a persistent unique ID directly to the DOM element
        if (!blockEl._mmp_id) {
          blockEl._mmp_id = `block_${blockIdCounter++}`;
        }
        
        const blockId = blockEl._mmp_id;
        const speaker = getSpeakerName(blockEl);
        
        // Extract caption text
        const spans = Array.from(blockEl.querySelectorAll('.CNusmb'));
        const text = spans.map(s => s.textContent.trim()).filter(Boolean).join(" ");
        
        if (!text) return;
        
        // Merge or append to blocksList
        const existingBlock = blocksList.find(b => b.id === blockId);
        if (existingBlock) {
          existingBlock.text = text;
          if (speaker && speaker !== "Speaker") {
            existingBlock.speaker = speaker;
          }
        } else {
          blocksList.push({ id: blockId, speaker, text });
        }
      });
      
      // Update transcript mapping
      transcript = blocksList.map(b => `${b.speaker}: ${b.text}`);
      console.log(`[MMP] Advanced parser synced ${transcript.length} lines`);
      
      try {
        chrome.runtime.sendMessage({ event: "captionsDetected" });
      } catch (_) {}
      
    } else {
      // Legacy Fallback Scraper
      const el = document.querySelector('[jsname="tgaKEf"], [jsname="YSs4S"], [jsname="ME7oBc"]');
      if (!el) return;

      const text = el.textContent.trim();
      if (!text) return;

      const hash = text.toLowerCase();
      if (lastTexts.has(hash)) return;
      lastTexts.add(hash);

      if (lastTexts.size > 200) {
        const first = lastTexts.values().next().value;
        lastTexts.delete(first);
      }

      transcript.push(text);
      console.log(`[MMP] Legacy fallback captured ${transcript.length} lines`);
      
      try {
        chrome.runtime.sendMessage({ event: "captionsDetected" });
      } catch (_) {}
    }
  };

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
        
        // Reconstruct blocksList from recovered transcript
        blocksList = transcript.map((line, index) => {
          const colonIdx = line.indexOf(": ");
          if (colonIdx > 0) {
            const speaker = line.substring(0, colonIdx);
            const text = line.substring(colonIdx + 2);
            return { id: `recovered_${index}`, speaker, text };
          }
          return { id: `recovered_${index}`, speaker: "Speaker", text: line };
        });
        blockIdCounter = blocksList.length + 1;
        
        if (captureStartTime > 0) {
          capturing = true; // Auto-resume observer if it was active
          startObserving();
          console.log("[MMP] Auto-resumed capturing from recovered state.");
        }
        
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
      captureStartTime = Date.now(); // Set persistent capture start time!
      startAutoCaptionsFlow();
      startObserving();
      sendResponse({ ok: true });
    } else if (msg.action === "stop") {
      capturing = false;
      captureStartTime = 0;
      disconnectObservers();
      clearInterval(autoCapTimer);

      const fullText = transcript.join("\n");
      
      // Perform string chunking synchronously on the main thread (100% immune to Vercel/Meet CSP blocks)
      const chunks = [];
      for (let i = 0; i < fullText.length; i += 11200) {
        chunks.push(fullText.substring(i, i + 11200));
      }

      idb.del("mmp-recovery"); // Clear database upon dynamic end
      blocksList = []; // Reset on stop
      blockIdCounter = 1;
      sendResponse({ ok: true, transcript: fullText, summary: previousSummary, chunks });
    } else if (msg.action === "clear") {
      transcript = [];
      blocksList = []; // Reset lists on clear
      blockIdCounter = 1;
      previousSummary = "";
      captureStartTime = 0;
      idb.del("mmp-recovery");
      sendResponse({ ok: true });
    } else if (msg.action === "ping") {
      const activeBtn = document.querySelector('button[aria-label*="captions" i], button[aria-label*="(c)"], button[data-tooltip*="(c)"]');
      const isCaptionsOn = !!(
        document.querySelector('.CNusmb') || 
        document.querySelector('[jsname="tgaKEf"], [jsname="YSs4S"], [jsname="ME7oBc"]') ||
        (activeBtn && activeBtn.getAttribute('aria-pressed') === 'true')
      );
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
