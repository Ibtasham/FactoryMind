/**
 * Resolves paths to files in `public/` against Vite's configured `BASE_URL`
 * so assets load reliably on both root domains (`/`) and project subpaths
 * (e.g. `/repo-name/` on GitHub Pages).
 */
export function publicAsset(relativePath: string, baseOverride?: string): string {
  const cleanRel = relativePath.replace(/^\/+/, '');
  const metaEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: { BASE_URL?: string } }).env
      : undefined;
  const rawBase = baseOverride ?? metaEnv?.BASE_URL ?? '/';
  const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  return `${normalizedBase}${cleanRel}`;
}
