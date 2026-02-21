export const config = {
  runtime: 'edge',
};

const UPSTREAM_BASE = 'https://atl-01.statsplus.net/world/api/';

const PUBLIC_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=604800';
const DATE_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=300';

function isPrivateEndpoint(path) {
  return path.startsWith('ratings') || path.startsWith('mycsv');
}

function getCacheControl(path) {
  if (path.startsWith('date')) return DATE_CACHE_CONTROL;
  return PUBLIC_CACHE_CONTROL;
}

async function openCache() {
  try {
    return await caches.open('statsplus-proxy');
  } catch {
    return null;
  }
}

export default async function handler(req) {
  const { searchParams, pathname } = new URL(req.url);
  const path = pathname.replace('/api/', '');
  const targetUrl = `${UPSTREAM_BASE}${path}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;

  // Try to get from cache first (only for public endpoints)
  if (!isPrivateEndpoint(path)) {
    const cache = await openCache();
    if (cache) {
      const cachedResponse = await cache.match(targetUrl);
      if (cachedResponse) {
        return new Response(cachedResponse.body, {
          status: cachedResponse.status,
          headers: {
            ...Object.fromEntries(cachedResponse.headers),
            'X-Cache': 'HIT',
          },
        });
      }
    }
  }

  // Forward relevant headers
  const headers = new Headers();
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
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  });

  if (isPrivateEndpoint(path)) {
    const cookie = req.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: 'manual',
    });
  } catch (error) {
    return new Response('Upstream fetch failed.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Build response headers
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') return;
    if (lower === 'content-encoding') return;
    if (lower === 'content-length') return;
    if (lower === 'vary') return;
    responseHeaders.set(key, value);
  });

  if (!isPrivateEndpoint(path)) {
    responseHeaders.set('Cache-Control', getCacheControl(path));
    responseHeaders.set('Vary', 'Accept-Encoding');
    responseHeaders.set('X-Cache', 'MISS');
  }

  const response = new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });

  // Cache the response for public endpoints
  if (!isPrivateEndpoint(path) && upstream.ok) {
    const cache = await openCache();
    if (cache) {
      await cache.put(targetUrl, response.clone());
    }
  }

  return response;
}
