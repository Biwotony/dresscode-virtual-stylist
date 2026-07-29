# Deployment

## Why GitHub Pages is not enough

GitHub Pages can host `public/`, but the Node backend is required to:

- protect OpenAI and Paystack secret keys
- initialize and verify payments
- validate webhook signatures
- process images with `sharp`
- run multi-stage try-on jobs
- store temporary photos, outputs, wallets and payment intents

## Render deployment

The repository includes `render.yaml`.

1. Create a Render Blueprint from this repository.
2. Set `OPENAI_API_KEY` as a secret.
3. Set `PAYSTACK_SECRET_KEY` as a secret.
4. Confirm the callback URL in `PAYSTACK_CALLBACK_URL`.
5. Deploy the service.
6. Copy the resulting backend URL.
7. In Paystack, set the webhook URL to `https://BACKEND/api/payments/webhook`.
8. Open the GitHub Pages app, expand **Backend connection**, enter the backend URL and save it.

The Blueprint mounts persistent storage at `/var/data` and sets `DRESSCODE_DATA_DIR=/var/data/dresscode`.

## Test mode first

Use a Paystack test secret and test payments first. Confirm:

- checkout opens
- M-PESA or the intended test channel appears
- callback returns to Dresscode
- webhook receives `charge.success`
- the wallet gains the correct number of credits exactly once
- one credit is deducted when try-on starts
- refreshing the callback does not duplicate credits

Only then switch to the live secret.

## Same-origin deployment

The Node server serves the frontend as well. When using the Node service URL directly, leave **Backend connection** blank.

## Docker

```bash
docker build -t dresscode-real-tryon .
docker run --rm -p 4173:4173 \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e PAYSTACK_SECRET_KEY="$PAYSTACK_SECRET_KEY" \
  -e PAYMENTS_REQUIRED=true \
  -v dresscode-data:/app/.dresscode \
  dresscode-real-tryon
```

## Required variables

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Garment analysis and image editing |
| `PAYSTACK_SECRET_KEY` | Server-side Paystack API authentication |
| `PAYSTACK_CALLBACK_URL` | Frontend return location after checkout |
| `PAYSTACK_CURRENCY` | Checkout currency, currently `KES` by default |
| `PAYSTACK_CHANNELS` | Hosted checkout channels |
| `PAYMENTS_REQUIRED` | Enforce one credit per real try-on |
| `DRESSCODE_DATA_DIR` | Runtime jobs, wallets and payment records |
| `CORS_ORIGIN` | Allowed separately hosted frontend origin(s) |

## Production checklist

- use live HTTPS URLs
- keep secret keys only in hosting secrets
- enable and test Paystack webhooks
- add authentication and account recovery
- protect asset and job endpoints by user
- publish pricing, refund and credit-expiry policies
- automate personal-photo deletion
- back up payment ledgers and reconcile them against Paystack
- add rate limits and generation-cost controls
