import { get_encoding } from 'tiktoken';

const cl100k = get_encoding('cl100k_base');

export interface ChatMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
  name?: string;
}

/**
 * Count tokens for a single string using cl100k_base.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return cl100k.encode(text).length;
}

/**
 * Count tokens for an array of chat messages.
 * Adds per-message overhead (~4 tokens per message + 2 for priming).
 */
export function countMessageTokens(messages: ChatMessage[]): number {
  let total = 0;

  for (const m of messages) {
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('');
    }
    total += countTokens(text);

    // Tool calls (assistant messages)
    if (m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        total += countTokens(tc.function?.name ?? '');
        total += countTokens(tc.function?.arguments ?? '');
      }
    }

    if (m.tool_call_id) {
      total += countTokens(m.tool_call_id);
    }
    if (m.name) {
      total += countTokens(m.name);
    }

    // Per-message overhead
    total += 4;
  }

  return total + 2;
}

/**
 * Estimate completion tokens from a streamed response body.
 * Parses SSE chunks and counts tokens in content deltas.
 */
export function countCompletionTokensFromBody(body: string): number {
  let text = '';

  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') break;

    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) {
        text += delta.content;
      }
      // Tool call arguments in streaming
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.arguments) {
            text += tc.function.arguments;
          }
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return countTokens(text);
}
