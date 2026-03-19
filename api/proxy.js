export default async function handler(req, res) {
  const { path: rawPath, ...queryParams } = req.query;
  const apiPath = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
  const search = new URLSearchParams(queryParams).toString();
  const targetUrl = `https://worldbaseballleague.org/api/${apiPath}${search ? '?' + search : ''}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json',
        'x-api-key': process.env.WBL_API_KEY || 'wbl_doback_gumbo_2020',
      },
    });

    const body = await upstream.text();
    const ct = upstream.headers.get('content-type');

    res.setHeader('Cache-Control', 'no-store');
    if (ct) res.setHeader('Content-Type', ct);
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Upstream fetch failed', detail: String(err) });
  }
}
