export function buildStylingBrief({
  event,
  garment,
  fit,
  fabric,
  colour,
  idea,
  measurements,
  inspirationAdded
}) {
  const measurementList = Object.values(measurements || {}).map(
    item => `${item.label}: ${item.value} ${item.unit}`
  );

  return {
    event,
    garment,
    fit,
    fabric,
    colour,
    idea: idea?.trim() || `Create a ${fit.toLowerCase()} ${garment.toLowerCase()} suitable for ${event.toLowerCase()}.`,
    measurements: measurements || {},
    inspirationAdded: Boolean(inspirationAdded),
    instructions: [
      'Preserve the model’s identity, face, skin tone, pose and background.',
      `Dress the model in a ${fit.toLowerCase()} ${garment.toLowerCase()} for ${event.toLowerCase()}.`,
      `Use ${fabric.toLowerCase()} as the main material and ${colour} as the primary colour.`,
      measurementList.length
        ? `Respect these measurements and proportions: ${measurementList.join(', ')}.`
        : 'Estimate garment proportions carefully from the model image.',
      inspirationAdded
        ? 'Use the inspiration image for silhouette, construction, texture and detailing while keeping the result original.'
        : 'Create an original design based on the written styling direction.',
      'Render realistic fabric drape, seams, folds, lighting and occlusion around the body.'
    ]
  };
}

export function formatBriefAsText(brief) {
  return [
    `${brief.event} · ${brief.garment} · ${brief.fit}`,
    brief.idea,
    '',
    ...brief.instructions.map((instruction, index) => `${index + 1}. ${instruction}`)
  ].join('\n');
}
