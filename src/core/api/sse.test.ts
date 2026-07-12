import { describe, expect, it } from 'vitest';
import { parseSseStream } from '@/core/api/sse';

describe('parseSseStream', () => {
  it('parses events split across chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: delta\ndata: {"textDelta":"Hal'));
        controller.enqueue(encoder.encode('lo"}\n\nevent: done\ndata: {"answerText":"Hallo"}\n\n'));
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseSseStream(stream)) events.push(event);

    expect(events).toEqual([
      { event: 'delta', data: '{"textDelta":"Hallo"}' },
      { event: 'done', data: '{"answerText":"Hallo"}' },
    ]);
  });
});
