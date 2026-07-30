# Dresscode — Custom Fashion Consultation System

Dresscode takes a custom-fashion client from inspiration to an approved tailoring order. It combines verified tailor accounts, client records, measurements, AI design previews, design versioning, branded approvals, credits, deposits and production handoff.

## What is implemented

### Secure tailor accounts

- passwordless email magic-link sign-in
- single-use, short-lived sign-in links
- expiring, revocable server-side sessions
- sign out here and sign out all devices
- cross-device restoration of the same studio, clients and credits
- automatic first-sign-in migration of legacy browser studios and wallets
- account ownership checks for studios, clients, consultations, jobs, images and payments
- short-lived signed URLs for private generated job images
- permanent account deletion that removes records and files

See [Authentication](docs/authentication.md).

### Tailor consultation workflow

- studio branding: business name, tagline, logo, contact details and brand colour
- create and reopen client records
- save client photos and measurements with an auditable consent record
- create consultations and save inspiration images and design direction
- save generated previews as numbered versions
- apply focused changes to neckline, sleeves, length, fit and colour
- create a branded client approval link
- record approval, quotation, deposit, order status and due date
- print a production brief

### Real try-on workflow

- model and inspiration uploads
- centimetre/inch measurement conversion
- event, garment, fit, fabric, colour and structured design controls
- garment detection and reviewable crop
- clean garment reconstruction and local chroma cleanup
- identity-preserving try-on generation
- one to three variations
- approve, reject and corrective regeneration
- before/after comparison

### Payments and privacy

- Paystack hosted checkout with M-PESA and card support
- prepaid credit packages owned by the authenticated account
- idempotent verification and webhook fulfilment
- server-controlled pricing
- seven-day purge for sensitive consultation media and temporary jobs
- server-side consent timestamp, statement, version and confirming account ID
- public approval responses exclude private photos, measurements, internal notes and payment references

## Core flow

```text
Sign in with verified email
        ↓
Create or select client
        ↓
Confirm permission and save photo + measurements
        ↓
Create consultation and design direction
        ↓
Generate, refine and save versions
        ↓
Share branded approval
        ↓
Record quote, deposit and order
        ↓
Print production handoff
```

## Storage model

Runtime data is stored beneath `DRESSCODE_DATA_DIR`:

```text
auth/             accounts, email index, magic links and sessions
jobs/             account-owned try-on jobs and generated assets
payments/         account wallets, payment intents and credit ledger
consultations/    account-owned studios, clients, versions, approvals and orders
```

This remains a file-backed MVP. Use a transactional database before multi-instance or high-volume deployment.

## Requirements

- Node.js 20 or newer
- a Resend API key and verified sending domain for production sign-in email
- an OpenAI API key for real try-on
- a Paystack secret key for paid credits
- persistent production storage

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

For local-only sign-in testing, keep `AUTH_DEV_SHOW_MAGIC_LINK=true`. Production must send the link by email instead.

Open `http://localhost:4173`.

## Main environment variables

```bash
RESEND_API_KEY=
AUTH_EMAIL_FROM=Dresscode <signin@your-verified-domain.example>
AUTH_FRONTEND_URL=https://biwotony.github.io/dresscode-virtual-stylist/
AUTH_ASSET_SECRET=
OPENAI_API_KEY=
PAYSTACK_SECRET_KEY=
PAYSTACK_CURRENCY=KES
PAYSTACK_CHANNELS=mobile_money,card
PAYSTACK_CALLBACK_URL=https://biwotony.github.io/dresscode-virtual-stylist/
PAYMENTS_REQUIRED=false
DRESSCODE_DATA_DIR=.dresscode
DRESSCODE_RETENTION_DAYS=7
CORS_ORIGIN=https://biwotony.github.io
```

Keep all keys and signing secrets on the backend. Never place them in browser JavaScript or GitHub Pages configuration.

## Default credit packages

| Package | Price | Credits |
| --- | ---: | ---: |
| Single Try-On | KES 350 | 1 |
| Event Pack | KES 1,200 | 4 |
| Style Pack | KES 2,500 | 10 |
| Studio Pack | KES 11,000 | 50 |

Override packages with `PAYSTACK_PLANS_JSON`; see [Payments](docs/payments.md).

## Deployment

GitHub Pages hosts the frontend. Render hosts authentication, private data, generation and payments.

Before the production sign-in flow works:

1. Verify a sending domain with the email provider.
2. Set `RESEND_API_KEY` in Render.
3. Set `AUTH_EMAIL_FROM` to an address on that verified domain.
4. Keep `AUTH_DEV_SHOW_MAGIC_LINK` disabled in production.
5. Confirm `AUTH_FRONTEND_URL` points to the Pages app.
6. Test sign-in, migration, cross-device access, session revocation and account deletion.

## Validation

```bash
npm test
npm run check
```

## Documentation

- [Authentication and ownership](docs/authentication.md)
- [Consultation workflow](docs/consultations.md)
- [Architecture](docs/architecture.md)
- [Payments](docs/payments.md)
- [Deployment](docs/deployment.md)

## Important limitations

- measurements guide visual proportions; they are not a body scan or fit guarantee
- generated previews are not physical fittings or pattern-cutting guarantees
- account sessions are stored in browser local storage, but they expire, can be revoked and are no longer the recovery mechanism
- the sign-in rate limiter is process-local and resets on backend restart
- file-backed indexes are not transaction-safe for multi-instance deployment
- account deletion is immediate and permanent; there is no restore bin

## Licence

MIT
