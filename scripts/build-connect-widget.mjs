#!/usr/bin/env node
// Bundles src/connect-widget/main.ts (the client-side half of the web-hosted
// connection token capture flow) into a single same-origin static file. Kept
// separate from the `vite build` of the admin SPA — this widget serves a bare,
// public /connect/:token page with no relation to the admin dashboard's React
// app, and needs to exist even when only `node server.js` is running (no vite
// build), so connections-routes.js serves it straight out of `public/` rather
// than through the SPA's dist/ pipeline.
//
// Run standalone (`node scripts/build-connect-widget.mjs`) or via `npm run build`.
import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(__dirname, '..', 'public', 'connect-widget.js');

await esbuild.build({
  entryPoints: [path.join(__dirname, '..', 'src', 'connect-widget', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  outfile,
});

console.log(`[build-connect-widget] wrote ${path.relative(process.cwd(), outfile)}`);
