const youtubeHosts = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validateVideoContext(value, errors, fieldName) {
  if (!isRecord(value)) {
    errors.push(`${fieldName} must be an object.`);
    return;
  }

  if (!/^[\w-]{11}$/.test(value.videoId || "")) {
    errors.push(`${fieldName}.videoId must be a valid YouTube video ID.`);
  }
  if (!isText(value.title, 300)) {
    errors.push(`${fieldName}.title must be a non-empty string of at most 300 characters.`);
  }

  let url;
  try {
    url = new URL(value.url);
  } catch (_error) {
    errors.push(`${fieldName}.url must be a valid YouTube watch URL.`);
    return;
  }

  if (url.protocol !== "https:" || !youtubeHosts.has(url.hostname) ||
      url.pathname !== "/watch" || url.searchParams.get("v") !== value.videoId) {
    errors.push(`${fieldName}.url must match the supplied YouTube video ID.`);
  }

  for (const field of ["currentTime", "duration"]) {
    if (value[field] !== undefined && value[field] !== null &&
        (!Number.isFinite(value[field]) || value[field] < 0)) {
      errors.push(`${fieldName}.${field} must be a non-negative number or null.`);
    }
  }
  if (value.playbackState !== undefined && !["playing", "paused"].includes(value.playbackState)) {
    errors.push(`${fieldName}.playbackState must be playing or paused.`);
  }
}

function validateTimestampList(value, fieldName, errors, maximum = 10) {
  if (!Array.isArray(value) || value.length > maximum ||
      value.some((timestamp) => !Number.isFinite(timestamp) || timestamp < 0)) {
    errors.push(`${fieldName} must contain at most ${maximum} non-negative timestamps.`);
    return false;
  }
  return true;
}

function validateKnowledgeEvidence(value, fieldName, errors) {
  if (!Array.isArray(value) || value.length > 3) {
    errors.push(`${fieldName} must contain at most 3 evidence quotes.`);
    return;
  }
  value.forEach((item, index) => {
    if (!isRecord(item) || !isText(item.quote, 500) ||
        !Number.isFinite(item.timestamp) || item.timestamp < 0) {
      errors.push(`${fieldName}[${index}] is invalid.`);
    }
  });
}

function validateStringList(value, fieldName, errors) {
  if (!Array.isArray(value) || value.length > 12 ||
      value.some((item) => !isText(item, 200))) {
    errors.push(`${fieldName} must contain at most 12 non-empty strings of at most 200 characters.`);
  }
}

function validateVariables(value, fieldName, errors) {
  if (!Array.isArray(value) || value.length > 12) {
    errors.push(`${fieldName} must contain at most 12 variables.`);
    return;
  }
  value.forEach((item, index) => {
    if (!isRecord(item) || !isText(item.symbol, 80) ||
        item.meaning !== "" && !isText(item.meaning, 300) ||
        !["instructor", "inference"].includes(item.attribution) ||
        !validateTimestampList(item.timestamps, `${fieldName}[${index}].timestamps`, errors, 10)) {
      errors.push(`${fieldName}[${index}] is invalid.`);
    }
    if (item && item.evidence !== undefined) {
      validateKnowledgeEvidence(item.evidence, `${fieldName}[${index}].evidence`, errors);
    }
  });
}

