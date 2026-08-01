export type AppRoute =
  | { kind: 'main' }
  | { kind: 'mediarecorder-lab'; pathname: '/lab/mediarecorder-prototype' };

export function readAppRoute(pathname: string): AppRoute {
  const normalized = pathname === '/' ? pathname : pathname.replace(/\/+$/u, '');
  if (normalized === '/lab/mediarecorder-prototype') {
    return { kind: 'mediarecorder-lab', pathname: '/lab/mediarecorder-prototype' };
  }
  return { kind: 'main' };
}
