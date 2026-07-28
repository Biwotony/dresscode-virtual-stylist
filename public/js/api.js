export async function requestGeneratedLook(payload) {
  const response = await fetch('./api/generate-look', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'Unable to generate the styled look.');
  }
  return result;
}

export function resolveProviderImage(result) {
  if (result?.imageUrl) return result.imageUrl;
  if (result?.imageBase64) {
    return result.imageBase64.startsWith('data:')
      ? result.imageBase64
      : `data:image/png;base64,${result.imageBase64}`;
  }
  return null;
}
