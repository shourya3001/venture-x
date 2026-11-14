function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function splitTranscriptIntoChunks(transcript, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars > 0
    ? options.maxChars
    : 12000;
  const overlapChars = Number.isInteger(options.overlapChars) && options.overlapChars >= 0
    ? options.overlapChars
    : 500;
  const chunks = [];
  let startIndex = 0;

  while (startIndex < transcript.length) {
    let endIndex = startIndex;
    let charCount = 0;
    while (endIndex < transcript.length &&
        (endIndex === startIndex || charCount < maxChars)) {
      charCount += transcript[endIndex].text.length + 1;
      endIndex += 1;
    }

    chunks.push({
      index: chunks.length,
      segments: transcript.slice(startIndex, endIndex).map((segment, offset) => ({
        segmentIndex: startIndex + offset,
        start: segment.start,
        end: segment.end,
        text: segment.text
      }))
    });

    if (endIndex >= transcript.length) {
      break;
    }

    let nextIndex = endIndex;
    let overlapLength = 0;
    while (nextIndex > startIndex + 1 && overlapLength < overlapChars) {
      nextIndex -= 1;
      overlapLength += transcript[nextIndex].text.length + 1;
    }
    startIndex = Math.max(startIndex + 1, nextIndex);
  }

  return chunks;
}

function normalizeEvidence(items, transcriptByIndex) {
  if (!Array.isArray(items)) {
    return [];
  }
  const seen = new Set();
  return items.reduce((evidence, item) => {
    if (!item || !Number.isInteger(item.segmentIndex) ||
        typeof item.quote !== "string" || !item.quote.trim()) {
      return evidence;
    }
    const segment = transcriptByIndex.get(item.segmentIndex);
    const quote = item.quote.trim();
    if (!segment || !segment.text.includes(quote)) {
      return evidence;
    }
    const key = `${item.segmentIndex}\u0000${quote}`;
    if (seen.has(key)) {
      return evidence;
    }
    seen.add(key);
    evidence.push({
      segmentIndex: item.segmentIndex,
      quote,
      timestamp: segment.start
    });
    return evidence;
  }, []);
}

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))].slice(0, 20);
}

function normalizeAttribution(value) {
  return value === "instructor" ? "instructor" : "inference";
}

function normalizeItem(item, transcriptByIndex, fields) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const evidence = normalizeEvidence(item.evidence, transcriptByIndex);
  if (evidence.length === 0) {
    return null;
  }
  const normalized = { evidence, attribution: normalizeAttribution(item.attribution) };
  fields.forEach((field) => {
    if (field.type === "list") {
      normalized[field.name] = normalizeList(item[field.name]);
    } else if (field.type === "variables") {
      normalized.variables = Array.isArray(item.variables)
        ? item.variables.slice(0, 20).reduce((variables, variable) => {
          if (variable && typeof variable.symbol === "string" && variable.symbol.trim() &&
              evidence.some((entry) => entry.quote.includes(variable.symbol.trim()))) {
            const meaning = normalizeText(variable.meaning).slice(0, 300);
            const meaningIsQuoted = meaning && evidence.some((entry) =>
              entry.quote.toLocaleLowerCase().includes(meaning.toLocaleLowerCase()));
            variables.push({
              symbol: variable.symbol.trim().slice(0, 80),
              meaning: meaningIsQuoted ? meaning : "",
              attribution: meaningIsQuoted ? normalizeAttribution(variable.attribution) : "inference"
            });
          }
          return variables;
        }, [])
        : [];
    } else {
      const value = normalizeText(item[field.name]);
      if (value) {
        normalized[field.name] = value.slice(0, field.maxLength || 1000);
      }
    }
  });
  if (fields.some((field) => field.required && !normalized[field.name])) {
    return null;
  }
  if (normalized.term) {
    const quotes = evidence.map((entry) => entry.quote.toLocaleLowerCase());
    if (!quotes.some((quote) => quote.includes(normalized.term.toLocaleLowerCase()))) {
      return null;
    }
    ["abbreviation", "instructorTerminology"].forEach((field) => {
      if (normalized[field] &&
          !quotes.some((quote) => quote.includes(normalized[field].toLocaleLowerCase()))) {
        normalized[field] = "";
      }
    });
  }
  normalized.timestamps = [...new Set(evidence.map((entry) => entry.timestamp))].sort((a, b) => a - b);
  if (normalized.term) {
    normalized.timestamp = normalized.timestamps[0];
  }
  return normalized;
}

const itemSchemas = {
  topics: [
    { name: "topic", required: true, maxLength: 200 },
    { name: "subtopics", type: "list" }
  ],
  concepts: [
    { name: "concept", required: true, maxLength: 200 },
    { name: "explanation", required: true, maxLength: 2000 },
    { name: "prerequisites", type: "list" },
    { name: "relatedConcepts", type: "list" },
    { name: "variables", type: "variables" }
  ],
  glossary: [
    { name: "term", required: true, maxLength: 200 },
    { name: "abbreviation", maxLength: 80 },
    { name: "definition", required: true, maxLength: 1000 },
    { name: "instructorTerminology", maxLength: 300 }
  ],
  equations: [
    { name: "expression", required: true, maxLength: 300 },
    { name: "variables", type: "variables" }
  ],
  examples: [
    { name: "description", required: true, maxLength: 1000 }
  ],
  relationships: [
    { name: "from", required: true, maxLength: 200 },
    { name: "relation", required: true, maxLength: 300 },
    { name: "to", required: true, maxLength: 200 }
  ],
  difficultExplanations: [
    { name: "explanation", required: true, maxLength: 1000 },
    { name: "reason", maxLength: 500 }
  ]
};

