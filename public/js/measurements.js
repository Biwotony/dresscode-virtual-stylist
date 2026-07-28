export const measurementFields = [
  { id: 'height', label: 'Height' },
  { id: 'chest', label: 'Chest / bust' },
  { id: 'waist', label: 'Waist' },
  { id: 'hips', label: 'Hips' },
  { id: 'shoulder', label: 'Shoulder width' },
  { id: 'inseam', label: 'Inseam' },
  { id: 'sleeve', label: 'Sleeve length' },
  { id: 'garmentLength', label: 'Garment length' }
];

export function convertMeasurement(value, fromUnit, toUnit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '';
  if (fromUnit === toUnit) return Number(numericValue.toFixed(1));
  if (fromUnit === 'cm' && toUnit === 'in') return Number((numericValue / 2.54).toFixed(1));
  if (fromUnit === 'in' && toUnit === 'cm') return Number((numericValue * 2.54).toFixed(1));
  throw new Error(`Unsupported unit conversion: ${fromUnit} to ${toUnit}`);
}

export function readMeasurements(documentRoot, unit) {
  return measurementFields.reduce((result, field) => {
    const input = documentRoot.getElementById(field.id);
    const numericValue = Number(input?.value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      result[field.id] = {
        label: field.label,
        value: numericValue,
        unit
      };
    }
    return result;
  }, {});
}

export function getBodyRatios(measurements) {
  const chest = measurements.chest?.value || null;
  const waist = measurements.waist?.value || null;
  const hips = measurements.hips?.value || null;

  return {
    chestToWaist: chest && waist ? chest / waist : 1.22,
    hipsToWaist: hips && waist ? hips / waist : 1.28
  };
}
