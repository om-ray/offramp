import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TELLS: [string, RegExp][] = [
  ["dash", /[\u2013\u2014]/],
  ["emoji", /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
  ["negative parallelism", /\b(it'?s|that'?s|this is|isn'?t|is) not (just |simply |only )?[^.\n]{0,60}[.,;] ?(it'?s|that'?s|it is)\b|\bnot just\b|\bnot simply\b|\bnot only\b[^.\n]*\bbut\b/i],
  ["gpt vocabulary", /\b(delve|tapestry|realm|intricate|crucial|pivotal|embark|navigat(e|es|ing)|vibrant|landscape|comprehensive|deep dive|holistic|in the age of|in today'?s world)\b/i],
  ["hype", /\b(supercharg\w*|seamless\w*|unlock\w*|robust|elevat\w*|game-?chang\w*|powerful|effortless\w*|intuitive|built for (creators|founders|builders))\b/i],
  ["throat clearing", /here'?s the thing|let me be clear|the truth is|the reality is|nobody (tells|is going to tell)|no one is talking about|most people don'?t realize/i],
  ["chat residue", /certainly!|great question|absolutely!|hope this helps|would you like me to|you'?re absolutely right/i],
  ["stock opener", /fast-paced world|let'?s dive in|let'?s explore|let'?s break it down/i],
  ["inflated significance", /\btestament\b|pivotal role|pivotal moment/i],
  ["telling it matters", /\bthis matters\b|\bthat matters\b|\bstill matters\b|important to note|\bit lands\b/i],
  ["quietly", /\bquietly\b/i],
  ["summary closer", /\bin short\b|at the end of the day|in conclusion|to sum up/i],
  ["corporate verbs", /\b(foster\w*|leverag\w*|multifaceted|underscor\w*|spearhead\w*|synerg\w*|impactful|results-driven)\b/i],
  ["serves as", /\bserves as\b|\bstands as\b|\bboasts\b/i],
  ["crowd talk", /\bmost people\b/i],
  ["fake urgency", /before monday|this weekend|before it'?s too late/i],
  ["startup jargon", /\b(wedge|moat|load-bearing|orthogonal)\b/i],
  ["placeholders", /\[(your|company) [^\]]*\]|\{\{|oaicite|utm_source=chatgpt/i],
  ["ai attribution", /co-authored-by: claude|generated with \[?claude/i],
];

const COMMENT = /\/\*|(^|[^:\\])\/\//;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

const source = ["app", "lib", "edge"].flatMap(files).filter((f) => /\.(tsx?|jsx?|mjs|css)$/.test(f));

test("copy and code have no AI tells", () => {
  const hits = [...source, "README.md"].flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((line, i) => TELLS.filter(([, re]) => re.test(line)).map(([name]) => `${f}:${i + 1} ${name}: ${line.trim()}`)),
  );
  assert.deepEqual(hits, []);
});

test("source has no comments", () => {
  const hits = source.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((line, i) => (COMMENT.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])),
  );
  assert.deepEqual(hits, []);
});
