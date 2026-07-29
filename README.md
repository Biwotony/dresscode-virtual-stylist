# Dresscode Real Try-On

Dresscode is an identity-preserving AI virtual fitting studio. It replaces the old canvas-overlay workflow with a staged image-generation pipeline inspired by the strongest ideas in [`tandpfun/wardrobe`](https://github.com/tandpfun/wardrobe), while keeping Dresscode's event, measurement and custom-design workflow.

## What is implemented

- model photo upload
- optional inspiration upload
- centimetre/inch measurement conversion
- event, garment, fit, fabric, colour and written design controls
- garment detection with structured image analysis
- reviewable inspiration crop
- clean garment reconstruction
- local chroma cleanup with `sharp`
- identity-preserving image editing
- one to three try-on variations
- approve, reject and corrective-regeneration actions
- before/after comparison
- private runtime job storage excluded from Git
- same-origin Node deployment or GitHub Pages + separate backend
- Render Blueprint and Dockerfile

## Real try-on flow

```text
Model photo + inspiration + brief
             ↓
Analyse and crop the intended garment
             ↓
User approves or regenerates the crop
             ↓
Create a clean transparent garment reference
             ↓
User approves or regenerates the garment
             ↓
Generate natural identity-preserving try-on variations
             ↓
User approves, rejects or corrects a selected result
```

The final image prompt preserves the original identity, face, hair, hands, pose, body proportions, camera angle, framing, lighting and background. It asks the image model to replace only the clothing and render realistic drape, folds, seams, hems, contact shadows and occlusion.

## Requirements

- Node.js 20 or newer
- an OpenAI API key
- network access from the backend

## Run locally

```bash
npm install
cp .env.example .env
```

Add your API key to `.env`, export the values into your shell or hosting platform, then run:

```bash
npm start
```

Open `http://localhost:4173`.

## Environment

```bash
OPENAI_API_KEY=
OPENAI_API_BASE_URL=https://api.openai.com/v1
OPENAI_VISION_MODEL=gpt-5-mini
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_QUALITY=high
DRESSCODE_DATA_DIR=.dresscode
CORS_ORIGIN=https://biwotony.github.io
```

Never put `OPENAI_API_KEY` in `public/config.js` or any browser file.

## GitHub Pages

GitHub Pages hosts only the frontend. It cannot execute the real try-on pipeline.

After deploying the Node backend, open the Pages app, expand **Backend connection**, enter the backend URL and save it. The backend must allow the Pages origin through `CORS_ORIGIN`.

## Validation

```bash
npm test
npm run check
```

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)

## Privacy

Photos and generated assets are written to `DRESSCODE_DATA_DIR`, which is ignored by Git. A public production release still needs authentication, automatic deletion, access-controlled assets, rate limits and a published retention policy.

## Licence

MIT
