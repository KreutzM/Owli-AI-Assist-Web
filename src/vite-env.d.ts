/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_OWLI_API_MODE?: 'mock' | 'remote';
  readonly VITE_OWLI_API_BASE_URL?: string;
  readonly VITE_OWLI_APP_VERSION?: string;
  readonly VITE_OWLI_VERSION_CODE?: string;
  readonly VITE_OWLI_DEFAULT_LOCALE?: string;
  readonly VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER?: 'enabled';
  readonly VITE_OWLI_BUILD_TARGET?: string;
  readonly VITE_OWLI_GIT_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
