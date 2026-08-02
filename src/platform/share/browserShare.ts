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

function createFileShareData(file: File, title: string, text: string): ShareData {
  return { files: [file], title, text };
}

export function canShareFile(file: File, title: string, text: string): boolean {
  if (typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') {
    return false;
  }
  return navigator.canShare(createFileShareData(file, title, text));
}

export async function shareFile(file: File, title: string, text: string): Promise<void> {
  if (!canShareFile(file, title, text)) throw new Error('File sharing is unavailable.');
  await navigator.share(createFileShareData(file, title, text));
}
