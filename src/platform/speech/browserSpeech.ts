export interface SpeechGateway {
  speak(text: string, locale: string): void;
  stop(): void;
  readonly supported: boolean;
}

export class BrowserSpeech implements SpeechGateway {
  get supported(): boolean {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  speak(text: string, locale: string): void {
    if (!this.supported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  stop(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }
}
