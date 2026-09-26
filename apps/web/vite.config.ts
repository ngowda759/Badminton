import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const DEFAULT_WEB_PORT = 5173;

/** Monorepo root, which holds the single `.env` file for every workspace. */
const envDir = fileURLToPath(new URL('../..', import.meta.url));

/** Resolves the `@/*` alias declared in `tsconfig.json` for Vite. */
const srcAlias = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Vite configuration for the Badminton web client.
 *
 * `envDir` points at the monorepo root so the web app and the API read the same
 * `.env`. Only `VITE_`-prefixed variables reach the bundle: everything else in
 * that file stays server-side.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const port = Number(env.WEB_PORT ?? DEFAULT_WEB_PORT);

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': srcAlias },
    },
    server: {
      port,
      strictPort: true,
      host: true,
    },
    preview: {
      port,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
