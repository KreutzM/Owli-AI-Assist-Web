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

export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

export async function shareFile(file: File, title: string, text: string): Promise<void> {
  if (typeof navigator.share !== 'function') throw new Error('File sharing is unavailable.');
  await navigator.share({ files: [file], title, text });
}
