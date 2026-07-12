export interface ShareGateway {
  shareUrl(url: string, title: string, text: string): Promise<void>;
}

export class BrowserShare implements ShareGateway {
  async shareUrl(url: string, title: string, text: string): Promise<void> {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
  }
}
