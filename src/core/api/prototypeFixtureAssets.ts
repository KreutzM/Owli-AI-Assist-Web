export async function loadPrototypeFixturePair(imagePath: string, audioPath: string): Promise<{
  imageBlob: Blob;
  audioBuffer: ArrayBuffer;
}> {
  const [imageResponse, audioResponse] = await Promise.all([fetch(imagePath), fetch(audioPath)]);
  if (!imageResponse.ok) {
    throw new Error(`Failed to load image fixture ${imagePath}.`);
  }
  if (!audioResponse.ok) {
    throw new Error(`Failed to load audio fixture ${audioPath}.`);
  }
  const [imageBlob, audioBuffer] = await Promise.all([imageResponse.blob(), audioResponse.arrayBuffer()]);
  return { imageBlob, audioBuffer };
}
