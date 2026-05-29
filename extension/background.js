/**
 * background.js — Meet Minutes Pro Service Worker v1.1
 *
 * Responsibilities:
 * 1. On first install, open the Vercel landing page for onboarding
 * 2. Set version in storage on install/update
 * 3. Clean up capture state when the active Google Meet tab is closed
 * 4. Run a 1-minute health-check alarm that pings the content script
 */

// ── Configuration ────────────────────────────────────────────────────────────
// Placeholder URL — User will replace after Vercel deployment
const PORTAL_URL = "https://minutes-maker-five.vercel.app/";

// ── Install / Update ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.set({ version: "1.1.0", portalUrl: PORTAL_URL });

  // Create recurring health-check alarm (fires every 1 minute)
  chrome.alarms.create("healthCheck", { periodInMinutes: 1 });

  // On first install, automatically open the Vercel landing page for onboarding instructions
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
