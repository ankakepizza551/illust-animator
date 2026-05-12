export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 特定のパスに来た時にプログラムを動かす例
    if (url.pathname === "/api/hello") {
      return new Response(JSON.stringify({ message: "Hello from Worker!" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // それ以外はHTMLを表示させたい場合、今の構成だとAssetsを併用するか
    // ここでHTMLをfetchして返す処理を書く必要があります。
    return new Response("Worker is running! Access /api/hello for JSON.");
  },
};
