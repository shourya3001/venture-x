const youtubeHosts = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error("Could not configure the LectureMate side panel:", error);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  notifyActiveTabChanged(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    sendToExtensionPages({ type: "LECTUREMATE_TAB_UPDATED", tabId });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sendToExtensionPages({ type: "LECTUREMATE_TAB_CLOSED", tabId });
  chrome.storage.session.remove(`lectureTranscript:${tabId}`).catch((error) => {
    console.error("Could not clear the closed tab's temporary LectureMate transcript:", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "YOUTUBE_PLAYBACK_UPDATE") {
    const state = validatePlaybackState(message.state, sender.url);
    if (state && sender.tab && Number.isInteger(sender.tab.id)) {
      sendToExtensionPages({
        type: "LECTUREMATE_PLAYBACK_UPDATE",
        tabId: sender.tab.id,
        state
      });
    }
    return false;
  }

  if (message.type === "YOUTUBE_CAPTION_SEGMENT") {
    const caption = validateCaptionSegment(message, sender.url);
    if (caption && sender.tab && Number.isInteger(sender.tab.id)) {
      sendToExtensionPages({
        type: "LECTUREMATE_CAPTION_SEGMENT",
        tabId: sender.tab.id,
        videoId: caption.videoId,
        segment: caption.segment
      });
    }
    return false;
  }

  if (message.type === "OPEN_FOCUS") {
    openFocusTab().then(sendResponse).catch((error) => {
      console.error("Could not open LectureMate focus mode:", error);
      sendResponse({ ok: false, error: "Focus mode could not be opened." });
    });
    return true;
  }

  if (message.type === "RETURN_TO_SIDE_PANEL") {
    returnToSourceTab(message.tabId, sender.tab && sender.tab.id)
      .then(sendResponse)
      .catch((error) => {
        console.error("Could not return to the LectureMate side panel:", error);
        sendResponse({ ok: false, error: "Could not return to the lecture tab." });
      });
    return true;
  }

  return false;
});

function validatePlaybackState(state, senderUrl) {
  if (!state || typeof state !== "object" || typeof state.connected !== "boolean") {
    return null;
  }

  let pageUrl;
  try {
    pageUrl = new URL(senderUrl);
  } catch (_error) {
    return null;
  }

  if (pageUrl.protocol !== "https:" || !youtubeHosts.has(pageUrl.hostname)) {
    return null;
  }

  let stateUrl;
  try {
    stateUrl = new URL(state.url);
  } catch (_error) {
    return null;
  }

  if (stateUrl.protocol !== "https:" || !youtubeHosts.has(stateUrl.hostname)) {
    return null;
  }

  const validVideoId = typeof state.videoId === "string" && /^[\w-]{11}$/.test(state.videoId);
  if (state.connected && (!validVideoId || stateUrl.pathname !== "/watch" ||
      stateUrl.searchParams.get("v") !== state.videoId)) {
    return null;
  }

  return {
    connected: state.connected,
    hasVideo: state.hasVideo === true,
    videoId: validVideoId ? state.videoId : null,
    url: stateUrl.href.slice(0, 2048),
    title: typeof state.title === "string" ? state.title.slice(0, 300) : "",
    currentTime: Number.isFinite(state.currentTime) && state.currentTime >= 0 ? state.currentTime : null,
    duration: Number.isFinite(state.duration) && state.duration >= 0 ? state.duration : null,
    paused: state.paused === true,
    event: typeof state.event === "string" ? state.event.slice(0, 32) : ""
  };
}

function validateCaptionSegment(message, senderUrl) {
  let pageUrl;
  try {
    pageUrl = new URL(senderUrl);
  } catch (_error) {
    return null;
  }

  const segment = message.segment;
  if (pageUrl.protocol !== "https:" || !youtubeHosts.has(pageUrl.hostname) ||
      typeof message.videoId !== "string" || !/^[\w-]{11}$/.test(message.videoId) ||
      !segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
      segment.start < 0 || segment.end <= segment.start ||
      typeof segment.text !== "string" || !segment.text.trim()) {
    return null;
  }

  return {
    videoId: message.videoId,
    segment: {
      start: segment.start,
      end: segment.end,
      text: segment.text.trim().slice(0, 2000)
    }
  };
}

function notifyActiveTabChanged(tabId) {
  sendToExtensionPages({ type: "LECTUREMATE_ACTIVE_TAB_CHANGED", tabId });
}

function sendToExtensionPages(message) {
  chrome.runtime.sendMessage(message, () => {
    if (chrome.runtime.lastError) {
      return;
    }
  });
}

async function openFocusTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  const focusUrl = new URL(chrome.runtime.getURL("focus/index.html"));

  if (activeTab && Number.isInteger(activeTab.id)) {
    focusUrl.searchParams.set("returnTabId", String(activeTab.id));
  }

  await chrome.tabs.create({ url: focusUrl.toString() });
  return { ok: true };
}

async function returnToSourceTab(tabId, focusTabId) {
  if (!Number.isInteger(tabId)) {
    return { ok: false, error: "The original browser tab is no longer available." };
  }

  await chrome.tabs.update(tabId, { active: true });

  if (Number.isInteger(focusTabId)) {
    await chrome.tabs.remove(focusTabId);
  }

  return { ok: true };
}
