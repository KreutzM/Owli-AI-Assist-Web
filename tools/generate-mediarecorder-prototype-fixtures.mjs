import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const fixtureRoot = path.join(root, 'prototype-fixtures', 'mediarecorder', 'fixtures');
const manifestRoot = path.join(
  root,
  'src',
  'features',
  'labs',
  'mediaRecorderPrototype',
  'generated',
);
const tempRoot = path.join(tmpdir(), 'owli-mediarecorder-prototype-fixtures');
const ffmpeg = 'ffmpeg';
const ffmpegVersion = readFfmpegVersion();

const imageFixtures = [
  {
    id: 'landscape-jpeg',
    fileName: 'landscape.jpg',
    width: 1280,
    height: 720,
    orientation: 'landscape',
    background: '#101d2f',
    boxes: [
      { x: 0, y: 0, w: 426, h: 240, color: '#e11d48' },
      { x: 854, y: 0, w: 426, h: 240, color: '#0ea5e9' },
      { x: 0, y: 480, w: 426, h: 240, color: '#22c55e' },
      { x: 854, y: 480, w: 426, h: 240, color: '#facc15' },
      { x: 426, y: 240, w: 428, h: 240, color: '#475569' },
    ],
  },
  {
    id: 'portrait-jpeg',
    fileName: 'portrait.jpg',
    width: 720,
    height: 1280,
    orientation: 'portrait',
    background: '#0f172a',
    boxes: [
      { x: 0, y: 0, w: 240, h: 426, color: '#8b5cf6' },
      { x: 480, y: 0, w: 240, h: 426, color: '#f97316' },
      { x: 0, y: 854, w: 240, h: 426, color: '#14b8a6' },
      { x: 480, y: 854, w: 240, h: 426, color: '#f43f5e' },
      { x: 240, y: 426, w: 240, h: 428, color: '#334155' },
    ],
  },
  {
    id: 'square-jpeg',
    fileName: 'square.jpg',
    width: 960,
    height: 960,
    orientation: 'square',
    background: '#111827',
    boxes: [
      { x: 0, y: 0, w: 320, h: 320, color: '#06b6d4' },
      { x: 640, y: 0, w: 320, h: 320, color: '#84cc16' },
      { x: 0, y: 640, w: 320, h: 320, color: '#fb7185' },
      { x: 640, y: 640, w: 320, h: 320, color: '#f59e0b' },
      { x: 320, y: 320, w: 320, h: 320, color: '#4b5563' },
    ],
  },
];

const audioDurations = [10, 30];
const audioFormats = [
  { id: 'audio-mpeg', extension: 'mp3', mimeType: 'audio/mpeg', codecArgs: ['-c:a', 'libmp3lame', '-b:a', '128k'] },
  { id: 'audio-wav', extension: 'wav', mimeType: 'audio/wav', codecArgs: ['-c:a', 'pcm_s16le'] },
  { id: 'audio-flac', extension: 'flac', mimeType: 'audio/flac', codecArgs: ['-c:a', 'flac'] },
  { id: 'audio-opus', extension: 'opus', mimeType: 'audio/opus', codecArgs: ['-c:a', 'libopus', '-b:a', '96k'] },
];

const recorderCandidates = [
  {
    id: 'mp4-h264-aac',
    mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    fileExtension: 'mp4',
  },
  {
    id: 'webm-vp8-opus',
    mimeType: 'video/webm;codecs=vp8,opus',
    fileExtension: 'webm',
  },
  {
    id: 'webm-default',
    mimeType: 'video/webm',
    fileExtension: 'webm',
  },
  {
    id: 'webm-vp9-opus',
    mimeType: 'video/webm;codecs=vp9,opus',
    fileExtension: 'webm',
  },
];

await mkdir(fixtureRoot, { recursive: true });
await mkdir(manifestRoot, { recursive: true });
await mkdir(tempRoot, { recursive: true });

for (const image of imageFixtures) {
  generateImage(image);
}

const audioFixtures = [];
for (const durationSeconds of audioDurations) {
  const sourcePath = path.join(tempRoot, `source-${durationSeconds}s.wav`);
  generateAudioSource(durationSeconds, sourcePath);
  for (const format of audioFormats) {
    const fileName = `${format.id}-${durationSeconds}s.${format.extension}`;
    const outputPath = path.join(fixtureRoot, fileName);
    transcodeAudio(sourcePath, outputPath, format.codecArgs);
    audioFixtures.push({
      id: `${format.id}-${durationSeconds}s`,
      fileName,
      path: outputPath,
      mimeType: format.mimeType,
      durationMs: durationSeconds * 1_000,
      sampleRateHz: 48_000,
      channels: 2,
      markerWindows: {
        startMs: 350,
        endMs: durationSeconds === 10 ? 9_200 : 29_200,
        toleranceMs: 250,
      },
    });
  }
}

const scenarios = [
  { id: 'scenario-01', imageId: 'landscape-jpeg', audioId: 'audio-mpeg-10s' },
  { id: 'scenario-02', imageId: 'portrait-jpeg', audioId: 'audio-wav-10s' },
  { id: 'scenario-03', imageId: 'square-jpeg', audioId: 'audio-flac-10s' },
  { id: 'scenario-04', imageId: 'landscape-jpeg', audioId: 'audio-opus-10s' },
  { id: 'scenario-05', imageId: 'portrait-jpeg', audioId: 'audio-mpeg-30s' },
  { id: 'scenario-06', imageId: 'square-jpeg', audioId: 'audio-wav-30s' },
  { id: 'scenario-07', imageId: 'landscape-jpeg', audioId: 'audio-flac-30s' },
  { id: 'scenario-08', imageId: 'portrait-jpeg', audioId: 'audio-opus-30s' },
];

