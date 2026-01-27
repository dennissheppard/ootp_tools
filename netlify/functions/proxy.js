const UPSTREAM_BASE = 'https://atl-01.statsplus.net/world/api/';

const PUBLIC_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=604800';
const DATE_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=300';

function buildQueryString(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (key === 'splat') return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined) search.append(key, String(entry));
      });
      return;
    }
    if (value !== undefined) {
      search.set(key, String(value));
    }
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function isPrivateEndpoint(path) {
  return path.startsWith('ratings') || path.startsWith('mycsv');
}

function getCacheControl(path) {
  if (path.startsWith('date')) return DATE_CACHE_CONTROL;
  return PUBLIC_CACHE_CONTROL;
}

exports.handler = async (event) => {
  const path = event.pathParameters?.splat || '';
  const query = buildQueryString(event.queryStringParameters || {});
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
    const value = event.headers?.[key];
    if (value) headers[key] = value;
  });

  if (isPrivateEndpoint(path) && event.headers?.cookie) {
    headers.cookie = event.headers.cookie;
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: event.httpMethod || 'GET',
      headers,
      redirect: 'manual',
    });
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Upstream fetch failed.',
    };
  }

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') return;
    if (lower === 'content-encoding') return;
    if (lower === 'content-length') return;
    if (lower === 'vary') return;
    responseHeaders[key] = value;
  });

  if (!isPrivateEndpoint(path)) {
    responseHeaders['Cache-Control'] = getCacheControl(path);
    responseHeaders['Vary'] = 'Accept-Encoding';
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());

  return {
    statusCode: upstream.status,
    headers: responseHeaders,
    body: buffer.toString('utf8'),
  };
};
