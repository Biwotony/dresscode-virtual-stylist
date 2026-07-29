export function buildStylingBrief({
  event,
  garment,
  fit,
  fabric,
  colour,
  idea,
  measurements,
  inspirationAdded,
  variationCount = 1
}) {
  const cleanIdea = idea?.trim();
  const measurementList = Object.values(measurements || {}).map(
    item => `${item.label}: ${item.value} ${item.unit}`
  );
  const resolvedIdea = cleanIdea || `Create a ${fit.toLowerCase()} ${garment.toLowerCase()} suitable for ${event.toLowerCase()}.`;
  return {
    event,
    garment,
    fit,
    fabric,
    colour,
    idea: resolvedIdea,
    measurements: measurements || {},
    inspirationAdded: Boolean(inspirationAdded),
    variationCount,
    instructions: [
      'Preserve the original person, identity, pose, hands, hair, framing, lighting and background.',
      `Replace only the clothing with a ${fit.toLowerCase()} ${garment.toLowerCase()} for ${event.toLowerCase()}.`,
      `Use ${fabric.toLowerCase()} and ${colour} as the primary colour.`,
      measurementList.length
        ? `Use these measurements as proportion guidance: ${measurementList.join(', ')}.`
        : 'Estimate clothing proportions from the visible body.',
      inspirationAdded
        ? 'Extract and preserve the inspiration garment before applying it to the model.'
        : 'Construct the requested design from the written brief.',
      'Render natural drape, seams, folds, hems, contact shadows and correct occlusion. Avoid an overlay appearance.'
    ]
  };
}

export function formatBriefAsText(brief) {
  return [
    `${brief.event} · ${brief.garment} · ${brief.fit}`,
    `Requested variations: ${brief.variationCount}`,
    brief.idea,
    '',
    ...brief.instructions.map((instruction, index) => `${index + 1}. ${instruction}`)
  ].join('\n');
}
