# Canopy control plane

> **Portfolio preview:** Thanks for taking a look. You are welcome to inspect, clone, build, and run this service for evaluation. The source is here to make its architecture and implementation easy to explore. This is a portfolio preview rather than a general open-source release; see [LICENSE](LICENSE) for details.

Authenticated administrative service and public catalog API for the [Canopy desktop app](https://github.com/ScottieR/canopy).

This repository owns persona, model, pricing, connector, accessory, habitat, and updater metadata. It also contains the internal React administration UI. It is not the agent execution plane: credentials, conversations, workspaces, and model inference for desktop users remain on the user's Mac or go directly to the provider they selected.

## Security boundary

Public unauthenticated routes are deliberately narrow:

- read-only desktop catalogs and updater manifests;
- bounded, opt-in aggregate telemetry;
- device-token-authenticated publish/share operations;
- a host-allowlisted image proxy.

All mutation, studio-generation, connector-generation, model-sync, release-management, and general server-funded LLM routes require `X-Admin-Key`. The public inference surface is intentionally tiny: `/api/canopy-helper/bootstrap` for one current first-run setup request and `/api/canopy-helper/voice-preview` for one short onboarding voice sample. Both strip non-onboarding context and carry burst and daily IP limits. The desktop does not possess the admin key and switches Eddy to the user's provider as soon as a provider credential is available.

Secrets are loaded from environment variables in production and from an ignored, mode-`0600` `.env` file for local development. Never commit a populated environment file.

## Local development

Requirements: Node.js 20.19 or newer and npm.

```bash
npm ci
cp .env.example .env
```

Populate only the credentials needed for the feature you are testing:

```text
ADMIN_API_KEY=<long random admin credential>
GEMINI_API_KEY=<optional studio key>
OPENAI_API_KEY=<optional hosted voice fallback key>
ELEVENLABS_API_KEY=<optional premium hosted voice key>
ELEVENLABS_DEFAULT_VOICE_ID=<optional fallback ElevenLabs voice id>
ELEVENLABS_VOICE_HARBOR_ID=<optional Harbor profile voice id>
ELEVENLABS_VOICE_FORGE_ID=<optional Forge profile voice id>
ELEVENLABS_VOICE_QUILL_ID=<optional Quill profile voice id>
ELEVENLABS_VOICE_ATLAS_ID=<optional Atlas profile voice id>
ELEVENLABS_VOICE_MARLOWE_ID=<optional Marlowe profile voice id>
ELEVENLABS_VOICE_LUMEN_ID=<optional Lumen profile voice id>
ANTHROPIC_API_KEY=<optional internal helper key>
MESHY_API_KEY=<optional asset-generation key>
CANOPY_ASSET_DIR=<optional absolute path to the server-side raster/GLB corpus>
```

Prefer the stdin helper so a secret does not appear in shell history:

```bash
pbpaste | node scripts/set-local-env-secret.mjs ADMIN_API_KEY
```

Then start the API and Vite UI in separate terminals:

```bash
npm run server
```

```bash
npm run dev
```

The API listens on `http://localhost:3001` and Vite prints the administration UI URL.

The JSON catalogs required by the API are committed in `shared/`, so a clean checkout builds and starts without the surrounding development workspace. The heavyweight raster and GLB corpus is intentionally deployed separately from source control. When working with those assets locally, set `CANOPY_ASSET_DIR` to that server-side directory; the API continues to serve files through `/agents`, `/models`, and `/accessories`. The desktop app does not bundle those persona or 3D assets into its own `public/` directory.

## Validation

```bash
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

The tests cover the public-route allowlist, constant-time admin authentication, request sanitization, SSRF defenses, telemetry bounding, release URLs, security headers, CORS, retired screen telemetry, and publish/share authorization.

## Deployment

Pushes to `production` run the full desktop/admin regression gate and deploy to Google Cloud Run through GitHub OIDC. Production credentials are read from Google Secret Manager; the workflow never writes them to the repository or build context.

Required GitHub configuration:

- `CANOPY_DEPLOY_KEY` while the desktop repository remains private;
- `ALERT_WEBHOOK_URL` if deployment failure alerts are desired;
- the configured Google Workload Identity provider and deployment service account.

Required Secret Manager entries are listed in `.github/workflows/deploy.yml`.

## Repository map

```text
server.js                 Express API and control-plane orchestration
server-security.js        Pure validation, authentication, and sanitization helpers
share-routes.js           Device-scoped mini-app publishing
src/                      Internal React administration UI
shared/                   Runtime catalog data and hosted public assets
migrations/               Postgres telemetry migrations
scripts/                  Repeatable operator utilities
.github/workflows/        Security gates and Cloud Run deployment
```

## License

This service is shared as a portfolio preview under a limited evaluation license. Reviewers are welcome to inspect, clone, build, and run it. See [LICENSE](LICENSE) for the full terms.
