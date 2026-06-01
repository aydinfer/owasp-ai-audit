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
//
// v1.0.0 widens the kind set beyond the LLM core so the completeness layers in
// SKILL.md have anchors: L3 (auth, api-route), L4 (code-exec, sandbox, log-sink,
// external-fetch — the trust-boundary subareas), L7 (log-sink, external-fetch)
// and L8 (read-then-act around llm-call/tool/document) all key off these.

const LLM_FN = new Set(['streamText', 'generateText', 'generateObject', 'streamObject']);
const RAG_FN = new Set(['embed', 'embedMany']);
const TOOL_FN = new Set(['tool']);
const AUTH_FN = new Set([
  'getServerSession', 'getServerAuthSession', 'getSession', 'currentUser',
  'getToken', 'verifyToken', 'auth', 'getAuth', 'requireAuth'
]);
const RATELIMIT_FN = new Set(['rateLimit', 'slowDown']);
const CODEEXEC_FN = new Set(['eval']);
const SANDBOX_FN = new Set(['loadPyodide']);
// Training entrypoints occasionally appear in JS/TS ML tooling (tfjs etc.).
const TRAIN_FN = new Set(['SFTTrainer', 'DPOTrainer', 'Trainer', 'TrainingArguments']);

const LLM_NEW = new Set([
  'OpenAI', 'Anthropic', 'ChatOpenAI', 'ChatAnthropic', 'Mistral',
  'MistralClient', 'CohereClient', 'GoogleGenerativeAI'
]);
const RAG_NEW = new Set([
  'Pinecone', 'PineconeClient', 'Chroma', 'ChromaClient',
  'Weaviate', 'WeaviateClient', 'QdrantClient'
]);
const RATELIMIT_NEW = new Set(['Ratelimit', 'Bottleneck']);
const CODEEXEC_NEW = new Set(['Function']);                       // new Function(...)
const SANDBOX_NEW = new Set(['Worker', 'VM', 'NodeVM', 'Sandbox', 'Daytona', 'Modal']);

