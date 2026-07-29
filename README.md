# Dresscode — Tailor Consultation & Realistic Virtual Try-On

Dresscode is a client-consultation platform for tailors, designers and occasion-wear boutiques. It combines identity-preserving AI try-on with saved client records, design versioning, branded approval links, deposits and tailoring-order tracking.

## What is implemented

### Tailor consultation workflow

- automatically creates a private browser-based studio workspace
- studio branding: business name, tagline, logo, contact details and brand colour
- create and reopen client records
- save the client model photo and measurements
- create and reopen consultations for each client
- save inspiration images and outfit directions with the consultation
- save generated try-ons as numbered design versions
- apply simple fashion changes for neckline, sleeves, length, fit and colour
- create a branded client approval link
- allow the client to approve a version or request changes
- record quotation, deposit and tailoring-order status

### Real try-on workflow

- model and inspiration uploads
- centimetre/inch measurement conversion
- event, garment, fit, fabric, colour and written design controls
- garment detection and reviewable crop
- clean garment reconstruction and local chroma cleanup
- identity-preserving try-on generation
- one to three variations, with one result selected by default
- approve, reject and corrective regeneration
- before/after comparison

### Payments and deployment

- Paystack hosted checkout
- M-PESA and card channel support
- prepaid credit packages
- idempotent payment verification and webhook fulfilment
- server-controlled pricing
- Render Blueprint and persistent disk configuration
- GitHub Pages frontend support

## Consultation flow

```text
Create or select client
        ↓
Save model photo and measurements
        ↓
Create consultation and upload inspiration
        ↓
Generate realistic try-on
        ↓
Apply changes and save numbered versions
        ↓
Create branded client approval link
        ↓
Client approves or requests changes
        ↓
Record quote, deposit and tailoring order
```

## Storage model

Runtime data is stored beneath `DRESSCODE_DATA_DIR`:

```text
jobs/             staged OpenAI try-on jobs and generated assets
payments/         guest wallets, payment intents and credit ledger
consultations/    studios, clients, measurements, versions, approvals and orders
```

The current studio and payment wallets use private browser tokens. This is suitable for an MVP, but account authentication and recovery are required before broad public use.

Public approval links use revocable random tokens. Creating a new approval link invalidates the previous link. Public responses do not expose the client model photo, body measurements, internal notes, deposit reference or private studio token.

## Requirements

- Node.js 20 or newer
- OpenAI API key
- Paystack secret key for payments
- persistent production storage
- network access from the backend

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:4173`.

## Main environment variables

```bash
OPENAI_API_KEY=
PAYSTACK_SECRET_KEY=
PAYSTACK_CURRENCY=KES
PAYSTACK_CHANNELS=mobile_money,card
PAYSTACK_CALLBACK_URL=https://biwotony.github.io/dresscode-virtual-stylist/
PAYMENTS_REQUIRED=false
DRESSCODE_DATA_DIR=.dresscode
CORS_ORIGIN=https://biwotony.github.io
```

Keep both secret keys on the server. Never place them in `public/config.js`, browser JavaScript or GitHub Pages settings.

## Default credit packages

| Package | Price | Credits |
| --- | ---: | ---: |
| Single Try-On | KES 350 | 1 |
| Event Pack | KES 1,200 | 4 |
| Style Pack | KES 2,500 | 10 |
| Studio Pack | KES 11,000 | 50 |

Override packages with `PAYSTACK_PLANS_JSON`; see [Payments](docs/payments.md).

## GitHub Pages and approval links

GitHub Pages hosts the frontend. The Render service hosts real try-on, consultations and payments.

After deploying the backend:

1. Open **Backend connection** in the Pages app.
2. Enter the Render service URL.
3. Save it.
4. Configure studio branding.
5. Create a client and consultation.
6. Generate and save a design version.
7. Create the approval link.

The approval URL includes the backend address so the client can open it from GitHub Pages without configuring anything.

## Validation

```bash
npm test
npm run check
```

## Documentation

- [Consultation workflow](docs/consultations.md)
- [Architecture](docs/architecture.md)
- [Payments](docs/payments.md)
- [Deployment](docs/deployment.md)

## Important limitations

- measurements are prompt guidance, not a 3D body scan or tailoring guarantee
- generated images are visual design previews, not physical fit simulation
- studio access is tied to a browser token and currently has no recovery
- generated job assets retain the original MVP access model; authenticated accounts should protect all jobs and assets before broad launch
- define photo retention, deletion, consent and refund policies before accepting public customers

## Licence

MIT
