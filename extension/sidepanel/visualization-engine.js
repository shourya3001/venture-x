(function () {
  const simulationModels = globalThis.LectureMateSimulationModels ||
    (typeof module !== "undefined" && module.exports
      ? require("../shared/simulation-models.js")
      : null);
  const diagramNodeTypes = {
    flowchart: new Set(["start", "process", "decision", "end", "input", "output"]),
    "concept-map": new Set(["concept"]),
    "process-diagram": new Set(["input", "process", "decision", "output"])
  };

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isText(value, maxLength) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
  }

  function requireValid(condition, message) {
    if (!condition) {
      throw new TypeError(message);
    }
  }

  function validateCommon(value) {
    requireValid(isRecord(value) && value.version === 1 &&
      isText(value.title, 120) && isText(value.explanation, 800),
    "The visualization response is malformed.");
  }

  function validateVisualization(value) {
    validateCommon(value);
    if (value.type === "unsupported") {
      return {
        version: 1,
        type: "unsupported",
        title: value.title,
        explanation: value.explanation
      };
    }

    if (diagramNodeTypes[value.type]) {
      requireValid(["top-to-bottom", "left-to-right"].includes(value.layout) &&
        Array.isArray(value.nodes) && value.nodes.length >= 2 && value.nodes.length <= 20 &&
        Array.isArray(value.connections) && value.connections.length <= 40,
      "The diagram structure is malformed.");
      const ids = new Set();
      const nodes = value.nodes.map((node) => {
        requireValid(isRecord(node) && typeof node.id === "string" &&
          /^[A-Za-z0-9_-]{1,30}$/.test(node.id) && !ids.has(node.id) &&
          diagramNodeTypes[value.type].has(node.type) && isText(node.label, 120),
        "The diagram contains an invalid node.");
        ids.add(node.id);
        return { id: node.id, type: node.type, label: node.label };
      });
      const connections = value.connections.map((connection) => {
        requireValid(isRecord(connection) && ids.has(connection.from) && ids.has(connection.to) &&
          connection.from !== connection.to &&
          ["forward", "both"].includes(connection.direction) &&
          (connection.label === undefined || connection.label === "" ||
            isText(connection.label, 100)),
        "The diagram contains an invalid connection.");
        return {
          from: connection.from,
          to: connection.to,
          label: connection.label || "",
          direction: connection.direction
        };
      });
      return {
        version: 1,
        type: value.type,
        title: value.title,
        explanation: value.explanation,
        layout: value.layout,
        nodes,
        connections
      };
    }

    if (value.type === "graph") {
      const axes = value.axes;
      requireValid(isRecord(axes) && isText(axes.xLabel, 80) && isText(axes.yLabel, 80) &&
        [axes.xMin, axes.xMax, axes.yMin, axes.yMax].every(Number.isFinite) &&
        axes.xMin < axes.xMax && axes.yMin < axes.yMax &&
        Math.max(Math.abs(axes.xMin), Math.abs(axes.xMax), Math.abs(axes.yMin),
          Math.abs(axes.yMax)) <= 1e9 &&
        ["line", "scatter"].includes(value.graphKind) &&
        Array.isArray(value.points) && value.points.length >= 2 && value.points.length <= 50,
      "The graph axes or point list is invalid.");
      const points = value.points.map((point) => {
        requireValid(isRecord(point) && Number.isFinite(point.x) && Number.isFinite(point.y) &&
          point.x >= axes.xMin && point.x <= axes.xMax &&
          point.y >= axes.yMin && point.y <= axes.yMax &&
          (point.label === undefined || point.label === "" || isText(point.label, 80)),
        "The graph contains an invalid point.");
        return { x: point.x, y: point.y, label: point.label || "" };
      });
      return {
        version: 1,
        type: "graph",
        title: value.title,
        explanation: value.explanation,
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

    if (value.type === "simulation") {
      const simulation = value.simulation;
      requireValid(isRecord(simulation) && isText(simulation.modelId, 80),
        "The simulation model is missing.");
      const model = simulationModels && simulationModels.getModel(simulation.modelId);
      requireValid(model, "This simulation model is not supported.");
      requireValid(simulation.attribution === model.attribution &&
        Array.isArray(simulation.variables) &&
        simulation.variables.length === model.variables.length &&
        Array.isArray(simulation.outputs) &&
        simulation.outputs.length === model.outputs.length &&
        Array.isArray(simulation.explanatoryLabels) &&
        simulation.explanatoryLabels.length >= 1 &&
        simulation.explanatoryLabels.length <= 4 &&
        simulation.explanatoryLabels.every((label) => isText(label, 240)),
      "The simulation inputs or labels are malformed.");

      const variablesById = new Map();
      simulation.variables.forEach((variable) => {
        requireValid(isRecord(variable) && typeof variable.id === "string" &&
          !variablesById.has(variable.id),
        "The simulation contains a duplicate or invalid input.");
        variablesById.set(variable.id, variable);
      });
      const variables = model.variables.map((expected) => {
        const variable = variablesById.get(expected.id);
        requireValid(variable && variable.label === expected.label &&
          variable.unit === expected.unit &&
          [variable.min, variable.max, variable.step, variable.initialValue].every(Number.isFinite) &&
          variable.min >= expected.minLimit && variable.max <= expected.maxLimit &&
          variable.min < variable.max && variable.step >= 0.001 &&
          variable.step <= variable.max - variable.min &&
          (variable.max - variable.min) / variable.step <= 1000000 &&
          variable.initialValue >= variable.min && variable.initialValue <= variable.max,
        `The slider limits for ${expected.id} are invalid.`);
        const stepPosition = (variable.initialValue - variable.min) / variable.step;
        requireValid(Math.abs(stepPosition - Math.round(stepPosition)) <= 1e-8,
          `The initial value for ${expected.id} does not align with its slider step.`);
        return {
          id: expected.id,
          label: expected.label,
          unit: expected.unit,
          min: variable.min,
          max: variable.max,
          step: variable.step,
          initialValue: variable.initialValue
        };
      });
      const outputs = model.outputs.map((expected, index) => {
        const output = simulation.outputs[index];
        requireValid(isRecord(output) && output.id === expected.id &&
          output.label === expected.label && output.unit === expected.unit,
        "The simulation output definition is invalid.");
        return { id: expected.id, label: expected.label, unit: expected.unit };
      });
      return {
        version: 1,
        type: "simulation",
        title: value.title,
        explanation: value.explanation,
        simulation: {
          modelId: simulation.modelId,
          attribution: model.attribution,
          variables,
          outputs,
          explanatoryLabels: simulation.explanatoryLabels.slice()
        }
      };
    }

    if (value.type === "steps") {
      requireValid(Array.isArray(value.steps) && value.steps.length >= 2 &&
        value.steps.length <= 12 && value.steps.every((step) =>
          isRecord(step) && isText(step.title, 120) && isText(step.description, 400)),
      "The step-by-step explanation is malformed.");
      return {
        version: 1,
        type: "steps",
        title: value.title,
        explanation: value.explanation,
        steps: value.steps.map((step) => ({
          title: step.title,
          description: step.description
        }))
      };
    }

    throw new TypeError("The visualization type is not supported.");
  }

  function makeElement(documentRef, name, className, text) {
    const element = documentRef.createElement(name);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function makeSvgElement(documentRef, name, attributes, text) {
    const element = documentRef.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes || {}).forEach(([name, value]) => {
      element.setAttribute(name, String(value));
    });
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function wrapLabel(value, maxLength, maxLines) {
    const words = value.split(/\s+/);
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxLength && current && lines.length < maxLines - 1) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) {
      lines.push(current.slice(0, maxLength));
    }
    return lines;
  }

  function appendWrappedSvgText(documentRef, parent, x, y, label, options) {
    const lines = wrapLabel(label, options.maxLength, options.maxLines);
    const attributes = {
      x,
      y: y - (lines.length - 1) * 8,
      "text-anchor": options.anchor || "middle",
      class: options.className || ""
    };
    if (options.transform) {
      attributes.transform = options.transform;
    }
    const text = makeSvgElement(documentRef, "text", attributes);
    lines.forEach((line, index) => {
      text.append(makeSvgElement(documentRef, "tspan", {
        x,
        dy: index === 0 ? 0 : 16
      }, line));
    });
    parent.append(text);
  }

  function getDiagramPositions(visualization) {
    const columns = visualization.layout === "left-to-right"
      ? Math.min(3, visualization.nodes.length)
      : 1;
    const rows = Math.ceil(visualization.nodes.length / columns);
    const cellWidth = 260;
    const cellHeight = 150;
    return {
      width: columns * cellWidth + 20,
      height: rows * cellHeight + 20,
      nodes: new Map(visualization.nodes.map((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return [node.id, {
          x: 10 + column * cellWidth + 20,
          y: 10 + row * cellHeight + 25,
          width: 220,
          height: 80
        }];
      }))
    };
  }

  let svgSequence = 0;

  function renderDiagram(documentRef, visualization) {
    const layout = getDiagramPositions(visualization);
    const svg = makeSvgElement(documentRef, "svg", {
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      role: "img",
      "aria-label": visualization.title,
      class: "visualization-diagram"
    });
    const markerId = `lecturemate-arrow-${svgSequence++}`;
    const defs = makeSvgElement(documentRef, "defs");
    const marker = makeSvgElement(documentRef, "marker", {
      id: markerId,
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      markerWidth: "6",
      markerHeight: "6",
      orient: "auto-start-reverse"
    });
    marker.append(makeSvgElement(documentRef, "path", {
      d: "M 0 0 L 10 5 L 0 10 z",
      class: "visualization-arrowhead"
    }));
    defs.append(marker);
    svg.append(defs);

    visualization.connections.forEach((connection) => {
      const from = layout.nodes.get(connection.from);
      const to = layout.nodes.get(connection.to);
      const startX = from.x + from.width / 2;
      const startY = from.y + from.height / 2;
      const endX = to.x + to.width / 2;
      const endY = to.y + to.height / 2;
      const distanceX = endX - startX;
      const distanceY = endY - startY;
      const scale = Math.min(
        (from.width / 2) / Math.max(Math.abs(distanceX), 1),
        (from.height / 2) / Math.max(Math.abs(distanceY), 1)
      );
      const targetScale = Math.min(
        (to.width / 2) / Math.max(Math.abs(distanceX), 1),
        (to.height / 2) / Math.max(Math.abs(distanceY), 1)
      );
      const line = makeSvgElement(documentRef, "line", {
        x1: startX + distanceX * scale,
        y1: startY + distanceY * scale,
        x2: endX - distanceX * targetScale,
        y2: endY - distanceY * targetScale,
        "marker-end": `url(#${markerId})`,
        ...(connection.direction === "both" ? { "marker-start": `url(#${markerId})` } : {}),
        class: "visualization-connection"
      });
      svg.append(line);
      if (connection.label) {
        appendWrappedSvgText(documentRef, svg, (startX + endX) / 2, (startY + endY) / 2,
          connection.label, { maxLength: 24, maxLines: 2, className: "visualization-edge-label" });
      }
    });

    visualization.nodes.forEach((node) => {
      const position = layout.nodes.get(node.id);
      const group = makeSvgElement(documentRef, "g", {
        class: `visualization-node visualization-node-${node.type}`
      });
      if (node.type === "decision") {
        group.append(makeSvgElement(documentRef, "polygon", {
          points: [
            `${position.x + position.width / 2},${position.y}`,
            `${position.x + position.width},${position.y + position.height / 2}`,
            `${position.x + position.width / 2},${position.y + position.height}`,
            `${position.x},${position.y + position.height / 2}`
          ].join(" "),
          class: "visualization-node-shape"
        }));
      } else {
        group.append(makeSvgElement(documentRef, "rect", {
          x: position.x,
          y: position.y,
          width: position.width,
          height: position.height,
          rx: node.type === "start" || node.type === "end" ? 36 : 12,
          class: "visualization-node-shape"
        }));
      }
      appendWrappedSvgText(documentRef, group, position.x + position.width / 2,
        position.y + position.height / 2 + 5, node.label,
        { maxLength: 28, maxLines: 3, className: "visualization-node-label" });
      svg.append(group);
    });
    return svg;
  }

  function renderGraph(documentRef, points, axes, graphKind, className) {
    const svg = makeSvgElement(documentRef, "svg", {
      viewBox: "0 0 800 440",
      role: "img",
      "aria-label": `${axes.yLabel} versus ${axes.xLabel}`,
      class: className
    });
    const plot = { x: 78, y: 24, width: 680, height: 340 };
    const scaleX = (value) => plot.x + ((value - axes.xMin) / (axes.xMax - axes.xMin)) * plot.width;
    const scaleY = (value) => plot.y + plot.height -
      ((value - axes.yMin) / (axes.yMax - axes.yMin)) * plot.height;

    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4;
      const x = plot.x + plot.width * ratio;
      const y = plot.y + plot.height * (1 - ratio);
      svg.append(makeSvgElement(documentRef, "line", {
        x1: x, y1: plot.y, x2: x, y2: plot.y + plot.height,
        class: "visualization-gridline"
      }));
      svg.append(makeSvgElement(documentRef, "line", {
        x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y,
        class: "visualization-gridline"
      }));
      appendWrappedSvgText(documentRef, svg, x, plot.y + plot.height + 22,
        String(axes.xMin + (axes.xMax - axes.xMin) * ratio),
        { maxLength: 12, maxLines: 1, className: "visualization-tick" });
      appendWrappedSvgText(documentRef, svg, plot.x - 12, y + 4,
        String(axes.yMin + (axes.yMax - axes.yMin) * ratio),
        { maxLength: 12, maxLines: 1, anchor: "end", className: "visualization-tick" });
    }

    svg.append(makeSvgElement(documentRef, "line", {
      x1: plot.x, y1: plot.y + plot.height,
      x2: plot.x + plot.width, y2: plot.y + plot.height,
      class: "visualization-axis"
    }));
    svg.append(makeSvgElement(documentRef, "line", {
      x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.height,
      class: "visualization-axis"
    }));
    appendWrappedSvgText(documentRef, svg, plot.x + plot.width / 2, 426, axes.xLabel,
      { maxLength: 38, maxLines: 1, className: "visualization-axis-label" });
    const yLabelX = 18;
    const yLabelY = plot.y + plot.height / 2;
    appendWrappedSvgText(documentRef, svg, yLabelX, yLabelY, axes.yLabel,
      {
        maxLength: 38,
        maxLines: 1,
        className: "visualization-axis-label",
        transform: `rotate(-90 ${yLabelX} ${yLabelY})`
      });

    if (graphKind === "line") {
      svg.append(makeSvgElement(documentRef, "polyline", {
        points: points.map((point) => `${scaleX(point.x)},${scaleY(point.y)}`).join(" "),
        class: "visualization-line"
      }));
    }
    points.forEach((point) => {
      const circle = makeSvgElement(documentRef, "circle", {
        cx: scaleX(point.x),
        cy: scaleY(point.y),
        r: className === "simulation-graph" ? 3 : 5,
        class: "visualization-point"
      });
      if (point.label) {
        circle.setAttribute("aria-label", point.label);
      }
      svg.append(circle);
    });
    return svg;
  }

  function renderGraphVisualization(documentRef, visualization) {
    const section = makeElement(documentRef, "section", "visualization-card");
    section.append(makeElement(documentRef, "h3", "", visualization.title));
    section.append(makeElement(documentRef, "p", "visualization-explanation", visualization.explanation));
    const graphWrap = makeElement(documentRef, "div", "visualization-graph-wrap");
    graphWrap.append(renderGraph(documentRef, visualization.points, visualization.axes,
      visualization.graphKind, "visualization-graph"));
    section.append(graphWrap);
    section.append(makeElement(documentRef, "p", "visualization-source-note",
      "Graph points are a structured illustration from the supplied lecture context."));
    return section;
  }

  function renderSimulation(documentRef, visualization) {
    const simulation = visualization.simulation;
    const model = simulationModels.getModel(simulation.modelId);
    const section = makeElement(documentRef, "section", "visualization-card simulation-card");
    section.append(makeElement(documentRef, "h3", "", visualization.title));
    section.append(makeElement(documentRef, "p", "visualization-explanation", visualization.explanation));
    section.append(makeElement(documentRef, "p", "simulation-attribution",
      "Illustrative additional background; this equation is not attributed to the instructor."));
    section.append(makeElement(documentRef, "p", "simulation-equation", model.equation));

    const controls = makeElement(documentRef, "div", "simulation-controls");
    const inputs = {};
    const sliders = [];
    simulation.variables.forEach((variable) => {
      const field = makeElement(documentRef, "label", "simulation-variable");
      field.append(makeElement(documentRef, "span", "simulation-variable-label", variable.label));
      const value = makeElement(documentRef, "output", "simulation-variable-value");
      const slider = makeElement(documentRef, "input", "simulation-slider");
      slider.type = "range";
      slider.min = String(variable.min);
      slider.max = String(variable.max);
      slider.step = String(variable.step);
      slider.value = String(variable.initialValue);
      inputs[variable.id] = variable.initialValue;
      field.append(value, slider);
      controls.append(field);
      sliders.push({ variable, value, slider });
    });
    section.append(controls);

    const outputs = makeElement(documentRef, "div", "simulation-outputs");
    const outputElements = new Map();
    simulation.outputs.forEach((output) => {
      const card = makeElement(documentRef, "div", "simulation-output");
      card.append(makeElement(documentRef, "span", "simulation-output-label", output.label));
      const value = makeElement(documentRef, "strong", "simulation-output-value");
      card.append(value, makeElement(documentRef, "span", "simulation-output-unit", output.unit));
      outputs.append(card);
      outputElements.set(output.id, value);
    });
    section.append(outputs);

    const dynamicExplanation = makeElement(documentRef, "p", "simulation-dynamic-explanation");
    section.append(dynamicExplanation);
    const graphHeading = makeElement(documentRef, "h4", "simulation-graph-heading",
      "Relationship between molar mass and DP");
    section.append(graphHeading);
    const graphContainer = makeElement(documentRef, "div", "simulation-graph-container");
    section.append(graphContainer);
    simulation.explanatoryLabels.forEach((label) => {
      section.append(makeElement(documentRef, "p", "simulation-label", label));
    });

    const numberAverageVariable = simulation.variables.find((item) =>
      item.id === "numberAverageMolarMass");
    const repeatUnitVariable = simulation.variables.find((item) =>
      item.id === "repeatUnitMolarMass");
    function update() {
      sliders.forEach(({ variable, value, slider }) => {
        inputs[variable.id] = Number(slider.value);
        value.textContent = `${inputs[variable.id]} ${variable.unit}`;
      });
      const results = simulationModels.calculate(simulation.modelId, inputs);
      simulation.outputs.forEach((output) => {
        outputElements.get(output.id).textContent = results[output.id].toPrecision(4);
      });
      const repeatUnitMass = inputs.repeatUnitMolarMass;
      dynamicExplanation.textContent =
        `With M_0 fixed at ${repeatUnitMass} g/mol, increasing M_n increases DP; increasing M_0 while M_n stays fixed decreases DP.`;
      const graphPoints = Array.from({ length: 21 }, (_, index) => {
        const molarMass = numberAverageVariable.min +
          ((numberAverageVariable.max - numberAverageVariable.min) * index) / 20;
        return {
          x: molarMass,
          y: simulationModels.calculate(simulation.modelId, {
            ...inputs,
            numberAverageMolarMass: molarMass
          }).degreeOfPolymerisation
        };
      });
      graphContainer.replaceChildren(renderGraph(documentRef, graphPoints, {
        xLabel: "Number-average molar mass (M_n)",
        yLabel: "Degree of polymerisation (DP)",
        xMin: numberAverageVariable.min,
        xMax: numberAverageVariable.max,
        yMin: Math.min(...graphPoints.map((point) => point.y)),
        yMax: Math.max(...graphPoints.map((point) => point.y)) || 1
      }, "line", "simulation-graph"));
    }

    sliders.forEach(({ slider }) => slider.addEventListener("input", update));
    update();
    return section;
  }

  function renderVisualization(container, input) {
    const documentRef = container.ownerDocument || globalThis.document;
    const visualization = validateVisualization(input);
    let content;
    if (visualization.type === "unsupported") {
      content = makeElement(documentRef, "section", "visualization-card visualization-unsupported");
      content.append(makeElement(documentRef, "h3", "", visualization.title));
      content.append(makeElement(documentRef, "p", "", visualization.explanation));
    } else if (diagramNodeTypes[visualization.type]) {
      content = makeElement(documentRef, "section", "visualization-card");
      content.append(makeElement(documentRef, "h3", "", visualization.title));
      content.append(makeElement(documentRef, "p", "visualization-explanation",
        visualization.explanation));
      const diagramWrap = makeElement(documentRef, "div", "visualization-diagram-wrap");
      diagramWrap.append(renderDiagram(documentRef, visualization));
      content.append(diagramWrap);
    } else if (visualization.type === "graph") {
      content = renderGraphVisualization(documentRef, visualization);
    } else if (visualization.type === "simulation") {
      content = renderSimulation(documentRef, visualization);
    } else {
      content = makeElement(documentRef, "section", "visualization-card");
      content.append(makeElement(documentRef, "h3", "", visualization.title));
      content.append(makeElement(documentRef, "p", "visualization-explanation",
        visualization.explanation));
      const list = makeElement(documentRef, "ol", "visualization-steps");
      visualization.steps.forEach((step) => {
        const item = makeElement(documentRef, "li", "visualization-step");
        item.append(makeElement(documentRef, "strong", "", step.title));
        item.append(makeElement(documentRef, "p", "", step.description));
        list.append(item);
      });
      content.append(list);
    }
    container.replaceChildren(content);
    return visualization;
  }

  const api = {
    validateVisualization,
    renderVisualization,
    getSimulationModel: simulationModels.getModel,
    calculateSimulation: simulationModels.calculate
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.LectureMateVisualization = api;
  }
})();