function normalizePartial(result, transcriptByIndex) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { summary: "", summaryEvidence: [], collections: {} };
  }
  const summaryEvidence = normalizeEvidence(result.summaryEvidence, transcriptByIndex);
  return {
    summary: summaryEvidence.length > 0 ? normalizeText(result.summary).slice(0, 3000) : "",
    summaryEvidence,
    collections: Object.fromEntries(Object.entries(itemSchemas).map(([name, schema]) => {
      const items = Array.isArray(result[name])
        ? result[name].map((item) => normalizeItem(item, transcriptByIndex, schema)).filter(Boolean)
        : [];
      if (name === "equations") {
        return [name, items.filter((item) =>
          item.evidence.some((entry) => entry.quote.toLocaleLowerCase()
            .includes(item.expression.toLocaleLowerCase())))];
      }
      if (name === "glossary") {
        return [name, items.filter((item) => item.evidence.some((entry) =>
          entry.quote.toLocaleLowerCase().includes(item.definition.toLocaleLowerCase())))];
      }
      return [name, items];
    }))
  };
}

function mergeEvidence(target, incoming) {
  const existing = new Set(target.map((item) => `${item.segmentIndex}\u0000${item.quote}`));
  incoming.forEach((item) => {
    const key = `${item.segmentIndex}\u0000${item.quote}`;
    if (!existing.has(key)) {
      existing.add(key);
      target.push(item);
    }
  });
  target.sort((left, right) => left.timestamp - right.timestamp);
}

function mergeValues(target, incoming) {
  const result = [...target];
  incoming.forEach((value) => {
    if (!result.some((existing) => existing.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      result.push(value);
    }
  });
  return result;
}

function mergeItems(collection, items, keyFields) {
  const byKey = new Map(collection.map((item) => [
    keyFields.map((field) => item[field].toLocaleLowerCase()).join("\u0000"),
    item
  ]));
  items.forEach((item) => {
    const key = keyFields.map((field) => item[field].toLocaleLowerCase()).join("\u0000");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      collection.push(item);
      return;
    }
    mergeEvidence(existing.evidence, item.evidence);
    existing.timestamps = [...new Set(existing.evidence.map((entry) => entry.timestamp))].sort((a, b) => a - b);
    ["subtopics", "prerequisites", "relatedConcepts"].forEach((field) => {
      if (existing[field]) {
        existing[field] = mergeValues(existing[field], item[field] || []);
      }
    });
  });
}

function buildPreviousContext(analysis) {
  const concepts = analysis.concepts.slice(-20).map((item) => item.concept);
  const terms = analysis.glossary.slice(-20).map((item) => item.term);
  const topics = analysis.topics.slice(-10).map((item) => item.topic);
  return { concepts, terms, topics };
}

function createLectureAnalyzer(llmProvider, options = {}) {
  async function analyzeLecture(input) {
    const chunks = splitTranscriptIntoChunks(input.transcript, options);
    const transcriptByIndex = new Map(input.transcript.map((segment, index) => [index, segment]));
    const analysis = {
      summary: "",
      summaryEvidence: [],
      topics: [],
      concepts: [],
      glossary: [],
      equations: [],
      examples: [],
      relationships: [],
      difficultExplanations: []
    };
    const summaries = new Set();

    for (const chunk of chunks) {
      const result = await llmProvider.extractTranscriptChunk({
        videoTitle: input.lessonMetadata.title || input.videoContext.title,
        videoId: input.videoContext.videoId,
        duration: input.videoContext.duration,
        transcriptCompleteness: input.transcriptCompleteness,
        chunk: {
          index: chunk.index,
          total: chunks.length,
          segments: chunk.segments
        },
        previousContext: buildPreviousContext(analysis)
      });
      const partial = normalizePartial(result, transcriptByIndex);
      if (partial.summary) {
        partial.summary.split(/(?<=[.!?])\s+/).forEach((sentence) => {
          const normalized = sentence.toLocaleLowerCase();
          if (!summaries.has(normalized)) {
            summaries.add(normalized);
            analysis.summary = [analysis.summary, sentence].filter(Boolean).join(" ");
          }
        });
        mergeEvidence(analysis.summaryEvidence, partial.summaryEvidence);
      }
      Object.entries(itemSchemas).forEach(([name, schema]) => {
        const keyFields = name === "relationships"
          ? ["from", "relation", "to"]
          : [schema[0].name];
        mergeItems(analysis[name], partial.collections[name], keyFields);
      });
    }

    return {
      version: 1,
      videoId: input.videoContext.videoId,
      videoTitle: input.lessonMetadata.title || input.videoContext.title,
      ...analysis,
      summary: analysis.summary.slice(0, 6000),
      transcriptCompleteness: {
        status: input.transcriptCompleteness.status,
        coveragePercentage: input.transcriptCompleteness.coveragePercentage,
        duration: input.videoContext.duration,
        analyzedChunks: chunks.length,
        totalChunks: chunks.length,
        note: input.transcriptCompleteness.status === "complete"
          ? "Analysis is based on the transcript marked complete by the caller."
          : "Analysis is limited to the supplied transcript; missing lecture portions are not represented."
      }
    };
  }

  return { analyzeLecture };
}

module.exports = {
  createLectureAnalyzer,
  splitTranscriptIntoChunks
};
