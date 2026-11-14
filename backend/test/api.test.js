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
      duration: 600,
      playbackState: "paused"
    },
    lessonContext: {
      source: "Imported VTT file",
      summary: "The lecture's main idea is an example.",
      segments: [{ start: 20, end: 35, text: "The main idea is an example." }],
      retrievedKnowledge: [{
        type: "concept",
        title: "Molecular weight",
        text: "Repeat-unit mass and chain length affect molecular weight.",
        timestamps: [20],
        evidence: [{ quote: "The main idea is an example.", timestamp: 20 }]
      }]
    },
    conversationHistory: [
      { role: "user", content: "What did the instructor say?" },
      { role: "assistant", content: "The supplied lecture context contains an example." }
    ]
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
      const request = JSON.parse(options.body);
      assert.equal(request.messages[1].content, "What did the instructor say?");
      assert.equal(request.messages[2].content, "The supplied lecture context contains an example.");
      const currentQuestion = JSON.parse(request.messages[3].content);
      assert.equal(currentQuestion.videoContext.videoId, "abcdefghijk");
      assert.equal(currentQuestion.videoContext.url, "https://www.youtube.com/watch?v=abcdefghijk");
      assert.equal(currentQuestion.videoContext.currentTime, 30);
      assert.equal(currentQuestion.videoContext.playbackState, "paused");
      assert.match(currentQuestion.lessonContext.summary, /main idea/);
      assert.match(currentQuestion.lessonContext.retrievedKnowledge[0].title, /Molecular weight/);
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
      answer: "Mocked answer from the test provider.",
      citations: []
    });
  });
});

test("synthetic polymer questions preserve lecture terminology, cite evidence, and reject unrelated claims", async () => {
  const definitionQuote =
    "The degree of polymerisation, or DP, is the average number of repeat units in a polymer chain.";
  const llmProvider = {
    async answerQuestion({ question, lessonContext }) {
      if (question.includes("DP")) {
        assert.ok(lessonContext.glossary.some((item) => item.term === "Degree of polymerisation"));
        return "The instructor's term **Degree of polymerisation (DP)** means the average number of repeat units in a polymer chain. [00:17]";
      }
      if (question.includes("example")) {
        assert.ok(lessonContext.retrievedKnowledge.some((item) => /polyethylene/i.test(item.text)));
        return "The lecture's example is polyethylene forming from ethene by addition polymerisation. [00:23]";
      }
      return "That question is unrelated to the supplied polymer lecture and is not covered by its transcript.";
    }
  };
  const app = createApp({ allowedOrigin: extensionOrigin, llmProvider });
  const syntheticContext = {
    source: "Synthetic polymer lecture",
    transcriptCompleteness: {
      status: "partial",
      note: "Only the supplied transcript is analyzed."
    },
    summary: "The lecture covers polymerisation and degree of polymerisation.",
    summaryEvidence: [{ quote: definitionQuote, timestamp: 17 }],
    segments: [{ start: 17, end: 23, text: definitionQuote }],
    glossary: [{
      term: "Degree of polymerisation",
      abbreviation: "DP",
      definition: "the average number of repeat units in a polymer chain",
      instructorTerminology: "degree of polymerisation",
      attribution: "instructor",
      timestamp: 17,
      timestamps: [17],
      evidence: [{ quote: definitionQuote, timestamp: 17 }]
    }],
    concepts: [{
      concept: "Degree of polymerisation",
      explanation: "The average number of repeat units in a polymer chain.",
      prerequisites: [],
      relatedConcepts: [],
      variables: [],
      attribution: "instructor",
      timestamps: [17],
      evidence: [{ quote: definitionQuote, timestamp: 17 }]
    }],
    variables: [],
    retrievedKnowledge: [{
      type: "example",
      title: "Polyethylene example",
      text: "Polyethylene forms by addition polymerisation of ethene.",
      timestamps: [23],
      evidence: [{ quote: "Polyethylene forms by addition polymerisation of ethene.", timestamp: 23 }]
    }]
  };

  await withServer(app, async (baseUrl) => {
    const ask = async (question, lessonContext = syntheticContext) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: extensionOrigin },
        body: JSON.stringify({
          question,
          videoContext: {
            ...validChatPayload().videoContext,
            playbackState: "playing"
          },
          lessonContext
        })
      });
      assert.equal(response.status, 200);
      return response.json();
    };

    const definition = await ask("What does DP mean?");
    assert.match(definition.answer, /Degree of polymerisation \(DP\)/);
    assert.deepEqual(definition.citations, [17]);

    const example = await ask("What example does the lecture give?");
    assert.match(example.answer, /polyethylene.*ethene/i);
    assert.deepEqual(example.citations, [23]);

    const unrelated = await ask("How do I build a spaceship?");
    assert.match(unrelated.answer, /unrelated.*not covered/i);
    assert.deepEqual(unrelated.citations, []);
  });
});

