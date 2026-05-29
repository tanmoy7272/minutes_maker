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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url?.includes("meet.google.com") ? tab : null;
  };

  const sendTabMessage = async (action) => {
    const tab = await getMeetTab();
    if (!tab) throw new Error("Google Meet tab not found");
    try {
      return await chrome.tabs.sendMessage(tab.id, { action });
    } catch (err) {
      console.error("[MMP] Connection error to Meet content script:", err);
      throw new Error("Please refresh this Google Meet page to activate the extension!");
    }
  };

  // Start Capture click
  $start.onclick = async () => {
    try {
      await sendTabMessage("start");
      $start.disabled = true;
      $stop.disabled = false;
      $visualizer.classList.add("active-capturing");
      timerStart = Date.now();
      timerInterval = setInterval(() => {
        const elapsed = Date.now() - timerStart;
        const s = Math.floor(elapsed / 1000);
        $timer.innerText = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }, 1000);
      showToast("Capture active", "success");
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  $stop.onclick = async () => {
    clearInterval(timerInterval);
    $overlay.classList.add("active-overlay");
    try {
      const data = await sendTabMessage("stop");
      if (!data || !data.transcript || data.transcript.trim().length === 0) {
        throw new Error(`No transcript captured. Open DevTools console (F12) on the Meet tab and look for [MMP] logs to diagnose.`);
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
      console.log("[MMP] Sending to API");
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

      // Handle mandatory update rejection (HTTP 426 Upgrade Required)
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
    $timer.innerText = "00:00:00";
    $lineCount.innerText = "0 lines";
  };

  $clear.onclick = async () => {
    if (!confirm("Clear captured meeting database?")) return;
    try {
      await sendTabMessage("clear");
      resetUI();
      showToast("Data cleared", "success");
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  // Caption Detection messages listener from content.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.event === "captionsDetected") {
      $captionState.className = "status-pill state-on";
      $captionState.innerHTML = '<span class="pill-dot animate-pulse"></span><span class="pill-text">ON</span>';
    } else if (msg.event === "offline-sync") {
      showToast("Offline - data saved in IndexedDB", "info");
    }
  });

  // Sync state initially
  (async () => {
    const tab = await getMeetTab();
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: "ping" }, (res) => {
        if (chrome.runtime.lastError) return; // Safely ignore if content script is not ready
        if (res) {
          $lineCount.innerText = `${res.lines || 0} lines`;
          
          if (res.isCaptionsOn || res.lines > 0 || res.capturing) {
            $captionState.className = "status-pill state-on";
            $captionState.innerHTML = '<span class="pill-dot animate-pulse"></span><span class="pill-text">ON</span>';
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
              timerInterval = setInterval(() => {
                const elapsed = Date.now() - timerStart;
                const s = Math.floor(elapsed / 1000);
                $timer.innerText = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
              }, 1000);
            }
          }
        }
      });
    }
  })();
})();
