# Deployment

## Why GitHub Pages is not enough

GitHub Pages can host `public/`, but real try-on requires a Node server because it must:

- keep the OpenAI API key secret
- process images with `sharp`
- run multi-stage jobs
- store temporary user photos and generated assets
- expose review, approve, reject and regeneration endpoints

The static frontend can still be served from GitHub Pages and connected to a separate backend.

## Render deployment

The repository includes `render.yaml`.

1. Create a Render Blueprint from this repository.
2. Set `OPENAI_API_KEY` as a secret.
3. Deploy the service.
4. Copy the resulting `onrender.com` URL.
5. Open the GitHub Pages app, expand **Backend connection**, enter the backend URL, and save it.

The Blueprint mounts a persistent disk at `/var/data` and sets `DRESSCODE_DATA_DIR=/var/data/dresscode`. Only data beneath the mounted path survives restarts and deploys.

For a low-retention production policy, add an automated cleanup process that deletes completed and abandoned jobs after the chosen retention period.

## Same-origin deployment

The Node server also serves the frontend. When opening the Node service URL directly, leave the backend URL blank—the browser uses the same origin automatically.

## Docker

```bash
docker build -t dresscode-real-tryon .
docker run --rm -p 4173:4173 \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -v dresscode-data:/app/.dresscode \
  dresscode-real-tryon
```

## Required variables

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for garment analysis and image editing |
| `OPENAI_VISION_MODEL` | Garment analysis model |
| `OPENAI_IMAGE_MODEL` | Garment reconstruction and try-on model |
| `OPENAI_IMAGE_QUALITY` | Image generation quality |
| `DRESSCODE_DATA_DIR` | Runtime job and image directory |
| `CORS_ORIGIN` | Allowed separately hosted frontend origin(s) |

## Privacy checklist

Before public launch:

- publish a photo-processing consent notice
- define automatic deletion and retention windows
- add authentication and per-user job ownership
- add rate limiting and cost controls
- avoid logging image data or prompts containing personal information
- restrict asset URLs to authenticated users
- add abuse and content moderation appropriate to your audience
