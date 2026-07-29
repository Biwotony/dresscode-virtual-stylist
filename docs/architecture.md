# Real try-on architecture

## Pipeline

A Dresscode job moves through three reviewable stages.

### 1. Inspiration reference

When an inspiration image is supplied, the server:

1. analyses the image with a vision-capable Responses API model
2. identifies the dominant intended garment or complete look
3. returns structured metadata and a normalised bounding box
4. crops the reference with local image processing
5. pauses for user approval

When no inspiration is supplied, this stage and the clean-garment stage are skipped.

### 2. Clean garment reconstruction

After crop approval, the server:

1. sends the cropped reference to the image-edit endpoint
2. asks for a complete empty garment on a distant chroma background
3. removes the wearer and unrelated scene content
4. removes the chroma background locally with `sharp`
5. frames the transparent garment reference consistently
6. pauses for approval or corrective regeneration

This step gives the final try-on model a much cleaner and more exact clothing reference than a noisy inspiration photograph.

### 3. Identity-preserving try-on

After garment approval, the server sends:

1. the exact original model photo
2. the approved clean garment image, when available
3. the structured event, design, fabric, colour and measurement brief

The prompt explicitly requests preservation of identity, face, hair, hands, body proportions, pose, camera angle, framing, lighting and background. It requests body-aware fabric drape, folds, seams, contact shadows and occlusion, and explicitly prohibits an overlay appearance.

The server produces one to three variations. The user can approve one, reject the job, or regenerate a selected variation with a corrective prompt. Corrective regeneration includes the failed result as an additional reference.

## Runtime storage

Jobs are stored beneath `DRESSCODE_DATA_DIR` and never under a tracked repository path. Each job directory contains:

- the normalised model image
- the inspiration image
- reference crops
- clean garment images
- try-on variations
- `job.json`

The `DELETE /api/try-on/jobs/:id` endpoint removes the job directory.

## API

### Configuration

`GET /api/health`

Returns whether the OpenAI-backed try-on pipeline is ready.

### Create a job

`POST /api/try-on/jobs`

```json
{
  "modelImage": "data:image/jpeg;base64,...",
  "inspirationImage": "data:image/png;base64,...",
  "variationCount": 3,
  "brief": {
    "event": "Wedding",
    "garment": "Gown",
    "fit": "Fitted",
    "fabric": "Silk",
    "colour": "#17634e",
    "idea": "A floor-length emerald gown...",
    "measurements": {}
  }
}
```

### Read a job

`GET /api/try-on/jobs/:id`

### Review actions

`POST /api/try-on/jobs/:id/stages/:stage/:action`

Stages:

- `reference`
- `garment`
- `tryon`

Actions:

- `approve`
- `reject`
- `regenerate`

Regeneration body:

```json
{
  "prompt": "Preserve the original sleeve construction and remove the invented belt.",
  "variationIndex": 0
}
```

`variationIndex` applies to try-on regeneration and approval.

### Delete a job

`DELETE /api/try-on/jobs/:id`

## Production hardening

The current filesystem job store is suitable for an early single-instance product. For larger deployment:

- place source and output images in private object storage
- store job state in a database or durable queue
- use signed short-lived asset URLs
- authenticate every job action
- process jobs with background workers
- enforce per-user cost and concurrency limits
- automatically delete personal images after a defined retention period
