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

The default production packages are:

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
3. Enable the intended payment channels on the Paystack account.
4. Enable transaction receipts to customers and set the business support email shown on receipts.
5. Set the webhook URL to:

```text
https://YOUR-BACKEND.example.com/api/payments/webhook
```

6. Confirm `PAYSTACK_CALLBACK_URL` points to the frontend page.
7. Test payment completion, webhook delivery, receipt delivery, account recovery and credit fulfilment.
8. Replace the test secret with the live secret only after end-to-end testing.

## API endpoints

### Public payment configuration

`GET /api/payments/config`

Returns enabled status, currency, payment requirement, account-recovery support and public package information.

### Create a temporary browser wallet

`POST /api/payments/wallets`

Returns a private bearer token. The browser uses this token for the current session before and after the wallet is attached to a paid email account.

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

The backend chooses the amount and credits. The frontend cannot submit a custom price. The email is sent to Paystack as the transaction customer email and is saved with the payment intent.

After the first successful payment, Dresscode links the paid wallet to that normalized email address. A second browser cannot create a separate paid wallet for the same email without first recovering the existing account.

### Verify callback

`GET /api/payments/verify/:reference`

The server verifies:

- transaction status is `success`
- reference matches
- amount matches the saved payment intent
- currency matches
- credits have not already been delivered

A successful verification links the wallet to the checkout email.

### Recover paid credits

The browser exposes **Recover paid credits on this browser**. The user enters:

- the same email used for payment
- a successful Paystack transaction reference from the receipt

The server retrieves the saved payment intent, verifies the transaction directly with Paystack, checks the email, amount, currency, status and reference, then issues a new wallet token. Issuing the new token invalidates the older browser token.

This flow also recovers wallets created before email account linking was introduced, provided the successful payment intent and Paystack transaction still exist.

The current recovery method is an interim email-and-receipt credential. A full user account with magic-link sign-in remains the preferred longer-term authentication model.

### Webhook

`POST /api/payments/webhook`

The webhook validates `x-paystack-signature` using HMAC SHA-512 and processes `charge.success` events idempotently. Webhook fulfilment also links the paid wallet to its checkout email.

## Receipts

Dresscode passes the entered receipt email to Paystack during transaction initialization. Paystack receipt delivery is controlled by the merchant's transaction-receipt preference in the Paystack dashboard.

Dresscode currently displays and stores the successful transaction reference for recovery, but it does not send a second independent Dresscode-branded receipt email.

## Credit rules

When `PAYMENTS_REQUIRED=true`:

- one credit is consumed when a new real try-on job successfully starts
- crop approval, garment approval and corrective regeneration do not consume another credit
- if the job cannot be created after deduction, the credit is restored
- payment fulfilment and usage deductions are idempotent

## Remaining account work

Email-linked receipt recovery removes the browser-only loss risk for paid credits, but it is not the final account system. Before broad multi-user scaling:

- add email magic-link or social sign-in
- attach consultation studios and credit wallets to the same authenticated account
- add rate limiting and recovery-attempt auditing
- provide a complete transaction and receipt history
- define refund, transfer and credit-expiry policies
