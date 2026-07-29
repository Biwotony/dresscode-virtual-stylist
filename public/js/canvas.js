import { getBodyRatios } from './measurements.js';

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the model image.'));
    image.src = source;
  });
}

function containRect(imageWidth, imageHeight, canvasWidth, canvasHeight) {
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
    scale
  };
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  const normalized = clean.length === 3
    ? clean.split('').map(character => character + character).join('')
    : clean;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function createFabricPattern(context, fabric, colour) {
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = 28;
  patternCanvas.height = 28;
  const patternContext = patternCanvas.getContext('2d');
  patternContext.fillStyle = hexToRgba(colour, 0.72);
  patternContext.fillRect(0, 0, 28, 28);
  patternContext.strokeStyle = 'rgba(255,255,255,0.18)';
  patternContext.fillStyle = 'rgba(255,255,255,0.16)';
  patternContext.lineWidth = 1;

  if (fabric === 'Lace') {
    for (let y = 5; y < 28; y += 9) {
      for (let x = 5; x < 28; x += 9) {
        patternContext.beginPath();
        patternContext.arc(x, y, 2.5, 0, Math.PI * 2);
        patternContext.stroke();
      }
    }
  } else if (fabric === 'Velvet') {
    const gradient = patternContext.createLinearGradient(0, 0, 28, 28);
    gradient.addColorStop(0, 'rgba(255,255,255,0.03)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.12)');
    patternContext.fillStyle = gradient;
    patternContext.fillRect(0, 0, 28, 28);
  } else if (fabric === 'Linen' || fabric === 'Cotton blend') {
    for (let position = 0; position < 28; position += 4) {
      patternContext.beginPath();
      patternContext.moveTo(position, 0);
      patternContext.lineTo(position, 28);
      patternContext.stroke();
      patternContext.beginPath();
      patternContext.moveTo(0, position);
      patternContext.lineTo(28, position);
      patternContext.stroke();
    }
  } else if (fabric === 'Satin' || fabric === 'Silk') {
    const gradient = patternContext.createLinearGradient(0, 0, 28, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0.02)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.24)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.04)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.1)');
    patternContext.fillStyle = gradient;
    patternContext.fillRect(0, 0, 28, 28);
  } else {
    patternContext.beginPath();
    patternContext.moveTo(0, 24);
    patternContext.lineTo(24, 0);
    patternContext.stroke();
  }

  return context.createPattern(patternCanvas, 'repeat');
}

function traceGown(context, box, ratios, fit) {
  const centreX = box.x + box.width * 0.5;
  const shoulderY = box.y + box.height * 0.24;
  const waistY = box.y + box.height * 0.47;
  const hemY = box.y + box.height * 0.91;
  const shoulderWidth = box.width * Math.min(0.28, 0.21 * ratios.chestToWaist);
  const waistWidth = box.width * (fit === 'Fitted' ? 0.12 : 0.15);
  const hemWidth = box.width * (fit === 'Flowing' ? 0.36 : fit === 'Structured' ? 0.28 : 0.32);

  context.beginPath();
  context.moveTo(centreX - shoulderWidth, shoulderY);
  context.quadraticCurveTo(centreX - box.width * 0.18, shoulderY + box.height * 0.11, centreX - waistWidth, waistY);
  context.quadraticCurveTo(centreX - hemWidth, box.y + box.height * 0.72, centreX - hemWidth * 0.95, hemY);
  context.quadraticCurveTo(centreX, hemY + box.height * 0.025, centreX + hemWidth * 0.95, hemY);
  context.quadraticCurveTo(centreX + hemWidth, box.y + box.height * 0.72, centreX + waistWidth, waistY);
  context.quadraticCurveTo(centreX + box.width * 0.18, shoulderY + box.height * 0.11, centreX + shoulderWidth, shoulderY);
  context.quadraticCurveTo(centreX, shoulderY + box.height * 0.055, centreX - shoulderWidth, shoulderY);
  context.closePath();
}

function traceKaftan(context, box, fit) {
  const centreX = box.x + box.width * 0.5;
  const shoulderY = box.y + box.height * 0.23;
  const hemY = box.y + box.height * 0.9;
  const topWidth = box.width * 0.28;
  const sideWidth = box.width * (fit === 'Relaxed' || fit === 'Oversized' ? 0.37 : 0.32);

  context.beginPath();
  context.moveTo(centreX - topWidth, shoulderY);
  context.lineTo(centreX - sideWidth, box.y + box.height * 0.52);
  context.lineTo(centreX - sideWidth * 0.82, hemY);
  context.quadraticCurveTo(centreX, hemY + box.height * 0.02, centreX + sideWidth * 0.82, hemY);
  context.lineTo(centreX + sideWidth, box.y + box.height * 0.52);
  context.lineTo(centreX + topWidth, shoulderY);
  context.quadraticCurveTo(centreX, shoulderY + box.height * 0.05, centreX - topWidth, shoulderY);
  context.closePath();
}

