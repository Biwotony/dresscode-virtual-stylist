function outputText(result) {
  if (typeof result?.output_text === 'string') return result.output_text;
  for (const item of result?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

export async function analyseGarment({ apiKey, baseUrl, model, imageBuffer, direction = '' }) {
  const response = await fetch(`${baseUrl}/responses`, {
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
    }),
    signal: AbortSignal.timeout(90_000)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || `Garment analysis failed (${response.status}).`);
  const text = outputText(result);
  if (!text) throw new Error('Garment analysis returned no structured result.');
  return JSON.parse(text);
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

  const response = await fetch(`${baseUrl}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || `Image generation failed (${response.status}).`);
  const encoded = result?.data?.[0]?.b64_json;
  if (!encoded) throw new Error('The image API returned no image data.');
  return Buffer.from(encoded, 'base64');
}
