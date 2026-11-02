export async function requestJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), ...options });
  const body = await response.json();
  if (!response.ok) {
    // Return provider messages, never request headers or tokens.
    throw new Error(body.error_description || body.message || body.error?.message || `Provider returned ${response.status}.`);
  }
  return body;
}
export const form = values => ({ method: 'POST', body: new URLSearchParams(values) });
