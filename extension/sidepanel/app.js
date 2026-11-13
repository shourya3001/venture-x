const messageList = document.querySelector("#messageList");
const messageInput = document.querySelector("#messageInput");
const chatForm = document.querySelector("#chatForm");
const notice = document.querySelector("#notice");
const settingsDialog = document.querySelector("#settingsDialog");
const focusButton = document.querySelector("#focusButton");
const quickActionButtons = document.querySelectorAll(".quick-actions button");
const isFocusPage = window.location.pathname.endsWith("/focus/index.html");
const returnTabValue = isFocusPage ? new URLSearchParams(window.location.search).get("returnTabId") : null;
const focusSourceTabId = returnTabValue === null ? Number.NaN : Number(returnTabValue);
const localBackendUrl = "http://127.0.0.1:3000";
const backendBaseUrlInput = document.querySelector("#backendUrl");
const saveBackendUrlButton = document.querySelector("#saveBackendUrl");
const backendSettingsStatus = document.querySelector("#backendSettingsStatus");
let backendBaseUrl = localBackendUrl;
let backendConfigPromise = null;
let contextTabId = null;
let noticeTimer;
let latestPlaybackState = null;

const connectionLabel = document.querySelector("#connectionLabel");
const connectionDot = document.querySelector("#connectionDot");
const videoContextTag = document.querySelector("#videoContextTag");
const videoTitle = document.querySelector("#videoTitle");
const videoUrl = document.querySelector("#videoUrl");
const videoId = document.querySelector("#videoId");
const playbackState = document.querySelector("#playbackState");
const playbackTime = document.querySelector("#playbackTime");
const playbackDot = document.querySelector("#playbackDot");
const transcriptStateTag = document.querySelector("#transcriptStateTag");
const transcriptSource = document.querySelector("#transcriptSource");
const transcriptSegmentCount = document.querySelector("#transcriptSegmentCount");
const transcriptDuration = document.querySelector("#transcriptDuration");
const transcriptCoverage = document.querySelector("#transcriptCoverage");
const transcriptProcessing = document.querySelector("#transcriptProcessing");
const transcriptChunkCount = document.querySelector("#transcriptChunkCount");
const transcriptPreview = document.querySelector("#transcriptPreview");
const transcriptFile = document.querySelector("#transcriptFile");
const transcriptPaste = document.querySelector("#transcriptPaste");
const pasteFormat = document.querySelector("#pasteFormat");
const loadPastedTranscript = document.querySelector("#loadPastedTranscript");
const clearTranscriptButton = document.querySelector("#clearTranscript");
const captionCaptureToggle = document.querySelector("#captionCaptureToggle");
const captionCaptureHint = document.querySelector("#captionCaptureHint");
let activeVideoId = null;
let expectedLectureDuration = null;
let transcriptSegments = [];
let transcriptChunks = null;
let cachedCoverageDuration = Number.NaN;
let cachedTranscriptCoverage = null;
let currentTranscriptSource = "None";
let transcriptVideoId = null;
let transcriptCoverageTrusted = true;
let transcriptCoverageBasis = [];
let captionCaptureEnabled = false;
const maxSessionTranscriptBytes = 8 * 1024 * 1024;
const captionCaptureSource = "YouTube on-screen captions (partial)";

function showNotice(message) {
  notice.textContent = message;
  notice.classList.add("visible");
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.classList.remove("visible");
  }, 3200);
}

function normalizeBackendBaseUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch (_error) {
    throw new Error("Enter a valid backend URL.");
  }
  if (url.username || url.password || url.search || url.hash ||
      (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("Enter only the backend origin, without credentials or a path.");
  }
  if (url.origin === localBackendUrl) {
    return localBackendUrl;
  }
  if (url.protocol === "https:" && url.hostname.endsWith(".onrender.com") &&
      url.port === "") {
    return url.origin;
  }
  throw new Error("Use the local backend URL or an HTTPS Render service URL.");
}

