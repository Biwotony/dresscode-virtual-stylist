import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chooseChromaKey,
  chooseTryOnSize,
  cropNormalisedBox,
  decodeImageDataUrl,
  normalisePng,
  removeChromaBackground
} from './image-utils.mjs';
import { analyseGarment, editImages } from './openai-tryon.mjs';

function stageState(status = 'pending') {
  return {
    status,
    attempts: 0,
    assets: [],
    error: null,
    prompt: null,
    updatedAt: null
  };
}

function measurementText(measurements = {}) {
  const values = Object.values(measurements).map(item => `${item.label}: ${item.value} ${item.unit}`);
  return values.length ? values.join(', ') : 'No exact measurements were supplied; use the visible body proportions.';
}

function garmentPrompt(job, chromaKey, direction = '') {
  const metadata = job.referenceMetadata || {};
  const details = Array.isArray(metadata.details) && metadata.details.length
    ? metadata.details.join(', ')
    : 'all visible construction and design details';
  return `Use case: garment-reference reconstruction.

Image 1 is a cropped reference showing the exact garment or outfit to reproduce.

Create one complete empty ${metadata.name || job.brief.garment || 'garment'} as a clean front-facing fashion product reference. Remove the wearer, skin, hair, hands, background, furniture, props and unrelated clothing. Preserve only the source-supported silhouette, colour, material, neckline, sleeves, seams, closures, pattern, embroidery, trim and proportions. Primary colour: ${metadata.primaryColour || job.brief.colour}. Material clue: ${metadata.material || job.brief.fabric}. Visible details: ${details}.

Place the item centred with generous padding on an absolutely uniform solid ${chromaKey} background. No shadow, gradient, floor, hanger, mannequin, text overlay or watermark. Do not invent uncertain logos, pockets, fasteners, openings or decorations. Do not use ${chromaKey} anywhere on the garment.
${direction ? `Corrective direction: ${direction}` : ''}`;
}

function tryOnPrompt(job, direction = '', corrective = false) {
  const brief = job.brief;
  const inspirationClause = job.stages.garment.status === 'approved' || job.stages.garment.status === 'review'
    ? 'Image 2 is the exact clean garment reference. Preserve its construction, material, colour, pattern, details, length and closures.'
    : 'No garment image was supplied. Construct the clothing strictly from the written design brief.';
  const correctiveClause = corrective
    ? 'The last image is a failed result. Correct only the named problem while preserving every successful part of the original model photo and garment.'
    : '';

  return `Use case: identity-preserving virtual try-on.

Image 1 is the exact original model photograph. ${inspirationClause} ${correctiveClause}

Primary request: Replace only the clothing on the person in Image 1 with the requested outfit. Produce a natural photorealistic edit, not an overlay and not a new editorial photoshoot.

Identity and scene preservation: Keep the same recognisable person, face, skin tone, hair, age, build, body proportions, pose, hands, camera angle, framing, lighting, shadows and background. Do not change the location. Do not add another person. Keep uncovered skin and hair unchanged.

Outfit brief: ${brief.idea}
Event: ${brief.event}.
Garment: ${brief.garment}.
Fit: ${brief.fit}.
Fabric: ${brief.fabric}.
Primary colour: ${brief.colour}.
Measurements and proportion guidance: ${measurementText(brief.measurements)}

Garment realism: Make the clothing follow the body and pose with natural fabric drape, tension, folds, seams, hems, sleeve placement, waist placement, contact shadows and realistic occlusion behind arms, hands and hair. Preserve realistic anatomy. Avoid painted-on clothing, translucent overlays, floating edges, duplicated limbs, hidden hands, artificial smoothing, changed facial features, text or watermark.
${direction ? `Corrective direction: ${direction}` : ''}`;
}

export class TryOnPipeline {
  constructor({ store, env = process.env }) {
    this.store = store;
    this.env = env;
    this.running = new Set();
  }

  setting(name, fallback = '') {
    return this.env[name]?.trim() || fallback;
  }

  get config() {
    return {
      ready: Boolean(this.setting('OPENAI_API_KEY')),
      visionModel: this.setting('OPENAI_VISION_MODEL', 'gpt-5-mini'),
      imageModel: this.setting('OPENAI_IMAGE_MODEL', 'gpt-image-1'),
      imageQuality: this.setting('OPENAI_IMAGE_QUALITY', 'high'),
      apiBaseUrl: this.setting('OPENAI_API_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '')
    };
  }

  async create({ modelImage, inspirationImage, brief, variationCount }) {
    if (!this.config.ready) throw Object.assign(new Error('Real try-on is not configured. Add OPENAI_API_KEY to the server environment.'), { statusCode: 503 });
    const model = decodeImageDataUrl(modelImage);
    const modelPng = await normalisePng(model.buffer);
    const inspirationPng = inspirationImage ? await normalisePng(decodeImageDataUrl(inspirationImage).buffer) : null;
    const seed = {
      status: 'active',
      brief,
      variationCount: Math.max(1, Math.min(3, Number(variationCount) || 1)),
      referenceMetadata: null,
      stages: {
        reference: stageState(inspirationPng ? 'pending' : 'skipped'),
        garment: stageState(inspirationPng ? 'pending' : 'skipped'),
        tryon: stageState('pending')
      },
      internal: {
        modelFile: 'model.png',
        inspirationFile: inspirationPng ? 'inspiration.png' : null,
        referenceCropFile: null,
        garmentFile: null,
        resultFiles: []
      }
    };
    const job = await this.store.create(seed);
    await this.store.writeAsset(job.id, 'model.png', modelPng);
    if (inspirationPng) await this.store.writeAsset(job.id, 'inspiration.png', inspirationPng);
    this.queue(inspirationPng ? 'reference' : 'tryon', job.id);
    return job;
  }

  queue(task, id, options = {}) {
    const key = `${id}:${task}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    const action = task === 'reference'
      ? this.prepareReference(id, options.direction)
      : task === 'garment'
        ? this.prepareGarment(id, options.direction)
        : this.prepareTryOn(id, options);
    Promise.resolve(action).finally(() => this.running.delete(key));
  }

  async updateStage(id, stageName, patch) {
    const job = await this.store.read(id);
    if (!job) throw Object.assign(new Error('Try-on job not found.'), { statusCode: 404 });
    Object.assign(job.stages[stageName], patch, { updatedAt: new Date().toISOString() });
    await this.store.save(job);
    return job;
  }

  async prepareReference(id, direction = '') {
    let job = await this.store.read(id);
    if (!job) return;
    job.stages.reference.status = 'processing';
    job.stages.reference.attempts += 1;
    job.stages.reference.error = null;
    job.stages.reference.prompt = direction || null;
    await this.store.save(job);

    try {
      const inspiration = await readFile(join(this.store.jobDir(id), job.internal.inspirationFile));
      const metadata = await analyseGarment({
        apiKey: this.setting('OPENAI_API_KEY'),
        baseUrl: this.config.apiBaseUrl,
        model: this.config.visionModel,
        imageBuffer: inspiration,
        direction
      });
      const crop = await cropNormalisedBox(inspiration, metadata.boundingBox, 0.12);
      const fileName = `reference-${job.stages.reference.attempts}.png`;
      const assetUrl = await this.store.writeAsset(id, fileName, crop);
      job = await this.store.read(id);
      job.referenceMetadata = metadata;
      job.internal.referenceCropFile = fileName;
      Object.assign(job.stages.reference, {
        status: 'review',
        assets: [{ url: assetUrl, label: metadata.name || 'Reference crop' }],
        error: null,
        updatedAt: new Date().toISOString()
      });
      await this.store.save(job);
    } catch (error) {
      await this.updateStage(id, 'reference', { status: 'failed', error: error.message });
    }
  }

  async prepareGarment(id, direction = '') {
    let job = await this.store.read(id);
    if (!job) return;
    job.stages.garment.status = 'processing';
    job.stages.garment.attempts += 1;
    job.stages.garment.error = null;
    job.stages.garment.prompt = direction || null;
    await this.store.save(job);

    try {
      const crop = await readFile(join(this.store.jobDir(id), job.internal.referenceCropFile));
      const chromaKey = chooseChromaKey(job.referenceMetadata?.primaryColour || job.brief.colour);
      const generated = await editImages({
        apiKey: this.setting('OPENAI_API_KEY'),
        baseUrl: this.config.apiBaseUrl,
        model: this.config.imageModel,
        quality: this.config.imageQuality,
        size: '1024x1024',
        background: 'opaque',
        inputFidelity: 'high',
        images: [{ buffer: crop, name: 'garment-reference.png' }],
        prompt: garmentPrompt(job, chromaKey, direction)
      });
      const rawName = `garment-source-${job.stages.garment.attempts}.png`;
      await this.store.writeAsset(id, rawName, generated);
      const cleaned = await removeChromaBackground(generated, chromaKey);
      const fileName = `garment-${job.stages.garment.attempts}.png`;
      const assetUrl = await this.store.writeAsset(id, fileName, cleaned);
      job = await this.store.read(id);
      job.internal.garmentFile = fileName;
      Object.assign(job.stages.garment, {
        status: 'review',
        assets: [{ url: assetUrl, label: job.referenceMetadata?.name || 'Clean garment reference' }],
        error: null,
        updatedAt: new Date().toISOString()
      });
      await this.store.save(job);
    } catch (error) {
      await this.updateStage(id, 'garment', { status: 'failed', error: error.message });
    }
  }

  async prepareTryOn(id, options = {}) {
    let job = await this.store.read(id);
    if (!job) return;
    job.stages.tryon.status = 'processing';
    job.stages.tryon.attempts += 1;
    job.stages.tryon.error = null;
    job.stages.tryon.prompt = options.direction || null;
    await this.store.save(job);

    try {
      const model = await readFile(join(this.store.jobDir(id), job.internal.modelFile));
      const garment = job.internal.garmentFile
        ? await readFile(join(this.store.jobDir(id), job.internal.garmentFile))
        : null;
      const size = await chooseTryOnSize(model);
      const replaceIndex = Number.isInteger(options.variationIndex) ? options.variationIndex : null;
      const count = replaceIndex === null ? job.variationCount : 1;
      const outputs = [];

      for (let index = 0; index < count; index += 1) {
        const images = [{ buffer: model, name: 'model-original.png' }];
        if (garment) images.push({ buffer: garment, name: 'garment.png' });
        if (replaceIndex !== null) {
          const previous = job.internal.resultFiles?.[replaceIndex];
          if (previous) images.push({ buffer: await readFile(join(this.store.jobDir(id), previous)), name: 'failed-result.png' });
        }
        const generated = await editImages({
          apiKey: this.setting('OPENAI_API_KEY'),
          baseUrl: this.config.apiBaseUrl,
          model: this.config.imageModel,
          quality: this.config.imageQuality,
          size,
          background: 'auto',
          inputFidelity: 'high',
          images,
          prompt: tryOnPrompt(job, options.direction || '', replaceIndex !== null)
        });
        const outputIndex = replaceIndex === null ? index : replaceIndex;
        const fileName = `tryon-${job.stages.tryon.attempts}-${outputIndex + 1}.png`;
        const assetUrl = await this.store.writeAsset(id, fileName, generated);
        outputs.push({ fileName, assetUrl, outputIndex });
      }

      job = await this.store.read(id);
      const resultFiles = Array.isArray(job.internal.resultFiles) ? [...job.internal.resultFiles] : [];
      const resultAssets = Array.isArray(job.stages.tryon.assets) ? [...job.stages.tryon.assets] : [];
      for (const output of outputs) {
        resultFiles[output.outputIndex] = output.fileName;
        resultAssets[output.outputIndex] = {
          url: output.assetUrl,
          label: `Variation ${output.outputIndex + 1}`
        };
      }
      job.internal.resultFiles = resultFiles;
      Object.assign(job.stages.tryon, {
        status: 'review',
        assets: resultAssets.filter(Boolean),
        error: null,
        updatedAt: new Date().toISOString()
      });
      await this.store.save(job);
    } catch (error) {
      await this.updateStage(id, 'tryon', { status: 'failed', error: error.message });
    }
  }

  async act(id, stageName, action, input = {}) {
    const allowedStages = new Set(['reference', 'garment', 'tryon']);
    const allowedActions = new Set(['approve', 'reject', 'regenerate']);
    if (!allowedStages.has(stageName) || !allowedActions.has(action)) {
      throw Object.assign(new Error('Invalid try-on stage action.'), { statusCode: 400 });
    }
    let job = await this.store.read(id);
    if (!job) throw Object.assign(new Error('Try-on job not found.'), { statusCode: 404 });

    if (action === 'reject') {
      job.stages[stageName].status = 'rejected';
      job.status = 'rejected';
      await this.store.save(job);
      return job;
    }

    if (action === 'regenerate') {
      const direction = typeof input.prompt === 'string' ? input.prompt.trim().slice(0, 1500) : '';
      if (!direction) throw Object.assign(new Error('Add a corrective direction before regenerating.'), { statusCode: 400 });
      job.stages[stageName].status = 'processing';
      job.stages[stageName].error = null;
      await this.store.save(job);
      this.queue(stageName, id, {
        direction,
        variationIndex: stageName === 'tryon' && Number.isInteger(input.variationIndex)
          ? input.variationIndex
          : undefined
      });
      return job;
    }

    if (job.stages[stageName].status !== 'review') {
      throw Object.assign(new Error('This stage is not ready for approval.'), { statusCode: 409 });
    }
    job.stages[stageName].status = 'approved';
    if (stageName === 'tryon') {
      const approvedIndex = Number.isInteger(input.variationIndex) ? input.variationIndex : 0;
      job.stages.tryon.approvedIndex = approvedIndex;
      job.status = 'complete';
    }
    await this.store.save(job);
    if (stageName === 'reference') this.queue('garment', id);
    if (stageName === 'garment') this.queue('tryon', id);
    return job;
  }
}