const manifest = {
  schemaVersion: 1,
  generatedAt: '2026-08-01',
  generator: {
    tool: 'tools/generate-mediarecorder-prototype-fixtures.mjs',
    ffmpegVersion,
  },
  routePath: '/lab/mediarecorder-prototype',
  fixtureRoot: '/prototypes/mediarecorder/fixtures',
  recorderCandidates,
  images: await Promise.all(imageFixtures.map(async (image) => describeImage(image))),
  audio: await Promise.all(audioFixtures.map(async (audio) => describeAudio(audio))),
  scenarios: scenarios.map((scenario, index) => ({ ...scenario, order: index + 1 })),
};

await writeFile(
  path.join(manifestRoot, 'mediaRecorderFixtureManifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

function generateImage(image) {
  const outputPath = path.join(fixtureRoot, image.fileName);
  const drawBoxes = image.boxes
    .map(
      (box) =>
        `drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=${box.color}:t=fill`,
    )
    .join(',');
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${image.background}:s=${image.width}x${image.height}`,
      '-vf',
      drawBoxes,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outputPath,
    ],
    { stdio: 'ignore' },
  );
}

function generateAudioSource(durationSeconds, outputPath) {
  const endMarkerStart = durationSeconds === 10 ? 9.2 : 29.2;
  const endMarkerEnd = durationSeconds === 10 ? 9.45 : 29.45;
  const escapeCommas = (value) => value.replaceAll(',', '\\,');
  const expressionLeft = escapeCommas([
    `between(t,0.35,0.55)*0.92*sin(2*PI*1760*t)`,
    `between(t,${endMarkerStart},${endMarkerEnd})*0.92*sin(2*PI*880*t)`,
    `(1-between(t,0,0.35)-between(t,0.35,0.55)-between(t,${endMarkerStart},${endMarkerEnd})-between(t,${endMarkerEnd},${durationSeconds}))*(0.20*sin(2*PI*440*t)+0.08*sin(2*PI*660*t))`,
  ].join('+'));
  const expressionRight = escapeCommas([
    `between(t,0.35,0.55)*0.78*sin(2*PI*1320*t)`,
    `between(t,${endMarkerStart},${endMarkerEnd})*0.78*sin(2*PI*660*t)`,
    `(1-between(t,0,0.35)-between(t,0.35,0.55)-between(t,${endMarkerStart},${endMarkerEnd})-between(t,${endMarkerEnd},${durationSeconds}))*(0.18*sin(2*PI*330*t)+0.06*sin(2*PI*550*t))`,
  ].join('+'));

  execFileSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=${expressionLeft}|${expressionRight}:s=48000:d=${durationSeconds}`,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ],
    { stdio: 'ignore' },
  );
}

function transcodeAudio(sourcePath, outputPath, codecArgs) {
  execFileSync(
    ffmpeg,
    ['-y', '-i', sourcePath, ...codecArgs, outputPath],
    { stdio: 'ignore' },
  );
}

async function describeImage(image) {
  const filePath = path.join(fixtureRoot, image.fileName);
  return {
    id: image.id,
    fileName: image.fileName,
    path: `/prototypes/mediarecorder/fixtures/${image.fileName}`,
    mimeType: 'image/jpeg',
    width: image.width,
    height: image.height,
    longEdgePx: Math.max(image.width, image.height),
    orientation: image.orientation,
    samplePoints: samplePointsForImage(image),
    ...(await describeFile(filePath)),
  };
}

async function describeAudio(audio) {
  return {
    id: audio.id,
    fileName: audio.fileName,
    path: `/prototypes/mediarecorder/fixtures/${audio.fileName}`,
    mimeType: audio.mimeType,
    durationMs: audio.durationMs,
    sampleRateHz: audio.sampleRateHz,
    channels: audio.channels,
    markerWindows: audio.markerWindows,
    ...(await describeFile(audio.path)),
  };
}

function samplePointsForImage(image) {
  const samples = [
    { id: 'northwest', x: 0.14, y: 0.14, color: image.boxes[0]?.color ?? '#000000' },
    { id: 'northeast', x: 0.86, y: 0.14, color: image.boxes[1]?.color ?? '#000000' },
    { id: 'southwest', x: 0.14, y: 0.86, color: image.boxes[2]?.color ?? '#000000' },
    { id: 'southeast', x: 0.86, y: 0.86, color: image.boxes[3]?.color ?? '#000000' },
    { id: 'center', x: 0.5, y: 0.5, color: image.boxes[4]?.color ?? '#000000' },
  ];
  return samples.map((sample) => ({
    id: sample.id,
    x: sample.x,
    y: sample.y,
    rgb: hexToRgb(sample.color),
  }));
}

async function describeFile(filePath) {
  const data = await readFile(filePath);
  const fileStat = await stat(filePath);
  return {
    sizeBytes: fileStat.size,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function hexToRgb(color) {
  const normalized = color.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function readFfmpegVersion() {
  const output = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' });
  return output.split(/\r?\n/u)[0]?.trim() ?? 'unknown';
}
