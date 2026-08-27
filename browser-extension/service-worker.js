const DESKTOP_ENDPOINT = "http://127.0.0.1:32145/v1/active-domain";
const HEARTBEAT_ALARM = "logyourtime-active-domain";

function extractDomain(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

async function publishActiveTab(tab) {
  const domain = extractDomain(tab?.url);
  if (!domain || !tab?.active) return;

  try {
    await fetch(DESKTOP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, observedAt: new Date().toISOString() }),
    });
  } catch {
    // La aplicación puede estar cerrada. No persistimos ni reenviamos historial.
  }
}

async function publishCurrentTab(windowId) {
  const query = { active: true };
  if (Number.isInteger(windowId) && windowId >= 0) query.windowId = windowId;
  else query.lastFocusedWindow = true;

  const [tab] = await chrome.tabs.query(query);
  await publishActiveTab(tab);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  publishCurrentTab().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  publishCurrentTab().catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(publishActiveTab).catch(() => {});
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) {
    publishActiveTab(tab).catch(() => {});
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    publishCurrentTab(windowId).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) publishCurrentTab().catch(() => {});
});
