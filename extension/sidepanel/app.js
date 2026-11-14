const messageList = document.querySelector("#messageList");
const messageInput = document.querySelector("#messageInput");
const chatForm = document.querySelector("#chatForm");
const resetConversationButton = document.querySelector("#resetConversation");
const visualizationPanel = document.querySelector("#visualizationPanel");
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
let chatHistory = [];
let chatHistoryVideoId = null;

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
const analyzeLectureButton = document.querySelector("#analyzeLecture");
const analysisStatus = document.querySelector("#analysisStatus");
const knowledgeStatus = document.querySelector("#knowledgeStatus");
const knowledgeBasePanel = document.querySelector("#knowledgeBase");
const knowledgeSummary = document.querySelector("#knowledgeSummary");
const knowledgeTopics = document.querySelector("#knowledgeTopics");
const knowledgeConcepts = document.querySelector("#knowledgeConcepts");
const knowledgeGlossary = document.querySelector("#knowledgeGlossary");
const knowledgeEquations = document.querySelector("#knowledgeEquations");
const knowledgeExamples = document.querySelector("#knowledgeExamples");
const knowledgeRelationships = document.querySelector("#knowledgeRelationships");
const knowledgeDifficult = document.querySelector("#knowledgeDifficult");
const knowledgeSearchInput = document.querySelector("#knowledgeSearchInput");
const knowledgeSearchButton = document.querySelector("#knowledgeSearchButton");
const knowledgeSearchResults = document.querySelector("#knowledgeSearchResults");
const captionCaptureToggle = document.querySelector("#captionCaptureToggle");
const captionCaptureHint = document.querySelector("#captionCaptureHint");
let activeVideoId = null;
let expectedLectureDuration = null;
let transcriptSegments = [];
let transcriptChunks = null;
let transcriptSearchDocuments = null;
let lectureKnowledgeBase = null;
let analysisInProgress = false;
let transcriptRevision = 0;
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

function getChatStorageKey(tabId) {
  return `lectureChat:${tabId}`;
}

function validateStoredChat(record) {
  return Boolean(record && record.version === 1 &&
    typeof record.videoId === "string" && /^[\w-]{11}$/.test(record.videoId) &&
    Array.isArray(record.messages) && record.messages.length <= 40 &&
    record.messages.every((message) => message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" && message.content.length <= 12000 &&
      (message.citations === undefined || Array.isArray(message.citations) &&
        message.citations.length <= 8 && message.citations.every((timestamp) =>
          Number.isFinite(timestamp) && timestamp >= 0))));
}

function invalidateTranscriptAnalysis() {
  transcriptChunks = null;
  transcriptSearchDocuments = null;
  cachedCoverageDuration = Number.NaN;
  cachedTranscriptCoverage = null;
  transcriptRevision += 1;
  lectureKnowledgeBase = null;
  renderKnowledgeBase();
  if (!analysisInProgress) {
    analysisStatus.classList.remove("error");
    analysisStatus.textContent = transcriptSegments.length > 0
      ? "Analyze this transcript to create a timestamped knowledge base."
      : "Load a transcript for this video to build a knowledge base.";
  }
}

function validateKnowledgeBase(record) {
  const collections = [
    "topics", "concepts", "glossary", "equations", "examples",
    "relationships", "difficultExplanations"
  ];
  return Boolean(record && record.version === 1 &&
    typeof record.videoId === "string" && /^[\w-]{11}$/.test(record.videoId) &&
    typeof record.summary === "string" &&
    record.transcriptCompleteness && typeof record.transcriptCompleteness.status === "string" &&
    record.summaryEvidence && Array.isArray(record.summaryEvidence) &&
    collections.every((name) => Array.isArray(record[name])));
}

function renderKnowledgeList(element, items, getLabel) {
  const entries = items.slice(0, 20).map((item) => {
    const row = document.createElement("li");
    row.textContent = getLabel(item);
    const details = document.createElement("small");
    const attribution = item.attribution === "instructor" ? "Instructor" : "AI inference";
    const timestamps = (item.timestamps || []).map(formatTime).join(", ");
    details.textContent = [attribution, timestamps].filter(Boolean).join(" · ");
    row.append(details);
    return row;
  });
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No evidence-supported items extracted.";
    entries.push(empty);
  }
  element.replaceChildren(...entries);
}

