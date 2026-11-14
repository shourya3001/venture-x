(function () {
  const timestampPattern = /\[(\d{1,3}:[0-5]\d|\d{1,2}:[0-5]\d:[0-5]\d)\]/g;

  function parseTimestamp(value) {
    const parts = value.split(":").map(Number);
    if (parts.some((part) => !Number.isInteger(part))) {
      return null;
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3 && parts[1] < 60) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  }

  function splitAnswer(text, citations, duration) {
    const allowed = new Set(Array.isArray(citations)
      ? citations.filter((value) => Number.isFinite(value) && value >= 0).map(Math.floor)
      : []);
    const parts = [];
    let previousIndex = 0;
    let match;
    while ((match = timestampPattern.exec(text)) !== null) {
      const seconds = parseTimestamp(match[1]);
      const allowedByDuration = !Number.isFinite(duration) || seconds <= duration;
      if (seconds === null || !allowed.has(seconds) || !allowedByDuration) {
        continue;
      }
      if (match.index > previousIndex) {
        parts.push({ type: "text", text: text.slice(previousIndex, match.index) });
      }
      parts.push({ type: "timestamp", text: match[1], seconds });
      previousIndex = match.index + match[0].length;
    }
    timestampPattern.lastIndex = 0;
    if (previousIndex < text.length) {
      parts.push({ type: "text", text: text.slice(previousIndex) });
    }
    return parts;
  }

  const api = { parseTimestamp, splitAnswer };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.LectureMateChatRenderer = api;
  }
})();
