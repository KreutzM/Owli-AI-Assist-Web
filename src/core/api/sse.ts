export interface SseEvent {
  event: string;
  data: string;
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/u);
      buffer = blocks.pop()!;

      for (const block of blocks) {
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
      }

      if (done) break;
    }

    const finalEvent = parseBlock(buffer);
    if (finalEvent) yield finalEvent;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseEvent | undefined {
  if (!block.trim()) return undefined;

  let event = 'message';
  const data: string[] = [];
  for (const rawLine of block.split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const separator = rawLine.indexOf(':');
    const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
    const rawValue = separator >= 0 ? rawLine.slice(separator + 1) : '';
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }

  return data.length ? { event, data: data.join('\n') } : undefined;
}
