const assert = require("node:assert/strict");
const test = require("node:test");
const { parseTimestamp, splitAnswer } = require("../sidepanel/chat-renderer.js");

test("parses minute and hour lecture timestamps", () => {
  assert.equal(parseTimestamp("12:34"), 754);
  assert.equal(parseTimestamp("2:03:04"), 7384);
  assert.equal(parseTimestamp("2:75:04"), null);
});

test("only turns cited timestamps that match supplied lecture evidence into links", () => {
  const parts = splitAnswer(
    "Degree of polymerisation is abbreviated DP [00:17]. Unsupported time [00:30].",
    [17],
    60
  );

  assert.deepEqual(parts, [
    { type: "text", text: "Degree of polymerisation is abbreviated DP " },
    { type: "timestamp", text: "00:17", seconds: 17 },
    { type: "text", text: ". Unsupported time [00:30]." }
  ]);
});

test("does not make links beyond the active video's duration", () => {
  assert.deepEqual(splitAnswer("Later [01:00].", [60], 59), [
    { type: "text", text: "Later [01:00]." }
  ]);
});
