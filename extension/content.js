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

  // Helper to find the captions toggle button using robust accessibility and shortcut labels
  const getCaptionsButton = () => {
    // 1. Try finding by accessibility labels on any element
    const selector = '[aria-label*="caption" i], [aria-label*="(c)"], [data-tooltip*="(c)"], [aria-label*="cc" i], [data-tooltip*="cc" i]';
    const el = document.querySelector(selector);
    if (el) {
      return el.closest('button') || el;
    }
    
    // 2. Traversal fallback: search text inside all buttons
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      const text = (btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || btn.textContent || '').toLowerCase();
      if (text.includes('caption') || text.includes('(c)') || text.includes('subtitles') || text.includes('cc')) {
        return btn;
      }
    }
    
    return null;
  };

  // Helper to determine the captions button toggle state (ON or OFF)
  const getCaptionsState = (btn) => {
    if (!btn) return false;
    
    // A. Check aria-pressed accessibility state
    const pressed = btn.getAttribute('aria-pressed') || btn.querySelector('[aria-pressed]')?.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
    
    // B. Check text description for toggle cues
    const label = (btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || btn.textContent || '').toLowerCase();
    if (label.includes('turn off') || label.includes('disable') || label.includes('desactivar') || label.includes('désactiver')) {
      return true;
    }
    if (label.includes('turn on') || label.includes('enable') || label.includes('activar') || label.includes('activer')) {
      return false;
    }
    
    return false;
  };

  // Helper to find the captions container element semantically
  const getCaptionsContainer = () => {
    // A. Search by accessibility region role
    let el = document.querySelector('[role="region"][aria-label*="caption" i]');
    if (el) return el;
    
    // B. Search by standard Google Meet developer containers
    el = document.querySelector('[jsname="tgaKEf"], [jsname="YSs4S"], [jsname="ME7oBc"]');
    if (el) return el;
    
    // C. Dynamic search for the parent container of active caption spans
    const activeText = document.querySelector('.CNusmb, .ygicle, .VbkSUe');
    if (activeText) {
      let current = activeText;
      while (current && current !== document.body) {
        const parent = current.parentElement;
        if (!parent || parent === document.body) break;
        if (parent.getAttribute('role') === 'region' || parent.getAttribute('jsname') || parent.children.length > 2) {
          return parent;
        }
        current = parent;
      }
    }
    
    return null;
  };

  // Helper to find the speaker block element from a child span
  const getSpeakerBlock = (cnusmbEl) => {
    let current = cnusmbEl;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent || parent === document.body) break;
      
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
    
    // 3. Traversal fallback: check the first child's text content (typically contains name)
    const firstChild = block.firstElementChild;
    if (firstChild && firstChild.textContent.trim()) {
      const text = firstChild.textContent.trim();
      if (text.length < 40 && isNaN(text)) return text;
    }
    
    return "Speaker";
  };

  // Helper to extract the caption text from a speaker block
  const getBlockCaptionText = (block, speakerName) => {
    // A. Try standard text selectors
    const spans = Array.from(block.querySelectorAll('.CNusmb, .ygicle, .VbkSUe'));
    if (spans.length > 0) {
      return spans.map(s => s.textContent.trim()).filter(Boolean).join(" ");
    }
    
    // B. Semantic Fallback: Subtract speaker name from block's overall text content
    let fullText = block.textContent.trim();
    if (speakerName && fullText.startsWith(speakerName)) {
      fullText = fullText.substring(speakerName.length).trim();
    }
    return fullText;
  };

  // 2. AUTO-CAPTIONS: Click captions toggle if inactive
  const startAutoCaptionsFlow = () => {
    let elapsed = 0;
    autoCapTimer = setInterval(() => {
      elapsed += 1500;
      if (elapsed > 45000) {
        clearInterval(autoCapTimer);
        console.log("[MMP] Auto-captions flow timeout (45s reached).");
      }

      const btn = getCaptionsButton();
      const isCaptionsOn = !!(getCaptionsContainer() || (btn && getCaptionsState(btn)));
      
      if (isCaptionsOn) {
        console.log("[MMP] Captions flow verified active.");
        clearInterval(autoCapTimer);
        
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

  // 3. CAPTION CAPTURE & DEDUPLICATION: 3 checks/sec throttle, advanced semantic scraper
  const lastTexts = new Set();

  const handleCaptionMutation = () => {
    if (!capturing) return;
    const now = Date.now();
    if (now - lastCheckTime < 333) return; // Throttle to 3 checks/sec to ensure ZERO CPU load
    lastCheckTime = now;

    const container = getCaptionsContainer();
    if (!container) return;

    // Children represent individual speaker turns in Google Meet captions layout
    const blockEls = Array.from(container.children).filter(el => el.nodeType === Node.ELEMENT_NODE);
    
    if (blockEls.length > 0) {
      blockEls.forEach((blockEl) => {
        // Assign a persistent unique ID directly to the DOM element
        if (!blockEl._mmp_id) {
          blockEl._mmp_id = `block_${blockIdCounter++}`;
        }
        
        const blockId = blockEl._mmp_id;
        const speaker = getSpeakerName(blockEl);
        const text = getBlockCaptionText(blockEl, speaker);
        
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
      console.log(`[MMP] Semantic parser synced ${transcript.length} lines`);
      
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