const PROMPT_KEYS = new Set(['system', 'prompt', 'systemPrompt']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const LLM_MEMBER = /(?:\.messages\.create|\.chat\.completions\.create|\.responses\.create|\.completions\.create|litellm\.completion)$/;
const RAG_MEMBER = /(?:\.embeddings\.create|\.similaritySearch(?:WithScore)?|\.embedQuery|\.embedDocuments)$/;
const TOOL_MEMBER = /\.(?:registerTool|addTool|tool)$/;
const CODEEXEC_MEMBER = /(?:child_process|cp)\.(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)$|vm\.(?:runInThisContext|runInNewContext|runInContext|compileFunction)$/;
const SANDBOX_MEMBER = /\.(?:createContext|loadPackage|runPython|runPythonAsync)$|Sandbox\.create$/;
const LOG_MEMBER = /(?:^|\.)console\.(?:log|error|warn|info|debug)$|\.(?:captureException|captureMessage)$/;
const AXIOS_MEMBER = /(?:^|\.)axios\.(?:get|post|put|patch|delete|request)$/;
const TRAIN_MEMBER = /\.(?:fit|train)$/;
const ROUTE_METHODS = /^(?:get|post|put|patch|delete|all|route)$/;
const ROUTE_OBJ = /^(?:app|router|server|api|route)$/i;

// Treat only absolute, non-loopback http(s) URLs as external fetches, so
// internal `fetch('/api/...')` calls don't flood the inventory.
function externalUrl(argText) {
  if (!argText) return false;
  const s = String(argText).replace(/^[`'"]/, '');
  return /^https?:\/\//i.test(s) && !/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?:[:/]|$)/i.test(s);
}

const CALL_IDENT = '(call_expression function: (identifier) @name) @surface';
const CALL_MEMBER = '(call_expression function: (member_expression) @name) @surface';
const CALL_IDENT_ARG = '(call_expression function: (identifier) @name arguments: (arguments . [(string) (template_string)] @arg)) @surface';
const CALL_MEMBER_ARG = '(call_expression function: (member_expression) @name arguments: (arguments . [(string) (template_string)] @arg)) @surface';
const CALL_MEMBER_OBJ = '(call_expression function: (member_expression object: (identifier) @obj property: (property_identifier) @name)) @surface';
const NEW_EXPR = '(new_expression constructor: (identifier) @name) @surface';
const PROMPT_PAIR = '(pair key: (property_identifier) @name value: (template_string (template_substitution))) @surface';
const FN_DECL = '(function_declaration name: (identifier) @name) @surface';
const ARROW_DECL = '(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @surface';

module.exports = [
  { kind: 'llm-call',            query: CALL_IDENT,  test: (c) => LLM_FN.has(c.name) },
  { kind: 'rag-embeddings',      query: CALL_IDENT,  test: (c) => RAG_FN.has(c.name) },
  { kind: 'tool-definition',     query: CALL_IDENT,  test: (c) => TOOL_FN.has(c.name) },
  { kind: 'auth',                query: CALL_IDENT,  test: (c) => AUTH_FN.has(c.name) },
  { kind: 'rate-limit',          query: CALL_IDENT,  test: (c) => RATELIMIT_FN.has(c.name) },
  { kind: 'code-exec',           query: CALL_IDENT,  test: (c) => CODEEXEC_FN.has(c.name) },
  { kind: 'sandbox',             query: CALL_IDENT,  test: (c) => SANDBOX_FN.has(c.name) },
  { kind: 'training',            query: CALL_IDENT,  test: (c) => TRAIN_FN.has(c.name) },

  { kind: 'llm-call',            query: CALL_MEMBER, test: (c) => LLM_MEMBER.test(c.name) },
  { kind: 'rag-embeddings',      query: CALL_MEMBER, test: (c) => RAG_MEMBER.test(c.name) },
  { kind: 'tool-definition',     query: CALL_MEMBER, test: (c) => TOOL_MEMBER.test(c.name) },
  { kind: 'code-exec',           query: CALL_MEMBER, test: (c) => CODEEXEC_MEMBER.test(c.name) },
  { kind: 'sandbox',             query: CALL_MEMBER, test: (c) => SANDBOX_MEMBER.test(c.name) },
  { kind: 'log-sink',            query: CALL_MEMBER, test: (c) => LOG_MEMBER.test(c.name) },
  { kind: 'training',            query: CALL_MEMBER, test: (c) => TRAIN_MEMBER.test(c.name) },

  { kind: 'llm-call',            query: NEW_EXPR,    test: (c) => LLM_NEW.has(c.name) },
  { kind: 'rag-embeddings',      query: NEW_EXPR,    test: (c) => RAG_NEW.has(c.name) },
  { kind: 'rate-limit',          query: NEW_EXPR,    test: (c) => RATELIMIT_NEW.has(c.name) },
  { kind: 'code-exec',           query: NEW_EXPR,    test: (c) => CODEEXEC_NEW.has(c.name) },
  { kind: 'sandbox',             query: NEW_EXPR,    test: (c) => SANDBOX_NEW.has(c.name) },

  // External network egress — only literal absolute non-loopback URLs.
  { kind: 'external-fetch',      query: CALL_IDENT_ARG,  test: (c) => c.name === 'fetch' && externalUrl(c.arg) },
  { kind: 'external-fetch',      query: CALL_MEMBER_ARG, test: (c) => AXIOS_MEMBER.test(c.name) && externalUrl(c.arg) },

  // HTTP route handlers. Next.js App Router exports a function named after the
  // verb (GET/POST/…); Express/Hono call app.get(...)/router.post(...).
  { kind: 'api-route',           query: FN_DECL,         test: (c) => HTTP_METHODS.has(c.name) },
  { kind: 'api-route',           query: ARROW_DECL,      test: (c) => HTTP_METHODS.has(c.name) },
  { kind: 'api-route',           query: CALL_MEMBER_OBJ, test: (c) => ROUTE_METHODS.test(c.name) && ROUTE_OBJ.test(c.obj) },

  { kind: 'prompt-construction', query: PROMPT_PAIR, test: (c) => PROMPT_KEYS.has(c.name) },
];
