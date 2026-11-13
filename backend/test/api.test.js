const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const { createApp, getServerConfig } = require("../src/server");
const { createLlmProvider } = require("../src/services/llm-provider");

const extensionOrigin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("production server config supports Render's public interface binding", () => {
  assert.deepEqual(
    getServerConfig({ NODE_ENV: "production", HOST: "0.0.0.0", PORT: "10000" }),
    { host: "0.0.0.0", port: 10000 }
  );
  assert.throws(() => getServerConfig({ HOST: "0.0.0.0", PORT: "3000" }));
});

function validChatPayload() {
  return {
    question: "What is the main idea?",
    videoContext: {
      videoId: "abcdefghijk",
      title: "Test lecture",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      currentTime: 30,
      duration: 600
    },
    lessonContext: {
      source: "Imported VTT file",
      segments: [{ start: 20, end: 35, text: "The main idea is an example." }]
    }
  };
}

async function withServer(app, action) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("health endpoint reports backend availability", async () => {
  await withServer(createApp({ allowedOrigin: extensionOrigin }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

test("chat rejects invalid payloads before calling the provider", async () => {
  let providerCalled = false;
  const app = createApp({
    allowedOrigin: extensionOrigin,
    llmProvider: {
      async answerQuestion() {
        providerCalled = true;
        return "unexpected";
      }
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ question: "", videoContext: {} })
    });
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.error.code, "INVALID_REQUEST");
    assert.equal(providerCalled, false);
  });
});

test("chat reports a missing provider API key without making an upstream call", async () => {
  const llmProvider = createLlmProvider({
    config: {
      apiKey: "",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => {
      assert.fail("Provider should not be called without a configured key.");
    }
  });

  await withServer(createApp({ allowedOrigin: extensionOrigin, llmProvider }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validChatPayload())
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.error.code, "MISSING_API_KEY");
    assert.doesNotMatch(JSON.stringify(result), /api\.example\.test|Bearer|test-model/);
  });
});

test("chat returns a validated response from a mocked compatible provider", async () => {
  const llmProvider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.example.test/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test-only-key");
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "Mocked answer from the test provider." } }] };
        }
      };
    }
  });

  await withServer(createApp({ allowedOrigin: extensionOrigin, llmProvider }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validChatPayload())
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      answer: "Mocked answer from the test provider."
    });
  });
});

test("provider failures return safe errors without exposing provider response details", async () => {
  const llmProvider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => ({ ok: false, status: 401 })
  });

  await withServer(createApp({ allowedOrigin: extensionOrigin, llmProvider }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validChatPayload())
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.error.code, "UPSTREAM_ERROR");
    assert.doesNotMatch(JSON.stringify(result), /test-only-key|stack|401/);
  });
});

test("malformed provider response is rejected instead of returned to the extension", async () => {
  const llmProvider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { choices: [{ message: { content: { unsafe: true } } }] };
      }
    })
  });

  await withServer(createApp({ allowedOrigin: extensionOrigin, llmProvider }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validChatPayload())
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.error.code, "INVALID_PROVIDER_RESPONSE");
  });
});

test("chat provider timeout is returned as a gateway timeout", async () => {
  const llmProvider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 10
    },
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });

  await withServer(createApp({ allowedOrigin: extensionOrigin, llmProvider }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validChatPayload())
    });
    const result = await response.json();
    assert.equal(response.status, 504);
    assert.equal(result.error.code, "PROVIDER_TIMEOUT");
  });
});

test("analysis validates transcript input but remains deferred", async () => {
  await withServer(createApp({ allowedOrigin: extensionOrigin }), async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ transcript: [] })
    });
    assert.equal(invalid.status, 400);

    const deferred = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({
        videoContext: validChatPayload().videoContext,
        lessonMetadata: { title: "Test lecture", source: "Imported VTT file" },
        transcript: [{ start: 0, end: 5, text: "A test transcript segment." }]
      })
    });
    const result = await deferred.json();
    assert.equal(deferred.status, 501);
    assert.equal(result.error.code, "ANALYSIS_NOT_IMPLEMENTED");
  });
});

test("CORS only permits the configured extension origin", async () => {
  await withServer(createApp({ allowedOrigin: extensionOrigin }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://example.test" }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "ORIGIN_NOT_ALLOWED");
  });
});
