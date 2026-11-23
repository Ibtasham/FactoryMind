import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizeBasePath(raw?: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function resolveBasePath(): string {
  if (process.env.VITE_BASE_PATH) {
    return normalizeBasePath(process.env.VITE_BASE_PATH);
  }
  const ghRepo = (process.env.GITHUB_REPOSITORY || '').trim();
  if (ghRepo.includes('/')) {
    const [owner, repo] = ghRepo.split('/');
    if (repo && repo.toLowerCase() !== `${owner.toLowerCase()}.github.io`) {
      return normalizeBasePath(repo);
    }
  }
  return '/';
}

const VALID_SPA_ROUTES = [
  'home',
  'factory-sim',
  'scenario-studio',
  'decision-assistant',
  'one-for-all',
  'dashboard',
  'advisor',
  'inventory',
  'eoq',
  'abc',
  'forecast',
  'models-3d',
  'production',
  'decision-lab',
  'line-balance',
  'spc',
  'research',
  'ledger',
  'brief',
  'reports',
  'settings',
];

function buildGitHubPages404Html(basePath: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Redirecting — FactoryMind</title>
    <script>
      (function () {
        var base = ${JSON.stringify(basePath)};
        var valid = ${JSON.stringify(VALID_SPA_ROUTES)};
        var p = window.location.pathname || '/';
        var rel = p.indexOf(base) === 0 ? p.slice(base.length) : p;
        var seg = rel.replace(/^\\/+|\\/+$/g, '').split('/')[0] || '';
        var route = valid.indexOf(seg) !== -1 ? seg : 'home';
        var search = window.location.search || '';
        var targetHash = window.location.hash && window.location.hash.length > 2
          ? window.location.hash
          : '#/' + route;
        window.location.replace(base + search + targetHash);
      })();
    </script>
  </head>
  <body></body>
</html>
`;
}

export default defineConfig(() => {
  const base = resolveBasePath();

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
      // Emits GitHub Pages SPA 404 redirect & .nojekyll marker into dist/.
      {
        name: 'github-pages-spa-fallback',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          if (fs.existsSync(distDir)) {
            fs.writeFileSync(path.join(distDir, '404.html'), buildGitHubPages404Html(base), 'utf8');
            fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');
          }
        },
      },
      // Rewrites og:image to an absolute URL when VITE_SITE_URL is provided at build time.
      {
        name: 'absolute-og-image',
        transformIndexHtml(html: string): string {
          const siteUrl = (process.env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
          if (!siteUrl) return html;
          return html.replace(
            /(<meta\s+property=["']og:image["']\s+content=["'])([^"']+)(["']\s*\/?>)/i,
            (_m, pre: string, content: string, post: string) => {
              if (/^https?:\/\//i.test(content)) return `${pre}${content}${post}`;
              const pathPart = content.startsWith('/') ? content : `/${content}`;
              return `${pre}${siteUrl}${pathPart}${post}`;
            }
          );
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
