(() => {
  "use strict";

  const PORTAL_URL = "https://minutes-maker-five.vercel.app";
  const $ = (id) => document.getElementById(id);
  const $timer = $("timer"), $lineCount = $("lineCount"), $captionState = $("captionState");
  const $start = $("start"), $stop = $("stop"), $clear = $("clear"), $overlay = $("summarizeOverlay"), $visualizer = $("visualizer");
  
  const $settingsPanel = $("settingsPanel"), $closeSettings = $("closeSettings"), $toggleSettings = $("toggleSettings");
  const $customKeyInput = $("customKeyInput"), $saveSettingsBtn = $("saveSettingsBtn");
  const $historyPanel = $("historyPanel"), $closeHistory = $("closeHistory"), $toggleHistory = $("toggleHistory");
  const $historyListContainer = $("historyListContainer"), $clearAllHistory = $("clearAllHistory");

  let timerInterval = null, timerStart = null;

  const showToast = (msg, type = "info") => {
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.innerText = msg;
    t.style.cssText = "padding:8px 12px; border-radius:8px; color:white; background:rgba(0,0,0,0.8); z-index:99999; margin-top:8px;";
    $("toastContainer").appendChild(t);
    setTimeout(() => t.remove(), 3000);
  };

  const getMeetTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.url?.includes("meet.google.com")) return tab;
    } catch (_) {}
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes("meet.google.com")) return tab;
    } catch (_) {}
    return null;
  };

  // Start Capture Click
  $start.onclick = async () => {
    try {
      const tab = await getMeetTab();
      if (!tab) {
        throw new Error("Active Google Meet tab not found. Please select a Meet tab first!");
      }

      console.log("[MMP-Popup] 1. Launching offscreen document context...");
      const launchRes = await chrome.runtime.sendMessage({ action: "launchOffscreen" });
      if (!launchRes || !launchRes.ok) {
        throw new Error(launchRes?.error || "Failed to launch offscreen context.");
      }

      // Check microphone permission (optional)
      let hasMicPermission = false;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        hasMicPermission = devices.some(device => device.kind === "audioinput" && device.label !== "");
      } catch (_) {}

      if (!hasMicPermission) {
        console.log("[MMP-Popup] Microphone permission missing. Launching permission helper tab...");
        showToast("Opening microphone configuration helper...", "info");
        chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
      }

      console.log(`[MMP-Popup] 3. Querying tab capture stream ID for tab ID: ${tab.id}`);
      const streamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(id);
          }
        });
      });

      console.log(`[MMP-Popup] 4. Instantly messaging stream ID: ${streamId} to offscreen context...`);
      chrome.storage.local.get(["customGeminiKey"], (stored) => {
        chrome.runtime.sendMessage({ 
          action: "initiateCapture", 
          streamId: streamId,
          customGeminiKey: stored.customGeminiKey || ""
        });
      });

      console.log("[MMP-Popup] 5. Syncing active capturing metadata to service worker...");
      const res = await chrome.runtime.sendMessage({ 
        action: "startCaptureState", 
        tabId: tab.id,
        streamId: streamId
      });
      
      if (!res || !res.ok) {
        throw new Error(res?.error || "Failed to start active capturing state.");
      }

      $start.disabled = true;
      $stop.disabled = false;
      $visualizer.classList.add("active-capturing");
      timerStart = res.startTime || Date.now();
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        const elapsed = Date.now() - timerStart;
        const s = Math.floor(elapsed / 1000);
        $timer.innerText = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }, 1000);

      // Force UI state to show Captions / Recording ON
      $captionState.className = "status-pill state-on";
      $captionState.innerHTML = '<span class="pill-dot animate-pulse"></span><span class="pill-text">REC</span>';

      showToast("Audio Capture active", "success");
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  // Stop Capture Click
  $stop.onclick = async () => {
    clearInterval(timerInterval);
    $overlay.classList.add("active-overlay");
    try {
      await chrome.runtime.sendMessage({ action: "stop" });
      showToast("Compiling summary in background...", "info");
    } catch (e) {
      showToast(e.message || "Summarize failed", "error");
      resetUI();
    }
  };

  const showUpdateOverlay = (reqVersion, curVersion) => {
    $("updateMsg").innerText = `You are running version v${curVersion}. A mandatory update to v${reqVersion} is required to continue.`;
    const overlay = $("updateOverlay");
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "auto";
  };

  const callSummarizeAPI = async (prevSummary, transcript, isRetry = false) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 60000); // 60s timeout
    try {
      console.log("[MMP-Popup] Sending transcripts to summarize API...");
      const currentVersion = chrome.runtime.getManifest().version;
      const dataStorage = await new Promise((resolve) => {
        chrome.storage.local.get(["customGeminiKey"], resolve);
      });
      const headers = { "Content-Type": "application/json" };
      if (dataStorage && dataStorage.customGeminiKey) {
        headers["x-custom-gemini-key"] = dataStorage.customGeminiKey;
      }

      const res = await fetch(`${PORTAL_URL}/api/summarize`, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          previousSummary: prevSummary, 
          chunk: transcript,
          version: currentVersion
        }),
        signal: controller.signal
      });
      clearTimeout(t);

      if (res.status === 426) {
        const data = await res.json();
        showUpdateOverlay(data.requiredVersion, currentVersion);
        throw new Error("Update required to continue");
      }

      if (res.status === 429) {
        throw new Error("Rate limit exceeded. Max 20 requests per hour.");
      }

      if (res.status === 403) {
        throw new Error("Unauthorized extension origin check failed.");
      }

      if (!res.ok) throw new Error("Server rejected request");
      const data = await res.json();
      return data;
    } catch (e) {
      clearTimeout(t);
      if (e.message === "Update required to continue" || e.message.includes("Rate limit") || e.message.includes("Unauthorized")) throw e;
      if (!isRetry) return callSummarizeAPI(prevSummary, transcript, true); // Retry once
      showToast("Offline - will sync later", "error");
      throw e;
    }
  };

  // ── Settings Sub-Panel Functionality ─────────────────────────────────────
  chrome.storage.local.get(["customGeminiKey"], (data) => {
    if (data.customGeminiKey) {
      $customKeyInput.value = data.customGeminiKey;
    }
  });

  $toggleSettings.onclick = () => {
    $settingsPanel.classList.add("active-panel");
  };

  $closeSettings.onclick = () => {
    $settingsPanel.classList.remove("active-panel");
  };

  $saveSettingsBtn.onclick = () => {
    const key = $customKeyInput.value.trim();
    chrome.storage.local.set({ customGeminiKey: key }, () => {
      showToast("Settings saved successfully", "success");
      $settingsPanel.classList.remove("active-panel");
    });
  };

  // ── History Sub-Panel Functionality ──────────────────────────────────────
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

  const renderHistoryList = () => {
    chrome.storage.local.get(["extension_history"], (data) => {
      const history = data.extension_history || [];
      $historyListContainer.innerHTML = "";
      
      if (history.length === 0) {
        $historyListContainer.innerHTML = '<p class="empty-msg">No local history saved.</p>';
        return;
      }
      
      history.forEach((item) => {
        const div = document.createElement("div");
        div.className = "history-item";
        div.onclick = () => {
          try {
            const bytes = new TextEncoder().encode(item.markdown);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const encoded = btoa(binary);
            chrome.tabs.create({ url: `${PORTAL_URL}/result#${encoded}` });
            $historyPanel.classList.remove("active-panel");
          } catch (err) {
            showToast("Failed to open history item", "error");
          }
        };
        
        const titleH4 = document.createElement("h4");
        titleH4.className = "history-item-title";
        titleH4.innerText = item.title;
        
        const dateP = document.createElement("p");
        dateP.className = "history-item-date";
        dateP.innerText = item.date;
        
        div.appendChild(titleH4);
        div.appendChild(dateP);
        $historyListContainer.appendChild(div);
      });
    });
  };

  $toggleHistory.onclick = () => {
    renderHistoryList();
    $historyPanel.classList.add("active-panel");
  };

  $closeHistory.onclick = () => {
    $historyPanel.classList.remove("active-panel");
  };

  $clearAllHistory.onclick = () => {
    if (confirm("Delete all local meeting history?")) {
      chrome.storage.local.set({ extension_history: [] }, () => {
        showToast("History cleared", "success");
        renderHistoryList();
      });
    }
  };

  const resetUI = () => {
    $overlay.classList.remove("active-overlay");
    $visualizer.classList.remove("active-capturing");
    $start.disabled = false;
    $stop.disabled = true;
    $stop.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>Stop Capture';
    $timer.innerText = "00:00:00";
    $lineCount.innerText = "0 lines";
    $captionState.className = "status-pill state-off";
    $captionState.innerHTML = '<span class="pill-dot"></span><span class="pill-text">OFF</span>';
  };

  $clear.onclick = async () => {
    if (!confirm("Clear captured meeting audio database?")) return;
    try {
      await chrome.runtime.sendMessage({ action: "clear" });
      resetUI();
      showToast("Session cleared", "success");
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const syncStateWithServiceWorker = () => {
    chrome.storage.local.get(["capturing", "transcript", "captureStartTime"], (data) => {
      if (chrome.runtime.lastError) {
        console.error("[MMP-Popup-Sync] Direct storage retrieval failed:", chrome.runtime.lastError.message);
        return;
      }
      console.log("[MMP-Popup-Sync] Direct local storage state retrieved successfully:", data);
      
      const isCap = !!data.capturing;
      const lines = data.transcript ? data.transcript.length : 0;
      
      $lineCount.innerText = `${lines} lines`;
      
      if (isCap || lines > 0) {
        $captionState.className = "status-pill state-on";
        $captionState.innerHTML = '<span class="pill-dot animate-pulse"></span><span class="pill-text">REC</span>';
      } else {
        $captionState.className = "status-pill state-off";
        $captionState.innerHTML = '<span class="pill-dot"></span><span class="pill-text">OFF</span>';
      }
      
      if (isCap) {
        $start.disabled = true;
        $stop.disabled = false;
        $visualizer.classList.add("active-capturing");
        
        const startTime = data.captureStartTime || 0;
        if (startTime) {
          timerStart = startTime;
          if (timerInterval) clearInterval(timerInterval);
          timerInterval = setInterval(() => {
            const elapsed = Date.now() - timerStart;
            const s = Math.floor(elapsed / 1000);
            $timer.innerText = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
          }, 1000);
        }
      } else if (lines > 0) {
        // Backup session available for compilation or retry
        $start.disabled = false;
        $stop.disabled = false;
        $stop.innerText = "Compile Summary"; // Visual affordance to retry compilation
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        $timer.innerText = "00:00:00";
      } else {
        $start.disabled = false;
        $stop.disabled = true;
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        $timer.innerText = "00:00:00";
      }
    });
  };

  // Message Listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.event === "captionsDetected") {
      syncStateWithServiceWorker();
    } else if (msg.event === "compilationStarted") {
      $overlay.classList.add("active-overlay");
    } else if (msg.event === "compilationCompleted") {
      $overlay.classList.remove("active-overlay");
      if (msg.success) {
        showToast("Minutes compiled successfully!", "success");
      } else {
        showToast(msg.error || "Compilation failed", "error");
      }
      resetUI();
    }
  });

  // Sync state initially with service worker
  syncStateWithServiceWorker();
})();
