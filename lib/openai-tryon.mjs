function outputText(result) {
  if (typeof result?.output_text === 'string') return result.output_text;
  for (const item of result?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function shouldRetry(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function providerError(result, status, operation) {
  const message = result?.error?.message || `${operation} failed (${status}).`;
  const code = result?.error?.code || result?.error?.type || '';
  const lower = `${code} ${message}`.toLowerCase();

  if (status === 401 || lower.includes('invalid api key') || lower.includes('incorrect api key')) {
    return new Error('OpenAI rejected the API key. Replace OPENAI_API_KEY in Render and redeploy.');
  }
  if (lower.includes('insufficient_quota') || lower.includes('billing') || lower.includes('quota')) {
    return new Error('OpenAI API billing or credits are unavailable. Add API billing in the OpenAI Platform, then retry.');
  }
  if (lower.includes('organization') && lower.includes('verif')) {
    return new Error('OpenAI requires organization verification before this image model can be used. Complete verification in the OpenAI Platform, then retry.');
  }
  if (status === 429) {
    return new Error('OpenAI is rate-limiting image generation. Wait briefly and regenerate.');
  }
  return new Error(message);
}

async function requestJsonWithRetry(url, init, { operation, timeout = 120_000, attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) return result;
      const error = providerError(result, response.status, operation);
      if (!shouldRetry(response.status) || attempt === attempts) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      if (!timedOut || attempt === attempts) throw error;
    }
    await wait(900 * attempt);
  }
  throw lastError || new Error(`${operation} failed.`);
}

export async function analyseGarment({ apiKey, baseUrl, model, imageBuffer, direction = '' }) {
  const result = await requestJsonWithRetry(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Identify the single main garment or complete outfit intended as the fashion reference. Return its concise name, garment category, primary colour, optional secondary colour, material clues, construction details and a tight bounding box using integer x, y, width and height coordinates normalised to a 1000 by 1000 image. If several garments are present, choose the visually dominant complete look.${direction ? ` User correction: ${direction}` : ''}`
          },
          {
            type: 'input_image',
            image_url: `data:image/png;base64,${imageBuffer.toString('base64')}`,
            detail: 'high'
          }
        ]
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'garment_reference',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              category: { type: 'string' },
              primaryColour: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
              secondaryColour: {
                anyOf: [
                  { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
                  { type: 'null' }
                ]
              },
              material: { type: 'string' },
              details: { type: 'array', items: { type: 'string' }, maxItems: 10 },
              boundingBox: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  x: { type: 'integer', minimum: 0, maximum: 999 },
                  y: { type: 'integer', minimum: 0, maximum: 999 },
                  width: { type: 'integer', minimum: 1, maximum: 1000 },
                  height: { type: 'integer', minimum: 1, maximum: 1000 }
                },
                required: ['x', 'y', 'width', 'height']
              }
            },
            required: ['name', 'category', 'primaryColour', 'secondaryColour', 'material', 'details', 'boundingBox']
          }
        }
      }
    })
  }, { operation: 'Garment analysis', timeout: 120_000 });

  const text = outputText(result);
  if (!text) throw new Error('Garment analysis returned no structured result.');
  return JSON.parse(text);
}

function imageForm({ model, quality, size, prompt, images, background, inputFidelity }) {
  const form = new FormData();
  form.set('model', model);
  form.set('prompt', prompt);
  form.set('size', size);
  form.set('quality', quality);
  form.set('output_format', 'png');
  form.set('background', background);
  if (inputFidelity) form.set('input_fidelity', inputFidelity);
  images.forEach((image, index) => {
    form.append(
      'image[]',
      new Blob([image.buffer], { type: 'image/png' }),
      image.name || `reference-${index + 1}.png`
    );
  });
  return form;
}

export async function editImages({
  apiKey,
  baseUrl,
  model,
  quality,
  size,
  prompt,
  images,
  background = 'auto',
  inputFidelity = 'high'
}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: imageForm({ model, quality, size, prompt, images, background, inputFidelity }),
        signal: AbortSignal.timeout(300_000)
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        const encoded = result?.data?.[0]?.b64_json;
        if (!encoded) throw new Error('The image API returned no image data.');
        return Buffer.from(encoded, 'base64');
      }
      const error = providerError(result, response.status, 'Image generation');
      if (!shouldRetry(response.status) || attempt === 3) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      if (!timedOut || attempt === 3) throw error;
    }
    await wait(1200 * attempt);
  }
  throw lastError || new Error('Image generation failed.');
}
