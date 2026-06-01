(() => {
  "use strict";

  const PORTAL_URL = "https://minutes-maker-five.vercel.app";
  const $ = (id) => document.getElementById(id);
  const $timer = $("timer"), $lineCount = $("lineCount"), $captionState = $("captionState");
  const $start = $("start"), $stop = $("stop"), $clear = $("clear"), $overlay = $("summarizeOverlay"), $visualizer = $("visualizer");

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

      // Check microphone permission before proceeding to prevent silent capturing failures (Issue 3)
      let hasMicPermission = false;
      try {
        const permStatus = await navigator.permissions.query({ name: "microphone" });
        hasMicPermission = permStatus.state === "granted";
      } catch (_) {}

      if (!hasMicPermission) {
        console.log("[MMP-Popup] Microphone permission missing. Launching onboarding permission tab...");
        chrome.tabs.create({ url: "permission.html" });
        return;
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
      chrome.runtime.sendMessage({ 
        action: "initiateCapture", 
        streamId: streamId 
      });

      console.log("[MMP-Popup] 5. Syncing active capturing metadata to service worker...");
      const res = await chrome.runtime.sendMessage({ 
        action: "startCaptureState", 
        tabId: tab.id 
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
      const data = await chrome.runtime.sendMessage({ action: "stop" });
      
      if (!data || !data.transcript || data.transcript.trim().length === 0) {
        throw new Error("No transcription was recorded during the call.");
      }

      const markdown = await callSummarizeAPI(data.summary, data.transcript);
      const bytes = new TextEncoder().encode(markdown);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const encoded = btoa(binary);
      chrome.tabs.create({ url: `${PORTAL_URL}/result#${encoded}` });
      showToast("Minutes compiled", "success");
      resetUI();
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
    const t = setTimeout(() => controller.abort(), 15000); // 15s timeout
    try {
      console.log("[MMP-Popup] Sending transcripts to summarize API...");
      const currentVersion = chrome.runtime.getManifest().version;
      const res = await fetch(`${PORTAL_URL}/api/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      if (!res.ok) throw new Error("Server rejected request");
      const data = await res.json();
      return data.markdown || "";
    } catch (e) {
      clearTimeout(t);
      if (e.message === "Update required to continue") throw e;
      if (!isRetry) return callSummarizeAPI(prevSummary, transcript, true); // Retry once
      showToast("Offline - will sync later", "error");
      throw e;
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
    chrome.runtime.sendMessage({ action: "ping" }, (res) => {
      if (chrome.runtime.lastError) {
        console.error("[MMP-Popup-Sync] Ping failed:", chrome.runtime.lastError.message);
        return;
      }
      console.log("[MMP-Popup-Sync] Ping state successfully retrieved:", res);
      if (res) {
        $lineCount.innerText = `${res.lines || 0} lines`;
        
        if (res.capturing || res.lines > 0) {
          $captionState.className = "status-pill state-on";
          $captionState.innerHTML = '<span class="pill-dot animate-pulse"></span><span class="pill-text">REC</span>';
        } else {
          $captionState.className = "status-pill state-off";
          $captionState.innerHTML = '<span class="pill-dot"></span><span class="pill-text">OFF</span>';
        }
        
        if (res.capturing) {
          $start.disabled = true;
          $stop.disabled = false;
          $visualizer.classList.add("active-capturing");
          
          if (res.startTime) {
            timerStart = res.startTime;
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(() => {
              const elapsed = Date.now() - timerStart;
              const s = Math.floor(elapsed / 1000);
              $timer.innerText = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
            }, 1000);
          }
        } else if (res.lines > 0) {
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
      }
    });
  };

  // Whisper Segment Transcribed Message Listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.event === "captionsDetected") {
      syncStateWithServiceWorker();
    }
  });

  // Sync state initially with service worker
  syncStateWithServiceWorker();
})();
