const INSTALLATION_ID_KEY = 'owli.web.installation-id.v1';

export function getOrCreateInstallationId(storage: Storage = window.localStorage): string {
  const existing = storage.getItem(INSTALLATION_ID_KEY)?.trim();
  if (existing) return existing;

  const installationId = crypto.randomUUID();
  storage.setItem(INSTALLATION_ID_KEY, installationId);
  return installationId;
}