async function loadBackendSettings() {
  try {
    const saved = await chrome.storage.local.get("lectureMateBackendUrl");
    if (saved.lectureMateBackendUrl) {
      backendBaseUrl = normalizeBackendBaseUrl(saved.lectureMateBackendUrl);
    }
    backendBaseUrlInput.value = backendBaseUrl;

    if (backendBaseUrl !== localBackendUrl) {
      const granted = await chrome.permissions.contains({
        origins: [`${backendBaseUrl}/*`]
      });
      backendSettingsStatus.textContent = granted
        ? "Render backend selected."
        : "Save this URL again to grant its host permission.";
    } else {
      backendSettingsStatus.textContent = "Using the local backend.";
    }
  } catch (error) {
    backendBaseUrl = localBackendUrl;
    backendBaseUrlInput.value = localBackendUrl;
    backendSettingsStatus.classList.add("error");
    backendSettingsStatus.textContent = `Could not load backend settings: ${error.message}`;
  }
}

async function saveBackendSettings() {
  backendSettingsStatus.classList.remove("error");
  let nextBackendUrl;
  try {
    nextBackendUrl = normalizeBackendBaseUrl(backendBaseUrlInput.value);
    if (nextBackendUrl !== localBackendUrl) {
      const granted = await chrome.permissions.request({
        origins: [`${nextBackendUrl}/*`]
      });
      if (!granted) {
        throw new Error("Chrome did not grant permission for that Render host.");
      }
    }
    await chrome.storage.local.set({ lectureMateBackendUrl: nextBackendUrl });
    backendBaseUrl = nextBackendUrl;
    backendSettingsStatus.textContent = nextBackendUrl === localBackendUrl
      ? "Using the local backend."
      : "Render backend saved and permitted.";
  } catch (error) {
    backendSettingsStatus.classList.add("error");
    backendSettingsStatus.textContent = error.message || "Could not save the backend URL.";
  }
}

function getTranscriptStorageKey(tabId) {
  return `lectureTranscript:${tabId}`;
}

function invalidateTranscriptAnalysis() {
  transcriptChunks = null;
  cachedCoverageDuration = Number.NaN;
  cachedTranscriptCoverage = null;
}

function renderTranscript() {
  transcriptProcessing.classList.remove("error");
  transcriptSegmentCount.textContent = String(transcriptSegments.length);
  transcriptDuration.textContent = Number.isFinite(expectedLectureDuration) && expectedLectureDuration > 0
    ? formatTime(expectedLectureDuration)
    : "Unavailable";

  if (transcriptSegments.length === 0) {
    transcriptPreview.replaceChildren();
    transcriptStateTag.textContent = "MISSING";
    transcriptStateTag.classList.remove("ready", "complete");
    transcriptSource.textContent = "None";
    transcriptCoverage.textContent = "Not measured";
    transcriptChunkCount.textContent = "";
    transcriptProcessing.textContent = "No transcript loaded. Import a VTT/SRT file or paste timestamped captions.";
    clearTranscriptButton.hidden = true;
    return;
  }

  if (transcriptChunks === null) {
    transcriptChunks = LectureMateTranscript.chunkTranscript(transcriptSegments);
  }
  const previewLabel = document.createElement("span");
  previewLabel.className = "transcript-preview-label";
  previewLabel.textContent = "Latest transcript text";
  const previewItems = transcriptSegments.slice(-8).map((segment) => {
    const item = document.createElement("div");
    item.className = "transcript-preview-item";
    const time = document.createElement("span");
    time.className = "transcript-preview-time";
    time.textContent = formatTime(segment.start);
    const text = document.createElement("span");
    text.className = "transcript-preview-text";
    text.textContent = segment.text;
    item.append(time, text);
    return item;
  });
  transcriptPreview.replaceChildren(previewLabel, ...previewItems);
  if (cachedCoverageDuration !== expectedLectureDuration) {
    cachedCoverageDuration = expectedLectureDuration;
    cachedTranscriptCoverage = LectureMateTranscript.calculateCoverage(transcriptSegments, expectedLectureDuration);
  }
  const coverage = cachedTranscriptCoverage;
  const verifiedCoverage = LectureMateTranscript.calculateCoverage(
    transcriptCoverageBasis,
    expectedLectureDuration
  );
  transcriptSource.textContent = currentTranscriptSource;
  transcriptChunkCount.textContent = `Prepared ${transcriptChunks.length} transcript chunks for later use.`;
  clearTranscriptButton.hidden = false;
  transcriptStateTag.classList.remove("ready", "complete");

  if (coverage.percentage === null) {
    transcriptStateTag.textContent = "PARTIAL";
    transcriptStateTag.classList.add("ready");
    transcriptCoverage.textContent = "Duration needed";
    transcriptProcessing.textContent = "Transcript loaded. Connect to a video with a known duration to measure timestamp coverage.";
    return;
  }

  transcriptCoverage.textContent = `${coverage.percentage.toFixed(1)}%`;
  if (!transcriptCoverageTrusted) {
    transcriptCoverage.textContent += " observed";
    transcriptStateTag.textContent = "PARTIAL";
    transcriptStateTag.classList.add("ready");
    transcriptProcessing.textContent = "Visible captions have been captured, but this sample cannot verify that the full lecture transcript is present.";
  } else if (verifiedCoverage.complete) {
    transcriptStateTag.textContent = "COMPLETE";
    transcriptStateTag.classList.add("complete");
    transcriptProcessing.textContent = "Imported timestamps cover the expected lecture duration and begin/end near its boundaries.";
  } else {
    if (currentTranscriptSource.includes("on-screen captions")) {
      transcriptCoverage.textContent += " observed";
    }
    transcriptStateTag.textContent = "PARTIAL";
    transcriptStateTag.classList.add("ready");
    transcriptProcessing.textContent = "Partial transcript: timestamps do not align with the expected lecture duration and coverage range.";
  }
}

