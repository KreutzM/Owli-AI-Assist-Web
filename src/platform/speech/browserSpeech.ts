export type SpeechState = 'unsupported' | 'idle' | 'speaking' | 'error';

export interface SpeechGateway {
  speak(text: string, locale: string): void;
  stop(): void;
  readonly supported: boolean;
}

export interface SpeechLifecycleGateway extends SpeechGateway {
  readonly state: SpeechState;
  subscribe(listener: (state: SpeechState) => void): () => void;
  dispose(): void;
}

export interface BrowserSpeechOptions {
  synthesis?: Pick<SpeechSynthesis, 'cancel' | 'speak'> | undefined;
  utteranceConstructor?: (new (text?: string) => SpeechSynthesisUtterance) | undefined;
}

export class BrowserSpeech implements SpeechLifecycleGateway {
  readonly #synthesis: Pick<SpeechSynthesis, 'cancel' | 'speak'> | undefined;
  readonly #utteranceConstructor: (new (text?: string) => SpeechSynthesisUtterance) | undefined;
  readonly #listeners = new Set<(state: SpeechState) => void>();
  #active: SpeechSynthesisUtterance | undefined;
  #generation = 0;
  #state: SpeechState;

  constructor(options: BrowserSpeechOptions = {}) {
    this.#synthesis =
      options.synthesis ??
      (typeof window !== 'undefined' && 'speechSynthesis' in window
        ? window.speechSynthesis
        : undefined);
    this.#utteranceConstructor =
      options.utteranceConstructor ??
      (typeof globalThis !== 'undefined' && 'SpeechSynthesisUtterance' in globalThis
        ? globalThis.SpeechSynthesisUtterance
        : undefined);
    this.#state = this.supported ? 'idle' : 'unsupported';
  }

  get supported(): boolean {
    return this.#synthesis !== undefined && this.#utteranceConstructor !== undefined;
  }

  get state(): SpeechState {
    return this.#state;
  }

  subscribe(listener: (state: SpeechState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  speak(text: string, locale: string): void {
    const normalized = text.trim();
    if (!this.supported) {
      this.#setState('unsupported');
      return;
    }
    if (!normalized) return;

    const generation = ++this.#generation;
    this.#detachActive();

    try {
      this.#synthesis!.cancel();
      const utterance = new this.#utteranceConstructor!(normalized);
      utterance.lang = locale;
      utterance.onend = () => {
        if (generation !== this.#generation || this.#active !== utterance) return;
        this.#detachActive();
        this.#setState('idle');
      };
      utterance.onerror = () => {
        if (generation !== this.#generation || this.#active !== utterance) return;
        this.#detachActive();
        this.#cancelSafely();
        this.#setState('error');
      };
      this.#active = utterance;
      this.#setState('speaking');
      this.#synthesis!.speak(utterance);
    } catch {
      this.#detachActive();
      this.#cancelSafely();
      this.#setState('error');
    }
  }

  stop(): void {
    this.#generation += 1;
    this.#detachActive();
    const cancelled = this.#cancelSafely();
    this.#setState(cancelled ? (this.supported ? 'idle' : 'unsupported') : 'error');
  }

  dispose(): void {
    this.stop();
    this.#listeners.clear();
  }

  #detachActive(): void {
    if (!this.#active) return;
    this.#active.onend = null;
    this.#active.onerror = null;
    this.#active = undefined;
  }

  #cancelSafely(): boolean {
    try {
      this.#synthesis?.cancel();
      return true;
    } catch {
      return false;
    }
  }

  #setState(state: SpeechState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }
}
