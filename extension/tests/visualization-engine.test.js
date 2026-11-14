const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateSimulation,
  renderVisualization,
  validateVisualization
} = require("../sidepanel/visualization-engine.js");

class FakeElement {
  constructor(name, ownerDocument) {
    this.tagName = name;
    this.ownerDocument = ownerDocument;
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.className = "";
    this.value = "";
    this._textContent = "";
    this.innerHTMLWrites = 0;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") {
      this.className = String(value);
    }
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  dispatch(name) {
    this.listeners[name]({ target: this });
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  set innerHTML(_value) {
    this.innerHTMLWrites += 1;
    throw new Error("Untrusted HTML must never be inserted.");
  }
}

class FakeDocument {
  createElement(name) {
    return new FakeElement(name, this);
  }

  createElementNS(_namespace, name) {
    return new FakeElement(name, this);
  }
}

function findElements(root, predicate, matches = []) {
  if (predicate(root)) {
    matches.push(root);
  }
  root.children.forEach((child) => findElements(child, predicate, matches));
  return matches;
}

function validFlowchart() {
  return {
    version: 1,
    type: "flowchart",
    title: "Polymer formation",
    explanation: "A simplified process view.",
    layout: "top-to-bottom",
    nodes: [
      { id: "start", type: "start", label: "<img src=x onerror=alert(1)>" },
      { id: "join", type: "process", label: "Monomers join" },
      { id: "end", type: "end", label: "Polymer chain" }
    ],
    connections: [
      { from: "start", to: "join", label: "react", direction: "forward" },
      { from: "join", to: "end", label: "form", direction: "forward" }
    ]
  };
}

function validSimulation() {
  return {
    version: 1,
    type: "simulation",
    title: "Explore polymer DP",
    explanation: "Adjust molar mass to explore its ratio.",
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

test("flowchart renderer draws nodes and connections using text-only DOM APIs", () => {
  const document = new FakeDocument();
  const container = document.createElement("div");
  const result = renderVisualization(container, validFlowchart());
  const elements = findElements(container, () => true);

  assert.equal(result.type, "flowchart");
  assert.equal(elements.filter((element) => element.tagName === "rect").length, 3);
  assert.equal(elements.filter((element) => element.tagName === "line").length, 2);
  assert.equal(elements.filter((element) => element.innerHTMLWrites > 0).length, 0);
  assert.ok(elements.some((element) => element.textContent === "<img src=x onerror=alert(1)>"));
});

test("malformed diagrams and missing simulation variables are rejected", () => {
  const malformedDiagram = validFlowchart();
  malformedDiagram.connections[0].to = "missing";
  assert.throws(() => validateVisualization(malformedDiagram), /invalid connection/i);

  const missingVariable = validSimulation();
  missingVariable.simulation.variables.pop();
  assert.throws(() => validateVisualization(missingVariable), /inputs or labels are malformed/i);

  const mismatchedLabel = validSimulation();
  mismatchedLabel.simulation.variables[0].label = "Repeat-unit molar mass";
  assert.throws(() => validateVisualization(mismatchedLabel), /slider limits.*invalid/i);
});

test("unsupported visualizations render a clear supported-alternatives state", () => {
  const document = new FakeDocument();
  const container = document.createElement("div");
  renderVisualization(container, {
    version: 1,
    type: "unsupported",
    title: "Model not supported",
    explanation: "Try a flowchart or a step-by-step explanation."
  });
  const renderedText = findElements(container, () => true)
    .map((element) => element.textContent)
    .join(" ");

  assert.match(renderedText, /Model not supported/);
  assert.match(renderedText, /flowchart or a step-by-step explanation/);
});

test("simulation slider ranges outside the allowlist are rejected", () => {
  const invalidRange = validSimulation();
  invalidRange.simulation.variables[0].min = 0;
  assert.throws(() => validateVisualization(invalidRange), /slider limits.*invalid/i);
});

test("polymer DP calculations are deterministic and independent of rendering", () => {
  assert.equal(calculateSimulation("polymer-dp-mass-ratio", {
    numberAverageMolarMass: 84000,
    repeatUnitMolarMass: 28
  }).degreeOfPolymerisation, 3000);
  assert.throws(() => calculateSimulation("polymer-dp-mass-ratio", {
    numberAverageMolarMass: 84000
  }), /outside the supported range/);
});

test("slider interactions immediately update calculated outputs and graph", () => {
  const document = new FakeDocument();
  const container = document.createElement("div");
  renderVisualization(container, validSimulation());

  const sliders = findElements(container, (element) => element.tagName === "input");
  const output = findElements(container, (element) =>
    element.className === "simulation-output-value")[0];
  const graphs = findElements(container, (element) =>
    element.className === "simulation-graph");
  assert.equal(sliders.length, 2);
  assert.equal(output.textContent, "1000");

  sliders[0].value = "14000";
  sliders[0].dispatch("input");
  assert.equal(output.textContent, "500.0");
  assert.equal(graphs.length, 1);
});
