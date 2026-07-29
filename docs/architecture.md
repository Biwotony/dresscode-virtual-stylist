# Real try-on architecture

## Pipeline

A Dresscode job moves through three reviewable stages.

### 1. Inspiration reference

When an inspiration image is supplied, the server analyses the image, identifies the intended garment, crops the reference and pauses for user approval.

### 2. Clean garment reconstruction

After crop approval, the server reconstructs a complete empty garment, removes the chroma background locally with `sharp`, frames the transparent reference and pauses for approval.

### 3. Identity-preserving try-on

After garment approval, the server sends the original model photo, approved garment reference and styling brief to the image-editing model. It requests preservation of identity, face, hair, hands, body proportions, pose, camera angle, framing, lighting and background, while prohibiting an overlay appearance.

The server produces one to three variations. The user can approve one, reject the job, or regenerate a selected variation with a corrective prompt.

## Runtime storage

Jobs are stored beneath `DRESSCODE_DATA_DIR` and never under a tracked repository path. The `DELETE /api/try-on/jobs/:id` endpoint removes a job directory.

## Try-on API

- `GET /api/health`
- `POST /api/try-on/jobs`
- `GET /api/try-on/jobs/:id`
- `POST /api/try-on/jobs/:id/stages/:stage/:action`
- `DELETE /api/try-on/jobs/:id`

Stages are `reference`, `garment` and `tryon`. Actions are `approve`, `reject` and `regenerate`.

## Payment and credit architecture

Dresscode uses a server-controlled prepaid credit model.

### Guest wallet

The backend creates an opaque wallet token in the form `wallet-id.secret`. Only a SHA-256 hash of the secret is stored on the server. The browser keeps the full token in local storage and sends it as a bearer token for wallet, payment and paid job-creation requests.

### Checkout initialization

The browser submits only an email address and package id. The backend looks up the package price and credit quantity from its own configuration, creates a payment intent and initializes Paystack hosted checkout. The client cannot choose the amount or credit quantity.

### Fulfilment

Credits can be fulfilled through either the signed `charge.success` webhook or the callback verification endpoint. Both paths validate status, reference, exact amount and currency. Wallet ledgers use stable references so repeated events cannot add credits twice.

### Credit consumption

When `PAYMENTS_REQUIRED=true`, the try-on job endpoint authenticates the wallet and consumes one credit before starting the pipeline. If synchronous job creation fails, an idempotent refund entry restores the credit. Review actions and corrective regenerations remain part of the same paid session.

### Runtime records

```text
DRESSCODE_DATA_DIR/
└── payments/
    ├── wallets/
    └── intents/
```

This file-backed design is suitable for one backend instance. A scaled deployment should move wallets, intents and ledgers into a transactional database and attach them to authenticated users.

## Production hardening

- place images in private object storage
- store jobs and wallet ledgers in a transactional database
- use signed short-lived asset URLs
- authenticate every job action
- process jobs with background workers
- enforce per-user cost and concurrency limits
- automatically delete personal images after a defined retention period