function validateStoredTranscript(record) {
  return Boolean(record && record.version === 1 &&
    typeof record.source === "string" &&
    (record.coverageTrusted === undefined || typeof record.coverageTrusted === "boolean") &&
    (record.coverageBasis === undefined || Array.isArray(record.coverageBasis) &&
      record.coverageBasis.every((range) => Array.isArray(range) && range.length === 2 &&
        Number.isFinite(range[0]) && Number.isFinite(range[1]) &&
        range[0] >= 0 && range[1] > range[0])) &&
    (record.videoId === null || typeof record.videoId === "string" && /^[\w-]{11}$/.test(record.videoId)) &&
    Array.isArray(record.segments) &&
    record.segments.every((segment) => segment &&
      Number.isFinite(segment.start) &&
      Number.isFinite(segment.end) &&
      segment.start >= 0 &&
      segment.end > segment.start &&
      typeof segment.text === "string" &&
      segment.text.trim().length > 0));
}

async function loadTranscriptForTab(tabId) {
  if (!Number.isInteger(tabId) || !chrome.storage || !chrome.storage.session) {
    return;
  }

  try {
    const key = getTranscriptStorageKey(tabId);
    const saved = await chrome.storage.session.get(key);
    if (contextTabId !== tabId) {
      return;
    }

    const record = saved[key];
    if (!validateStoredTranscript(record)) {
      return;
    }

    transcriptSegments = record.segments;
    invalidateTranscriptAnalysis();
    currentTranscriptSource = record.source;
    transcriptVideoId = record.videoId || null;
    transcriptCoverageTrusted = record.coverageTrusted !== false;
    transcriptCoverageBasis = Array.isArray(record.coverageBasis)
      ? record.coverageBasis
      : transcriptCoverageTrusted
        ? record.segments.map((segment) => [segment.start, segment.end])
        : [];
    renderTranscript();
    if (activeVideoId && transcriptVideoId && transcriptVideoId !== activeVideoId) {
      discardCurrentTranscript("The saved transcript belonged to a different video and was cleared.");
    }
  } catch (error) {
    transcriptProcessing.textContent = `Could not read the temporary transcript: ${error.message}`;
    transcriptProcessing.classList.add("error");
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session" || !Number.isInteger(contextTabId)) {
    return;
  }

  const change = changes[getTranscriptStorageKey(contextTabId)];
  if (!change) {
    return;
  }
  if (!change.newValue) {
    transcriptSegments = [];
    invalidateTranscriptAnalysis();
    currentTranscriptSource = "None";
    transcriptVideoId = null;
    transcriptCoverageTrusted = true;
    transcriptCoverageBasis = [];
    renderTranscript();
    return;
  }
  if (!validateStoredTranscript(change.newValue)) {
    return;
  }

  transcriptSegments = change.newValue.segments;
  invalidateTranscriptAnalysis();
  currentTranscriptSource = change.newValue.source;
  transcriptVideoId = change.newValue.videoId || null;
  transcriptCoverageTrusted = change.newValue.coverageTrusted !== false;
  transcriptCoverageBasis = Array.isArray(change.newValue.coverageBasis)
    ? change.newValue.coverageBasis
    : transcriptCoverageTrusted
      ? change.newValue.segments.map((segment) => [segment.start, segment.end])
      : [];
  renderTranscript();
  if (activeVideoId && transcriptVideoId && transcriptVideoId !== activeVideoId) {
    discardCurrentTranscript("The saved transcript belonged to a different video and was cleared.");
  }
});

