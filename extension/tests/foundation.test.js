const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const extensionPath = path.resolve(__dirname, "..");
const readExtensionFile = (filePath) =>
  fs.readFileSync(path.join(extensionPath, filePath), "utf8");

test("manifest configures the MV3 side panel and local plus optional Render backend permissions", () => {
  const manifest = JSON.parse(readExtensionFile("manifest.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["sidePanel", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1:3000/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*.onrender.com/*"]);
  assert.equal(manifest.side_panel.default_path, "sidepanel/index.html");
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.deepEqual(
    manifest.content_scripts[0].matches,
    ["https://www.youtube.com/*", "https://youtube.com/*", "https://m.youtube.com/*"]
  );
  assert.deepEqual(manifest.content_scripts[0].js, ["content/youtube-bridge.js"]);
});

test("toolbar action opens the configured panel and focus mode uses an extension tab", () => {
  const serviceWorker = readExtensionFile("service-worker.js");

  assert.match(serviceWorker, /openPanelOnActionClick:\s*true/);
  assert.match(serviceWorker, /chrome\.tabs\.create\(\{\s*url:\s*focusUrl\.toString\(\)\s*\}\)/);
  assert.match(readExtensionFile("sidepanel/app.js"), /chrome\.sidePanel\.open\(\{\s*tabId:\s*focusSourceTabId\s*\}\)/);
});

test("side panel and focus page share the same application assets", () => {
  const sidePanel = readExtensionFile("sidepanel/index.html");
  const focusPage = readExtensionFile("focus/index.html");

  assert.match(sidePanel, /href="style\.css"/);
  assert.match(sidePanel, /src="app\.js"/);
  assert.match(focusPage, /href="\.\.\/sidepanel\/style\.css"/);
  assert.match(focusPage, /src="\.\.\/sidepanel\/app\.js"/);
  assert.match(focusPage, /Return to side panel/);
});

test("the chat uses the local backend without embedding provider credentials", () => {
  const sidePanel = readExtensionFile("sidepanel/index.html");
  const app = readExtensionFile("sidepanel/app.js");

  for (const id of ["messageList", "chatForm", "messageInput", "focusButton", "settingsButton"]) {
    assert.match(sidePanel, new RegExp(`id="${id}"`));
  }
  assert.match(sidePanel, /Explain this concept/);
  assert.match(sidePanel, /Visualise this concept/);
  assert.match(sidePanel, /Summarise this lecture/);
  assert.match(sidePanel, /Quiz me/);
  assert.match(app, /fetch\(`\$\{backendBaseUrl\}\/api\/chat`/);
  assert.match(app, /chrome\.permissions\.request/);
  assert.match(sidePanel, /id="backendUrl"/);
  assert.match(app, /LECTUREMATE · WAITING/);
  assert.match(app, /invalid answer format/);
  assert.doesNotMatch(app, /LLM_API_KEY|OPENAI_API_KEY|Bearer\s/);
});

test("YouTube bridge tracks player events, rate-limits time updates, and supports SPA navigation", () => {
  const bridge = readExtensionFile("content/youtube-bridge.js");

  for (const event of ["play", "pause", "timeupdate", "seeking", "seeked", "loadedmetadata", "ended"]) {
    assert.match(bridge, new RegExp(`"${event}"`));
  }
  assert.match(bridge, /timeUpdateInterval = 1000/);
  assert.match(bridge, /yt-navigate-finish/);
  assert.match(bridge, /GET_YOUTUBE_STATE/);
  assert.match(bridge, /YOUTUBE_PLAYBACK_UPDATE/);
  assert.match(bridge, /function safelySendRuntimeMessage/);
  assert.match(bridge, /function isInvalidatedContext/);
  assert.match(bridge, /function stopBridge/);
  assert.equal((bridge.match(/chrome\.runtime\.sendMessage\(/g) || []).length, 1);
  assert.doesNotMatch(bridge, /\bfetch\s*\(/);
});

test("both interfaces expose the live video fields and disconnected state", () => {
  const sidePanel = readExtensionFile("sidepanel/index.html");
  const focusPage = readExtensionFile("focus/index.html");
  const app = readExtensionFile("sidepanel/app.js");
  const serviceWorker = readExtensionFile("service-worker.js");

  for (const page of [sidePanel, focusPage]) {
    for (const id of ["connectionLabel", "videoTitle", "videoUrl", "videoId", "playbackState", "playbackTime"]) {
      assert.match(page, new RegExp(`id="${id}"`));
    }
  }
  assert.match(app, /function showDisconnected/);
  assert.match(app, /function renderPlaybackState/);
  assert.match(serviceWorker, /validatePlaybackState/);
  assert.match(serviceWorker, /youtubeHosts/);
});

test("YouTube state refreshes directly and visible captions stay partial", () => {
  const sidePanel = readExtensionFile("sidepanel/index.html");
  const focusPage = readExtensionFile("focus/index.html");
  const app = readExtensionFile("sidepanel/app.js");
  const bridge = readExtensionFile("content/youtube-bridge.js");
  const serviceWorker = readExtensionFile("service-worker.js");

  for (const page of [sidePanel, focusPage]) {
    assert.match(page, /id="captionCaptureToggle"/);
    assert.match(page, /visibly shown while you watch/);
  }
  assert.match(app, /function refreshActiveContext/);
  assert.match(app, /window\.setInterval\(refreshActiveContext,\s*1000\)/);
  assert.match(app, /coverageTrusted/);
  assert.match(app, /calculateCoverage\(\s*transcriptCoverageBasis/);
  assert.match(app, /verifiedCoverage\.complete/);
  assert.match(app, /Visible YouTube captions captured\. This is a partial sample/);
  assert.match(sidePanel, /id="transcriptPreview"/);
  assert.match(bridge, /ytp-caption-window-container/);
  assert.match(bridge, /YOUTUBE_CAPTION_SEGMENT/);
  assert.match(serviceWorker, /validateCaptionSegment/);
  assert.match(serviceWorker, /LECTUREMATE_CAPTION_SEGMENT/);
  assert.doesNotMatch(bridge, /\bfetch\s*\(/);
});
