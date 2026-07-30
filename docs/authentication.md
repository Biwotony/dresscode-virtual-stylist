# Account authentication and ownership

Dresscode uses passwordless email magic links for tailor accounts.

## Sign-in flow

1. The browser requests a link for an email address.
2. The backend stores a SHA-256 hash of a random one-time secret and sends a URL through Resend.
3. The secret is placed in the URL fragment (`#auth=...`), so it is not sent to the static host in an HTTP request.
4. The link can be used once and expires after `AUTH_MAGIC_LINK_MINUTES` (15 minutes by default).
5. Successful verification creates a revocable server-side session. The browser stores only the bearer session token.
6. Sessions expire after `AUTH_SESSION_DAYS` (30 days by default).

## Resource ownership

An account owns one studio and one credit wallet. The following private resources are checked against the authenticated account on every request:

- studio profile
- client records, photos and measurements
- consultations, inspiration files and saved versions
- quotes, deposits and production records
- try-on jobs and generated assets
- Paystack payment intents and credit balances

Knowing a resource UUID is not enough to read or modify it.

Generated job images use short-lived HMAC-signed URLs so browser image elements can load them without exposing the account session in a query string. The underlying job must still belong to the account.

Public client approval links remain separate, revocable, limited-purpose tokens and expose only the intended approval record.

## Existing user migration

On the first verified sign-in, the browser sends its old anonymous studio and wallet credentials once. The backend:

- verifies and assigns the studio to the new account
- assigns or merges the legacy credit wallet
- preserves the existing balance and ledger
- assigns consultation-linked jobs to the account
- removes the old credentials from browser storage after successful migration

A legacy studio or wallet that has already been claimed by another account cannot be claimed again.

## Consent audit

Client upload consent is stored in the server-side client record with:

- the exact statement
- consent version
- confirmation timestamp
- confirming account ID
- consent history

The browser checkbox is no longer the authoritative consent record.

## Session controls

The account dialog supports:

- signing out the current browser
- signing out every browser and device
- permanent account deletion

Session secrets are stored as hashes. Revoked and expired sessions are rejected with HTTP 401.

## Permanent deletion

Account deletion requires the user to type `DELETE`. The backend removes:

- the complete studio directory and client/consultation files
- all account-owned try-on job directories and generated assets
- the wallet, payment intents and credit ledger
- magic links, sessions and the account email index

This is separate from the seven-day privacy retention sweep for consultation media.

## Required environment variables

```text
RESEND_API_KEY=
AUTH_EMAIL_FROM=Dresscode <signin@your-verified-domain.example>
AUTH_FRONTEND_URL=https://biwotony.github.io/dresscode-virtual-stylist/
AUTH_MAGIC_LINK_MINUTES=15
AUTH_SESSION_DAYS=30
AUTH_ASSET_SECRET=a-long-random-secret
```

`AUTH_EMAIL_FROM` must use a sending domain verified with the email provider. Never commit the API key or asset-signing secret.

For local development only, `AUTH_DEV_SHOW_MAGIC_LINK=true` returns the link in the API response instead of sending an email. It must not be enabled in production.

## Security limits

This is a file-backed MVP authentication system. Before high-volume or multi-staff deployment, move accounts, sessions, rate limits and ownership records to a transactional database. The current in-memory request rate limiter resets when the server restarts and does not coordinate across multiple server instances.

The session token is stored in browser local storage. It is expiring and revocable, and account recovery no longer depends on it, but a successful same-origin script injection could still read it. Keep third-party scripts off private studio pages and adopt a strict Content Security Policy when the frontend and backend deployment model permits it.
