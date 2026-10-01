/**
 * Library build for the npm package (`npm run build:lib`), separate from the
 * app build so the app keeps its own entry, proxy and HTML.
 *
 * The three path aliases are resolved HERE, at build time — that is the whole
 * reason this package ships a bundle rather than sources (see src/embed.ts).
 * Only React is external; everything else (Radix, i18next, immer, the Tauri
 * shims, both JSON tables) is bundled so a host needs nothing but React.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@profiles': fileURLToPath(
        new URL('../src/tavotto/profiles/publication.json', import.meta.url),
      ),
      '@glyphcoverage': fileURLToPath(
        new URL('../src/tavotto/pdfbackend/canvas_coverage.json', import.meta.url),
      ),
      '@playground-runtime': fileURLToPath(
        new URL('../packaging/playground-runtime.json', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('./src/embed.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // React is a peer, so it must not be bundled. `use-sync-external-store`
      // (pulled in by zustand / react-i18next) is CJS and does
      // `require('react')`; bundling it while react is external makes rolldown
      // emit a `require` shim that throws in any ESM/browser host. Leaving the
      // shim external hands it to the host's bundler, which resolves CJS the
      // normal way — so it is declared as a runtime dependency of this package.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom/client',
        /^use-sync-external-store(\/|$)/,
      ],
      output: { assetFileNames: 'style[extname]' },
    },
  },
})
