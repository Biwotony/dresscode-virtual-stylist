import sharp from 'sharp';

const HEX = /^#[0-9a-f]{6}$/i;

export function decodeImageDataUrl(value) {
  if (typeof value !== 'string') throw new Error('Image data must be a data URL.');
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error('Only PNG, JPEG and WEBP data URLs are supported.');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw new Error('The image payload is empty.');
  return { buffer, mime: match[1].toLowerCase() };
}

export async function normalisePng(buffer, maxDimension = 2048) {
  const pipeline = sharp(buffer).rotate().toColourspace('srgb');
  const metadata = await pipeline.metadata();
  const width = metadata.width || maxDimension;
  const height = metadata.height || maxDimension;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return pipeline
    .resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), {
      fit: 'inside',
      withoutEnlargement: true
    })
    .png()
    .toBuffer();
}

export async function imageDimensions(buffer) {
  const metadata = await sharp(buffer).metadata();
  return { width: metadata.width || 1024, height: metadata.height || 1024 };
}

export async function cropNormalisedBox(buffer, box, paddingRatio = 0.1) {
  const source = await normalisePng(buffer);
  const metadata = await sharp(source).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const x = Math.max(0, Math.min(999, Number(box?.x) || 0));
  const y = Math.max(0, Math.min(999, Number(box?.y) || 0));
  const normalisedWidth = Math.max(1, Math.min(1000 - x, Number(box?.width) || 1000));
  const normalisedHeight = Math.max(1, Math.min(1000 - y, Number(box?.height) || 1000));
  const rawLeft = (x / 1000) * width;
  const rawTop = (y / 1000) * height;
  const rawWidth = (normalisedWidth / 1000) * width;
  const rawHeight = (normalisedHeight / 1000) * height;
  const padding = Math.max(10, Math.round(Math.max(rawWidth, rawHeight) * paddingRatio));
  const left = Math.max(0, Math.floor(rawLeft - padding));
  const top = Math.max(0, Math.floor(rawTop - padding));
  const right = Math.min(width, Math.ceil(rawLeft + rawWidth + padding));
  const bottom = Math.min(height, Math.ceil(rawTop + rawHeight + padding));
  return sharp(source)
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .png()
    .toBuffer();
}

export function chooseChromaKey(primaryColour = '#808080') {
  const value = HEX.test(primaryColour) ? primaryColour : '#808080';
  const source = [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
  const candidates = [
    { hex: '#00ff00', rgb: [0, 255, 0] },
    { hex: '#ff00ff', rgb: [255, 0, 255] },
    { hex: '#00ffff', rgb: [0, 255, 255] }
  ];
  return candidates
    .map(candidate => ({
      ...candidate,
      distance: candidate.rgb.reduce((total, channel, index) => total + ((channel - source[index]) ** 2), 0)
    }))
    .sort((a, b) => b.distance - a.distance)[0].hex;
}

export async function removeChromaBackground(buffer, chromaKey, options = {}) {
  const tolerance = Math.max(18, Math.min(120, Number(options.tolerance) || 52));
  const feather = Math.max(24, Math.min(120, Number(options.feather) || 72));
  const target = [1, 3, 5].map(offset => Number.parseInt(chromaKey.slice(offset, offset + 2), 16));
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const distance = Math.sqrt(
      ((red - target[0]) ** 2) +
      ((green - target[1]) ** 2) +
      ((blue - target[2]) ** 2)
    );

    if (distance <= tolerance) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      continue;
    }

    if (distance < tolerance + feather) {
      const alphaScale = (distance - tolerance) / feather;
      data[index + 3] = Math.round(data[index + 3] * alphaScale);
    }

    const dominantKeyChannel = target.indexOf(Math.max(...target));
    const otherChannels = [0, 1, 2].filter(channel => channel !== dominantKeyChannel);
    const neutral = (data[index + otherChannels[0]] + data[index + otherChannels[1]]) / 2;
    const keyOffset = index + dominantKeyChannel;
    if (data[keyOffset] > neutral) data[keyOffset] = Math.round(neutral);
  }

  const transparent = await sharp(data, { raw: info }).png().toBuffer();
  return frameTransparentImage(transparent, options.canvasSize || 1024);
}

export async function frameTransparentImage(buffer, canvasSize = 1024, occupancy = 0.88) {
  const trimmed = await sharp(buffer).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const resized = await sharp(trimmed)
    .resize(Math.round(canvasSize * occupancy), Math.round(canvasSize * occupancy), {
      fit: 'inside',
      withoutEnlargement: false
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((canvasSize - resized.info.width) / 2);
  const top = Math.floor((canvasSize - resized.info.height) / 2);
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized.data, left, top }])
    .png()
    .toBuffer();
}

export async function chooseTryOnSize(buffer) {
  const { width, height } = await imageDimensions(buffer);
  const ratio = width / height;
  if (ratio < 0.82) return '1024x1536';
  if (ratio > 1.22) return '1536x1024';
  return '1024x1024';
}
