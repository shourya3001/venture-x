const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const { validateVisualizationRequest } = require("../src/middleware/validate-request");
const { validateVisualizationOutput } = require("../src/services/visualization-contract");
const backendSimulationModels = require("../src/services/simulation-models");
const { createApp } = require("../src/server");
const { createLlmProvider } = require("../src/services/llm-provider");
const clientSimulationModels = require("../../extension/shared/simulation-models");

const extensionOrigin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function validRequest() {
  return {
    question: "Visualise degree of polymerisation.",
    concept: "Degree of polymerisation",
    videoContext: {
      videoId: "abcdefghijk",
      title: "Synthetic polymer lesson",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      currentTime: 17,
      duration: 40,
      playbackState: "paused"
    },
    lessonContext: {
      source: "Synthetic VTT",
      summary: "The lecture defines degree of polymerisation as the average number of repeat units.",
      segments: [{ start: 17, end: 23, text: "The degree of polymerisation is the average number of repeat units." }],
      concepts: [{
        concept: "Degree of polymerisation",
        explanation: "The average number of repeat units in a polymer chain.",
        prerequisites: [],
        relatedConcepts: [],
        variables: [],
        timestamps: [17],
        evidence: [{ quote: "The degree of polymerisation is the average number of repeat units.", timestamp: 17 }]
      }]
    }
  };
}

function validFlowchart() {
  return {
    version: 1,
    type: "flowchart",
    title: "Polymer chain formation",
    explanation: "A simplified view of the process.",
    layout: "top-to-bottom",
    nodes: [
      { id: "monomer", type: "start", label: "Monomers" },
      { id: "polymer", type: "process", label: "Join into a polymer chain" },
      { id: "chain", type: "end", label: "Polymer chain" }
    ],
    connections: [
      { from: "monomer", to: "polymer", label: "react", direction: "forward" },
      { from: "polymer", to: "chain", label: "form", direction: "forward" }
    ]
  };
}

