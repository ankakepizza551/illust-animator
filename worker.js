const ALLOWED_ORIGINS = [
  'https://illust-animator.pages.dev',
  'https://illust-animator.workers.dev',
];

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || ALLOWED_ORIGINS.find(o => o === origin) || '';
  return {
    'Access-Control-Allow-Origin': allowed || origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORSプリフライト
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

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
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
      });
    }

    // Anthropic APIプロキシ
    if (url.pathname === '/api/detect') {
      const body = await request.json();
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
      });
    }

    // それ以外は静的ファイルを返す
    return env.ASSETS.fetch(request);
  }
};
