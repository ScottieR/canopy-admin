# Server asset directory

Production raster images, GLB models, and signed release artifacts are deployed separately from this source repository. Set `CANOPY_ASSET_DIR` to their server-side directory; the control plane exposes them through `/agents`, `/models`, `/accessories`, and `/releases`.

Do not copy persona images or 3D assets into the desktop application's `public/` directory. Catalog records in the parent directory remain the source of truth for their server URLs.
