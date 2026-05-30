(() => {
  "use strict";

  let hadMeetControls = false;
  let capturing = false;

  // 1. Passive automated hangup checker (Pathname-aware only, 0% CPU overhead)
  const checkMeetingEndStatus = () => {
    const isMeetSession = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(window.location.pathname);
    
    if (isMeetSession) {
      hadMeetControls = true;
    } else if (!isMeetSession && hadMeetControls) {
      console.log("[Meet Minutes Pro] Passive supervisor detected tab redirect/hangup.");
      hadMeetControls = false;
      capturing = false;
      
      try {
        chrome.runtime.sendMessage({ action: "autoStopAndSummarize" });
      } catch (_) {}
    }
  };

  // Check every 2.5 seconds
  setInterval(checkMeetingEndStatus, 2500);

  // 2. Simple Message Router to handle background pings
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.action === "ping") {
      sendResponse({ ok: true });
    } else if (msg.action === "start") {
      capturing = true;
      hadMeetControls = true;
      sendResponse({ ok: true });
    } else if (msg.action === "stop") {
      capturing = false;
      hadMeetControls = false;
      sendResponse({ ok: true });
    }
    return true; // Keep channel open
  });

  console.log("[Meet Minutes Pro] Passive path supervisor script active.");
})();