function renderKnowledgeBase() {
  const available = validateKnowledgeBase(lectureKnowledgeBase) &&
    lectureKnowledgeBase.videoId === activeVideoId;
  knowledgeStatus.textContent = available ? "ready" : "not generated";
  knowledgeBasePanel.hidden = !available;
  analyzeLectureButton.disabled = analysisInProgress ||
    transcriptSegments.length === 0 || transcriptVideoId !== activeVideoId;
  if (!available) {
    knowledgeSearchResults.replaceChildren();
    return;
  }

  knowledgeSummary.textContent = lectureKnowledgeBase.summary ||
    "No summary could be supported by the supplied transcript evidence.";
  renderKnowledgeList(knowledgeTopics, lectureKnowledgeBase.topics, (item) =>
    `${item.topic}${item.subtopics && item.subtopics.length ? ` — ${item.subtopics.join(", ")}` : ""}`);
  renderKnowledgeList(knowledgeConcepts, lectureKnowledgeBase.concepts, (item) =>
    `${item.concept}: ${item.explanation}${item.variables.length
      ? ` Variables: ${item.variables.map((variable) =>
        `${variable.symbol}${variable.meaning ? ` (${variable.meaning})` : ""}`).join(", ")}.`
      : ""}`);
  renderKnowledgeList(knowledgeGlossary, lectureKnowledgeBase.glossary, (item) =>
    `${item.term}${item.abbreviation ? ` (${item.abbreviation})` : ""}: ${item.definition}`);
  renderKnowledgeList(knowledgeEquations, lectureKnowledgeBase.equations, (item) =>
    `${item.expression}${item.variables.length
      ? ` · ${item.variables.map((variable) =>
        `${variable.symbol}${variable.meaning ? ` (${variable.meaning})` : ""}`).join(", ")}`
      : ""}`);
  renderKnowledgeList(knowledgeExamples, lectureKnowledgeBase.examples, (item) => item.description);
  renderKnowledgeList(knowledgeRelationships, lectureKnowledgeBase.relationships, (item) =>
    `${item.from} ${item.relation} ${item.to}`);
  renderKnowledgeList(knowledgeDifficult, lectureKnowledgeBase.difficultExplanations, (item) =>
    `${item.explanation}${item.reason ? ` — ${item.reason}` : ""}`);
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
    renderKnowledgeBase();
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
  renderKnowledgeBase();
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
    (record.knowledgeBase === undefined || validateKnowledgeBase(record.knowledgeBase)) &&
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
    lectureKnowledgeBase = validateKnowledgeBase(record.knowledgeBase) &&
      record.knowledgeBase.videoId === record.videoId
      ? record.knowledgeBase
      : null;
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

async function loadConversationForTab(tabId) {
  if (!Number.isInteger(tabId) || !chrome.storage || !chrome.storage.session) {
    return;
  }
  try {
    const key = getChatStorageKey(tabId);
    const saved = await chrome.storage.session.get(key);
    if (contextTabId !== tabId) {
      return;
    }
    const record = saved[key];
    if (!validateStoredChat(record)) {
      renderConversation();
      return;
    }
    if (activeVideoId && record.videoId !== activeVideoId) {
      chatHistory = [];
      chatHistoryVideoId = activeVideoId;
      clearVisualization();
      await chrome.storage.session.remove(key);
      renderConversation();
      return;
    }
    chatHistory = record.messages;
    chatHistoryVideoId = record.videoId;
    renderConversation();
  } catch (error) {
    showNotice(`Could not restore this session's conversation: ${error.message}`);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session" || !Number.isInteger(contextTabId)) {
    return;
  }

  const chatChange = changes[getChatStorageKey(contextTabId)];
  if (chatChange) {
    if (!chatChange.newValue) {
      chatHistory = [];
      chatHistoryVideoId = null;
      renderConversation();
    } else if (validateStoredChat(chatChange.newValue)) {
      chatHistory = chatChange.newValue.messages;
      chatHistoryVideoId = chatChange.newValue.videoId;
      if (!activeVideoId || chatHistoryVideoId === activeVideoId) {
        renderConversation();
      }
    }
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
  lectureKnowledgeBase = validateKnowledgeBase(change.newValue.knowledgeBase) &&
    change.newValue.knowledgeBase.videoId === change.newValue.videoId
    ? change.newValue.knowledgeBase
    : null;
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
    segments: transcriptSegments,
    ...(validateKnowledgeBase(lectureKnowledgeBase) ? { knowledgeBase: lectureKnowledgeBase } : {})
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
    coverageBasis: transcriptCoverageBasis,
    knowledgeBase: lectureKnowledgeBase
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
    lectureKnowledgeBase = previousTranscript.knowledgeBase;
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

async function analyzeCurrentLecture() {
  if (!latestPlaybackState || !latestPlaybackState.connected || !activeVideoId ||
      transcriptSegments.length === 0 || transcriptVideoId !== activeVideoId) {
    analysisStatus.textContent = "Connect the matching video and load its timestamped transcript first.";
    analysisStatus.classList.add("error");
    return;
  }

  const requestedVideoId = activeVideoId;
  const requestedRevision = transcriptRevision;
  const coverage = LectureMateTranscript.calculateCoverage(transcriptSegments, expectedLectureDuration);
  const verifiedCoverage = LectureMateTranscript.calculateCoverage(
    transcriptCoverageBasis,
    expectedLectureDuration
  );
  const transcriptCompleteness = {
    status: !transcriptCoverageTrusted
      ? "partial"
      : coverage.percentage === null
        ? "unknown"
        : verifiedCoverage.complete
          ? "complete"
          : "partial",
    coveragePercentage: coverage.percentage
  };
  analysisInProgress = true;
  analysisStatus.classList.remove("error");
  analysisStatus.textContent = "Analyzing transcript chunks and checking evidence…";
  renderKnowledgeBase();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 300000);
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

    const response = await fetch(`${backendBaseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoContext: {
          videoId: latestPlaybackState.videoId,
          title: latestPlaybackState.title.slice(0, 300),
          url: latestPlaybackState.url,
          currentTime: latestPlaybackState.currentTime,
          duration: expectedLectureDuration
        },
        lessonMetadata: {
          title: latestPlaybackState.title.slice(0, 300),
          source: currentTranscriptSource
        },
        transcriptCompleteness,
        transcript: transcriptSegments
      }),
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
    if (!validateKnowledgeBase(result) || result.videoId !== requestedVideoId) {
      throw new Error("The backend returned an invalid knowledge base.");
    }
    if (activeVideoId !== requestedVideoId || transcriptRevision !== requestedRevision) {
      throw new Error("The video or transcript changed during analysis. Analyze the current transcript again.");
    }

    lectureKnowledgeBase = result;
    renderKnowledgeBase();
    const completenessLabel = result.transcriptCompleteness.status;
    analysisStatus.textContent =
      `Knowledge base ready from ${result.transcriptCompleteness.analyzedChunks} chunk(s); transcript marked ${completenessLabel}.`;
    await persistTranscript();
  } catch (error) {
    analysisStatus.classList.add("error");
    if (error.name === "AbortError") {
      analysisStatus.textContent = "Analysis timed out. Check the backend/provider and try again.";
    } else if (error instanceof TypeError) {
      analysisStatus.textContent = backendBaseUrl === localBackendUrl
        ? "Could not connect to the local backend. Start it from the backend folder and check its extension origin."
        : "Could not reach the Render backend. Check that the service is live and its extension origin is configured correctly.";
    } else {
      analysisStatus.textContent = error.message || "The transcript could not be analyzed.";
    }
  } finally {
    window.clearTimeout(timeout);
    analysisInProgress = false;
    renderKnowledgeBase();
  }
}

function renderKnowledgeSearchResults() {
  const results = LectureMateTranscript.searchKnowledgeBase(
    knowledgeSearchInput.value,
    lectureKnowledgeBase,
    transcriptChunks || [],
    8
  );
  const rows = results.map((result) => {
    const row = document.createElement("li");
    row.className = "knowledge-result";
    row.textContent = `${result.title}: ${result.text}`;
    const details = document.createElement("small");
    details.textContent = [
      result.type,
      ...result.timestamps.map(formatTime)
    ].join(" · ");
    row.append(details);
    return row;
  });
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "knowledge-result";
    empty.textContent = "No keyword matches in the supplied transcript or knowledge base.";
    rows.push(empty);
  }
  knowledgeSearchResults.replaceChildren(...rows);
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
      (chatHistoryVideoId && chatHistoryVideoId !== state.videoId)) {
    clearConversationForVideo(state.videoId);
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

function clearConversationForVideo(videoId) {
  chatHistory = [];
  chatHistoryVideoId = videoId || null;
  renderConversation();
  clearVisualization();
  if (Number.isInteger(contextTabId) && chrome.storage && chrome.storage.session) {
    chrome.storage.session.remove(getChatStorageKey(contextTabId)).catch((error) => {
      showNotice(`Could not clear the previous conversation: ${error.message}`);
    });
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
    chatHistory = [];
    chatHistoryVideoId = null;
    clearVisualization();
    renderConversation();
    transcriptPaste.value = "";
    renderTranscript();
  }
  contextTabId = tabId;
  showDisconnected("Checking for a supported YouTube video...");
  loadTranscriptForTab(tabId);
  loadConversationForTab(tabId);
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
analyzeLectureButton.addEventListener("click", analyzeCurrentLecture);
knowledgeSearchButton.addEventListener("click", renderKnowledgeSearchResults);
knowledgeSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    renderKnowledgeSearchResults();
  }
});

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
    chatHistory = [];
    chatHistoryVideoId = null;
    clearVisualization();
    invalidateTranscriptAnalysis();
    currentTranscriptSource = "None";
    transcriptVideoId = null;
    transcriptCoverageTrusted = true;
    transcriptCoverageBasis = [];
    renderConversation();
    updateCaptionCaptureControl(false);
    showDisconnected();
    renderTranscript();
  }
});

function addMessage(text, kind, citations) {
  const bubble = document.createElement("article");
  bubble.className = `chat-message ${kind}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = kind === "user" ? "YOU" : "LECTUREMATE";

  const content = document.createElement("div");
  content.className = "message-content";
  if (kind === "assistant") {
    renderAnswerContent(content, text, citations || []);
  } else {
    content.textContent = text;
  }

  bubble.append(label, content);
  messageList.append(bubble);
  messageList.scrollTop = messageList.scrollHeight;
  return { bubble, label, content, citations: citations || [] };
}

function formatCitationTimestamp(seconds) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function createTimestampButton(seconds, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "timestamp-link";
  button.textContent = `[${label || formatCitationTimestamp(seconds)}]`;
  button.setAttribute("aria-label", `Seek to ${formatTime(seconds)}`);
  button.addEventListener("click", () => seekToTimestamp(seconds));
  return button;
}

function renderAnswerContent(content, answer, citations) {
  const parts = LectureMateChatRenderer.splitAnswer(
    answer,
    citations,
    latestPlaybackState && latestPlaybackState.duration
  );
  const nodes = parts.map((part) => part.type === "timestamp"
    ? createTimestampButton(part.seconds, part.text)
    : document.createTextNode(part.text));
  if (citations.length > 0) {
    const references = document.createElement("div");
    references.className = "answer-references";
    references.append(document.createTextNode("Lecture references:"));
    citations.forEach((timestamp) => references.append(createTimestampButton(timestamp)));
    nodes.push(references);
  }
  content.replaceChildren(...nodes);
}

function seekToTimestamp(seconds) {
  if (!Number.isInteger(contextTabId) || !activeVideoId ||
      !Number.isFinite(seconds) || seconds < 0 ||
      Number.isFinite(expectedLectureDuration) && seconds > expectedLectureDuration) {
    showNotice("This lecture timestamp is not available in the active video.");
    return;
  }

  chrome.tabs.sendMessage(contextTabId, {
    type: "SEEK_TO_TIMESTAMP",
    seconds
  }, (response) => {
    if (chrome.runtime.lastError) {
      showNotice("Could not reach the YouTube player. Reload the lecture tab and try again.");
      return;
    }
    if (!response || !response.ok || !Number.isFinite(response.currentTime)) {
      showNotice(response && response.error
        ? response.error
        : "The YouTube player could not seek to that timestamp.");
      return;
    }
    if (latestPlaybackState && latestPlaybackState.videoId === activeVideoId) {
      latestPlaybackState = {
        ...latestPlaybackState,
        currentTime: response.currentTime,
        event: "seeked"
      };
      renderPlaybackState(latestPlaybackState);
    }
  });
}

function renderConversation() {
  messageList.replaceChildren();
  if (chatHistory.length === 0) {
    const welcome = document.createElement("div");
    welcome.className = "welcome-card";
    const title = document.createElement("h3");
    title.textContent = "Ask about this lecture.";
    const copy = document.createElement("p");
    copy.className = "welcome-copy";
    copy.textContent = "Relevant lesson excerpts and knowledge will be retrieved for your question.";
    welcome.append(title, copy);
    messageList.append(welcome);
    return;
  }
  chatHistory.forEach((message) => {
    addMessage(message.content, message.role, message.citations || []);
  });
}

async function persistChatHistory() {
  if (!Number.isInteger(contextTabId) || !chatHistoryVideoId) {
    throw new Error("Wait for the current video to connect before saving conversation history.");
  }
  await chrome.storage.session.set({
    [getChatStorageKey(contextTabId)]: {
      version: 1,
      videoId: chatHistoryVideoId,
      messages: chatHistory.slice(-40)
    }
  });
}

async function resetConversation() {
  chatHistory = [];
  chatHistoryVideoId = activeVideoId;
  renderConversation();
  clearVisualization();
  try {
    if (Number.isInteger(contextTabId)) {
      await chrome.storage.session.remove(getChatStorageKey(contextTabId));
    }
    showNotice("Conversation history reset for this video.");
  } catch (error) {
    showNotice(`Could not clear the saved conversation: ${error.message}`);
  }
}

function buildLessonContext(question) {
  if (transcriptSegments.length === 0 || transcriptVideoId !== activeVideoId) {
    return null;
  }

  if (transcriptSearchDocuments === null) {
    transcriptSearchDocuments = transcriptSegments.map((segment, index) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      segments: [{ index, start: segment.start, end: segment.end, text: segment.text }]
    }));
  }
  const transcriptHits = LectureMateTranscript.searchKnowledgeBase(
    question || "",
    null,
    transcriptSearchDocuments,
    8
  );
  const knowledgeHits = LectureMateTranscript.searchKnowledgeBase(
    question || "",
    lectureKnowledgeBase,
    [],
    20
  );
  const playbackIndexes = [];

  if (Number.isFinite(latestPlaybackState && latestPlaybackState.currentTime) &&
      transcriptSegments.length > 0) {
    let low = 0;
    let high = transcriptSegments.length - 1;
    let currentIndex = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (transcriptSegments[middle].start <= latestPlaybackState.currentTime) {
        currentIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    for (let index = Math.max(0, currentIndex - 1);
      index <= Math.min(transcriptSegments.length - 1, currentIndex + 1);
      index += 1) {
      playbackIndexes.push(index);
    }
  }
  const relevantIndexes = [
    ...playbackIndexes,
    ...transcriptHits.flatMap((hit) => hit.segmentIndexes)
  ];
  if (relevantIndexes.length === 0) {
    relevantIndexes.push(...transcriptHits.flatMap((hit) => hit.segmentIndexes));
  }

  const selectedSegments = [];
  const seenIndexes = new Set();
  let totalTextLength = 0;
  for (const index of relevantIndexes) {
    if (seenIndexes.has(index) || selectedSegments.length >= 12) {
      continue;
    }
    const segment = transcriptSegments[index];
    if (!segment || segment.text.length > 2000 ||
        totalTextLength + segment.text.length > 8000) {
      continue;
    }
    seenIndexes.add(index);
    selectedSegments.push({
      start: segment.start,
      end: segment.end,
      text: segment.text
    });
    totalTextLength += segment.text.length;
  }
  selectedSegments.sort((left, right) => left.start - right.start);

  const selectedGlossary = knowledgeHits
    .filter((item) => item.type === "glossary")
    .slice(0, 5)
    .map((result) => lectureKnowledgeBase.glossary.find((item) => item.term === result.title))
    .filter(Boolean)
    .map((item) => ({
      term: item.term,
      abbreviation: item.abbreviation || "",
      definition: item.definition,
      instructorTerminology: item.instructorTerminology || "",
      attribution: item.attribution,
      timestamp: item.timestamp,
      timestamps: item.timestamps.slice(0, 10),
      evidence: item.evidence.slice(0, 3).map((entry) => ({
        quote: entry.quote.slice(0, 500),
        timestamp: entry.timestamp
      }))
    }));
  const selectedConcepts = knowledgeHits
    .filter((item) => item.type === "concept")
    .slice(0, 5)
    .map((result) => lectureKnowledgeBase.concepts.find((item) => item.concept === result.title))
    .filter(Boolean)
    .map((item) => ({
      concept: item.concept,
      explanation: item.explanation,
      prerequisites: item.prerequisites.slice(0, 12),
      relatedConcepts: item.relatedConcepts.slice(0, 12),
      variables: item.variables.slice(0, 12),
      attribution: item.attribution,
      timestamps: item.timestamps.slice(0, 10),
      evidence: item.evidence.slice(0, 3).map((entry) => ({
        quote: entry.quote.slice(0, 500),
        timestamp: entry.timestamp
      }))
    }));
  const variables = selectedConcepts.flatMap((item) =>
    item.variables
      .filter((variable) => variable.meaning)
      .map((variable) => ({
        ...variable,
        concept: item.concept,
        timestamps: item.timestamps,
        evidence: item.evidence
      })))
    .filter((item, index, list) =>
      list.findIndex((other) => other.symbol === item.symbol && other.concept === item.concept) === index)
    .slice(0, 12);
  const retrievedKnowledge = knowledgeHits
    .filter((item) => !["concept", "glossary"].includes(item.type))
    .slice(0, 6)
    .map((result) => ({
      type: result.type,
      title: result.title.slice(0, 200),
      text: result.text.slice(0, 1200),
      timestamps: result.timestamps.slice(0, 10),
      evidence: result.evidence.slice(0, 3).map((item) => ({
        quote: item.quote.slice(0, 500),
        timestamp: item.timestamp
      }))
    }));
  const transcriptCompleteness = lectureKnowledgeBase
    ? {
      status: lectureKnowledgeBase.transcriptCompleteness.status,
      note: lectureKnowledgeBase.transcriptCompleteness.note.slice(0, 500),
      coveragePercentage: lectureKnowledgeBase.transcriptCompleteness.coveragePercentage
    }
    : {
      status: transcriptCoverageTrusted ? "unknown" : "partial",
      note: "Answer only from supplied transcript excerpts; do not imply missing portions were covered."
    };
  return {
    source: currentTranscriptSource,
    segments: selectedSegments,
    transcriptCompleteness,
    summary: lectureKnowledgeBase ? lectureKnowledgeBase.summary.slice(0, 1800) : "",
    summaryEvidence: lectureKnowledgeBase
      ? lectureKnowledgeBase.summaryEvidence.slice(0, 3).map((item) => ({
        quote: item.quote.slice(0, 500),
        timestamp: item.timestamp
      }))
      : [],
    glossary: selectedGlossary,
    concepts: selectedConcepts,
    variables,
    retrievedKnowledge
  };
}

function getConversationContext() {
  if (chatHistoryVideoId !== activeVideoId) {
    return [];
  }
  const selected = [];
  let totalLength = 0;
  for (let index = chatHistory.length - 1; index >= 0 && selected.length < 12; index -= 1) {
    const message = chatHistory[index];
    const content = message.content.slice(0, 4000);
    if (totalLength + content.length > 28000) {
      break;
    }
    selected.unshift({ role: message.role, content });
    totalLength += content.length;
  }
  return selected;
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
      duration: latestPlaybackState.duration,
      playbackState: latestPlaybackState.paused ? "paused" : "playing"
    },
    lessonContext: buildLessonContext(question),
    conversationHistory: getConversationContext()
  };
}

