import type { RemoteProfileCatalog } from '@/core/api/remoteCatalogContracts';
import type { RuntimeConfig } from '@/core/config/runtimeConfig';

export type RemoteRuntimeConfig = Extract<RuntimeConfig, { mode: 'remote' }>;

export interface RemoteReadiness {
  catalog: RemoteProfileCatalog;
  sceneDescribeEnabled: boolean;
  followupEnabled: boolean;
  audioPostcardEnabled: boolean;
}