function validSimulation() {
  return {
    version: 1,
    type: "simulation",
    title: "Explore degree of polymerisation",
    explanation: "Change molar masses to see their ratio change.",
    simulation: {
      modelId: "polymer-dp-mass-ratio",
      attribution: "additional-background",
      variables: [
        {
          id: "numberAverageMolarMass",
          label: "Number-average molar mass (M_n)",
          unit: "g/mol",
          min: 280,
          max: 28000,
          step: 28,
          initialValue: 28000
        },
        {
          id: "repeatUnitMolarMass",
          label: "Repeat-unit molar mass (M_0)",
          unit: "g/mol",
          min: 1,
          max: 100,
          step: 1,
          initialValue: 28
        }
      ],
      outputs: [{
        id: "degreeOfPolymerisation",
        label: "Degree of polymerisation (DP)",
        unit: "repeat units"
      }],
      explanatoryLabels: ["Increasing M_n while M_0 stays fixed increases DP."]
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

test("visualization request requires a concept and valid bounded lecture context", () => {
  assert.deepEqual(validateVisualizationRequest(validRequest()), []);
  const invalid = validRequest();
  invalid.concept = "";
  invalid.videoContext.url = "https://attacker.example/watch?v=abcdefghijk";
  assert.ok(validateVisualizationRequest(invalid).length >= 2);
});

test("flowchart output is validated and unknown executable fields are discarded", () => {
  const output = {
    ...validFlowchart(),
    script: "run this",
    html: "<img src=x onerror=alert(1)>"
  };
  const result = validateVisualizationOutput(output);

  assert.equal(result.valid, true);
  assert.equal(result.visualization.connections[0].direction, "forward");
  assert.equal("script" in result.visualization, false);
  assert.equal("html" in result.visualization, false);
});

test("simulation output rejects missing variables and out-of-model slider ranges", () => {
  const missingVariable = validSimulation();
  missingVariable.simulation.variables.pop();
  assert.equal(validateVisualizationOutput(missingVariable).valid, false);

  const invalidRange = validSimulation();
  invalidRange.simulation.variables[0].min = 0;
  assert.equal(validateVisualizationOutput(invalidRange).valid, false);

  const mismatchedLabel = validSimulation();
  mismatchedLabel.simulation.variables[0].label = "Repeat-unit molar mass";
  assert.equal(validateVisualizationOutput(mismatchedLabel).valid, false);
});

test("backend and extension simulation allowlists stay aligned", () => {
  const clientModel = clientSimulationModels.getModel("polymer-dp-mass-ratio");
  const backendModel = backendSimulationModels.getModel("polymer-dp-mass-ratio");
  assert.deepEqual(backendModel, {
    attribution: clientModel.attribution,
    variables: clientModel.variables.map(({ id, label, unit, minLimit, maxLimit }) => ({
      id,
      label,
      unit,
      minLimit,
      maxLimit
    })),
    outputs: clientModel.outputs.map(({ id, label, unit }) => ({ id, label, unit }))
  });
});

test("unknown simulation models become an explicit unsupported visualization", () => {
  const unsupported = validSimulation();
  unsupported.simulation.modelId = "model-from-ai";
  const result = validateVisualizationOutput(unsupported);

  assert.equal(result.valid, false);
  assert.equal(result.unsupported, true);
});

test("AI visualization generation requests constrained JSON with concept and lecture context", async () => {
  const provider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.deepEqual(request.response_format, { type: "json_object" });
      assert.match(request.messages[0].content, /never return HTML, CSS, JavaScript/i);
      const input = JSON.parse(request.messages[1].content);
      assert.equal(input.concept, "Degree of polymerisation");
      assert.equal(input.videoContext.currentTime, 17);
      assert.equal(input.lessonContext.segments[0].start, 17);
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: { content: JSON.stringify(validFlowchart()) }
            }]
          };
        }
      };
    }
  });

  const result = await provider.createVisualization(validRequest());
  assert.equal(result.type, "flowchart");
});

test("AI visualization generation rejects non-JSON responses", async () => {
  const provider = createLlmProvider({
    config: {
      apiKey: "test-only-key",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      timeoutMs: 1000
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { choices: [{ message: { content: "not JSON" } }] };
      }
    })
  });

  await assert.rejects(
    provider.createVisualization(validRequest()),
    (error) => error.code === "INVALID_PROVIDER_RESPONSE"
  );
});

test("visualization endpoint returns a validated flowchart using lecture context", async () => {
  let received;
  const app = createApp({
    allowedOrigin: extensionOrigin,
    llmProvider: {
      async createVisualization(input) {
        received = input;
        return validFlowchart();
      }
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/visualize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validRequest())
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(received.concept, "Degree of polymerisation");
    assert.equal(received.videoContext.currentTime, 17);
    assert.equal(received.lessonContext.segments[0].start, 17);
    assert.equal(result.visualization.type, "flowchart");
    assert.equal(result.visualization.connections.length, 2);
  });
});

test("malformed generated visualizations fail explicitly without reaching the UI", async () => {
  const malformed = validFlowchart();
  malformed.connections[0].to = "missing-node";
  const app = createApp({
    allowedOrigin: extensionOrigin,
    llmProvider: { async createVisualization() { return malformed; } }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/visualize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validRequest())
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.error.code, "INVALID_PROVIDER_RESPONSE");
  });
});

test("unsupported model requests return a stable unsupported state", async () => {
  const unsupported = validSimulation();
  unsupported.simulation.modelId = "unknown-model";
  const app = createApp({
    allowedOrigin: extensionOrigin,
    llmProvider: { async createVisualization() { return unsupported; } }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/visualize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify(validRequest())
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.visualization.type, "unsupported");
    assert.match(result.visualization.explanation, /not available yet/i);
  });
});