async function persistTranscript() {
  if (!Number.isInteger(contextTabId)) {
    throw new Error("Wait for the current browser tab to finish loading.");
  }

  const record = {
    version: 1,
    source: currentTranscriptSource,
    videoId: activeVideoId,
    coverageTrusted: transcriptCoverageTrusted,
    coverageBasis: transcriptCoverageBasis,
    segments: transcriptSegments
  };
  const serializedRecord = JSON.stringify(record);
  if (new TextEncoder().encode(serializedRecord).length > maxSessionTranscriptBytes) {
    throw new Error("This transcript is too large for temporary session storage.");
  }

  await chrome.storage.session.set({
    [getTranscriptStorageKey(contextTabId)]: record
  });
}

async function importTranscriptText(text, format, source) {
  transcriptProcessing.classList.remove("error");
  transcriptProcessing.textContent = "Processing transcript…";
  const previousTranscript = {
    segments: transcriptSegments,
    source: currentTranscriptSource,
    videoId: transcriptVideoId,
    coverageTrusted: transcriptCoverageTrusted,
    coverageBasis: transcriptCoverageBasis
  };
  try {
    const result = LectureMateTranscript.parseTranscript(text, format);
    if (result.segments.length === 0) {
      throw new Error("No valid timestamped caption segments were found. Check the VTT/SRT format.");
    }

    transcriptSegments = result.segments;
    invalidateTranscriptAnalysis();
    currentTranscriptSource = source;
    transcriptVideoId = activeVideoId;
    transcriptCoverageTrusted = true;
    transcriptCoverageBasis = result.segments.map((segment) => [segment.start, segment.end]);
    await persistTranscript();
    renderTranscript();
    if (source.startsWith("Pasted ")) {
      transcriptPaste.value = "";
    }

    const details = [];
    if (result.duplicates > 0) {
      details.push(`${result.duplicates} duplicate segment${result.duplicates === 1 ? "" : "s"} removed`);
    }
    if (result.rejected > 0) {
      details.push(`${result.rejected} invalid segment${result.rejected === 1 ? "" : "s"} skipped`);
    }
    transcriptProcessing.textContent = details.length > 0
      ? `${transcriptProcessing.textContent} ${details.join("; ")}.`
      : transcriptProcessing.textContent;
  } catch (error) {
    transcriptSegments = previousTranscript.segments;
    invalidateTranscriptAnalysis();
    currentTranscriptSource = previousTranscript.source;
    transcriptVideoId = previousTranscript.videoId;
    transcriptCoverageTrusted = previousTranscript.coverageTrusted;
    transcriptCoverageBasis = previousTranscript.coverageBasis;
    renderTranscript();
    transcriptProcessing.classList.add("error");
    transcriptProcessing.textContent = error.message || "The transcript could not be processed.";
  }
}

function discardCurrentTranscript(statusMessage) {
  transcriptSegments = [];
  invalidateTranscriptAnalysis();
  currentTranscriptSource = "None";
  transcriptVideoId = null;
  transcriptCoverageTrusted = true;
  transcriptCoverageBasis = [];
  transcriptPaste.value = "";
  renderTranscript();
  if (statusMessage) {
    transcriptProcessing.textContent = statusMessage;
  }

  if (Number.isInteger(contextTabId) && chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove(getTranscriptStorageKey(contextTabId)).catch((error) => {
      transcriptProcessing.classList.add("error");
      transcriptProcessing.textContent = `Could not clear the temporary transcript: ${error.message}`;
    });
  }
}

