(function () {
  const definitions = {
    "polymer-dp-mass-ratio": {
      equation: "DP = M_n / M_0",
      attribution: "additional-background",
      variables: [
        {
          id: "numberAverageMolarMass",
          label: "Number-average molar mass (M_n)",
          unit: "g/mol",
          minLimit: 28,
          maxLimit: 280000,
          min: 280,
          max: 28000,
          step: 28,
          initialValue: 28000
        },
        {
          id: "repeatUnitMolarMass",
          label: "Repeat-unit molar mass (M_0)",
          unit: "g/mol",
          minLimit: 1,
          maxLimit: 1000,
          min: 1,
          max: 100,
          step: 1,
          initialValue: 28
        }
      ],
      outputs: [
        {
          id: "degreeOfPolymerisation",
          label: "Degree of polymerisation (DP)",
          unit: "repeat units"
        }
      ]
    }
  };

  function getModel(modelId) {
    return definitions[modelId] || null;
  }

  function calculate(modelId, values) {
    const model = getModel(modelId);
    if (!model || !values || typeof values !== "object") {
      throw new TypeError("The simulation model or its inputs are not supported.");
    }

    const inputs = {};
    for (const variable of model.variables) {
      const value = values[variable.id];
      if (!Number.isFinite(value) || value < variable.minLimit || value > variable.maxLimit) {
        throw new RangeError(`The value for ${variable.id} is outside the supported range.`);
      }
      inputs[variable.id] = value;
    }

    return {
      degreeOfPolymerisation:
        inputs.numberAverageMolarMass / inputs.repeatUnitMolarMass
    };
  }

  const api = { getModel, calculate };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.LectureMateSimulationModels = api;
  }
})();
