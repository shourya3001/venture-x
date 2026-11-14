(() => {
  const allowedHosts = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);
  const videoEvents = [
    "play",
    "pause",
    "timeupdate",
    "seeking",
    "seeked",
    "loadedmetadata",
    "ended"
  ];
  const timeUpdateInterval = 1000;
  const navigationEventNames = ["yt-navigate-finish", "yt-page-data-updated", "popstate", "hashchange"];
  let boundVideo = null;
  let boundHandlers = [];
  let lastTimeUpdateAt = 0;
  let lastPageStateKey = null;
  let scanTimer = null;
  let captionCaptureEnabled = false;
  let captionVideoId = null;
  let captionContainer = null;
  let captionObserver = null;
  let activeCaption = null;
  let pageScanInterval = null;
  let bridgeStopped = false;

  function getWatchPage() {
    const url = new URL(window.location.href);
    if (!allowedHosts.has(url.hostname) || url.pathname !== "/watch") {
      return null;
    }

    const videoId = url.searchParams.get("v");
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
      return null;
    }

    return { url: url.href, videoId };
  }

  function getVideoElement() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function getVideoTitle() {
    const heading = document.querySelector("h1.ytd-watch-metadata") || document.querySelector("#title h1");
    const headingText = heading && heading.textContent ? heading.textContent.trim() : "";
    const documentTitle = document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    return headingText || documentTitle || "Untitled video";
  }

  function finiteTime(value) {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function createState(eventName) {
    const page = getWatchPage();
    const video = page ? getVideoElement() : null;

    return {
      connected: Boolean(page),
      hasVideo: Boolean(video),
      videoId: page ? page.videoId : null,
      url: window.location.href,
      title: page ? getVideoTitle() : "",
      currentTime: video ? finiteTime(video.currentTime) : null,
      duration: video ? finiteTime(video.duration) : null,
      paused: video ? video.paused : true,
      captionCaptureEnabled,
      event: eventName
    };
  }

  function sendState(eventName) {
    safelySendRuntimeMessage({
      type: "YOUTUBE_PLAYBACK_UPDATE",
      state: createState(eventName)
    });
  }

  function isInvalidatedContext(error) {
    return Boolean(error && typeof error.message === "string" &&
      /extension context invalidated/i.test(error.message));
  }

  function stopBridge() {
    if (bridgeStopped) {
      return;
    }

    bridgeStopped = true;
    if (scanTimer !== null) {
      window.clearTimeout(scanTimer);
      scanTimer = null;
    }
    if (pageScanInterval !== null) {
      window.clearInterval(pageScanInterval);
      pageScanInterval = null;
    }
    navigationEventNames.forEach((eventName) => {
      document.removeEventListener(eventName, scheduleScan);
    });
    detachVideo();
    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }
    captionContainer = null;
    activeCaption = null;
    captionCaptureEnabled = false;
    captionVideoId = null;
  }

  function safelySendRuntimeMessage(message) {
    if (bridgeStopped) {
      return;
    }

    try {
      chrome.runtime.sendMessage(message, () => {
        try {
          if (!chrome.runtime.lastError) {
            return;
          }
          if (isInvalidatedContext(chrome.runtime.lastError)) {
            stopBridge();
            return;
          }
          console.warn("LectureMate could not communicate with its extension service worker.");
        } catch (error) {
          if (isInvalidatedContext(error)) {
            stopBridge();
            return;
          }
          console.warn("LectureMate could not check the extension message status.");
        }
      });
    } catch (error) {
      if (isInvalidatedContext(error)) {
        stopBridge();
        return;
      }
      console.warn("LectureMate could not send an extension message.");
    }
  }

  function getCurrentTime() {
    const video = getVideoElement();
    return video ? finiteTime(video.currentTime) : null;
  }

  function getRenderedCaption() {
    const container = document.querySelector(".ytp-caption-window-container");
    if (!container || !container.getClientRects().length) {
      return "";
    }

    const style = window.getComputedStyle(container);
    if (style.display === "none" || style.visibility === "hidden") {
      return "";
    }

    return Array.from(container.querySelectorAll(".ytp-caption-segment"))
      .map((element) => element.textContent.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);
  }

  function sendCaptionSegment(caption, endTime) {
    const duration = endTime - caption.start;
    if (!caption.text || !Number.isFinite(duration) || duration <= 0) {
      return;
    }

    safelySendRuntimeMessage({
      type: "YOUTUBE_CAPTION_SEGMENT",
      videoId: caption.videoId,
      segment: {
        start: caption.start,
        end: endTime,
        text: caption.text
      }
    });
  }

  function flushCaption(endTime) {
    if (!activeCaption) {
      return;
    }

    const caption = activeCaption;
    activeCaption = null;
    const page = getWatchPage();
    const currentTime = page && page.videoId === caption.videoId && Number.isFinite(endTime)
      ? endTime
      : caption.lastTime;
    const video = getVideoElement();
    const maximumEnd = page && page.videoId === caption.videoId &&
      video && Number.isFinite(video.duration) ? video.duration : currentTime;
    const finalEnd = Math.min(maximumEnd, Math.max(caption.start + 0.1, currentTime));
    sendCaptionSegment(caption, finalEnd);
  }

  function observeCaptionContainer() {
    const nextContainer = document.querySelector(".ytp-caption-window-container");
    if (nextContainer === captionContainer) {
      return;
    }

    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }
    captionContainer = nextContainer;

    if (!captionCaptureEnabled || !captionContainer) {
      return;
    }

    captionObserver = new MutationObserver(readRenderedCaption);
    captionObserver.observe(captionContainer, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      characterData: true,
      subtree: true
    });
    readRenderedCaption();
  }

  function readRenderedCaption() {
    if (!captionCaptureEnabled) {
      return;
    }

    const text = getRenderedCaption();
    const now = getCurrentTime();
    if (!text || now === null) {
      flushCaption(now);
      return;
    }

    if (activeCaption) {
      const previousText = activeCaption.text;
      if (text === previousText || text.startsWith(previousText) || previousText.startsWith(text)) {
        activeCaption.text = text.length > previousText.length ? text : previousText;
        activeCaption.lastTime = now;
        return;
      }
      flushCaption(now);
    }

    const page = getWatchPage();
    if (page) {
      activeCaption = { videoId: page.videoId, start: now, lastTime: now, text };
    }
  }

  function startCaptionCapture() {
    const page = getWatchPage();
    if (!page) {
      return false;
    }

    captionCaptureEnabled = true;
    captionVideoId = page.videoId;
    observeCaptionContainer();
    return true;
  }

  function stopCaptionCapture() {
    flushCaption(getCurrentTime());
    captionCaptureEnabled = false;
    captionVideoId = null;
    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }
    captionContainer = null;
  }

  function detachVideo() {
    if (!boundVideo) {
      return;
    }

    boundHandlers.forEach(({ name, handler }) => {
      boundVideo.removeEventListener(name, handler);
    });
    boundVideo = null;
    boundHandlers = [];
  }

  function attachVideo(video) {
    if (video === boundVideo) {
      return false;
    }

    detachVideo();
    if (!video) {
      return false;
    }

    boundVideo = video;
    boundHandlers = videoEvents.map((name) => {
      const handler = () => {
        if (captionCaptureEnabled && name === "play") {
          readRenderedCaption();
        }
        if (captionCaptureEnabled && name === "timeupdate" && activeCaption) {
          activeCaption.lastTime = getCurrentTime();
        }
        if (captionCaptureEnabled && ["pause", "seeking", "seeked", "ended"].includes(name)) {
          flushCaption(getCurrentTime());
        }
        if (name === "timeupdate") {
          const now = Date.now();
          if (now - lastTimeUpdateAt < timeUpdateInterval) {
            return;
          }
          lastTimeUpdateAt = now;
        }
        sendState(name);
      };

      video.addEventListener(name, handler);
      return { name, handler };
    });

    return true;
  }

  function scanPage() {
    if (bridgeStopped) {
      return;
    }
    scanTimer = null;
    const page = getWatchPage();
    const video = page ? getVideoElement() : null;
    if (captionCaptureEnabled && (!page || captionVideoId !== page.videoId)) {
      flushCaption(getCurrentTime());
      if (!page) {
        stopCaptionCapture();
      } else {
        captionVideoId = page.videoId;
      }
    }
    if (captionCaptureEnabled) {
      observeCaptionContainer();
    }
    const attachedNewVideo = attachVideo(video);
    const stateKey = JSON.stringify({
      url: window.location.href,
      videoId: page ? page.videoId : null,
      title: page ? getVideoTitle() : "",
      hasVideo: Boolean(video)
    });

    if (attachedNewVideo || stateKey !== lastPageStateKey) {
      const eventName = !page ? "disconnected" :
        lastPageStateKey === null || stateKey !== lastPageStateKey ? "navigation" : "player-detected";
      sendState(eventName);
      lastPageStateKey = stateKey;
    }
  }

  function scheduleScan() {
    if (bridgeStopped) {
      return;
    }
    if (scanTimer !== null) {
      window.clearTimeout(scanTimer);
    }
    scanTimer = window.setTimeout(scanPage, 120);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SEEK_TO_TIMESTAMP") {
      const page = getWatchPage();
      const video = page ? getVideoElement() : null;
      if (!page || !video || !Number.isFinite(message.seconds) || message.seconds < 0) {
        sendResponse({ ok: false, error: "No active YouTube player is available for that timestamp." });
        return false;
      }
      if (Number.isFinite(video.duration) && message.seconds > video.duration) {
        sendResponse({ ok: false, error: "That timestamp is beyond the video duration." });
        return false;
      }
      try {
        video.currentTime = message.seconds;
      } catch (_error) {
        sendResponse({ ok: false, error: "The YouTube player rejected that timestamp." });
        return false;
      }
      sendResponse({ ok: true, currentTime: finiteTime(video.currentTime) });
      sendState("seeked");
      return false;
    }

    if (message.type === "GET_YOUTUBE_STATE") {
      scanPage();
      sendResponse(createState("snapshot"));
      return false;
    }

    if (message.type === "SET_CAPTION_CAPTURE") {
      if (message.enabled === true) {
        const started = startCaptionCapture();
        sendResponse({
          ok: started,
          enabled: started,
          error: started ? null : "Open a supported YouTube watch page before capturing captions."
        });
      } else {
        stopCaptionCapture();
        sendResponse({ ok: true, enabled: false });
      }
    }
    return false;
  });

  navigationEventNames.forEach((eventName) => {
    document.addEventListener(eventName, scheduleScan);
  });

  pageScanInterval = window.setInterval(scheduleScan, 1000);
  scanPage();
})();