transcriptFile.addEventListener("change", async () => {
  const file = transcriptFile.files && transcriptFile.files[0];
  if (!file) {
    return;
  }

  const extension = file.name.split(".").pop().toLowerCase();
  if (extension !== "vtt" && extension !== "srt") {
    transcriptProcessing.classList.add("error");
    transcriptProcessing.textContent = "Choose a .vtt or .srt subtitle file.";
    transcriptFile.value = "";
    return;
  }
  if (file.size > maxSessionTranscriptBytes) {
    transcriptProcessing.classList.add("error");
    transcriptProcessing.textContent = "This subtitle file is too large for temporary session storage.";
    transcriptFile.value = "";
    return;
  }

  try {
    const text = await file.text();
    await importTranscriptText(text, extension, `${extension.toUpperCase()} file`);
  } catch (error) {
    transcriptProcessing.classList.add("error");
    transcriptProcessing.textContent = `Could not read the subtitle file: ${error.message}`;
  } finally {
    transcriptFile.value = "";
  }
});

loadPastedTranscript.addEventListener("click", () => {
  if (!transcriptPaste.value.trim()) {
    transcriptProcessing.classList.add("error");
    transcriptProcessing.textContent = "Paste timestamped VTT or SRT content first.";
    return;
  }
  importTranscriptText(
    transcriptPaste.value,
    pasteFormat.value,
    `Pasted ${pasteFormat.value.toUpperCase()}`
  );
});

clearTranscriptButton.addEventListener("click", () => {
  discardCurrentTranscript("Transcript cleared from this browser session.");
});

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function showDisconnected(message) {
  latestPlaybackState = null;
  connectionLabel.textContent = "Disconnected";
  connectionDot.classList.remove("connected");
  videoContextTag.textContent = "DISCONNECTED";
  videoContextTag.classList.remove("connected");
  videoTitle.textContent = "No YouTube video detected";
  videoUrl.textContent = message || "Open a YouTube watch page to connect.";
  videoId.textContent = "Video ID: --";
  playbackState.textContent = "Not connected";
  playbackTime.textContent = "--:-- / --:--";
  playbackDot.classList.remove("playing", "paused");
  captionCaptureToggle.disabled = true;
  updateCaptionCaptureControl(false);
}

function isValidState(state) {
  if (!state || typeof state !== "object" || typeof state.connected !== "boolean") {
    return false;
  }
  if (!state.connected) {
    return true;
  }

  if (typeof state.videoId !== "string" || !/^[\w-]{11}$/.test(state.videoId) ||
      typeof state.url !== "string" || typeof state.title !== "string") {
    return false;
  }

  try {
    const url = new URL(state.url);
    return ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) &&
      url.protocol === "https:" &&
      url.pathname === "/watch" &&
      url.searchParams.get("v") === state.videoId;
  } catch (_error) {
    return false;
  }
}