function setChatBusy(busy) {
  messageInput.disabled = busy;
  chatForm.querySelector('button[type="submit"]').disabled = busy;
  quickActionButtons.forEach((button) => {
    button.disabled = busy;
  });
  resetConversationButton.disabled = busy;
}

function clearVisualization() {
  visualizationPanel.replaceChildren();
  visualizationPanel.hidden = true;
}

function showVisualizationStatus(message, state) {
  const status = document.createElement("p");
  status.className = `visualization-status ${state}`;
  status.setAttribute("role", state === "loading" ? "status" : "alert");
  status.textContent = message;
  visualizationPanel.hidden = false;
  visualizationPanel.replaceChildren(status);
}

function getVisualizationTarget() {
  const lastQuestion = [...chatHistory].reverse().find((message) => message.role === "user");
  const question = messageInput.value.trim() ||
    (lastQuestion ? lastQuestion.content : "") ||
    knowledgeSearchInput.value.trim();
  if (!question) {
    return null;
  }
  const matches = LectureMateTranscript.searchKnowledgeBase(
    question,
    lectureKnowledgeBase,
    [],
    12
  );
  const concept = matches.find((item) => item.type === "concept") ||
    matches.find((item) => item.type === "glossary");
  return {
    question,
    concept: concept ? concept.title.slice(0, 200) : question.slice(0, 200)
  };
}