test("invalid provider credentials return actionable safe errors", async () => {
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
    assert.equal(result.error.code, "PROVIDER_AUTHENTICATION_FAILED");
    assert.match(result.error.message, /LLM_API_KEY/);
    assert.doesNotMatch(JSON.stringify(result), /test-only-key|api\.example\.test|stack|401/);
  });
});

test("provider rate limits return a retryable safe error", async () => {
  const llmProvider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => ({ ok: false, status: 429 })
  });

  await withServer(createApp({ allowedOrigin: extensionOrigin, llmProvider }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validChatPayload())
    });
    const result = await response.json();
    assert.equal(response.status, 429);
    assert.equal(result.error.code, "PROVIDER_RATE_LIMITED");
    assert.match(result.error.message, /Wait a moment/);
    assert.doesNotMatch(JSON.stringify(result), /test-only-key|api\.example\.test|stack|429/);
  });
});

test("provider service failures do not expose upstream response details", async () => {
  const llmProvider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => ({ ok: false, status: 500 })
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
    assert.doesNotMatch(JSON.stringify(result), /test-only-key|api\.example\.test|stack|500/);
  });
});

test("provider network failures return a safe unavailable response", async () => {
  const llmProvider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => {
      throw new Error("network error with private endpoint details");
    }
  });

  await withServer(createApp({ allowedOrigin: extensionOrigin, llmProvider }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validChatPayload())
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.error.code, "PROVIDER_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(result), /test-only-key|api\.example\.test|private endpoint|stack/);
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

test("analysis validates transcript completeness and returns an evidence-backed knowledge base", async () => {
  const llmProvider = {
    async extractTranscriptChunk({ chunk }) {
      const segment = chunk.segments[0];
      return {
        summary: "The lecture defines polymerisation.",
        summaryEvidence: [{ segmentIndex: segment.segmentIndex, quote: segment.text }],
        topics: [{
          topic: "Polymerisation",
          subtopics: [],
          attribution: "instructor",
          evidence: [{ segmentIndex: segment.segmentIndex, quote: segment.text }]
        }],
        concepts: [],
        glossary: [],
        equations: [],
        examples: [],
        relationships: [],
        difficultExplanations: []
      };
    }
  };
  const app = createApp({ allowedOrigin: extensionOrigin, llmProvider });
  await withServer(app, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ transcript: [] })
    });
    assert.equal(invalid.status, 400);

    const invalidCompleteness = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({
        videoContext: validChatPayload().videoContext,
        lessonMetadata: { title: "Test lecture", source: "Imported VTT file" },
        transcript: [{ start: 0, end: 5, text: "Polymerisation joins monomers." }]
      })
    });
    assert.equal(invalidCompleteness.status, 400);

    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({
        videoContext: validChatPayload().videoContext,
        lessonMetadata: { title: "Test lecture", source: "Imported VTT file" },
        transcriptCompleteness: { status: "partial", coveragePercentage: 10 },
        transcript: [{ start: 0, end: 5, text: "Polymerisation joins monomers." }]
      })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.videoId, "abcdefghijk");
    assert.equal(result.transcriptCompleteness.status, "partial");
    assert.equal(result.transcriptCompleteness.analyzedChunks, 1);
    assert.deepEqual(result.topics[0].evidence, [{
      segmentIndex: 0,
      quote: "Polymerisation joins monomers.",
      timestamp: 0
    }]);
    assert.match(result.transcriptCompleteness.note, /limited to the supplied transcript/);
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
