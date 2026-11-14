const express = require("express");
const { validateRequest, validateVisualizationRequest } = require("../middleware/validate-request");
const { validateVisualizationOutput } = require("../services/visualization-contract");

function createVisualizationRouter(llmProvider) {
  const router = express.Router();

  router.post("/", validateRequest(validateVisualizationRequest), async (req, res, next) => {
    try {
      const generated = await llmProvider.createVisualization(req.validatedBody);
      const result = validateVisualizationOutput(generated);
      if (result.unsupported) {
        res.json({
          visualization: {
            version: 1,
            type: "unsupported",
            title: "Simulation model not supported",
            explanation: "This simulation is not available yet. Try a flowchart, concept map, or step-by-step explanation."
          }
        });
        return;
      }
      if (!result.valid) {
        const error = new Error("INVALID_PROVIDER_RESPONSE");
        error.code = "INVALID_PROVIDER_RESPONSE";
        next(error);
        return;
      }

      res.json({ visualization: result.visualization });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createVisualizationRouter };
