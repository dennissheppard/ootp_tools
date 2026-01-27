const UPSTREAM_BASE = 'https://atl-01.statsplus.net/world/api/';

const PUBLIC_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=604800';
const DATE_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=300';

function buildQueryString(query) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (key === 'path') return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined) params.append(key, String(entry));
      });
      return;
    }
    if (value !== undefined) {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function isPrivateEndpoint(path) {
  return path.startsWith('ratings') || path.startsWith('mycsv');
}

function getCacheControl(path) {
  if (path.startsWith('date')) return DATE_CACHE_CONTROL;
  return PUBLIC_CACHE_CONTROL;
}

export default async function handler(req, res) {
  const rawPath = req.query?.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
  const query = buildQueryString(req.query);
  const targetUrl = `${UPSTREAM_BASE}${path}${query}`;

  const headers = {};
  const passthrough = [
    'user-agent',
    'accept',
    'accept-language',
    'accept-encoding',
    'cache-control',
    'pragma',
    'referer'
  ];
  passthrough.forEach((key) => {
    const value = req.headers[key];
    if (value) headers[key] = value;
  });

  if (isPrivateEndpoint(path) && req.headers.cookie) {
    headers.cookie = req.headers.cookie;
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: 'manual',
    });
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Upstream fetch failed.');
    return;
  }

  res.statusCode = upstream.status;

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') return;
    if (lower === 'content-encoding') return;
    if (lower === 'content-length') return;
    if (lower === 'vary') return;
    res.setHeader(key, value);
  });

  if (!isPrivateEndpoint(path)) {
    res.setHeader('Cache-Control', getCacheControl(path));
    res.setHeader('Vary', 'Accept-Encoding');
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.end(buffer);
}
