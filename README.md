# LectureMate AI

LectureMate AI is a Chrome side-panel companion for YouTube lectures. It can
show the active video's playback context, use an imported transcript or a
partial sample of visible captions, build an evidence-linked lesson knowledge
base, answer lecture questions, and render safe visual explanations.

## Architecture

```text
Chrome extension (Manifest V3)
  side panel / focus page
    transcript import, search, analysis, chat, visualizations
    session-scoped transcript, knowledge base, and conversation state
  service worker
    tab lifecycle, extension-page messages, focus-mode navigation
  YouTube content script
    video metadata, playback updates, seeking, visible caption capture
                 |
                 | bounded JSON requests
                 v
Node.js / Express backend
  request validation, CORS, error sanitization
  transcript chunk analysis, chat, visualization validation
  configured LLM provider (API key stays on the backend)
```

The backend does not save transcripts or chat history. The extension keeps
transcripts, extracted knowledge, and chat history in `chrome.storage.session`,
which is temporary browser-session storage and is cleared when the browser
session ends (and when a tab closes). The backend URL setting is kept in
`chrome.storage.local`. Relevant transcript excerpts and extracted knowledge
are sent to the configured backend for analysis or a question; the backend
sends the requested context to the configured AI provider. Review that
provider's data-handling terms before using real student or course material.

## Folder structure

```text
backend/
  src/
    middleware/       Request validation
    routes/           Chat, analysis, and visualization endpoints
    services/         AI provider, transcript analyzer, safe visualization models
  test/               Backend API and service tests
  .env.example        Backend configuration template
extension/
  content/            YouTube player bridge
  focus/              Full-tab focus-mode page
  shared/              Client-side allowlisted simulation models
  sidepanel/          Side panel UI, transcript retrieval, chat, visualization
  tests/              Extension logic and renderer tests
  manifest.json       Chrome Manifest V3 configuration
render.yaml           Optional Render backend deployment configuration
```

## Requirements

- Google Chrome 116 or later.
- Node.js 20 or later (includes npm and the built-in test runner).
- A Gemini API key from Google AI Studio to use live AI features.

## Install and configure the local backend

In PowerShell, from the project folder:

```powershell
Set-Location .\backend
npm install
Copy-Item .env.example .env
```

Edit `.env` in the `backend` folder and set `LLM_API_KEY` to your Gemini API
key. Keep this file private; it is ignored by Git. The default provider settings
use Gemini's OpenAI-compatible endpoint and `gemini-4-hydrogen`. Change
`LLM_BASE_URL` and `LLM_MODEL` if you use a different model or compatible
provider.

1. In Chrome, open `chrome://extensions`.
2. Enable **Developer mode**, choose **Load unpacked**, and select this
   project's `extension` folder.
3. Copy the extension ID shown by Chrome.
4. Set `ALLOWED_EXTENSION_ORIGIN` in `backend/.env` to
   `chrome-extension://<your-extension-id>`.
5. Start or restart the backend:

   ```powershell
   npm start
   ```

The backend listens on `http://127.0.0.1:3000` by default. Check
`http://127.0.0.1:3000/health` for `{"status":"ok"}`. Configure the extension
origin before using AI endpoints; the backend rejects requests from other web
origins.

## Optional Render backend

The repository includes a Render blueprint in `render.yaml`. Configure
`ALLOWED_EXTENSION_ORIGIN` and `LLM_API_KEY` as private Render environment
variables, and set any provider-specific `LLM_BASE_URL` or `LLM_MODEL` values.
After deploying, open LectureMate **Settings**, enter the service's HTTPS URL,
and save it to grant Chrome the optional host permission. Free hosting may
sleep between requests, so the first request can take longer.

## Test

From the project folder, run the backend tests:

```powershell
Set-Location .\backend
npm test
```

From the project folder, run the extension tests:

```powershell
Set-Location .\extension
node --test
```

These automated tests use mock providers and synthetic transcript data. They
check validation, evidence filtering, retrieval, safe errors, citation
allow-listing, visualization validation/rendering, and simulation calculations.
They do not measure the factual accuracy of a live AI provider.

## Demonstrate the user journey

1. Start the configured backend and load/reload the unpacked extension.
2. Open a YouTube watch page and open **LectureMate AI** from the Chrome
   toolbar. Confirm that the video title, ID, playback state, and time appear.
3. Import a timestamped `.vtt` or `.srt` transcript, or paste timestamped cues.
   The extension does not automatically download YouTube transcripts.
4. Choose **Analyze lecture** to build the evidence-linked knowledge base.
5. Ask a question from the lecture or choose a quick action. Answers may cite
   relevant timestamps; clicking a verified citation seeks the YouTube player.
6. Ask about a supported concept and choose **Visualise this concept**. The
   initial polymer degree-of-polymerisation simulation is an explicitly
   labeled additional-background model; its sliders calculate locally.
7. Open focus mode to expand the study view, then use **Return to side panel**.

For a quick no-transcript check, open any YouTube watch page without importing a
transcript. The panel should show the missing-transcript state and offer VTT/SRT
import, timestamped paste, and optional on-screen caption capture.

## Security and privacy notes

- Provider credentials belong only in the backend environment, never in the
  extension.
- The extension requests only `sidePanel` and `storage`; it has a local
  backend host permission, optional permission for an HTTPS Render host, and a
  YouTube-only content script.
- The backend validates request sizes, video URLs, transcript fields, and
  visualization models. AI-generated visualization data is validated and
  rendered with built-in DOM/SVG components; generated JavaScript and HTML are
  not executed or inserted.
- The polymer simulation is selected from a fixed allowlist and calculated
  locally. Do not treat it as an equation stated by the instructor.
- Error responses intentionally omit provider response bodies and credentials.

## Known limitations

- There is no automatic transcript acquisition. Import a timestamped VTT/SRT
  file or paste one. On-screen caption capture records only captions visibly
  displayed while enabled and is a partial sample, not a complete transcript.
- Analysis and answers can only be grounded in transcript material supplied
  for that video. Missing portions are not represented.
- Keyword retrieval is the initial search implementation; semantic retrieval
  is not included.
- Live AI quality, availability, cost, provider rate limits, and provider data
  handling depend on the configured service. The included tests use mocks.
- The only interactive simulation currently supported is the polymer DP
  molar-mass ratio model. Other simulation requests should receive an
  unsupported state; diagrams and step-by-step explanations are separately
  supported.
- YouTube's page structure and Chrome extension behavior can change. Verify
  playback, seeking, caption capture, and focus-mode return in the target Chrome
  version before a public demonstration.
