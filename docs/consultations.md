# Tailor consultation workflow

## Studio identity

The browser receives a random studio token from:

```text
POST /api/consultations/studios
```

The token is saved in browser local storage and sent in the `X-Dresscode-Studio` header. Only a SHA-256 hash is stored on the server.

This is an MVP identity mechanism. Replace it with account authentication before broad launch.

## Client records

A client record stores:

- name, email, phone and private notes
- preferred unit
- entered measurements
- normalized model photo
- timestamps

The model photo and measurements are not included in public approval responses.

## Consultations

Each consultation belongs to one client and stores:

- title and event date
- internal notes
- outfit brief
- saved inspiration image
- last try-on job reference
- numbered design versions
- client approval decision
- quotation, deposit and order status

## Design versions

The backend copies the selected generated try-on from the temporary job directory into the consultation directory. The consultation therefore keeps the version even if the original try-on job is reset or removed.

Each version includes:

- sequential version number
- label
- change summary
- image asset
- brief snapshot
- source job reference
- draft, approved, changes-requested or superseded status

## Simple fashion changes

The tailor UI creates a precise corrective instruction from structured controls:

- neckline
- sleeve type or length
- garment length or train
- fit and waist position
- colour
- additional construction or decoration notes

The instruction tells the image model to preserve identity, pose, scene and all successful garment details that were not named.

## Approval links

Creating an approval link generates a random token containing no client information. The server stores only its hash. Creating another link rotates the token and invalidates the earlier link.

The public page can:

- display studio branding and contact information
- display saved design versions
- let the client select a version
- approve it or request a change
- show a limited order summary

Public API responses intentionally exclude:

- original client model photo
- client measurements
- internal consultation notes
- deposit method and reference
- studio access token

## Orders and deposits

The current implementation records a tailoring order manually. It does not collect the tailoring deposit through the Paystack credit checkout.

Recorded fields include:

- quote amount in KES
- deposit amount
- method and reference
- deposit status
- order status
- due date
- production notes

A later milestone can add a separate customer-deposit payment flow without mixing deposits with try-on credits.
