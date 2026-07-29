# Dresscode — Realistic Virtual Try-On

Dresscode is an identity-preserving AI virtual fitting studio with a staged garment-review pipeline and prepaid Paystack credits.

## What is implemented

- model and inspiration uploads
- centimetre/inch measurement conversion
- event, garment, fit, fabric, colour and written design controls
- garment detection and reviewable crop
- clean garment reconstruction and local chroma cleanup
- identity-preserving try-on generation
- one to three variations
- approve, reject and corrective regeneration
- before/after comparison
- Paystack hosted checkout
- M-PESA and card channel support
- prepaid credit packages
- idempotent payment verification and webhook fulfilment
- one-credit deduction per real try-on when payments are required
- private runtime storage excluded from Git
- Render Blueprint and Dockerfile

## Real try-on flow

```text
Model photo + inspiration + brief
             ↓
Review detected garment
             ↓
Review clean garment reference
             ↓
Generate realistic try-on variations
             ↓
Approve or correct the selected look
```

## Payment flow

```text
Create browser wallet
        ↓
Choose credit package
        ↓
Backend initializes Paystack Checkout
        ↓
Customer pays by M-PESA or card
        ↓
Webhook / verification confirms exact amount and currency
        ↓
Credits are added once
        ↓
One credit is consumed when a real try-on starts
```

Prices, credits, currency and enabled payment channels are controlled by server environment variables. The browser never receives the Paystack secret key.

## Requirements

- Node.js 20 or newer
- OpenAI API key
- Paystack secret key for payments
- network access from the backend

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:4173`.

Keep `PAYMENTS_REQUIRED=false` while testing without payments. Set it to `true` when the Paystack account, callback and webhook are ready.

## Main environment variables

```bash
OPENAI_API_KEY=
PAYSTACK_SECRET_KEY=
PAYSTACK_CURRENCY=KES
PAYSTACK_CHANNELS=mobile_money,card
PAYSTACK_CALLBACK_URL=https://biwotony.github.io/dresscode-virtual-stylist/
PAYMENTS_REQUIRED=true
DRESSCODE_DATA_DIR=.dresscode
CORS_ORIGIN=https://biwotony.github.io
```

Never place either secret key in `public/config.js`, browser JavaScript or GitHub Pages settings.

## Default credit packages

| Package | Price | Credits |
| --- | ---: | ---: |
| Single Try-On | KES 250 | 1 |
| Event Pack | KES 800 | 4 |
| Style Pack | KES 1,500 | 10 |
| Studio Pack | KES 6,000 | 50 |

Override them with `PAYSTACK_PLANS_JSON`; see [Payments](docs/payments.md).

## GitHub Pages

GitHub Pages hosts only the frontend. Real try-on and Paystack initialization must run on the Node backend.

After deploying the backend, open **Backend connection** in the Pages app, enter the backend URL and save it.

## Validation

```bash
npm test
npm run check
```

## Documentation

- [Architecture](docs/architecture.md)
- [Payments](docs/payments.md)
- [Deployment](docs/deployment.md)

## Privacy and account limitation

Try-on photos, generated assets, credit wallets and payment intent records are stored beneath `DRESSCODE_DATA_DIR`, which is excluded from Git.

The current MVP wallet is represented by a private browser token. Clearing browser storage loses access to that wallet. Add real user authentication before a broad public launch.

## Licence

MIT
