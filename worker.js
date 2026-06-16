const ALLOWED_ORIGINS = [
  'https://illust-animator.pages.dev',
  'https://illust-animator.workers.dev',
];

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin)
    || (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN);
  if (!isAllowed) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORSプリフライト
    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(request, env);
      if (!headers) return new Response(null, { status: 403 });
      return new Response(null, { headers });
    }

    const headers = corsHeaders(request, env);
    if (!headers) return new Response('Forbidden', { status: 403 });

    // Gemini APIプロキシ
    if (url.pathname === '/api/gemini-detect') {
      const body = await request.json();
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', ...headers }
      });
    }

    // それ以外は静的ファイルを返す
    return env.ASSETS.fetch(request);
  }
};