function renderPlaybackState(state) {
  if (state && typeof state.captionCaptureEnabled === "boolean") {
    updateCaptionCaptureControl(state.captionCaptureEnabled);
  }
  if (!isValidState(state) || !state.connected) {
    showDisconnected();
    if (state && state.connected === false && state.event === "disconnected") {
      activeVideoId = null;
      expectedLectureDuration = null;
      discardCurrentTranscript("No YouTube watch video is connected. The transcript was cleared.");
    } else {
      renderTranscript();
    }
    return;
  }

  if ((activeVideoId && activeVideoId !== state.videoId) ||
      (transcriptVideoId && transcriptVideoId !== state.videoId)) {
    discardCurrentTranscript("The video changed. Import a transcript for this video.");
  }
  latestPlaybackState = state;
  captionCaptureToggle.disabled = !state.hasVideo;
  activeVideoId = state.videoId;
  expectedLectureDuration = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : null;
  if (transcriptSegments.length > 0 && !transcriptVideoId) {
    transcriptVideoId = state.videoId;
    persistTranscript().catch((error) => {
      transcriptProcessing.classList.add("error");
      transcriptProcessing.textContent = `Could not save the temporary transcript: ${error.message}`;
    });
  }
  renderTranscript();

  connectionLabel.textContent = "YouTube connected";
  connectionDot.classList.add("connected");
  videoContextTag.textContent = "LIVE";
  videoContextTag.classList.add("connected");
  videoTitle.textContent = state.title || "Untitled video";
  videoUrl.textContent = state.url;
  videoId.textContent = `Video ID: ${state.videoId}`;
  playbackTime.textContent = `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
  playbackDot.classList.remove("playing", "paused");

  if (!state.hasVideo) {
    playbackState.textContent = "Waiting for video player";
  } else if (state.event === "ended") {
    playbackState.textContent = "Ended";
    playbackDot.classList.add("paused");
  } else if (state.paused) {
    playbackState.textContent = "Paused";
    playbackDot.classList.add("paused");
  } else {
    playbackState.textContent = "Playing";
    playbackDot.classList.add("playing");
  }
}

function updateCaptionCaptureControl(enabled) {
  captionCaptureEnabled = enabled;
  captionCaptureToggle.textContent = enabled
    ? "Stop on-screen caption capture"
    : "Start on-screen caption capture";
  captionCaptureToggle.classList.toggle("capturing", enabled);
  captionCaptureHint.textContent = enabled
    ? "Capture is on. Keep YouTube captions enabled and visible; collected text remains a partial sample."
    : "Turn on YouTube captions first. Only captions visibly shown while you watch are captured; this is not a complete transcript.";
}

function startOrStopCaptionCapture() {
  if (!Number.isInteger(contextTabId) || !activeVideoId) {
    showNotice("Open a YouTube watch page and wait for its video details before capturing captions.");
    return;
  }

  const enabled = !captionCaptureEnabled;
  chrome.tabs.sendMessage(contextTabId, { type: "SET_CAPTION_CAPTURE", enabled }, (response) => {
    if (chrome.runtime.lastError) {
      captionCaptureHint.textContent = "The YouTube bridge is unavailable. Refresh the YouTube watch page, then try again.";
      showNotice("Refresh the YouTube watch page to load LectureMate's caption bridge.");
      return;
    }
    if (!response || !response.ok) {
      showNotice(response && response.error
        ? response.error
        : "Caption capture could not be started.");
      return;
    }

    updateCaptionCaptureControl(response.enabled === true);
    if (!response.enabled) {
      transcriptProcessing.textContent = transcriptSegments.length > 0
        ? "Caption capture stopped. Captured captions remain marked as partial."
        : "Caption capture stopped. No visible captions were collected.";
    }
  });
}

async function appendCapturedCaption(message) {
  if (message.tabId !== contextTabId || message.videoId !== activeVideoId) {
    return;
  }

  const segment = message.segment;
  if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
      segment.start < 0 || segment.end <= segment.start ||
      typeof segment.text !== "string" || !segment.text.trim()) {
    return;
  }

  const isSameVideo = transcriptVideoId === message.videoId;
  if (!isSameVideo) {
    transcriptSegments = [];
    currentTranscriptSource = captionCaptureSource;
    transcriptCoverageTrusted = false;
    transcriptCoverageBasis = [];
  } else if (transcriptSegments.length > 0 && !currentTranscriptSource.includes("on-screen captions")) {
    currentTranscriptSource = `${currentTranscriptSource} + on-screen captions`;
  }

  transcriptVideoId = message.videoId;
  const normalizedText = segment.text.trim().slice(0, 2000);
  const alreadyCaptured = transcriptSegments.some((existing) =>
    existing.start === segment.start &&
    existing.end === segment.end &&
    existing.text === normalizedText
  );
  if (alreadyCaptured) {
    return;
  }

  transcriptSegments.push({
    start: segment.start,
    end: segment.end,
    text: normalizedText
  });
  transcriptSegments.sort((left, right) => left.start - right.start || left.end - right.end);
  invalidateTranscriptAnalysis();
  renderTranscript();
  transcriptProcessing.textContent = transcriptCoverageTrusted
    ? "Visible captions added to this transcript. Full coverage still depends on the imported timestamps."
    : "Visible YouTube captions captured. This is a partial sample, not a complete transcript.";

  try {
    await persistTranscript();
  } catch (error) {
    transcriptProcessing.classList.add("error");
    transcriptProcessing.textContent = `Could not save captured captions for this browser session: ${error.message}`;
  }
}

function refreshTabState(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  chrome.tabs.sendMessage(tabId, { type: "GET_YOUTUBE_STATE" }, (state) => {
    if (contextTabId !== tabId) {
      return;
    }
    if (chrome.runtime.lastError) {
      showDisconnected("No LectureMate bridge responded. Open or reload a YouTube watch page to connect.");
      return;
    }
    renderPlaybackState(state);
  });
}

function requestTabState(tabId) {
  if (!Number.isInteger(tabId)) {
    contextTabId = null;
    activeVideoId = null;
    expectedLectureDuration = null;
    transcriptCoverageTrusted = true;
    updateCaptionCaptureControl(false);
    showDisconnected();
    renderTranscript();
    return;
  }

  if (contextTabId !== tabId) {
    if (captionCaptureEnabled && Number.isInteger(contextTabId)) {
      chrome.tabs.sendMessage(contextTabId, { type: "SET_CAPTION_CAPTURE", enabled: false }, () => {
        if (chrome.runtime.lastError) {
          return;
        }
      });
    }
    updateCaptionCaptureControl(false);
    activeVideoId = null;
    expectedLectureDuration = null;
    transcriptSegments = [];
    invalidateTranscriptAnalysis();
    currentTranscriptSource = "None";
    transcriptVideoId = null;
    transcriptCoverageTrusted = true;
    transcriptCoverageBasis = [];
    transcriptPaste.value = "";
    renderTranscript();
  }
  contextTabId = tabId;
  showDisconnected("Checking for a supported YouTube video...");
  loadTranscriptForTab(tabId);
  refreshTabState(tabId);
}

function initializeVideoContext() {
  if (isFocusPage) {
    requestTabState(focusSourceTabId);
    return;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      showDisconnected();
      return;
    }
    requestTabState(tabs[0] && tabs[0].id);
  });
}

function refreshActiveContext() {
  if (isFocusPage) {
    refreshTabState(contextTabId);
    return;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      return;
    }
    const activeTabId = tabs[0] && tabs[0].id;
    if (activeTabId !== contextTabId) {
      requestTabState(activeTabId);
    } else {
      refreshTabState(activeTabId);
    }
  });
}

captionCaptureToggle.addEventListener("click", startOrStopCaptionCapture);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "LECTUREMATE_PLAYBACK_UPDATE" && message.tabId === contextTabId) {
    renderPlaybackState(message.state);
  } else if (message.type === "LECTUREMATE_CAPTION_SEGMENT") {
    appendCapturedCaption(message);
  } else if (!isFocusPage && message.type === "LECTUREMATE_ACTIVE_TAB_CHANGED") {
    requestTabState(message.tabId);
  } else if (message.type === "LECTUREMATE_TAB_UPDATED" && message.tabId === contextTabId) {
    requestTabState(message.tabId);
  } else if (message.type === "LECTUREMATE_TAB_CLOSED" && message.tabId === contextTabId) {
    contextTabId = null;
    activeVideoId = null;
    expectedLectureDuration = null;
    transcriptSegments = [];
    invalidateTranscriptAnalysis();
    currentTranscriptSource = "None";
    transcriptVideoId = null;
    transcriptCoverageTrusted = true;
    transcriptCoverageBasis = [];
    updateCaptionCaptureControl(false);
    showDisconnected();
    renderTranscript();
  }
});

function addMessage(text, kind) {
  const bubble = document.createElement("article");
  bubble.className = `chat-message ${kind}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = kind === "user" ? "YOU" : "LECTUREMATE";

  const content = document.createElement("span");
  content.textContent = text;

  bubble.append(label, content);
  messageList.append(bubble);
  messageList.scrollTop = messageList.scrollHeight;
  return { bubble, label, content };
}

