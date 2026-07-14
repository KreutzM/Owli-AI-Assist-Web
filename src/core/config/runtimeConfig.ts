import { z } from 'zod';

export const STAGING_API_ROOT =
  'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/';
export const PRODUCTION_API_ROOT = 'https://api.owli-ai.com/';

export type RuntimeConfigurationErrorCode =
  | 'REMOTE_BASE_URL_MISSING'
  | 'REMOTE_BASE_URL_INVALID'
  | 'REMOTE_BASE_URL_NOT_APPROVED'
  | 'APP_VERSION_INVALID'
  | 'VERSION_CODE_INVALID'
  | 'LOCALE_INVALID';

export type RuntimeConfig =
  | {
      mode: 'mock';
      appVersion: string;
      versionCode: number;
      defaultLocale: string;
    }
  | {
      mode: 'remote';
      target: 'staging' | 'production';
      apiBaseUrl: string;
      appVersion: string;
      versionCode: number;
      defaultLocale: string;
    }
  | { mode: 'invalid_configuration'; reason: RuntimeConfigurationErrorCode };

const appVersionSchema = z.string().trim().min(1).max(32);
const localeSchema = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

export function readRuntimeConfig(env: ImportMetaEnv = import.meta.env): RuntimeConfig {
  const mode = env.VITE_OWLI_API_MODE ?? 'mock';
  const appVersion = appVersionSchema.safeParse(env.VITE_OWLI_APP_VERSION ?? '0.1.0');
  if (!appVersion.success) return { mode: 'invalid_configuration', reason: 'APP_VERSION_INVALID' };

  const versionCodeRaw = env.VITE_OWLI_VERSION_CODE ?? '1';
  if (!/^[1-9]\d*$/.test(versionCodeRaw)) {
    return { mode: 'invalid_configuration', reason: 'VERSION_CODE_INVALID' };
  }
  const versionCode = Number(versionCodeRaw);
  if (!Number.isSafeInteger(versionCode)) {
    return { mode: 'invalid_configuration', reason: 'VERSION_CODE_INVALID' };
  }

  const locale = localeSchema.safeParse(env.VITE_OWLI_DEFAULT_LOCALE ?? 'de-DE');
  if (!locale.success) return { mode: 'invalid_configuration', reason: 'LOCALE_INVALID' };

  if (mode === 'mock') {
    return {
      mode: 'mock',
      appVersion: appVersion.data,
      versionCode,
      defaultLocale: locale.data,
    };
  }

  if (mode !== 'remote') {
    return { mode: 'invalid_configuration', reason: 'REMOTE_BASE_URL_INVALID' };
  }

  const rawBaseUrl = env.VITE_OWLI_API_BASE_URL;
  if (!rawBaseUrl) return { mode: 'invalid_configuration', reason: 'REMOTE_BASE_URL_MISSING' };

  let normalized: string;
  try {
    const url = new URL(rawBaseUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return { mode: 'invalid_configuration', reason: 'REMOTE_BASE_URL_INVALID' };
    }
    normalized = `${url.origin}/`;
  } catch {
    return { mode: 'invalid_configuration', reason: 'REMOTE_BASE_URL_INVALID' };
  }

  const target =
    normalized === STAGING_API_ROOT
      ? 'staging'
      : normalized === PRODUCTION_API_ROOT
        ? 'production'
        : undefined;
  if (!target) return { mode: 'invalid_configuration', reason: 'REMOTE_BASE_URL_NOT_APPROVED' };

  return {
    mode: 'remote',
    target,
    apiBaseUrl: normalized,
    appVersion: appVersion.data,
    versionCode,
    defaultLocale: locale.data,
  };
}
