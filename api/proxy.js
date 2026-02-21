export const config = { runtime: 'edge' };

const UPSTREAM_BASE = 'https://atl-01.statsplus.net/world/api/';

const isPrivateEndpoint = (path) => path.startsWith('ratings') || path.startsWith('mycsv');

const normalizePath = (path) => path.replace(/^\/+/, '');

export default async function handler(req) {
  const url = new URL(req.url);
  const path = normalizePath(url.searchParams.get('path') || '');
  url.searchParams.delete('path');

  const search = url.searchParams.toString();
  const targetUrl = `${UPSTREAM_BASE}${path}${search ? `?${search}` : ''}`;

  const headers = new Headers();
  for (const key of ['user-agent', 'accept', 'accept-language', 'cache-control', 'pragma', 'referer']) {
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  }

  if (isPrivateEndpoint(path)) {
    const cookie = req.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: 'manual',
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const normalized = key.toLowerCase();
      if (normalized !== 'set-cookie' && normalized !== 'content-encoding' && normalized !== 'content-length' && normalized !== 'vary') {
        responseHeaders.set(key, value);
      }
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response('Upstream fetch failed.', { status: 502 });
  }
}
