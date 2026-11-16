export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    requestUrl.host = host;
    return originUrl.origin === requestUrl.origin;
  } catch {
    return false;
  }
}
