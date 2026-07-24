import { describe, expect, it, vi } from 'vitest';
import { BrowserSpeech, type SpeechState } from '@/platform/speech/browserSpeech';

class FakeUtterance {
  lang = '';
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

  constructor(readonly text = '') {}
}

describe('BrowserSpeech', () => {
  it('does not synthesize before an explicit speak call', () => {
    const synthesis = createSynthesis();
    const speech = createSpeech(synthesis);

    expect(speech.state).toBe('idle');
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it('speaks completed text with the completed result locale and browser defaults', () => {
    const synthesis = createSynthesis();
    const speech = createSpeech(synthesis);

    speech.speak('  Vollständige Antwort.  ', 'de-DE');

    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    expect(synthesis.speak).toHaveBeenCalledTimes(1);
    const utterance = synthesis.speak.mock.calls[0]?.[0] as unknown as FakeUtterance;
    expect(utterance.text).toBe('Vollständige Antwort.');
    expect(utterance.lang).toBe('de-DE');
    expect(speech.state).toBe('speaking');
  });

  it('replaces an active utterance and ignores stale completion callbacks', () => {
    const synthesis = createSynthesis();
    const speech = createSpeech(synthesis);

    speech.speak('Erste Antwort', 'de-DE');
    const first = synthesis.speak.mock.calls[0]?.[0] as unknown as FakeUtterance;
    const staleEnd = first.onend;

    speech.speak('Zweite Antwort', 'de-DE');
    const second = synthesis.speak.mock.calls[1]?.[0] as unknown as FakeUtterance;

    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    staleEnd?.({} as SpeechSynthesisEvent);
    expect(speech.state).toBe('speaking');

    second.onend?.({} as SpeechSynthesisEvent);
    expect(speech.state).toBe('idle');
  });

  it('stops deterministically and detaches stale callbacks', () => {
    const synthesis = createSynthesis();
    const speech = createSpeech(synthesis);
    const states: SpeechState[] = [];
    speech.subscribe((state) => states.push(state));

    speech.speak('Antwort', 'de-DE');
    const utterance = synthesis.speak.mock.calls[0]?.[0] as unknown as FakeUtterance;
    const staleError = utterance.onerror;
    speech.stop();

    expect(speech.state).toBe('idle');
    expect(utterance.onend).toBeNull();
    expect(utterance.onerror).toBeNull();
    staleError?.({} as SpeechSynthesisErrorEvent);
    expect(speech.state).toBe('idle');
    expect(states).toEqual(['idle', 'speaking', 'idle']);
  });

  it('reports synchronous synthesis failures without throwing', () => {
    const synthesis = createSynthesis();
    synthesis.speak.mockImplementation(() => {
      throw new Error('synthesis failed');
    });
    const speech = createSpeech(synthesis);

    expect(() => speech.speak('Antwort', 'de-DE')).not.toThrow();
    expect(speech.state).toBe('error');
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
  });

  it('ignores empty text and exposes unsupported capability', () => {
    const synthesis = createSynthesis();
    const speech = createSpeech(synthesis);
    speech.speak('   ', 'de-DE');
    expect(synthesis.speak).not.toHaveBeenCalled();

    const unsupported = new BrowserSpeech({
      synthesis,
      utteranceConstructor: undefined,
    });
    if (typeof globalThis.SpeechSynthesisUtterance === 'undefined') {
      expect(unsupported.supported).toBe(false);
      expect(unsupported.state).toBe('unsupported');
      unsupported.speak('Antwort', 'de-DE');
      expect(synthesis.speak).not.toHaveBeenCalled();
    }
  });
});

function createSpeech(synthesis: ReturnType<typeof createSynthesis>): BrowserSpeech {
  return new BrowserSpeech({
    synthesis,
    utteranceConstructor: FakeUtterance as unknown as new (
      text?: string,
    ) => SpeechSynthesisUtterance,
  });
}

function createSynthesis() {
  return {
    cancel: vi.fn(),
    speak: vi.fn<(utterance: SpeechSynthesisUtterance) => void>(),
  };
}
