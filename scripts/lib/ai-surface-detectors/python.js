// AI-surface detectors for Python (tree-sitter-python).
// Same (query, kind, test) shape as the TypeScript set. Discrimination runs on
// AST nodes, so `input("prompt> ")`, `print`, and `@pytest.fixture` don't fire.

const LLM_FN = new Set(['OpenAI', 'AsyncOpenAI', 'Anthropic', 'AsyncAnthropic', 'AzureOpenAI']);
const RAG_FN = new Set(['Pinecone', 'Chroma', 'QdrantClient', 'Weaviate', 'WeaviateClient']);
const AUTH_FN = new Set(['get_current_user', 'verify_token', 'get_user', 'authenticate', 'get_jwt_identity']);
const RATELIMIT_FN = new Set(['Limiter', 'RateLimiter']);
const TOOL_FN = new Set(['Tool', 'StructuredTool', 'FunctionTool']);

const PROMPT_KW = new Set(['system', 'prompt', 'system_prompt']);
const TOOL_DECORATORS = new Set(['tool']);
const AUTH_DECORATORS = new Set(['login_required', 'requires_auth', 'authenticated', 'jwt_required']);

const LLM_MEMBER = /(?:\.chat\.completions\.create|\.messages\.create|\.completions\.create|\.responses\.create|litellm\.completion|\.generate_content)$/;
const RAG_MEMBER = /(?:\.embeddings\.create|\.embed_query|\.embed_documents|\.similarity_search|\.create_collection)$/;
const RATELIMIT_MEMBER = /\.(?:limit|shared_limit)$/;

const CALL_IDENT = '(call function: (identifier) @name) @surface';
const CALL_ATTR = '(call function: (attribute) @name) @surface';
// f-string assigned to a name (right-hand `string` carries an `interpolation`)
const ASSIGN_FSTRING = '(assignment left: (identifier) @name right: (string (interpolation))) @surface';
// keyword argument whose value is an f-string, e.g. system=f"..."
const KW_FSTRING = '(keyword_argument name: (identifier) @name value: (string (interpolation))) @surface';
const DECORATOR_IDENT = '(decorator (identifier) @name) @surface';
const DECORATOR_ATTR = '(decorator [(attribute attribute: (identifier) @name) (call function: (attribute attribute: (identifier) @name))]) @surface';

const PROMPTISH = /(?:^|_)(?:prompt|system|instruction|template)s?$/i;

module.exports = [
  { kind: 'llm-call',        query: CALL_IDENT, test: (c) => LLM_FN.has(c.name) },
  { kind: 'rag-embeddings',  query: CALL_IDENT, test: (c) => RAG_FN.has(c.name) },
  { kind: 'auth',            query: CALL_IDENT, test: (c) => AUTH_FN.has(c.name) },
  { kind: 'rate-limit',      query: CALL_IDENT, test: (c) => RATELIMIT_FN.has(c.name) },
  { kind: 'tool-definition', query: CALL_IDENT, test: (c) => TOOL_FN.has(c.name) },

  { kind: 'llm-call',        query: CALL_ATTR,  test: (c) => LLM_MEMBER.test(c.name) },
  { kind: 'rag-embeddings',  query: CALL_ATTR,  test: (c) => RAG_MEMBER.test(c.name) },
  { kind: 'rate-limit',      query: CALL_ATTR,  test: (c) => RATELIMIT_MEMBER.test(c.name) },

  { kind: 'prompt-construction', query: ASSIGN_FSTRING, test: (c) => PROMPTISH.test(c.name) },
  { kind: 'prompt-construction', query: KW_FSTRING,     test: (c) => PROMPT_KW.has(c.name) },

  { kind: 'tool-definition', query: DECORATOR_IDENT, test: (c) => TOOL_DECORATORS.has(c.name) },
  { kind: 'tool-definition', query: DECORATOR_ATTR,  test: (c) => TOOL_DECORATORS.has(c.name) },
  { kind: 'auth',            query: DECORATOR_IDENT, test: (c) => AUTH_DECORATORS.has(c.name) },
];