function traceJumpsuit(context, box, fit) {
  const centreX = box.x + box.width * 0.5;
  const shoulderY = box.y + box.height * 0.24;
  const waistY = box.y + box.height * 0.49;
  const ankleY = box.y + box.height * 0.91;
  const shoulderWidth = box.width * 0.21;
  const waistWidth = box.width * (fit === 'Fitted' ? 0.12 : 0.15);
  const legWidth = box.width * (fit === 'Flowing' ? 0.15 : 0.11);
  const gap = box.width * 0.025;

  context.beginPath();
  context.moveTo(centreX - shoulderWidth, shoulderY);
  context.lineTo(centreX - waistWidth, waistY);
  context.lineTo(centreX - gap, waistY + box.height * 0.09);
  context.lineTo(centreX - gap - legWidth, ankleY);
  context.lineTo(centreX - gap + legWidth * 0.12, ankleY);
  context.lineTo(centreX, waistY + box.height * 0.16);
  context.lineTo(centreX + gap - legWidth * 0.12, ankleY);
  context.lineTo(centreX + gap + legWidth, ankleY);
  context.lineTo(centreX + gap, waistY + box.height * 0.09);
  context.lineTo(centreX + waistWidth, waistY);
  context.lineTo(centreX + shoulderWidth, shoulderY);
  context.quadraticCurveTo(centreX, shoulderY + box.height * 0.05, centreX - shoulderWidth, shoulderY);
  context.closePath();
}

function traceSuit(context, box, fit) {
  const centreX = box.x + box.width * 0.5;
  const shoulderY = box.y + box.height * 0.24;
  const waistY = box.y + box.height * 0.52;
  const ankleY = box.y + box.height * 0.91;
  const shoulderWidth = box.width * 0.22;
  const waistWidth = box.width * (fit === 'Fitted' ? 0.14 : 0.17);
  const legWidth = box.width * (fit === 'Relaxed' || fit === 'Oversized' ? 0.13 : 0.1);
  const gap = box.width * 0.022;

  context.beginPath();
  context.moveTo(centreX - shoulderWidth, shoulderY);
  context.lineTo(centreX - waistWidth, waistY);
  context.lineTo(centreX + waistWidth, waistY);
  context.lineTo(centreX + shoulderWidth, shoulderY);
  context.lineTo(centreX + box.width * 0.04, shoulderY + box.height * 0.04);
  context.lineTo(centreX, shoulderY + box.height * 0.13);
  context.lineTo(centreX - box.width * 0.04, shoulderY + box.height * 0.04);
  context.closePath();

  context.moveTo(centreX - waistWidth, waistY);
  context.lineTo(centreX - gap, waistY + box.height * 0.06);
  context.lineTo(centreX - gap - legWidth, ankleY);
  context.lineTo(centreX - gap + legWidth * 0.18, ankleY);
  context.lineTo(centreX, waistY + box.height * 0.14);
  context.lineTo(centreX + gap - legWidth * 0.18, ankleY);
  context.lineTo(centreX + gap + legWidth, ankleY);
  context.lineTo(centreX + gap, waistY + box.height * 0.06);
  context.lineTo(centreX + waistWidth, waistY);
  context.closePath();
}

