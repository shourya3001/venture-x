const express = require("express");
const { validateRequest, validateChatPayload } = require("../middleware/validate-request");

function parseAnswerTimestamp(value) {
  const parts = value.split(":").map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && parts[1] < 60) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

function getRelevantCitations(answer, lessonContext, duration) {
  if (!lessonContext) {
    return [];
  }
  const availableTimestamps = new Set([
    ...(lessonContext.segments || []).map((segment) => segment.start),
    ...(lessonContext.summaryEvidence || []).map((item) => item.timestamp),
    ...(lessonContext.glossary || []).flatMap((item) => item.timestamps || []),
    ...(lessonContext.concepts || []).flatMap((item) => item.timestamps || []),
    ...(lessonContext.variables || []).flatMap((item) => item.timestamps || []),
    ...(lessonContext.retrievedKnowledge || []).flatMap((item) => item.timestamps || [])
  ].filter((timestamp) => Number.isFinite(timestamp) && timestamp >= 0 &&
    (!Number.isFinite(duration) || timestamp <= duration)).map(Math.floor));
  const citations = [];
  const markers = answer.matchAll(/\[(\d{1,3}:[0-5]\d|\d{1,2}:[0-5]\d:[0-5]\d)\]/g);
  for (const marker of markers) {
    const timestamp = parseAnswerTimestamp(marker[1]);
    if (timestamp !== null && availableTimestamps.has(timestamp) && !citations.includes(timestamp)) {
      citations.push(timestamp);
    }
    if (citations.length === 8) {
      break;
    }
  }
  return citations;
}

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

      res.json({
        answer: answer.trim(),
        citations: getRelevantCitations(
          answer,
          req.validatedBody.lessonContext,
          req.validatedBody.videoContext.duration
        )
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createChatRouter, getRelevantCitations };
