(function () {
  const timestampPattern = /^(?:(\d{2,}):)?([0-5]?\d):([0-5]\d)(?:[.,](\d{1,3}))?$/;
  const defaultMaxChars = 4000;
  const defaultOverlapChars = 400;

  function parseTimestamp(value) {
    const match = timestampPattern.exec(value.trim());
    if (!match) {
      return null;
    }

    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = match[4] ? Number(match[4].padEnd(3, "0")) : 0;
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  function cleanText(value) {
    return value
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseTranscript(input, format) {
    if (typeof input !== "string") {
      throw new TypeError("Transcript content must be text.");
    }
    if (format !== "vtt" && format !== "srt") {
      throw new TypeError("Choose a VTT or SRT transcript.");
    }

    const blocks = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
    const parsed = [];
    let rejected = 0;

    blocks.forEach((block) => {
      const lines = block.split("\n");
      const timingLineIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingLineIndex < 0) {
        return;
      }

      const timingParts = lines[timingLineIndex].split("-->");
      if (timingParts.length !== 2) {
        rejected += 1;
        return;
      }

      const start = parseTimestamp(timingParts[0]);
      const endToken = timingParts[1].trim().split(/\s+/)[0];
      const end = parseTimestamp(endToken);
      const text = cleanText(lines.slice(timingLineIndex + 1).join(" "));

      if (start === null || end === null || end <= start || !text) {
        rejected += 1;
        return;
      }

      parsed.push({ start, end, text });
    });

    parsed.sort((left, right) => left.start - right.start || left.end - right.end || left.text.localeCompare(right.text));

    const seen = new Set();
    const segments = [];
    let duplicates = 0;
    parsed.forEach((segment) => {
      const key = `${segment.start}\u0000${segment.end}\u0000${segment.text.toLocaleLowerCase()}`;
      if (seen.has(key)) {
        duplicates += 1;
        return;
      }
      seen.add(key);
      segments.push(segment);
    });

    return { segments, rejected, duplicates };
  }

  function isSentenceEnd(text) {
    return /[.!?]["'’”)\]]*$/.test(text.trim());
  }

  function chunkTranscript(segments, options) {
    if (!Array.isArray(segments)) {
      throw new TypeError("Transcript segments must be an array.");
    }

    const maxChars = options && Number.isInteger(options.maxChars) && options.maxChars > 0
      ? options.maxChars
      : defaultMaxChars;
    const overlapChars = options && Number.isInteger(options.overlapChars) && options.overlapChars >= 0
      ? options.overlapChars
      : defaultOverlapChars;
    const chunks = [];
    let startIndex = 0;

    while (startIndex < segments.length) {
      let endIndex = startIndex;
      let charCount = 0;
      let lastSentenceEnd = -1;

      while (endIndex < segments.length && charCount < maxChars) {
        charCount += segments[endIndex].text.length + 1;
        endIndex += 1;
        if (isSentenceEnd(segments[endIndex - 1].text)) {
          lastSentenceEnd = endIndex;
        }
      }

      if (endIndex < segments.length && lastSentenceEnd > startIndex) {
        endIndex = lastSentenceEnd;
      } else if (endIndex < segments.length && lastSentenceEnd < 0) {
        while (endIndex < segments.length && !isSentenceEnd(segments[endIndex - 1].text)) {
          charCount += segments[endIndex].text.length + 1;
          endIndex += 1;
        }
      }

      if (endIndex <= startIndex) {
        endIndex = startIndex + 1;
      }

      const chunkSegments = segments.slice(startIndex, endIndex).map((segment, offset) => ({
        index: startIndex + offset,
        start: segment.start,
        end: segment.end,
        text: segment.text
      }));
      chunks.push({
        index: chunks.length,
        start: chunkSegments[0].start,
        end: chunkSegments[chunkSegments.length - 1].end,
        text: chunkSegments.map((segment) => segment.text).join(" "),
        segments: chunkSegments
      });

      if (endIndex >= segments.length) {
        break;
      }

      let nextIndex = endIndex;
      let overlapLength = 0;
      while (nextIndex > startIndex + 1 && overlapLength < overlapChars) {
        nextIndex -= 1;
        overlapLength += segments[nextIndex].text.length + 1;
      }
      startIndex = Math.max(startIndex + 1, nextIndex);
    }

    return chunks;
  }

  function calculateCoverage(segments, expectedDuration) {
    if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) {
      return { percentage: null, complete: false };
    }

    const validSegments = segments
      .map((segment) => Array.isArray(segment)
        ? { start: segment[0], end: segment[1] }
        : segment)
      .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) &&
        segment.start >= 0 && segment.end > segment.start);
    const intervals = validSegments
      .map((segment) => ({
        start: Math.max(0, Math.min(expectedDuration, segment.start)),
        end: Math.max(0, Math.min(expectedDuration, segment.end))
      }))
      .filter((interval) => interval.end > interval.start)
      .sort((left, right) => left.start - right.start);

    if (intervals.length === 0) {
      return { percentage: 0, complete: false };
    }

    let coveredSeconds = 0;
    let rangeStart = intervals[0].start;
    let rangeEnd = intervals[0].end;
    intervals.slice(1).forEach((interval) => {
      if (interval.start <= rangeEnd) {
        rangeEnd = Math.max(rangeEnd, interval.end);
      } else {
        coveredSeconds += rangeEnd - rangeStart;
        rangeStart = interval.start;
        rangeEnd = interval.end;
      }
    });
    coveredSeconds += rangeEnd - rangeStart;

    const percentage = Math.min(100, (coveredSeconds / expectedDuration) * 100);
    let earliestStart = Infinity;
    let latestEnd = -Infinity;
    validSegments.forEach((segment) => {
      earliestStart = Math.min(earliestStart, segment.start);
      latestEnd = Math.max(latestEnd, segment.end);
    });
    const startsNearBeginning = earliestStart <= 1;
    const endsNearDuration = latestEnd >= expectedDuration - 1 && latestEnd <= expectedDuration + 1;
    return {
      percentage,
      complete: percentage >= 98 && startsNearBeginning && endsNearDuration
    };
  }

  function tokenize(value, includeSingle = false) {
    return (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
      .filter((token) => token.length > 1 || includeSingle);
  }

  function searchKnowledgeBase(query, knowledgeBase, transcriptChunks, limit) {
    const terms = [...new Set(tokenize(query))];
    const singleCharacterTerms = (query.toLocaleLowerCase().match(/\b[\p{L}]\b/gu) || []);
    const knownSymbols = new Set([
      ...(knowledgeBase && Array.isArray(knowledgeBase.concepts) ? knowledgeBase.concepts : []),
      ...(knowledgeBase && Array.isArray(knowledgeBase.equations) ? knowledgeBase.equations : [])
    ].flatMap((item) => Array.isArray(item.variables)
      ? item.variables.map((variable) => variable.symbol.toLocaleLowerCase())
      : []));
    singleCharacterTerms.forEach((term) => {
      if (knownSymbols.has(term) && !terms.includes(term)) {
        terms.push(term);
      }
    });
    if (terms.length === 0) {
      return [];
    }

    const candidates = [];
    (Array.isArray(transcriptChunks) ? transcriptChunks : []).forEach((chunk) => {
      candidates.push({
        type: "transcript",
        title: `Transcript · ${chunk.start}`,
        text: chunk.text,
        timestamps: [chunk.start],
        evidence: [],
        segmentIndexes: chunk.segments.map((segment) => segment.index)
      });
    });

    const collections = [
      ["topic", knowledgeBase && knowledgeBase.topics, (item) => item.topic,
        (item) => (item.subtopics || []).join(" "), () => ""],
      ["concept", knowledgeBase && knowledgeBase.concepts, (item) => item.concept,
        (item) => [item.explanation, ...(item.prerequisites || []), ...(item.relatedConcepts || [])].join(" "),
        (item) => (item.variables || []).map((variable) => variable.symbol).join(" ")],
      ["glossary", knowledgeBase && knowledgeBase.glossary, (item) => item.term,
        (item) => [item.abbreviation, item.definition, item.instructorTerminology].filter(Boolean).join(" "),
        (item) => item.abbreviation || ""],
      ["equation", knowledgeBase && knowledgeBase.equations, (item) => item.expression,
        (item) => (item.variables || []).map((variable) => variable.meaning).join(" "),
        (item) => (item.variables || []).map((variable) => variable.symbol).join(" ")],
      ["example", knowledgeBase && knowledgeBase.examples, (item) => item.description, () => "", () => ""],
      ["relationship", knowledgeBase && knowledgeBase.relationships,
        (item) => `${item.from} ${item.relation} ${item.to}`, () => "", () => ""],
      ["explanation", knowledgeBase && knowledgeBase.difficultExplanations,
        (item) => item.explanation, (item) => item.reason || "", () => ""]
    ];

    collections.forEach(([type, items, getTitle, getBody, getKeywords]) => {
      (Array.isArray(items) ? items : []).forEach((item) => {
        const title = getTitle(item);
        const body = getBody(item);
        candidates.push({
          type,
          title,
          text: body || title,
          keywordText: getKeywords(item),
          timestamps: item.timestamps || (Number.isFinite(item.timestamp) ? [item.timestamp] : []),
          evidence: item.evidence || [],
          segmentIndexes: (item.evidence || []).map((evidence) => evidence.segmentIndex)
        });
      });
    });

    const scored = candidates.map((candidate) => {
      const titleTokens = tokenize(`${candidate.title} ${candidate.keywordText || ""}`, true);
      const textTokens = tokenize(candidate.text);
      const titleCounts = new Map();
      const textCounts = new Map();
      titleTokens.forEach((token) => titleCounts.set(token, (titleCounts.get(token) || 0) + 1));
      textTokens.forEach((token) => textCounts.set(token, (textCounts.get(token) || 0) + 1));
      const score = terms.reduce((total, term) =>
        total + (titleCounts.get(term) || 0) * 3 + (textCounts.get(term) || 0), 0);
      return { ...candidate, score };
    }).filter((candidate) => candidate.score > 0);

    scored.sort((left, right) => right.score - left.score ||
      (left.timestamps[0] || 0) - (right.timestamps[0] || 0));
    const resultLimit = Number.isInteger(limit) && limit > 0 ? limit : 8;
    return scored.slice(0, resultLimit);
  }

  const api = { parseTranscript, chunkTranscript, calculateCoverage, searchKnowledgeBase };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.LectureMateTranscript = api;
  }
})();
