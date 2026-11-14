const models = {
  "polymer-dp-mass-ratio": {
    attribution: "additional-background",
    variables: [
      {
        id: "numberAverageMolarMass",
        label: "Number-average molar mass (M_n)",
        unit: "g/mol",
        minLimit: 28,
        maxLimit: 280000
      },
      {
        id: "repeatUnitMolarMass",
        label: "Repeat-unit molar mass (M_0)",
        unit: "g/mol",
        minLimit: 1,
        maxLimit: 1000
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
  return models[modelId] || null;
}

module.exports = { getModel };
