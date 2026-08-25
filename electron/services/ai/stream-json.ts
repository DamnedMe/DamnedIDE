export interface CliUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface CliEvent {
  sessionId?: string
  delta?: string
  tool?: string
  final?: { text?: string; costUsd: number; usage?: CliUsage; isError: boolean }
}

// Pure reducer over one `claude -p --output-format stream-json` line. Kept free
// of electron/SDK imports so it can be exercised with plain node.
export function parseCliEvent(line: string): CliEvent | null {
  if (!line.trim()) return null
  let msg: Record<string, any>
  try { msg = JSON.parse(line) } catch { return null }
  const out: CliEvent = {}
  if (typeof msg.session_id === 'string') out.sessionId = msg.session_id

  if (msg.type === 'stream_event') {
    const ev = msg.event
    if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') out.delta = ev.delta.text
  } else if (msg.type === 'assistant') {
    // a coding turn can run for minutes emitting only tool calls: surface them
    // so the panel shows progress instead of looking frozen
    const block = ((msg.message?.content || []) as { type?: string; name?: string }[])
      .find(b => b.type === 'tool_use' && b.name)
    if (block?.name) out.tool = block.name
  } else if (msg.type === 'result') {
    const u = msg.usage as Record<string, number> | undefined
    out.final = {
      text: typeof msg.result === 'string' ? msg.result : undefined,
      costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : 0,
      // the CLI reports auth/tool failures as a successful line with is_error:
      // without this an "OAuth token expired" would render as a normal answer
      isError: msg.is_error === true || (typeof msg.subtype === 'string' && msg.subtype !== 'success'),
      usage: u && {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens,
        cacheWriteTokens: u.cache_creation_input_tokens
      }
    }
  }
  return out
}
