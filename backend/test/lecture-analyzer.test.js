const assert = require("node:assert/strict");
const test = require("node:test");
const { createLectureAnalyzer, splitTranscriptIntoChunks } = require("../src/services/lecture-analyzer");

const transcript = [
  {
    start: 0,
    end: 5,
    text: "Today we compare addition polymerisation and condensation polymerisation."
  },
  {
    start: 5,
    end: 11,
    text: "Addition polymerisation joins monomers with carbon-carbon double bonds and produces no small molecule by-product."
  },
  {
    start: 11,
    end: 17,
    text: "Condensation polymerisation joins monomers with two functional groups and releases a small molecule such as water."
  },
  {
    start: 17,
    end: 23,
    text: "The degree of polymerisation, or DP, is the average number of repeat units in a polymer chain."
  },
  {
    start: 23,
    end: 28,
    text: "For example, polyethylene forms by addition polymerisation of ethene."
  },
  {
    start: 28,
    end: 34,
    text: "Do not confuse degree of polymerisation with molecular weight; chain length and repeat-unit mass both affect molecular weight."
  }
];

function evidenceFor(segment) {
  return [{ segmentIndex: segment.segmentIndex, quote: segment.text }];
}

function extractionFor(chunk) {
  const result = {
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

  chunk.segments.forEach((segment) => {
    const text = segment.text;
    const evidence = evidenceFor(segment);
    if (!result.summary) {
      result.summary = text;
      result.summaryEvidence = evidence;
    }
    if (text.startsWith("Today we compare")) {
      result.topics.push({
        topic: "Polymerisation mechanisms",
        subtopics: ["Addition polymerisation", "Condensation polymerisation"],
        attribution: "instructor",
        evidence
      });
    }
    if (text.startsWith("Addition polymerisation joins")) {
      result.concepts.push({
        concept: "Addition polymerisation",
        explanation: "Joins monomers with carbon-carbon double bonds and produces no small molecule by-product.",
        prerequisites: [],
        relatedConcepts: ["Condensation polymerisation"],
        variables: [{ symbol: "M", meaning: "molecular weight", attribution: "instructor" }],
        attribution: "instructor",
        evidence
      });
      result.equations.push({
        expression: "DP = M / M0",
        variables: [{ symbol: "M", meaning: "molecular weight", attribution: "instructor" }],
        attribution: "instructor",
        evidence
      });
    }
    if (text.startsWith("Condensation polymerisation joins")) {
      result.concepts.push({
        concept: "Condensation polymerisation",
        explanation: "Joins monomers with two functional groups and releases a small molecule such as water.",
        prerequisites: [],
        relatedConcepts: ["Addition polymerisation"],
        variables: [],
        attribution: "instructor",
        evidence
      });
    }
    if (text.startsWith("The degree of polymerisation")) {
      result.concepts.push({
        concept: "Degree of polymerisation",
        explanation: "The average number of repeat units in a polymer chain.",
        prerequisites: [],
        relatedConcepts: [],
        variables: [],
        attribution: "instructor",
        evidence
      });
      result.glossary.push({
        term: "Degree of polymerisation",
        abbreviation: "DP",
        definition: "the average number of repeat units in a polymer chain",
        instructorTerminology: "degree of polymerisation",
        attribution: "instructor",
        evidence
      });
    }
    if (text.startsWith("For example")) {
      result.examples.push({
        description: "Polyethylene forms by addition polymerisation of ethene.",
        attribution: "instructor",
        evidence
      });
    }
    if (text.startsWith("Do not confuse")) {
      result.relationships.push({
        from: "Degree of polymerisation",
        relation: "is distinct from and contributes to",
        to: "Molecular weight",
        attribution: "instructor",
        evidence
      });
      result.difficultExplanations.push({
        explanation: "Degree of polymerisation and molecular weight should not be confused.",
        reason: "Chain length and repeat-unit mass both affect molecular weight.",
        attribution: "instructor",
        evidence
      });
    }
  });
  return result;
}

test("overlapping long-transcript analysis preserves context and filters unsupported equations", async () => {
  const chunks = splitTranscriptIntoChunks(transcript, { maxChars: 160, overlapChars: 45 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.some((chunk, index) => index > 0 &&
    chunk.segments[0].segmentIndex === chunks[index - 1].segments.at(-1).segmentIndex));

  const calls = [];
  const analyzer = createLectureAnalyzer({
    async extractTranscriptChunk(input) {
      calls.push(input);
      return extractionFor(input.chunk);
    }
  }, { maxChars: 160, overlapChars: 45 });

  const result = await analyzer.analyzeLecture({
    videoContext: {
      videoId: "abcdefghijk",
      title: "Synthetic polymer chemistry lesson",
      duration: 40
    },
    lessonMetadata: { title: "Synthetic polymer chemistry lesson", source: "Synthetic transcript" },
    transcriptCompleteness: { status: "partial", coveragePercentage: 85 },
    transcript
  });

  assert.equal(calls.length, chunks.length);
  assert.ok(calls.slice(1).some((call) =>
    call.previousContext.concepts.includes("Addition polymerisation")));
  assert.equal(result.transcriptCompleteness.status, "partial");
  assert.equal(result.transcriptCompleteness.analyzedChunks, chunks.length);
  assert.match(result.transcriptCompleteness.note, /limited to the supplied transcript/);
  assert.equal(result.equations.length, 0);

  const expectedConcepts = [
    "Addition polymerisation",
    "Condensation polymerisation",
    "Degree of polymerisation"
  ];
  const extractedConcepts = result.concepts.map((item) => item.concept);
  const conceptMatches = expectedConcepts.filter((concept) => extractedConcepts.includes(concept)).length;
  assert.equal(conceptMatches, 3);
  assert.equal(conceptMatches / extractedConcepts.length, 1);
  assert.equal(conceptMatches / expectedConcepts.length, 1);
  assert.ok(result.concepts.every((item) => item.variables.length === 0));

  const expectedGlossaryTerms = ["Degree of polymerisation"];
  const extractedGlossaryTerms = result.glossary.map((item) => item.term);
  const glossaryMatches = expectedGlossaryTerms.filter((term) => extractedGlossaryTerms.includes(term)).length;
  assert.equal(glossaryMatches, 1);
  assert.equal(glossaryMatches / extractedGlossaryTerms.length, 1);
  assert.equal(glossaryMatches / expectedGlossaryTerms.length, 1);
  assert.deepEqual(result.glossary.map((item) => ({
    term: item.term,
    abbreviation: item.abbreviation,
    definition: item.definition,
    instructorTerminology: item.instructorTerminology,
    timestamp: item.timestamp
  })), [{
    term: "Degree of polymerisation",
    abbreviation: "DP",
    definition: "the average number of repeat units in a polymer chain",
    instructorTerminology: "degree of polymerisation",
    timestamp: 17
  }]);

  const evidenceSegments = new Map(transcript.map((segment, index) => [index, segment]));
  [...result.concepts, ...result.glossary, ...result.examples].forEach((item) => {
    assert.ok(item.evidence.length > 0);
    item.evidence.forEach((evidence) => {
      assert.ok(evidenceSegments.get(evidence.segmentIndex).text.includes(evidence.quote));
      assert.equal(evidence.timestamp, evidenceSegments.get(evidence.segmentIndex).start);
    });
  });
  assert.ok(result.examples.some((item) => /polyethylene/i.test(item.description)));
  assert.ok(result.relationships.some((item) => item.from === "Degree of polymerisation"));
  assert.ok(result.difficultExplanations.length > 0);
});
