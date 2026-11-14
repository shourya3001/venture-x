const simulationModels = require("./simulation-models");

const diagramNodeTypes = {
  flowchart: new Set(["start", "process", "decision", "end", "input", "output"]),
  "concept-map": new Set(["concept"]),
  "process-diagram": new Set(["input", "process", "decision", "output"])
};
const visualizationTypes = new Set([
  ...Object.keys(diagramNodeTypes),
  "graph",
  "simulation",
  "steps",
  "unsupported"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validateCommon(value) {
  return isRecord(value) && value.version === 1 &&
    visualizationTypes.has(value.type) &&
    isText(value.title, 120) &&
    isText(value.explanation, 800);
}

function sanitizeCommon(value) {
  return {
    version: 1,
    type: value.type,
    title: value.title,
    explanation: value.explanation
  };
}

function validateDiagram(value) {
  if (!["top-to-bottom", "left-to-right"].includes(value.layout) ||
      !Array.isArray(value.nodes) || value.nodes.length < 2 || value.nodes.length > 20 ||
      !Array.isArray(value.connections) || value.connections.length > 40) {
    return null;
  }

  const ids = new Set();
  const nodes = [];
  for (const node of value.nodes) {
    if (!isRecord(node) || typeof node.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,30}$/.test(node.id) || ids.has(node.id) ||
        !diagramNodeTypes[value.type].has(node.type) || !isText(node.label, 120)) {
      return null;
    }
    ids.add(node.id);
    nodes.push({ id: node.id, type: node.type, label: node.label });
  }

  const connections = [];
  for (const connection of value.connections) {
    if (!isRecord(connection) || !ids.has(connection.from) || !ids.has(connection.to) ||
        connection.from === connection.to ||
        !["forward", "both"].includes(connection.direction) ||
        connection.label !== undefined && connection.label !== "" && !isText(connection.label, 100)) {
      return null;
    }
    connections.push({
      from: connection.from,
      to: connection.to,
      label: connection.label || "",
      direction: connection.direction
    });
  }

  return { ...sanitizeCommon(value), layout: value.layout, nodes, connections };
}

function validateGraph(value) {
  const axes = value.axes;
  if (!isRecord(axes) || !isText(axes.xLabel, 80) || !isText(axes.yLabel, 80) ||
      !Number.isFinite(axes.xMin) || !Number.isFinite(axes.xMax) ||
      !Number.isFinite(axes.yMin) || !Number.isFinite(axes.yMax) ||
      axes.xMin >= axes.xMax || axes.yMin >= axes.yMax ||
      Math.max(Math.abs(axes.xMin), Math.abs(axes.xMax), Math.abs(axes.yMin), Math.abs(axes.yMax)) > 1e9 ||
      !["line", "scatter"].includes(value.graphKind) ||
      !Array.isArray(value.points) || value.points.length < 2 || value.points.length > 50) {
    return null;
  }

  const points = [];
  for (const point of value.points) {
    if (!isRecord(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < axes.xMin || point.x > axes.xMax ||
        point.y < axes.yMin || point.y > axes.yMax ||
        point.label !== undefined && point.label !== "" && !isText(point.label, 80)) {
      return null;
    }
    points.push({ x: point.x, y: point.y, label: point.label || "" });
  }
  return {
    ...sanitizeCommon(value),
    graphKind: value.graphKind,
    axes: {
      xLabel: axes.xLabel,
      yLabel: axes.yLabel,
      xMin: axes.xMin,
      xMax: axes.xMax,
      yMin: axes.yMin,
      yMax: axes.yMax
    },
    points
  };
}

function validateSimulation(value) {
  if (!isRecord(value.simulation) || !isText(value.simulation.modelId, 80)) {
    return { unsupported: false };
  }
  const model = simulationModels.getModel(value.simulation.modelId);
  if (!model) {
    return { unsupported: true };
  }

  const simulation = value.simulation;
  if (simulation.attribution !== model.attribution ||
      !Array.isArray(simulation.variables) || simulation.variables.length !== model.variables.length ||
      !Array.isArray(simulation.outputs) || simulation.outputs.length !== model.outputs.length ||
      !Array.isArray(simulation.explanatoryLabels) ||
      simulation.explanatoryLabels.length < 1 || simulation.explanatoryLabels.length > 4 ||
      simulation.explanatoryLabels.some((label) => !isText(label, 240))) {
    return { unsupported: false };
  }

  const variablesById = new Map();
  for (const variable of simulation.variables) {
    if (!isRecord(variable) || typeof variable.id !== "string" ||
        variablesById.has(variable.id)) {
      return { unsupported: false };
    }
    variablesById.set(variable.id, variable);
  }

  const variables = [];
  for (const expected of model.variables) {
    const variable = variablesById.get(expected.id);
    if (!variable || variable.label !== expected.label || variable.unit !== expected.unit ||
        !Number.isFinite(variable.min) || !Number.isFinite(variable.max) ||
        !Number.isFinite(variable.step) || !Number.isFinite(variable.initialValue) ||
        variable.min < expected.minLimit || variable.max > expected.maxLimit ||
        variable.min >= variable.max || variable.step < 0.001 ||
        variable.step > variable.max - variable.min ||
        (variable.max - variable.min) / variable.step > 1000000 ||
        variable.initialValue < variable.min || variable.initialValue > variable.max) {
      return { unsupported: false };
    }
    const stepPosition = (variable.initialValue - variable.min) / variable.step;
    if (Math.abs(stepPosition - Math.round(stepPosition)) > 1e-8) {
      return { unsupported: false };
    }
    variables.push({
      id: expected.id,
      label: expected.label,
      unit: expected.unit,
      min: variable.min,
      max: variable.max,
      step: variable.step,
      initialValue: variable.initialValue
    });
  }

  const outputs = [];
  for (let index = 0; index < model.outputs.length; index += 1) {
    const output = simulation.outputs[index];
    const expected = model.outputs[index];
    if (!isRecord(output) || output.id !== expected.id || output.label !== expected.label ||
        output.unit !== expected.unit) {
      return { unsupported: false };
    }
    outputs.push({ id: expected.id, label: expected.label, unit: expected.unit });
  }

  return {
    unsupported: false,
    visualization: {
      ...sanitizeCommon(value),
      simulation: {
        modelId: simulation.modelId,
        attribution: model.attribution,
        variables,
        outputs,
        explanatoryLabels: simulation.explanatoryLabels.slice()
      }
    }
  };
}

function validateVisualizationOutput(value) {
  if (!validateCommon(value)) {
    return { valid: false, unsupported: false };
  }
  if (value.type === "unsupported") {
    return { valid: true, unsupported: false, visualization: sanitizeCommon(value) };
  }
  if (diagramNodeTypes[value.type]) {
    const visualization = validateDiagram(value);
    return { valid: Boolean(visualization), unsupported: false, visualization };
  }
  if (value.type === "graph") {
    const visualization = validateGraph(value);
    return { valid: Boolean(visualization), unsupported: false, visualization };
  }
  if (value.type === "simulation") {
    const result = validateSimulation(value);
    return {
      valid: Boolean(result.visualization),
      unsupported: result.unsupported,
      visualization: result.visualization
    };
  }
  if (value.type === "steps") {
    if (!Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 12 ||
        value.steps.some((step) => !isRecord(step) ||
          !isText(step.title, 120) || !isText(step.description, 400))) {
      return { valid: false, unsupported: false };
    }
    return {
      valid: true,
      unsupported: false,
      visualization: {
        ...sanitizeCommon(value),
        steps: value.steps.map((step) => ({
          title: step.title,
          description: step.description
        }))
      }
    };
  }
  return { valid: false, unsupported: false };
}

module.exports = {
  validateVisualizationOutput
};
