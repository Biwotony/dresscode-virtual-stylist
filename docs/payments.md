# Paystack and M-PESA integration

## Checkout approach

Dresscode uses Paystack hosted checkout rather than collecting card or M-PESA credentials itself.

The backend initializes the transaction with its secret key and returns only the Paystack authorization URL. The configured channels default to:

```text
mobile_money,card
```

For an enabled Kenyan Paystack account, `mobile_money` exposes M-PESA in checkout.

## Configuration

```bash
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_CURRENCY=KES
PAYSTACK_SUBUNIT=100
PAYSTACK_CHANNELS=mobile_money,card
PAYSTACK_CALLBACK_URL=https://biwotony.github.io/dresscode-virtual-stylist/
PAYMENTS_REQUIRED=true
```

### Packages

The application has default packages, but production pricing can be changed without editing browser code:

```bash
PAYSTACK_PLANS_JSON='[
  {"id":"single","name":"Single Try-On","price":250,"credits":1,"description":"One realistic try-on session"},
  {"id":"event","name":"Event Pack","price":800,"credits":4,"description":"Four try-on sessions"}
]'
```

`price` is expressed in the major currency unit. The backend multiplies it by `PAYSTACK_SUBUNIT` before sending the amount to Paystack.

## Paystack dashboard setup

1. Obtain test keys from Paystack.
2. Add the test secret key to the backend environment.
3. Enable the intended payment channels on the Paystack account.
4. Set the webhook URL to:

```text
https://YOUR-BACKEND.example.com/api/payments/webhook
```

5. Confirm `PAYSTACK_CALLBACK_URL` points to the frontend page.
6. Test payment completion, webhook delivery and credit fulfilment.
7. Replace the test secret with the live secret only after end-to-end testing.

## API endpoints

### Public payment configuration

`GET /api/payments/config`

Returns enabled status, currency, payment requirement and public package information.

### Create a guest credit wallet

`POST /api/payments/wallets`

Returns a private bearer token once. The frontend stores it in browser local storage.

### Read wallet

`GET /api/payments/wallet`

Requires:

```http
Authorization: Bearer WALLET_TOKEN
```

### Initialize checkout

`POST /api/payments/initialize`

```json
{
  "email": "customer@example.com",
  "planId": "event"
}
```

The backend chooses the amount and credits. The frontend cannot submit a custom price.

### Verify callback

`GET /api/payments/verify/:reference`

The server verifies:

- transaction status is `success`
- reference matches
- amount matches the saved payment intent
- currency matches
- credits have not already been delivered

### Webhook

`POST /api/payments/webhook`

The webhook validates `x-paystack-signature` using HMAC SHA-512 and processes `charge.success` events idempotently.

## Credit rules

When `PAYMENTS_REQUIRED=true`:

- one credit is consumed when a new real try-on job successfully starts
- crop approval, garment approval and corrective regeneration do not consume another credit
- if the job cannot be created after deduction, the credit is restored
- payment fulfilment and usage deductions are idempotent

## Current wallet limitation

The guest wallet token is a bearer credential saved in the browser. It is suitable for an MVP but not a replacement for user accounts.

Before scaling:

- add email or social sign-in
- attach wallets to authenticated users
- add account recovery
- restrict try-on jobs and assets by user
- provide transaction history and receipts
- define refund and expiry policies
