export const config = { runtime: 'edge' };

const UPSTREAM = 'https://atl-01.statsplus.net/world';

export default async function handler(req) {
  const url = new URL(req.url);
  // Keep the full /api/... path and append query string
  const targetUrl = `${UPSTREAM}${url.pathname}${url.search}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'User-Agent': req.headers.get('user-agent') || '',
        'Accept': req.headers.get('accept') || 'application/json',
      },
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k !== 'set-cookie' && k !== 'content-encoding' && k !== 'content-length' && k !== 'vary') {
        responseHeaders.set(key, value);
      }
    });

    // Prevent browser from caching API responses as HTML on error
    responseHeaders.set('Cache-Control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Upstream fetch failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
