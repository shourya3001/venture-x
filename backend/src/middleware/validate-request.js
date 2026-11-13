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
  if (value.segments === undefined) {
    return;
  }
  if (!Array.isArray(value.segments) || value.segments.length > 80) {
    errors.push("lessonContext.segments must be an array containing at most 80 segments.");
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
  if (totalTextLength > 24000) {
    errors.push("lessonContext contains too much text; send at most 24000 characters.");
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
  validateAnalyzePayload
};
