# Architecture

## Browser application

The browser owns the user-facing workflow:

1. Select a model photo.
2. Enter optional measurements in centimetres or inches.
3. Describe an outfit and select event, garment, fit, fabric and colour.
4. Upload an optional inspiration image.
5. Build a structured generation brief.
6. Create an immediate local concept rendering on a canvas.
7. Send the model image, inspiration image and brief to `/api/generate-look`.
8. Replace the local concept rendering when a configured provider returns a generated image.

The local canvas renderer is deliberately described as a concept preview. It is useful for testing the complete workflow without sending photos to a third party, but it is not a photorealistic try-on model.

## Node server

`server.mjs` uses only built-in Node APIs. It serves the static application and exposes:

- `GET /api/health`
- `POST /api/generate-look`

When `TRY_ON_API_URL` is not configured, the generation endpoint reports demo mode and the browser keeps the local concept preview.

When `TRY_ON_API_URL` is configured, the server forwards this JSON shape:

```json
{
  "modelImage": "data:image/jpeg;base64,...",
  "inspirationImage": "data:image/png;base64,...",
  "brief": {
    "event": "Wedding",
    "garment": "Gown",
    "fit": "Fitted",
    "fabric": "Silk",
    "colour": "#17634e",
    "idea": "...",
    "measurements": {},
    "instructions": []
  }
}
```

The external service must return either:

```json
{ "imageUrl": "https://example.com/generated-look.png" }
```

or:

```json
{ "imageBase64": "iVBORw0KGgo..." }
```

## Production recommendations

Before launching with real customers:

- Replace data URLs with multipart uploads or signed object-storage URLs.
- Add authentication and consent records.
- Define retention and deletion rules for user photos.
- Add background removal or human segmentation before garment generation.
- Add pose and body-landmark detection for more accurate placement.
- Store measurement profiles only with explicit user consent.
- Add moderation, rate limiting and provider timeouts.
- Keep provider credentials only on the server.
