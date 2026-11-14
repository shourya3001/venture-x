const express = require("express");
const { validateRequest, validateAnalyzePayload } = require("../middleware/validate-request");
const { createLectureAnalyzer } = require("../services/lecture-analyzer");

function createAnalyzeRouter(llmProvider) {
  const router = express.Router();
  const lectureAnalyzer = createLectureAnalyzer(llmProvider);

  router.post("/", validateRequest(validateAnalyzePayload), async (req, res, next) => {
    try {
      res.json(await lectureAnalyzer.analyzeLecture(req.validatedBody));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAnalyzeRouter };
