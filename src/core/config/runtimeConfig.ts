import { z } from 'zod';

export const STAGING_API_ROOT = 'https://api-staging.owli-ai.com/';
export const PRODUCTION_API_ROOT = 'https://api.owli-ai.com/';

export type RuntimeConfigurationErrorCode =
  | 'API_MODE_INVALID'
  | 'REMOTE_BASE_URL_MISSING'
  | 'REMOTE_BASE_URL_INVALID'
  | 'REMOTE_BASE_URL_NOT_APPROVED'
  | 'APP_VERSION_INVALID'
  | 'VERSION_CODE_INVALID'
  | 'LOCALE_INVALID';

interface PrototypeConfig {
  mediaRecorderLabEnabled: boolean;
}

export type RuntimeConfig =
  | {
      mode: 'mock';
      appVersion: string;
      versionCode: number;
      defaultLocale: string;
      prototype?: PrototypeConfig;
    }
  | {
      mode: 'remote';
      target: 'staging' | 'production';
      apiBaseUrl: string;
      appVersion: string;
      versionCode: number;
      defaultLocale: string;
      prototype?: PrototypeConfig;
    }
  | {
      mode: 'invalid_configuration';
      reason: RuntimeConfigurationErrorCode;
      prototype?: PrototypeConfig;
    };

const apiModeSchema = z.enum(['mock', 'remote']);
const appVersionSchema = z.string().trim().min(1).max(32);
const localeSchema = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

export function readRuntimeConfig(env: ImportMetaEnv = import.meta.env): RuntimeConfig {
  const prototypeEnabled = env.VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER === 'enabled';
  const mode = apiModeSchema.safeParse(String(env.VITE_OWLI_API_MODE ?? 'mock'));
  if (!mode.success) {
    return {
      mode: 'invalid_configuration',
      reason: 'API_MODE_INVALID',
      prototype: { mediaRecorderLabEnabled: false },
    };
  }

  const appVersion = appVersionSchema.safeParse(env.VITE_OWLI_APP_VERSION ?? '0.1.0');
  if (!appVersion.success) {
    return {
      mode: 'invalid_configuration',
      reason: 'APP_VERSION_INVALID',
      prototype: { mediaRecorderLabEnabled: false },
    };
  }

  const versionCodeRaw = env.VITE_OWLI_VERSION_CODE ?? '1';
  if (!/^[1-9]\d*$/.test(versionCodeRaw)) {
    return {
      mode: 'invalid_configuration',
      reason: 'VERSION_CODE_INVALID',
      prototype: { mediaRecorderLabEnabled: false },
    };
  }
  const versionCode = Number(versionCodeRaw);
  if (!Number.isSafeInteger(versionCode)) {
    return {
      mode: 'invalid_configuration',
      reason: 'VERSION_CODE_INVALID',
      prototype: { mediaRecorderLabEnabled: false },
    };
  }

  const locale = localeSchema.safeParse(env.VITE_OWLI_DEFAULT_LOCALE ?? 'de-DE');
  if (!locale.success) {
    return {
      mode: 'invalid_configuration',
      reason: 'LOCALE_INVALID',
      prototype: { mediaRecorderLabEnabled: false },
    };
  }

  if (mode.data === 'mock') {
    return {
      mode: 'mock',
      appVersion: appVersion.data,
      versionCode,
      defaultLocale: locale.data,
      prototype: { mediaRecorderLabEnabled: false },
    };
  }

  const rawBaseUrl = env.VITE_OWLI_API_BASE_URL;
  if (!rawBaseUrl) {
    return {
      mode: 'invalid_configuration',
      reason: 'REMOTE_BASE_URL_MISSING',
      prototype: { mediaRecorderLabEnabled: false },
    };
  }

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
      return {
        mode: 'invalid_configuration',
        reason: 'REMOTE_BASE_URL_INVALID',
        prototype: { mediaRecorderLabEnabled: false },
      };
    }
    normalized = `${url.origin}/`;
  } catch {
    return {
      mode: 'invalid_configuration',
      reason: 'REMOTE_BASE_URL_INVALID',
      prototype: { mediaRecorderLabEnabled: false },
    };
  }

  const target =
    normalized === STAGING_API_ROOT
      ? 'staging'
      : normalized === PRODUCTION_API_ROOT
        ? 'production'
        : undefined;
  if (!target) {
    return {
      mode: 'invalid_configuration',
      reason: 'REMOTE_BASE_URL_NOT_APPROVED',
      prototype: { mediaRecorderLabEnabled: false },
    };
  }

  return {
    mode: 'remote',
    target,
    apiBaseUrl: normalized,
    appVersion: appVersion.data,
    versionCode,
    defaultLocale: locale.data,
    prototype: {
      mediaRecorderLabEnabled: target === 'staging' && prototypeEnabled,
    },
  };
}
