const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { calculateCoverage, chunkTranscript, parseTranscript } = require("../sidepanel/transcript-engine.js");

const fixturesPath = path.join(__dirname, "fixtures");
const readFixture = (name) => fs.readFileSync(path.join(fixturesPath, name), "utf8");

test("parses timestamped WebVTT cues into ordered segment records", () => {
  const result = parseTranscript(readFixture("lecture.vtt"), "vtt");

  assert.deepEqual(result.segments[0], {
    start: 0,
    end: 2,
    text: "Welcome to this lesson."
  });
  assert.equal(result.segments.length, 3);
  assert.equal(result.segments[2].end, 7);
  assert.equal(result.rejected, 0);
});

test("parses SubRip comma timestamps and cue indexes", () => {
  const result = parseTranscript(readFixture("lecture.srt"), "srt");

  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].start, 0);
  assert.equal(result.segments[1].end, 5);
  assert.equal(result.segments[1].text, "Here is the second example.");
});

test("returns no segments for an empty transcript and rejects malformed cues", () => {
  const empty = parseTranscript("", "vtt");
  const malformed = parseTranscript(
    "WEBVTT\n\n00:90:02.000 --> 00:00:01.000\nInvalid cue.\n\n01:00.000 --> 00:02.000\nBad range.",
    "vtt"
  );

  assert.equal(empty.segments.length, 0);
  assert.equal(malformed.segments.length, 0);
  assert.equal(malformed.rejected, 2);
});

test("removes exact duplicates and sorts out-of-order subtitle cues", () => {
  const input = [
    "00:00:04.000 --> 00:00:06.000\nLater sentence.",
    "00:00:00.000 --> 00:00:02.000\nFirst sentence.",
    "00:00:04.000 --> 00:00:06.000\nLater sentence."
  ].join("\n\n");
  const result = parseTranscript(input, "vtt");

  assert.deepEqual(result.segments.map((segment) => segment.start), [0, 4]);
  assert.equal(result.duplicates, 1);
});

test("chunks large transcripts with overlap and original timestamp mappings", () => {
  const segments = Array.from({ length: 1000 }, (_, index) => ({
    start: index * 2,
    end: index * 2 + 1,
    text: `Sentence number ${index} has enough words to fill a useful chunk.`
  }));
  const chunks = chunkTranscript(segments, { maxChars: 500, overlapChars: 80 });
  const mappedIndexes = new Set(chunks.flatMap((chunk) => chunk.segments.map((segment) => segment.index)));

  assert.ok(chunks.length > 1);
  assert.equal(mappedIndexes.size, segments.length);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks[chunks.length - 1].end, segments[segments.length - 1].end);
  assert.ok(chunks.every((chunk) => chunk.segments.every((segment) =>
    segment.start === segments[segment.index].start &&
    segment.end === segments[segment.index].end &&
    segment.text === segments[segment.index].text
  )));
  assert.ok(chunks.slice(0, -1).every((chunk) =>
    /[.!?]["'’”)\]]*$/.test(chunk.segments[chunk.segments.length - 1].text)
  ));
  assert.ok(chunks.some((chunk, index) => index > 0 &&
    chunk.segments[0].index < chunks[index - 1].segments[chunks[index - 1].segments.length - 1].index));
});

test("reports full coverage only when the transcript spans the known duration", () => {
  const completeSegments = [
    { start: 0, end: 5, text: "First half." },
    { start: 5, end: 10, text: "Second half." }
  ];
  const partialSegments = parseTranscript(readFixture("partial.vtt"), "vtt").segments;
  const internalGap = calculateCoverage([
    { start: 0, end: 4, text: "Opening." },
    { start: 6, end: 10, text: "Ending." }
  ], 10);
  const outOfRange = calculateCoverage([
    { start: 0, end: 100, text: "Timestamp range exceeds the actual lecture." }
  ], 10);
  const invalidRange = calculateCoverage([
    { start: -2, end: 10, text: "Negative start must not count as complete coverage." }
  ], 10);
  const full = calculateCoverage(completeSegments, 10);
  const partial = calculateCoverage(partialSegments, 20);
  const unknown = calculateCoverage(completeSegments, null);

  assert.equal(full.percentage, 100);
  assert.equal(full.complete, true);
  assert.equal(internalGap.percentage, 80);
  assert.equal(internalGap.complete, false);
  assert.equal(outOfRange.percentage, 100);
  assert.equal(outOfRange.complete, false);
  assert.equal(invalidRange.percentage, 0);
  assert.equal(invalidRange.complete, false);
  assert.equal(partial.percentage, 20);
  assert.equal(partial.complete, false);
  assert.equal(unknown.percentage, null);
  assert.equal(unknown.complete, false);
});
