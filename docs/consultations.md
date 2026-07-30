# Tailor consultation workflow

## Studio identity

A verified Dresscode account owns one studio. Private consultation APIs require the account session bearer token. The server resolves the account first and then checks that the requested studio, client, consultation, job or file belongs to it.

On first sign-in, an existing anonymous browser studio can be claimed into the verified account. After migration, the legacy studio token is removed from browser storage and is no longer used for normal requests.

See [Authentication and ownership](authentication.md).

## Client records and consent

A client record stores:

- name, email, phone and private notes
- preferred unit and entered measurements
- normalized model photo
- consent statement, version, timestamp and confirming account ID
- creation and update timestamps

Saving a client photo or measurements requires the client-permission checkbox. The authoritative consent record is stored on the server, not only in the browser.

The model photo, measurements, contact details and consent audit are not included in public approval responses.

## Consultations

Each consultation belongs to one account-owned client and stores:

- title and event date
- internal notes and outfit brief
- saved inspiration image
- last account-owned try-on job reference
- numbered design versions
- client approval decision
- quotation, deposit and order status

## Design versions

The backend copies the selected generated try-on from the private job directory into the consultation directory. Each version includes:

- sequential version number and label
- change summary
- image asset
- brief snapshot
- source job reference
- draft, approved, changes-requested or superseded status

Both the job and the consultation must belong to the signed-in account before a version can be saved.

## Focused fashion changes

The tailor UI creates a corrective instruction from structured controls for neckline, sleeves, length, fit, waist position, colour and construction notes. The instruction asks the image model to preserve identity, pose, scene and successful garment details that were not named.

## Approval links

Creating an approval link generates a random limited-purpose token containing no client information. The server stores only its hash. Creating another link rotates the token and invalidates the earlier link.

The public page can display studio branding and saved design versions, accept approval or change requests, and show a limited order summary.

Public responses exclude:

- original client photo and measurements
- client contact details and consent history
- internal notes
- deposit method and reference
- account and session credentials

Deleting the account or consultation removes the approval assets and invalidates the link.

## Orders and production handoff

The current order record includes:

- quote amount in KES
- deposit amount, method, reference and status
- order status and due date
- production notes
- a printable production brief containing the chosen visual and measurements

The tailoring deposit is recorded manually. It is separate from the Paystack checkout used for try-on credits.

## Deletion and retention

- deleting a consultation removes its directory and saved version files
- deleting a client removes its directory after its consultations have been removed
- deleting the account removes the complete studio directory and all account-owned jobs and payment files
- the retention scheduler purges sensitive consultation media and temporary job assets after seven days