function buildLessonContext() {
  if (transcriptSegments.length === 0 || transcriptVideoId !== activeVideoId) {
    return null;
  }

  const selectedSegments = [];
  let totalTextLength = 0;
  for (let index = transcriptSegments.length - 1; index >= 0 && selectedSegments.length < 80; index -= 1) {
    const segment = transcriptSegments[index];
    if (segment.text.length > 2000) {
      continue;
    }
    if (totalTextLength + segment.text.length > 24000) {
      break;
    }
    selectedSegments.push({
      start: segment.start,
      end: segment.end,
      text: segment.text
    });
    totalTextLength += segment.text.length;
  }
  selectedSegments.reverse();
  return { source: currentTranscriptSource, segments: selectedSegments };
}

function buildChatPayload(question) {
  if (!latestPlaybackState || !latestPlaybackState.connected || !activeVideoId) {
    throw new Error("Open a YouTube watch page and wait for its video details before asking a question.");
  }

  return {
    question,
    videoContext: {
      videoId: latestPlaybackState.videoId,
      title: latestPlaybackState.title.slice(0, 300),
      url: latestPlaybackState.url,
      currentTime: latestPlaybackState.currentTime,
      duration: latestPlaybackState.duration
    },
    lessonContext: buildLessonContext()
  };
}