function validateLessonContext(value, errors) {
  if (value === undefined || value === null) {
    return;
  }
  if (!isRecord(value)) {
    errors.push("lessonContext must be an object.");
    return;
  }
  if (value.source !== undefined && (typeof value.source !== "string" || value.source.length > 150)) {
    errors.push("lessonContext.source must be a string of at most 150 characters.");
  }
  if (value.summary !== undefined && (typeof value.summary !== "string" || value.summary.length > 2000)) {
    errors.push("lessonContext.summary must be a string of at most 2000 characters.");
  }
  if (value.transcriptCompleteness !== undefined) {
    const completeness = value.transcriptCompleteness;
    if (!isRecord(completeness) ||
        !["complete", "partial", "unknown"].includes(completeness.status) ||
        completeness.note !== undefined &&
          (typeof completeness.note !== "string" || completeness.note.length > 500)) {
      errors.push("lessonContext.transcriptCompleteness is invalid.");
    }
  }
  if (value.segments !== undefined) {
    if (!Array.isArray(value.segments) || value.segments.length > 16) {
      errors.push("lessonContext.segments must be an array containing at most 16 relevant segments.");
      return;
    }

    let totalTextLength = 0;
    value.segments.forEach((segment, index) => {
      if (!isRecord(segment) || !Number.isFinite(segment.start) ||
          !Number.isFinite(segment.end) || segment.start < 0 ||
          segment.end <= segment.start || !isText(segment.text, 2000)) {
        errors.push(`lessonContext.segments[${index}] has invalid timestamps or text.`);
        return;
      }
      totalTextLength += segment.text.length;
    });
    if (totalTextLength > 12000) {
      errors.push("lessonContext contains too much transcript text; send at most 12000 characters.");
    }
  }

  if (value.glossary !== undefined) {
    if (!Array.isArray(value.glossary) || value.glossary.length > 6) {
      errors.push("lessonContext.glossary must contain at most 6 relevant terms.");
      return;
    }
    value.glossary.forEach((item, index) => {
      if (!isRecord(item) || !isText(item.term, 200) || !isText(item.definition, 1000) ||
          item.abbreviation !== undefined && item.abbreviation !== "" && !isText(item.abbreviation, 80) ||
          item.instructorTerminology !== undefined && item.instructorTerminology !== "" &&
            !isText(item.instructorTerminology, 300) ||
          item.attribution !== undefined && !["instructor", "inference"].includes(item.attribution) ||
          !validateTimestampList(item.timestamps, `lessonContext.glossary[${index}].timestamps`, errors, 10)) {
        errors.push(`lessonContext.glossary[${index}] is invalid.`);
      }
      if (item && item.evidence !== undefined) {
        validateKnowledgeEvidence(item.evidence, `lessonContext.glossary[${index}].evidence`, errors);
      }
    });
  }

  if (value.concepts !== undefined) {
    if (!Array.isArray(value.concepts) || value.concepts.length > 6) {
      errors.push("lessonContext.concepts must contain at most 6 relevant concepts.");
      return;
    }
    value.concepts.forEach((item, index) => {
      if (!isRecord(item) || !isText(item.concept, 200) || !isText(item.explanation, 2000) ||
          item.attribution !== undefined && !["instructor", "inference"].includes(item.attribution) ||
          !validateTimestampList(item.timestamps, `lessonContext.concepts[${index}].timestamps`, errors, 10)) {
        errors.push(`lessonContext.concepts[${index}] is invalid.`);
        return;
      }
      if (item.prerequisites !== undefined) {
        validateStringList(item.prerequisites, `lessonContext.concepts[${index}].prerequisites`, errors);
      }
      if (item.relatedConcepts !== undefined) {
        validateStringList(item.relatedConcepts, `lessonContext.concepts[${index}].relatedConcepts`, errors);
      }
      if (item.variables !== undefined) {
        validateVariables(item.variables, `lessonContext.concepts[${index}].variables`, errors);
      }
      if (item.evidence !== undefined) {
        validateKnowledgeEvidence(item.evidence, `lessonContext.concepts[${index}].evidence`, errors);
      }
    });
  }

  if (value.variables !== undefined) {
    validateVariables(value.variables, "lessonContext.variables", errors);
  }

  if (value.retrievedKnowledge !== undefined) {
    if (!Array.isArray(value.retrievedKnowledge) || value.retrievedKnowledge.length > 12) {
      errors.push("lessonContext.retrievedKnowledge must contain at most 12 items.");
      return;
    }
    let retrievedTextLength = 0;
    value.retrievedKnowledge.forEach((item, index) => {
      if (!isRecord(item) || !isText(item.type, 40) || !isText(item.title, 200) ||
          !isText(item.text, 1200) || !Array.isArray(item.timestamps) ||
          item.timestamps.length > 10 || item.timestamps.some((timestamp) =>
            !Number.isFinite(timestamp) || timestamp < 0) ||
          !Array.isArray(item.evidence) || item.evidence.length > 3 ||
          item.evidence.some((evidence) => !isRecord(evidence) ||
            !isText(evidence.quote, 500) || !Number.isFinite(evidence.timestamp) ||
            evidence.timestamp < 0)) {
        errors.push(`lessonContext.retrievedKnowledge[${index}] is invalid.`);
        return;
      }
      retrievedTextLength += item.text.length;
    });
    if (retrievedTextLength > 12000) {
      errors.push("lessonContext.retrievedKnowledge contains too much text.");
    }
  }
}

