# Dresscode Virtual Stylist

A dependency-free web project for visualising event outfits on an uploaded model photo.

## What is included

- Model photo upload with drag-and-drop and immediate preview
- Optional inspiration image upload
- Measurements in centimetres or inches with automatic conversion
- Event, garment, fit, fabric and colour controls
- Free-text outfit description
- Structured generation brief
- Local canvas-based outfit concept preview
- Before/after comparison slider
- PNG preview and text brief downloads
- Provider-ready `/api/generate-look` endpoint
- Automated tests and GitHub Actions
- Static GitHub Pages demo workflow

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm start
```

Open `http://localhost:4173`.

For automatic restart while editing:

```bash
npm run dev
```

Run validation:

```bash
npm test
npm run check
```

## Connect a photorealistic virtual try-on provider

Copy the environment template:

```bash
cp .env.example .env
```

Set:

```bash
TRY_ON_API_URL=https://your-provider.example/generate
TRY_ON_API_KEY=your-secret-key
```

Export the values before starting the server, or configure them in your hosting platform. The expected request and response formats are documented in [`docs/architecture.md`](docs/architecture.md).

Without a provider, the app remains fully usable in local concept mode.

## Deploy

### Static demo on GitHub Pages

The included Pages workflow deploys the `public` directory. File uploads, measurements, the local concept renderer and downloads work in this mode. The external generation API does not run on GitHub Pages.

Enable Pages in the repository settings and select **GitHub Actions** as the source.

### Full Node deployment

Deploy the repository to a platform that can run:

```bash
npm start
```

Set `PORT`, `TRY_ON_API_URL` and `TRY_ON_API_KEY` in the platform environment.

## Repository structure

```text
.
├── .github/workflows/      # CI and GitHub Pages deployment
├── docs/architecture.md    # Provider contract and production notes
├── public/                 # Browser application
│   ├── index.html
│   ├── styles.css
│   └── js/
├── tests/                  # Node test runner tests
├── .env.example
├── package.json
└── server.mjs
```

## Important limitation

The built-in canvas renderer is a visual concept tool, not a precise or photorealistic fitting engine. Real garment replacement requires a virtual try-on or image-generation provider connected through the included server adapter.

## Licence

MIT
