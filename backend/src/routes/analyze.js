const express = require("express");
const { validateRequest, validateAnalyzePayload } = require("../middleware/validate-request");

function createAnalyzeRouter() {
  const router = express.Router();

  router.post("/", validateRequest(validateAnalyzePayload), (_req, res) => {
    res.status(501).json({
      error: {
        code: "ANALYSIS_NOT_IMPLEMENTED",
        message: "Transcript analysis is reserved for a later LectureMate milestone."
      }
    });
  });

  return router;
}

module.exports = { createAnalyzeRouter };
