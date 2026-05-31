import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

// LLM call site + prompt construction that splices untrusted input into both
// the system and user prompt with no isolation.
export async function chat(userInput: string, history: string) {
  return streamText({
    model: openai('gpt-4o'),
    system: `You are a support agent. Conversation so far: ${history}`,
    prompt: `The user says: ${userInput}`,
  });
}
