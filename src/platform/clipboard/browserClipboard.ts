export async function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
