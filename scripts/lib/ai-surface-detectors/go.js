// AI-surface detectors for Go (tree-sitter-go).
// Go LLM SDKs expose method calls like client.CreateChatCompletion(...) and
// constructors like openai.NewClient(...). We match the selector's field name
// (and, for the generic NewClient, also require a known SDK package operand).

const LLM_FIELD = new Set([
  'CreateChatCompletion', 'CreateChatCompletionStream', 'CreateCompletion',
  'CreateMessage', 'CreateMessages'
]);
const RAG_FIELD = new Set(['CreateEmbeddings', 'CreateEmbedding']);
const SDK_PKGS = new Set(['openai', 'anthropic', 'cohere', 'genai', 'ollama']);

// call to selector: c.Field(...)  — captures operand + field
const CALL_SELECTOR = '(call_expression function: (selector_expression operand: (identifier) @pkg field: (field_identifier) @name)) @surface';

module.exports = [
  { kind: 'llm-call',       query: CALL_SELECTOR, test: (c) => LLM_FIELD.has(c.name) },
  { kind: 'rag-embeddings', query: CALL_SELECTOR, test: (c) => RAG_FIELD.has(c.name) },
  // generic constructor, only when the package is a known LLM SDK
  { kind: 'llm-call',       query: CALL_SELECTOR, test: (c) => c.name === 'NewClient' && SDK_PKGS.has(c.pkg) },
];
