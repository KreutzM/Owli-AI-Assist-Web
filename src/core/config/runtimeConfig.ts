import { z } from 'zod';

const runtimeConfigSchema = z.object({
  apiMode: z.enum(['mock', 'remote']),
  apiBaseUrl: z.string().url(),
  appVersion: z.string().min(1).max(32),
  versionCode: z.number().int().positive(),
  defaultLocale: z.string().min(2).max(32),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function readRuntimeConfig(env: ImportMetaEnv = import.meta.env): RuntimeConfig {
  const versionCode = Number.parseInt(env.VITE_OWLI_VERSION_CODE ?? '1', 10);
  return runtimeConfigSchema.parse({
    apiMode: env.VITE_OWLI_API_MODE ?? 'mock',
    apiBaseUrl: env.VITE_OWLI_API_BASE_URL ?? 'https://api.owli-ai.com',
    appVersion: env.VITE_OWLI_APP_VERSION ?? '0.1.0',
    versionCode,
    defaultLocale: env.VITE_OWLI_DEFAULT_LOCALE ?? 'de-DE',
  });
}