function traceTwoPiece(context, box, fit, lowerKind) {
  const centreX = box.x + box.width * 0.5;
  const shoulderY = box.y + box.height * 0.25;
  const waistY = box.y + box.height * 0.48;
  const hemTopY = box.y + box.height * 0.58;
  const ankleY = box.y + box.height * 0.91;
  const shoulderWidth = box.width * 0.2;
  const waistWidth = box.width * (fit === 'Fitted' ? 0.14 : 0.18);
  const lowerWidth = box.width * (lowerKind === 'skirt' ? 0.28 : 0.12);
  const gap = box.width * 0.024;

  context.beginPath();
  context.moveTo(centreX - shoulderWidth, shoulderY);
  context.quadraticCurveTo(centreX - box.width * 0.16, shoulderY + box.height * 0.08, centreX - waistWidth, waistY);
  context.lineTo(centreX - waistWidth * 0.9, hemTopY);
  context.lineTo(centreX + waistWidth * 0.9, hemTopY);
  context.lineTo(centreX + waistWidth, waistY);
  context.quadraticCurveTo(centreX + box.width * 0.16, shoulderY + box.height * 0.08, centreX + shoulderWidth, shoulderY);
  context.quadraticCurveTo(centreX, shoulderY + box.height * 0.05, centreX - shoulderWidth, shoulderY);
  context.closePath();

  if (lowerKind === 'skirt') {
    context.beginPath();
    context.moveTo(centreX - waistWidth * 0.9, hemTopY);
    context.quadraticCurveTo(centreX - lowerWidth, box.y + box.height * 0.76, centreX - lowerWidth * 0.95, ankleY);
    context.quadraticCurveTo(centreX, ankleY + box.height * 0.025, centreX + lowerWidth * 0.95, ankleY);
    context.quadraticCurveTo(centreX + lowerWidth, box.y + box.height * 0.76, centreX + waistWidth * 0.9, hemTopY);
    context.closePath();
  } else {
    context.beginPath();
    context.moveTo(centreX - waistWidth * 0.9, hemTopY);
    context.lineTo(centreX - gap, hemTopY + box.height * 0.03);
    context.lineTo(centreX - gap - lowerWidth, ankleY);
    context.lineTo(centreX - gap + lowerWidth * 0.18, ankleY);
    context.lineTo(centreX, hemTopY + box.height * 0.1);
    context.lineTo(centreX + gap - lowerWidth * 0.18, ankleY);
    context.lineTo(centreX + gap + lowerWidth, ankleY);
    context.lineTo(centreX + gap, hemTopY + box.height * 0.03);
    context.lineTo(centreX + waistWidth * 0.9, hemTopY);
    context.closePath();
  }
}

function addHighlights(context, box, garment) {
  context.save();
  context.strokeStyle = 'rgba(255,255,255,0.38)';
  context.lineWidth = Math.max(1.5, box.width * 0.004);
  context.lineCap = 'round';
  const centreX = box.x + box.width * 0.5;

  if (garment === 'Gown' || garment === 'Kaftan' || garment === 'Blouse and skirt') {
    for (const offset of [-0.08, 0, 0.08]) {
      context.beginPath();
      context.moveTo(centreX + box.width * offset, box.y + box.height * 0.46);
      context.quadraticCurveTo(
        centreX + box.width * offset * 1.25,
        box.y + box.height * 0.67,
        centreX + box.width * offset * 1.7,
        box.y + box.height * 0.88
      );
      context.stroke();
    }
  } else {
    context.beginPath();
    context.moveTo(centreX, box.y + box.height * 0.3);
    context.lineTo(centreX, box.y + box.height * 0.51);
    context.stroke();
  }
  context.restore();
}

export async function renderConceptPreview({
  canvas,
  modelImage,
  garment,
  fit,
  fabric,
  colour,
  measurements
}) {
  const image = await loadImage(modelImage);
  const maxDimension = 1100;
  const naturalRatio = image.naturalWidth / image.naturalHeight;
  canvas.width = naturalRatio >= 1 ? maxDimension : Math.round(maxDimension * naturalRatio);
  canvas.height = naturalRatio >= 1 ? Math.round(maxDimension / naturalRatio) : maxDimension;

  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111318';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const box = containRect(image.naturalWidth, image.naturalHeight, canvas.width, canvas.height);
  context.drawImage(image, box.x, box.y, box.width, box.height);

  const ratios = getBodyRatios(measurements || {});
  context.save();
  context.globalCompositeOperation = 'source-over';
  const fill = createFabricPattern(context, fabric, colour);
  context.fillStyle = fill || hexToRgba(colour, 0.76);
  context.strokeStyle = hexToRgba(colour, 0.95);
  context.lineWidth = Math.max(2, box.width * 0.006);
  context.shadowColor = 'rgba(0,0,0,0.25)';
  context.shadowBlur = box.width * 0.015;

  if (garment === 'Suit') traceSuit(context, box, fit);
  else if (garment === 'Jumpsuit') traceJumpsuit(context, box, fit);
  else if (garment === 'Kaftan') traceKaftan(context, box, fit);
  else if (garment === 'Blouse and skirt') traceTwoPiece(context, box, fit, 'skirt');
  else if (garment === 'Top and trousers') traceTwoPiece(context, box, fit, 'trousers');
  else traceGown(context, box, ratios, fit);

  context.fill();
  context.stroke();
  context.restore();
  addHighlights(context, box, garment);

  return canvas.toDataURL('image/png', 0.92);
}
