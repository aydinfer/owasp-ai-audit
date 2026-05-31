import { test, expect } from 'vitest';
import * as readline from 'node:readline/promises';

// DECOY: this file deliberately uses `test`/`tool`-adjacent words and a CLI
// `prompt` that must NOT be mistaken for AI surfaces by the static detectors.
// `test(` is Vitest, not `tool(`. The CLI prompt is a readline question, not a
// `prompt:` argument to an LLM. The word "tool" only appears in this comment.
test('reads a line from the command-line prompt', async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('your name> ');
  rl.close();
  expect(answer).toBeDefined();
});
