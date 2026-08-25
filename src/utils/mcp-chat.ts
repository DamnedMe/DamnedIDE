// Auto-discovery of chat options (mode / model / effort) from an MCP tool's
// inputSchema. Enum-typed properties become a select; free-form string/number
// properties become a text field with suggestions, so the user can always pick
// the specific model and reasoning effort the tool accepts.

export interface ChatSelection {
  mode?: string
  model?: string
  effort?: string
}

export interface ChatOptionField {
  path: string[] | null // e.g. ['model'] or ['options', 'permissionMode']
  values: string[]      // enum values (empty when the field is free-form)
  suggestions: string[] // suggested values for free-form fields (datalist)
  free: boolean         // true when the schema accepts any value
  closed: boolean       // true when the offered list is the complete set (select)
}

export interface ChatOptions {
  mode: ChatOptionField
  model: ChatOptionField
  effort: ChatOptionField
  // whether the tool accepts extra arguments (additionalProperties not set to
  // false): used to offer model/effort even when the schema does not declare them
  lenient: boolean
}

const MODE_KEYS = ['mode', 'permissionMode', 'agent']
const MODEL_KEYS = ['model', 'modelName', 'model_name']
const EFFORT_KEYS = ['effort', 'reasoningEffort', 'reasoning_effort', 'thinking', 'intelligence']
const NESTED = ['options', 'config', 'settings', 'parameters']

// Per-agent profiles: the suggested models come from the agent itself, never a
// generic cross-agent list (Claude Code must not offer gpt/gemini, and vice
// versa). `effort` empty means the agent has no reasoning-effort parameter.
// `modelPath`/`effortPath` are the conventional argument paths used as a
// fallback when the tool schema does not declare the field.
interface AgentProfile {
  models: string[]
  effort: string[]
  modelPath: string[]
  effortPath: string[]
}

// Claude is not here on purpose: it is a native provider (useClaudeStore), not
// an MCP agent.
const AGENT_PROFILES: Record<string, AgentProfile> = {
  'codex': {
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-codex'],
    effort: ['minimal', 'low', 'medium', 'high'],
    modelPath: ['model'],
    effortPath: ['reasoning_effort']
  },
  'cursor': {
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5', 'gpt-5', 'gpt-5-mini', 'gemini-2.5-pro'],
    effort: [],
    modelPath: ['model'],
    effortPath: ['effort']
  },
  'opencode': {
    models: ['gpt-5', 'claude-sonnet-4-5', 'o4-mini', 'deepseek-v4-flash'],
    effort: [],
    modelPath: ['model'],
    effortPath: ['effort']
  }
}

const DEFAULT_EFFORT_SUGGESTIONS = ['minimal', 'low', 'medium', 'high']

const EMPTY_FIELD: ChatOptionField = { path: null, values: [], suggestions: [], free: false, closed: false }

function fieldAt(
  schema: Record<string, unknown> | undefined,
  keys: string[],
  suggestions: string[]
): ChatOptionField {
  if (!schema || typeof schema !== 'object') return EMPTY_FIELD
  const props = (schema.properties || {}) as Record<string, any>
  if (!props) return EMPTY_FIELD

  const match = (p: any): ChatOptionField | null => {
    if (!p || typeof p !== 'object') return null
    if (Array.isArray(p.enum) && p.enum.length > 0) {
      return { path: [], values: p.enum.map(String), suggestions: [], free: false, closed: true }
    }
    const t = p.type
    if (t === 'string' || t === 'number' || t === 'integer' || t === 'boolean' || t === 'null') {
      return { path: [], values: [], suggestions, free: true, closed: false }
    }
    return null
  }

  for (const key of keys) {
    const f = match(props[key])
    if (f) return { ...f, path: [key] }
  }
  for (const nested of NESTED) {
    const np = props[nested]
    if (np && typeof np === 'object' && np.properties) {
      for (const key of keys) {
        const f = match((np.properties as Record<string, any>)[key])
        if (f) return { ...f, path: [nested, key] }
      }
    }
  }
  return EMPTY_FIELD
}

export function discoverChatOptions(tool: McpTool | null, serverName?: string): ChatOptions {
  const raw = tool?.inputSchema || (tool as { parameters?: unknown })?.parameters
  const schema = (raw || {}) as Record<string, unknown>
  // JSON Schema allows extra properties by default unless additionalProperties
  // is explicitly false, so strict tools are the exception
  const lenient = (schema as { additionalProperties?: unknown }).additionalProperties !== false

  // per-agent catalog: known agents get their own model/effort suggestions, and
  // agents without a reasoning-effort parameter never get the effort control
  const profile = AGENT_PROFILES[(serverName || '').toLowerCase()] || null
  const modelSuggestions = profile?.models || []
  const effortSuggestions = profile?.effort.length ? profile.effort : (profile ? [] : DEFAULT_EFFORT_SUGGESTIONS)

  let model = fieldAt(schema, MODEL_KEYS, modelSuggestions)
  let effort = fieldAt(schema, EFFORT_KEYS, effortSuggestions)
  const mode = fieldAt(schema, MODE_KEYS, [])
  // tools that don't declare model/effort but accept extra args: still offer the
  // controls, sending them at the agent's conventional paths (Claude Code sends
  // them under options.model / options.effort, OpenAI/Foundry use top-level keys)
  if (!model.path && lenient) {
    model = { path: profile?.modelPath ?? ['model'], values: [], suggestions: modelSuggestions, free: true, closed: false }
  }
  if (!effort.path && lenient && effortSuggestions.length > 0) {
    effort = { path: profile?.effortPath ?? ['reasoning_effort'], values: [], suggestions: effortSuggestions, free: true, closed: true }
  }
  return { mode, model, effort, lenient }
}

// Builds the tools/call arguments for a chat/agent tool: the prompt goes under
// `prompt` (or `message`, per the schema) and mode/model/effort at their
// discovered paths (top-level or nested in options).
export function buildChatArgs(tool: McpTool | null, prompt: string, sel: ChatSelection): Record<string, unknown> {
  const schema = (tool?.inputSchema || {}) as Record<string, unknown>
  const props = ((schema.properties || {}) as Record<string, unknown>) || {}
  const promptKey = 'prompt' in props ? 'prompt' : 'message' in props ? 'message' : 'prompt'
  const args: Record<string, unknown> = { [promptKey]: prompt }
  const opts = discoverChatOptions(tool)
  const setAt = (path: string[] | null, value: string | undefined) => {
    if (!path || !value) return
    if (path.length === 1) {
      args[path[0]] = value
    } else if (path.length === 2) {
      const nested = (args[path[0]] as Record<string, unknown>) || {}
      args[path[0]] = { ...nested, [path[1]]: value }
    }
  }
  setAt(opts.mode.path, sel.mode)
  setAt(opts.model.path, sel.model)
  setAt(opts.effort.path, sel.effort)
  return args
}