function validateChatPayload(body) {
  const errors = [];
  if (!isRecord(body)) {
    return ["Request body must be a JSON object."];
  }
  if (!isText(body.question, 2000)) {
    errors.push("question must be a non-empty string of at most 2000 characters.");
  }
  validateVideoContext(body.videoContext, errors, "videoContext");
  validateLessonContext(body.lessonContext, errors);
  if (body.conversationHistory !== undefined) {
    if (!Array.isArray(body.conversationHistory) || body.conversationHistory.length > 12) {
      errors.push("conversationHistory must contain at most 12 messages.");
    } else {
      let totalHistoryLength = 0;
      body.conversationHistory.forEach((message, index) => {
        if (!isRecord(message) || !["user", "assistant"].includes(message.role) ||
            !isText(message.content, 4000)) {
          errors.push(`conversationHistory[${index}] is invalid.`);
          return;
        }
        totalHistoryLength += message.content.length;
      });
      if (totalHistoryLength > 30000) {
        errors.push("conversationHistory contains too much text.");
      }
    }
  }
  return errors;
}

function validateVisualizationRequest(body) {
  const errors = [];
  if (!isRecord(body)) {
    return ["Request body must be a JSON object."];
  }
  if (!isText(body.question, 2000)) {
    errors.push("question must be a non-empty string of at most 2000 characters.");
  }
  if (!isText(body.concept, 200)) {
    errors.push("concept must be a non-empty string of at most 200 characters.");
  }
  validateVideoContext(body.videoContext, errors, "videoContext");
  validateLessonContext(body.lessonContext, errors);
  return errors;
}

function validateAnalyzePayload(body) {
  const errors = [];
  if (!isRecord(body)) {
    return ["Request body must be a JSON object."];
  }

  validateVideoContext(body.videoContext, errors, "videoContext");
  if (!isRecord(body.lessonMetadata)) {
    errors.push("lessonMetadata must be an object.");
  } else {
    if (body.lessonMetadata.title !== undefined && !isText(body.lessonMetadata.title, 300)) {
      errors.push("lessonMetadata.title must be a non-empty string of at most 300 characters.");
    }
    if (body.lessonMetadata.source !== undefined &&
        (typeof body.lessonMetadata.source !== "string" || body.lessonMetadata.source.length > 150)) {
      errors.push("lessonMetadata.source must be a string of at most 150 characters.");
    }
  }

  if (!isRecord(body.transcriptCompleteness)) {
    errors.push("transcriptCompleteness must be an object.");
  } else {
    if (!["complete", "partial", "unknown"].includes(body.transcriptCompleteness.status)) {
      errors.push("transcriptCompleteness.status must be complete, partial, or unknown.");
    }
    const coverage = body.transcriptCompleteness.coveragePercentage;
    if (coverage !== null && (!Number.isFinite(coverage) || coverage < 0 || coverage > 100)) {
      errors.push("transcriptCompleteness.coveragePercentage must be between 0 and 100 or null.");
    }
  }

  if (!Array.isArray(body.transcript) || body.transcript.length === 0 || body.transcript.length > 10000) {
    errors.push("transcript must contain between 1 and 10000 timestamped segments.");
    return errors;
  }

  let totalTextLength = 0;
  body.transcript.forEach((segment, index) => {
    if (!isRecord(segment) || !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) || segment.start < 0 ||
        segment.end <= segment.start || !isText(segment.text, 5000)) {
      errors.push(`transcript[${index}] has invalid timestamps or text.`);
      return;
    }
    totalTextLength += segment.text.length;
  });
  if (totalTextLength > 800000) {
    errors.push("transcript contains too much text.");
  }
  return errors;
}

function validateRequest(validator) {
  return (req, res, next) => {
    const errors = validator(req.body);
    if (errors.length > 0) {
      res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "The request body is invalid.",
          details: errors
        }
      });
      return;
    }

    req.validatedBody = req.body;
    next();
  };
}

module.exports = {
  validateRequest,
  validateChatPayload,
  validateVisualizationRequest,
  validateAnalyzePayload
};
