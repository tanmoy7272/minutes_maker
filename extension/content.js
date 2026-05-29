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

  // ===== SELECTOR-FREE CAPTION CAPTURE ENGINE =====
  // Instead of querying DOM with hardcoded Google class names (which break when Google changes them),
  // we read caption text directly from MutationObserver mutation records.

  // Exclusion zones — structural roles/tags that are NEVER captions
  const EXCLUSION_SELECTORS = [
    '[role="list"]',           // Chat messages panel
    '[role="dialog"]',         // Settings/dialogs
    '[role="toolbar"]',        // Control bar
    '[role="navigation"]',     // Navigation bars
    '[role="menu"]',           // Dropdown menus
    '[role="menubar"]',        // Menu bars
    '[role="tablist"]',        // Tab interfaces
    '[role="complementary"]',  // Side panels (people, chat)
    '[role="banner"]',         // Headers
    'textarea',                // Chat input
    'input',                   // Any input fields
    'button',                  // Button text changes
  ].join(',');

  // Returns true if a node looks like caption text based on structural heuristics
  const isCaptionNode = (node) => {
    // Must be an element or text node
    if (!node) return false;

    // Get the actual element (for text nodes, use parent)
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || el === document.body || el === document.documentElement) return false;

    // Get text content
    const text = (node.nodeType === Node.TEXT_NODE ? node.textContent : el.innerText || el.textContent || '').trim();

    // FILTER 1: Text length — captions are spoken words, typically 1-500 chars
    if (!text || text.length === 0 || text.length > 500) return false;

    // FILTER 2: Reject pure numbers, timestamps, participant counts
    if (/^\d+$/.test(text)) return false;
    if (/^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i.test(text)) return false;

    // FILTER 3: Reject very short UI fragments (single characters, icons)
    if (text.length <= 1) return false;

    // FILTER 4: Check that node is NOT inside an exclusion zone
    if (el.closest(EXCLUSION_SELECTORS)) return false;

    // FILTER 5: Nesting depth — captions in Google Meet are deeply nested (4+ levels from body)
    let depth = 0;
    let parent = el;
    while (parent && parent !== document.body) {
      depth++;
      parent = parent.parentElement;
    }
    if (depth < 4) return false;

    // FILTER 6: Check the node's position — captions appear in the bottom half of viewport
    try {
      const rect = el.getBoundingClientRect();
      // If the element has a position and it's in the top 30% of the page, likely not captions
      if (rect.height > 0 && rect.bottom < window.innerHeight * 0.3) return false;
    } catch (_) {}

    // FILTER 7: Reject if it looks like a participant name badge or UI label
    const tag = el.tagName?.toLowerCase();
    if (tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') return false;

    return true;
  };

  // 2. AUTO-CAPTIONS: Click captions toggle if inactive
  const startAutoCaptionsFlow = () => {
    let elapsed = 0;
    let hasClicked = false;
    autoCapTimer = setInterval(() => {
      elapsed += 1500;
      if (elapsed > 45000) {
        clearInterval(autoCapTimer);
        console.log("[MMP] Auto-captions flow timeout (45s reached).");
        return;
      }

      const btn = getCaptionsButton();

      // Check if captions are already on via button state
      if (btn && getCaptionsState(btn)) {
        console.log("[MMP] Captions verified ON via button state.");
        clearInterval(autoCapTimer);
        try { chrome.runtime.sendMessage({ event: "captionsDetected" }); } catch (_) {}
        return;
      }

      // Click the button if we haven't yet, or if it's still showing "off"
      if (btn && !hasClicked) {
        btn.click();
        hasClicked = true;
        console.log("[MMP] Clicked captions button. Will verify in next cycle.");
      } else if (btn && hasClicked) {
        // Already clicked once, check state again
        if (getCaptionsState(btn)) {
          console.log("[MMP] Captions confirmed ON after click.");
          clearInterval(autoCapTimer);
          try { chrome.runtime.sendMessage({ event: "captionsDetected" }); } catch (_) {}
        } else {
          // Reset - maybe it toggled off, try again
          hasClicked = false;
          console.log("[MMP] Captions still off, will retry click.");
        }
      } else {
        console.log("[MMP] Captions button not found yet, retrying...");
      }
    }, 1500);
  };

  // 3. SELECTOR-FREE CAPTION CAPTURE — reads directly from mutation records
  const lastTexts = new Set();
  let mutationDebugCount = 0;

  const handleCaptionMutation = (mutations) => {
    if (!capturing) return;
    const now = Date.now();
    if (now - lastCheckTime < 333) return; // Throttle to 3 checks/sec
    lastCheckTime = now;

    let capturedThisCycle = false;

    for (const mutation of mutations) {
      // STRATEGY A: characterData — an existing text node's content changed (live caption update)
      if (mutation.type === 'characterData' && mutation.target) {
        if (isCaptionNode(mutation.target)) {
          const text = mutation.target.textContent.trim();
          if (text) {
            const hash = text.toLowerCase();
            // For characterData, we REPLACE the last entry if it's a prefix (caption is being typed live)
            if (!lastTexts.has(hash)) {
              // Check if this is an update to the last captured line
              if (transcript.length > 0) {
                const lastLine = transcript[transcript.length - 1].toLowerCase();
                if (hash.startsWith(lastLine.substring(0, Math.min(lastLine.length, 20)))) {
                  // This is the same caption being extended — update it
                  transcript[transcript.length - 1] = text;
                  capturedThisCycle = true;
                  continue;
                }
              }
              lastTexts.add(hash);
              if (lastTexts.size > 500) {
                const first = lastTexts.values().next().value;
                lastTexts.delete(first);
              }
              transcript.push(text);
              console.log(`[MMP] ✓ Captured (charData) line ${transcript.length}: "${text.substring(0, 80)}"`);
              capturedThisCycle = true;
            }
          }
        }
      }

      // STRATEGY B: childList — new elements were added (new caption block appeared)
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            // Direct text node added
            if (isCaptionNode(node)) {
              const text = node.textContent.trim();
              if (text) {
                const hash = text.toLowerCase();
                if (!lastTexts.has(hash)) {
                  lastTexts.add(hash);
                  if (lastTexts.size > 500) {
                    const first = lastTexts.values().next().value;
                    lastTexts.delete(first);
                  }
                  transcript.push(text);
                  console.log(`[MMP] ✓ Captured (textNode) line ${transcript.length}: "${text.substring(0, 80)}"`);
                  capturedThisCycle = true;
                }
              }
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Element added — extract its text content if it passes heuristics
            // First check the element itself
            if (isCaptionNode(node)) {
              const text = (node.innerText || node.textContent || '').trim();
              if (text) {
                const hash = text.toLowerCase();
                if (!lastTexts.has(hash)) {
                  lastTexts.add(hash);
                  if (lastTexts.size > 500) {
                    const first = lastTexts.values().next().value;
                    lastTexts.delete(first);
                  }
                  transcript.push(text);
                  console.log(`[MMP] ✓ Captured (element) line ${transcript.length}: "${text.substring(0, 80)}"`);
                  capturedThisCycle = true;
                }
              }
            }

            // Also check leaf-level text descendants (captions are often deeply wrapped spans)
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
            let textNode;
            while ((textNode = walker.nextNode())) {
              const text = textNode.textContent.trim();
              if (text && text.length > 1 && text.length <= 500 && isCaptionNode(textNode)) {
                const hash = text.toLowerCase();
                if (!lastTexts.has(hash)) {
                  lastTexts.add(hash);
                  if (lastTexts.size > 500) {
                    const first = lastTexts.values().next().value;
                    lastTexts.delete(first);
                  }
                  transcript.push(text);
                  console.log(`[MMP] ✓ Captured (leaf) line ${transcript.length}: "${text.substring(0, 80)}"`);
                  capturedThisCycle = true;
                }
              }
            }
          }
        }
      }
    }

    // Periodic debug logging (every ~30 seconds) to confirm observer is alive
    mutationDebugCount++;
    if (mutationDebugCount % 90 === 0) { // ~90 * 333ms ≈ 30s
      console.log(`[MMP] Observer alive. Total mutations processed: ${mutationDebugCount}. Transcript lines: ${transcript.length}`);
    }

    if (capturedThisCycle) {
      try { chrome.runtime.sendMessage({ event: "captionsDetected" }); } catch (_) {}
    }
  };

  // 5. PERFORMANCE: Throttled Global document.body Observer
  const startObserving = () => {
    disconnectObservers();
    
    capObserver = new MutationObserver(handleCaptionMutation);
    capObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    console.log("[MMP] MutationObserver active on document.body — selector-free capture engine ready.");
    mutationDebugCount = 0;
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
      // Determine captions state from button accessibility attributes only
      const btn = getCaptionsButton();
      const isCaptionsOn = capturing || transcript.length > 0 || (btn && getCaptionsState(btn));
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