async function sendChatQuestion(question, assistantMessage) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90000);
  try {
    await backendConfigPromise;
    if (backendBaseUrl !== localBackendUrl) {
      const granted = await chrome.permissions.contains({
        origins: [`${backendBaseUrl}/*`]
      });
      if (!granted) {
        throw new Error("Open Settings and save the Render URL to grant its host permission.");
      }
    }
    const payload = buildChatPayload(question);
    const response = await fetch(`${backendBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    let result;
    try {
      result = await response.json();
    } catch (_error) {
      throw new Error("The backend returned an invalid JSON response.");
    }
    if (!response.ok) {
      throw new Error(result && result.error && typeof result.error.message === "string"
        ? result.error.message
        : `The backend request failed with status ${response.status}.`);
    }
    if (!result || typeof result.answer !== "string" ||
        !result.answer.trim() || result.answer.length > 12000) {
      throw new Error("The backend returned an invalid answer format.");
    }

    assistantMessage.label.textContent = "LECTUREMATE";
    assistantMessage.content.textContent = result.answer.trim();
    assistantMessage.bubble.classList.remove("loading");
  } catch (error) {
    assistantMessage.label.textContent = "LECTUREMATE · ERROR";
    assistantMessage.bubble.classList.remove("loading");
    assistantMessage.bubble.classList.add("error");
    if (error.name === "AbortError") {
      assistantMessage.content.textContent = "The backend request timed out. Check that the backend and provider are responding, then try again.";
    } else if (error instanceof TypeError) {
      assistantMessage.content.textContent = backendBaseUrl === localBackendUrl
        ? "Could not connect to the local backend. Start it from the backend folder and check its extension origin."
        : "Could not reach the Render backend. Check that the service is live and its extension origin is configured correctly.";
    } else {
      assistantMessage.content.textContent = error.message || "The backend could not complete the request.";
    }
  } finally {
    window.clearTimeout(timeout);
    messageInput.disabled = false;
    chatForm.querySelector('button[type="submit"]').disabled = false;
    messageInput.focus();
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();

  if (!text) {
    messageInput.focus();
    return;
  }

  addMessage(text, "user");
  const assistantMessage = addMessage("Waiting for the backend…", "assistant");
  assistantMessage.label.textContent = "LECTUREMATE · WAITING";
  assistantMessage.bubble.classList.add("loading");
  messageInput.value = "";
  messageInput.style.height = "auto";
  messageInput.disabled = true;
  chatForm.querySelector('button[type="submit"]').disabled = true;
  sendChatQuestion(text, assistantMessage);
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

quickActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.prompt || "";
    messageInput.focus();
    messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
    messageInput.dispatchEvent(new Event("input"));
  });
});

document.querySelector("#settingsButton").addEventListener("click", () => {
  settingsDialog.showModal();
});
saveBackendUrlButton.addEventListener("click", saveBackendSettings);

if (isFocusPage) {
  const returnButton = document.querySelector("#focusButton");
  returnButton.setAttribute("aria-label", "Return to side panel");
  returnButton.title = "Return to side panel";
  returnButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3 0.9 9.1 7 15.2M1.5 9.1h11a6 6 0 0 1 6 6"></path></svg>';

  returnButton.addEventListener("click", () => {
    if (!Number.isInteger(focusSourceTabId) || focusSourceTabId < 0) {
      showNotice("The original browser tab is no longer available. Open the side panel from the toolbar.");
      return;
    }

    chrome.sidePanel.open({ tabId: focusSourceTabId })
      .then(() => {
        chrome.runtime.sendMessage(
          { type: "RETURN_TO_SIDE_PANEL", tabId: focusSourceTabId },
          (response) => {
            if (chrome.runtime.lastError) {
              showNotice(chrome.runtime.lastError.message);
              return;
            }

            if (!response || !response.ok) {
              showNotice(response?.error || "Could not return to the lecture tab.");
            }
          }
        );
      })
      .catch((error) => {
        showNotice(`Could not open the side panel: ${error.message}`);
      });
  });
} else {
  focusButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_FOCUS" }, (response) => {
      if (chrome.runtime.lastError) {
        showNotice(chrome.runtime.lastError.message);
        return;
      }

      if (!response || !response.ok) {
        showNotice(response?.error || "Focus mode could not be opened.");
      }
    });
  });
}

initializeVideoContext();
backendConfigPromise = loadBackendSettings();
window.setInterval(refreshActiveContext, 1000);