function showVisualizationFailure(message, question, concept) {
  const card = document.createElement("section");
  card.className = "visualization-card visualization-failure";
  const title = document.createElement("h3");
  title.textContent = "Visualization unavailable";
  const details = document.createElement("p");
  details.className = "visualization-status error";
  details.textContent = message;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "visualization-retry";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => sendVisualizationRequest(question, concept));
  card.append(title, details, retry);
  visualizationPanel.hidden = false;
  visualizationPanel.replaceChildren(card);
}

async function sendVisualizationRequest(question, concept) {
  const requestedVideoId = activeVideoId;
  setChatBusy(true);
  showVisualizationStatus("Building a lecture-aware visual explanation…", "loading");
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
    delete payload.conversationHistory;
    payload.concept = concept;
    const response = await fetch(`${backendBaseUrl}/api/visualize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let result;
    try {
      result = await response.json();
    } catch (_error) {
      throw new Error("The backend returned an invalid visualization response.");
    }
    if (!response.ok) {
      throw new Error(result && result.error && typeof result.error.message === "string"
        ? result.error.message
        : `The visualization request failed with status ${response.status}.`);
    }
    if (activeVideoId !== requestedVideoId) {
      throw new Error("The active video changed before the visualization arrived. Ask again for the current lecture.");
    }
    if (!result || !result.visualization) {
      throw new Error("The backend returned a malformed visualization response.");
    }
    LectureMateVisualization.renderVisualization(visualizationPanel, result.visualization);
    visualizationPanel.hidden = false;
  } catch (error) {
    if (activeVideoId !== requestedVideoId) {
      clearVisualization();
      showNotice("The active video changed before the visualization arrived.");
      return;
    }
    if (error.name === "AbortError") {
      showVisualizationFailure("The visualization request timed out. Check the backend and try again.",
        question, concept);
    } else if (error instanceof TypeError &&
        ["Failed to fetch", "fetch failed"].includes(error.message)) {
      showVisualizationFailure(backendBaseUrl === localBackendUrl
        ? "Could not connect to the local backend. Start it from the backend folder and try again."
        : "Could not reach the configured backend. Check that the service is live and try again.",
      question, concept);
    } else if (error.message && error.message.includes("not supported")) {
      LectureMateVisualization.renderVisualization(visualizationPanel, {
        version: 1,
        type: "unsupported",
        title: "Visualization model not supported",
        explanation: "This model is not available yet. Try a flowchart, concept map, or step-by-step explanation."
      });
    } else {
      showVisualizationFailure(error.message || "The backend could not create a safe visualization.",
        question, concept);
    }
  } finally {
    window.clearTimeout(timeout);
    setChatBusy(false);
  }
}

function addRetryButton(question, assistantMessage) {
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "retry-button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => {
    retry.remove();
    assistantMessage.label.textContent = "LECTUREMATE · WAITING";
    assistantMessage.bubble.classList.remove("error");
    assistantMessage.bubble.classList.add("loading");
    assistantMessage.content.textContent = "Retrying…";
    sendChatQuestion(question, assistantMessage);
  });
  assistantMessage.bubble.append(retry);
}

async function sendChatQuestion(question, assistantMessage) {
  const requestedVideoId = activeVideoId;
  setChatBusy(true);
  assistantMessage.bubble.querySelector(".retry-button")?.remove();
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
    if (!Array.isArray(result.citations) || result.citations.length > 8 ||
        result.citations.some((timestamp) => !Number.isFinite(timestamp) || timestamp < 0 ||
          Number.isFinite(latestPlaybackState && latestPlaybackState.duration) &&
            timestamp > latestPlaybackState.duration)) {
      throw new Error("The backend returned invalid lecture timestamps.");
    }
    if (activeVideoId !== requestedVideoId) {
      showNotice("The active video changed before the answer arrived. Ask again for the current lecture.");
      return;
    }

    assistantMessage.label.textContent = "LECTUREMATE";
    assistantMessage.citations = result.citations;
    renderAnswerContent(assistantMessage.content, result.answer.trim(), result.citations);
    assistantMessage.bubble.classList.remove("loading");
    assistantMessage.bubble.classList.remove("error");
    chatHistoryVideoId = requestedVideoId;
    chatHistory.push(
      { role: "user", content: question },
      {
        role: "assistant",
        content: result.answer.trim(),
        citations: result.citations
      }
    );
    chatHistory = chatHistory.slice(-40);
    try {
      await persistChatHistory();
    } catch (error) {
      showNotice(`Answer received, but conversation history could not be saved: ${error.message}`);
    }
  } catch (error) {
    assistantMessage.label.textContent = "LECTUREMATE · ERROR";
    assistantMessage.bubble.classList.remove("loading");
    assistantMessage.bubble.classList.add("error");
    let message;
    if (error.name === "AbortError") {
      message = "The backend request timed out. Check that the backend and provider are responding, then retry.";
    } else if (error instanceof TypeError) {
      message = backendBaseUrl === localBackendUrl
        ? "Could not connect to the local backend. Start it from the backend folder and check its extension origin."
        : "Could not reach the Render backend. Check that the service is live and its extension origin is configured correctly.";
    } else {
      message = error.message || "The backend could not complete the request.";
    }
    assistantMessage.content.textContent = message;
    addRetryButton(question, assistantMessage);
  } finally {
    window.clearTimeout(timeout);
    setChatBusy(false);
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
  chatHistoryVideoId = activeVideoId;
  messageInput.value = "";
  messageInput.style.height = "auto";
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
    if (button.dataset.action === "visualize") {
      const target = getVisualizationTarget();
      if (!target) {
        showNotice("Ask about or select a lecture concept before visualizing it.");
        return;
      }
      sendVisualizationRequest(target.question, target.concept);
      return;
    }
    messageInput.value = button.dataset.prompt || "";
    messageInput.focus();
    messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
    messageInput.dispatchEvent(new Event("input"));
  });
});

resetConversationButton.addEventListener("click", resetConversation);

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
