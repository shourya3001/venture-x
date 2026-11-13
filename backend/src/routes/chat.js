const express = require("express");
const { validateRequest, validateChatPayload } = require("../middleware/validate-request");

function createChatRouter(llmProvider) {
  const router = express.Router();

  router.post("/", validateRequest(validateChatPayload), async (req, res, next) => {
    try {
      const answer = await llmProvider.answerQuestion(req.validatedBody);
      if (typeof answer !== "string" || !answer.trim() || answer.length > 12000) {
        const error = new Error("INVALID_PROVIDER_RESPONSE");
        error.code = "INVALID_PROVIDER_RESPONSE";
        next(error);
        return;
      }

      res.json({ answer: answer.trim() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createChatRouter };
