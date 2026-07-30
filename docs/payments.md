# Paystack and M-PESA integration

## Checkout approach

Dresscode uses Paystack hosted checkout rather than collecting card or M-PESA credentials itself. The backend creates the transaction with server-controlled pricing and returns only the hosted checkout URL.

The default channels are:

```text
mobile_money,card
```

For an enabled Kenyan Paystack account, `mobile_money` exposes M-PESA in checkout.

## Account ownership

A credit wallet is created when a verified Dresscode account is first provisioned. The wallet is linked to the account ID and account email on the server.

- signing in on another device restores the same balance
- clearing browser storage does not destroy or orphan paid credits
- payment intents include both account ID and wallet ID
- one account cannot verify or spend another account’s payment
- first sign-in can claim or merge an older browser wallet
- account deletion removes the wallet, intents and ledger files

The browser session token authenticates payment requests. The old wallet bearer token is accepted only once during migration and is then removed from browser storage.

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

```text
Single Try-On: KES 350 / 1 credit
Event Pack: KES 1,200 / 4 credits
Style Pack: KES 2,500 / 10 credits
Studio Pack: KES 11,000 / 50 credits
```

Production pricing can be changed without editing browser code:

```bash
PAYSTACK_PLANS_JSON='[
  {"id":"single","name":"Single Try-On","price":350,"credits":1,"description":"One realistic try-on session"},
  {"id":"event","name":"Event Pack","price":1200,"credits":4,"description":"Four try-on sessions"}
]'
```

`price` is expressed in the major currency unit. The backend multiplies it by `PAYSTACK_SUBUNIT` before sending the amount to Paystack.

## Paystack dashboard setup

1. Obtain test keys from Paystack.
2. Add the test secret key to the backend environment.
3. Enable the intended payment channels.
4. Enable transaction receipts to customers and set the support email shown on receipts.
5. Set the webhook URL to:

```text
https://YOUR-BACKEND.example.com/api/payments/webhook
```

6. Confirm `PAYSTACK_CALLBACK_URL` points to the frontend.
7. Test sign-in, checkout, callback verification, webhook fulfilment and cross-device balance restoration.
8. Replace the test secret with the live secret only after end-to-end testing.

## API endpoints

### Public payment configuration

`GET /api/payments/config`

Returns enabled status, currency, payment requirement and public package information.

### Read the account wallet

`GET /api/payments/wallet`

Requires the authenticated Dresscode account session:

```http
Authorization: Bearer ACCOUNT_SESSION_TOKEN
```

### Initialize checkout

`POST /api/payments/initialize`

```json
{
  "email": "customer@example.com",
  "planId": "event"
}
```

The submitted email must match the signed-in account email. The backend chooses the price and credits; the browser cannot submit a custom amount.

### Verify callback

`GET /api/payments/verify/:reference`

The server verifies:

- the session account owns the saved payment intent
- the intent belongs to the account wallet
- transaction status is `success`
- reference, amount and currency match
- credits have not already been delivered

### Webhook

`POST /api/payments/webhook`

The webhook validates `x-paystack-signature` using HMAC SHA-512 and processes `charge.success` idempotently.

## Receipts

Dresscode sends the account email to Paystack as the transaction customer email. Customer receipt delivery depends on the merchant’s transaction-receipt preference in Paystack.

Dresscode does not currently send a second branded payment receipt email. The transaction reference and ledger remain available in the account wallet record.

## Credit rules

When `PAYMENTS_REQUIRED=true`:

- one credit is consumed when a new real try-on job starts
- crop approval, garment approval and corrective regeneration do not consume another credit
- the credit is restored when job creation fails after deduction
- payment fulfilment, deductions and refunds are idempotent

## Operational limits

- Wallets and intents are currently JSON files rather than database transactions.
- In-process locks protect a single server instance only.
- Define refund, transfer and credit-expiry policies before scaling paid usage.
- Keep Paystack secrets on the backend and use webhook verification in production.
