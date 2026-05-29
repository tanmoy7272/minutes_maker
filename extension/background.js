/**
 * background.js — Meet Minutes Pro Service Worker v1.1
 *
 * Responsibilities:
 * 1. On first install, open the Vercel landing page for onboarding
 * 2. Clean up capture state when the active Google Meet tab is closed
 * 3. Run a 1-minute health-check alarm that pings the active tab
 * 4. Process background summarization and launch results tab on meeting end
 */

const PORTAL_URL = "https://minutes-maker-five.vercel.app/";

// ── Install / Update ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.set({ version: "1.1.0", portalUrl: PORTAL_URL });

  // Create recurring health-check alarm (fires every 1 minute)
  chrome.alarms.create("healthCheck", { periodInMinutes: 1 });

  // On first install, automatically open the Vercel landing page
  if (details.reason === "install") {
    chrome.tabs.create({ url: PORTAL_URL });
  }

  console.log(
    `[Meet Minutes Pro] ${details.reason === "install" ? "Installed" : "Updated"} v1.1.0`
  );
});

// ── Tab Closed → Cleanup ─────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(["activeTabId"], (data) => {
    if (data.activeTabId && data.activeTabId === tabId) {
      chrome.storage.local.set({
        capturing: false,
        activeTabId: null,
      });
      console.log("[Meet Minutes Pro] Active Meet tab closed — capture reset.");
    }
  });
});

// ── Health-Check Alarm ───────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "healthCheck") return;

  chrome.storage.local.get(["capturing", "activeTabId"], (data) => {
    if (!data.capturing || !data.activeTabId) return;

    chrome.tabs.sendMessage(
      data.activeTabId,
      { action: "ping" },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          chrome.storage.local.set({
            capturing: false,
            activeTabId: null,
          });
          console.warn(
            "[Meet Minutes Pro] Health check failed — capture reset.",
            chrome.runtime.lastError?.message
          );
        }
      }
    );
  });
});

// ── Background API Summarizer (Force Upgrade safe) ───────────────────────────
const callSummarizeAPI = async (prevSummary, transcript, isRetry = false) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000); // 15s timeout
  try {
    const res = await fetch(`${PORTAL_URL}api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        previousSummary: prevSummary, 
        chunk: transcript,
        version: chrome.runtime.getManifest().version
      }),
      signal: controller.signal
    });
    clearTimeout(t);
    
    // Ignore updates check in background or let it launch
    if (res.status === 426) {
      throw new Error("Update required");
    }
    
    if (!res.ok) throw new Error("Server rejected request");
    const data = await res.json();
    return data.markdown || "";
  } catch (e) {
    clearTimeout(t);
    if (e.message === "Update required") throw e;
    if (!isRetry) return callSummarizeAPI(prevSummary, transcript, true); // Retry once
    throw e;
  }
};

// ── Message router for automated stop & redirect ────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg.action === "autoStopAndSummarize") {
    console.log("[Meet Minutes Pro] Background worker received auto-stop trigger. Summarizing...");
    
    callSummarizeAPI(msg.summary, msg.transcript)
      .then((markdown) => {
        const bytes = new TextEncoder().encode(markdown);
        const binary = String.fromCharCode(...bytes);
        const encoded = btoa(binary);
        chrome.tabs.create({ url: `${PORTAL_URL}result#${encoded}` });
        sendResponse({ ok: true });
      })
      .catch((err) => {
        console.error("[Meet Minutes Pro] Auto-summarization failed:", err);
        sendResponse({ ok: false, error: err.message });
      });
      
    return true; // Keep channel open async
  }
});
