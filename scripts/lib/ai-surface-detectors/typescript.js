// AI-surface detectors for TypeScript / TSX / JavaScript.
// (tree-sitter-typescript, tree-sitter-tsx and tree-sitter-javascript share
// the node names these queries use, so all four extensions reuse this set.)
//
// A detector is a { kind, query, test } tuple: `query` is a tree-sitter
// S-expression that captures the surface node (@surface) and a discriminating
// node (@name etc.); `test(caps)` receives the captured texts and decides
// whether the match is really an AI surface. The discrimination runs on AST
// nodes — never on raw lines — so strings, comments and look-alike identifiers
// (Vitest's `test()`, readline's `prompt`) don't false-positive.

const LLM_FN = new Set(['streamText', 'generateText', 'generateObject', 'streamObject']);
const RAG_FN = new Set(['embed', 'embedMany']);
const TOOL_FN = new Set(['tool']);
const AUTH_FN = new Set([
  'getServerSession', 'getServerAuthSession', 'getSession', 'currentUser',
  'getToken', 'verifyToken', 'auth', 'getAuth'
]);
const RATELIMIT_FN = new Set(['rateLimit', 'slowDown']);

const LLM_NEW = new Set([
  'OpenAI', 'Anthropic', 'ChatOpenAI', 'ChatAnthropic', 'Mistral',
  'MistralClient', 'CohereClient', 'GoogleGenerativeAI'
]);
const RAG_NEW = new Set([
  'Pinecone', 'PineconeClient', 'Chroma', 'ChromaClient',
  'Weaviate', 'WeaviateClient', 'QdrantClient'
]);
const RATELIMIT_NEW = new Set(['Ratelimit', 'Bottleneck']);

const PROMPT_KEYS = new Set(['system', 'prompt', 'systemPrompt']);

const LLM_MEMBER = /(?:\.messages\.create|\.chat\.completions\.create|\.responses\.create|\.completions\.create|litellm\.completion)$/;
const RAG_MEMBER = /(?:\.embeddings\.create|\.similaritySearch(?:WithScore)?|\.embedQuery|\.embedDocuments)$/;
const TOOL_MEMBER = /\.(?:registerTool|addTool|tool)$/;

const CALL_IDENT = '(call_expression function: (identifier) @name) @surface';
const CALL_MEMBER = '(call_expression function: (member_expression) @name) @surface';
const NEW_EXPR = '(new_expression constructor: (identifier) @name) @surface';
const PROMPT_PAIR = '(pair key: (property_identifier) @name value: (template_string (template_substitution))) @surface';

module.exports = [
  { kind: 'llm-call',           query: CALL_IDENT,  test: (c) => LLM_FN.has(c.name) },
  { kind: 'rag-embeddings',     query: CALL_IDENT,  test: (c) => RAG_FN.has(c.name) },
  { kind: 'tool-definition',    query: CALL_IDENT,  test: (c) => TOOL_FN.has(c.name) },
  { kind: 'auth',               query: CALL_IDENT,  test: (c) => AUTH_FN.has(c.name) },
  { kind: 'rate-limit',         query: CALL_IDENT,  test: (c) => RATELIMIT_FN.has(c.name) },

  { kind: 'llm-call',           query: CALL_MEMBER, test: (c) => LLM_MEMBER.test(c.name) },
  { kind: 'rag-embeddings',     query: CALL_MEMBER, test: (c) => RAG_MEMBER.test(c.name) },
  { kind: 'tool-definition',    query: CALL_MEMBER, test: (c) => TOOL_MEMBER.test(c.name) },

  { kind: 'llm-call',           query: NEW_EXPR,    test: (c) => LLM_NEW.has(c.name) },
  { kind: 'rag-embeddings',     query: NEW_EXPR,    test: (c) => RAG_NEW.has(c.name) },
  { kind: 'rate-limit',         query: NEW_EXPR,    test: (c) => RATELIMIT_NEW.has(c.name) },

  { kind: 'prompt-construction', query: PROMPT_PAIR, test: (c) => PROMPT_KEYS.has(c.name) },
];
