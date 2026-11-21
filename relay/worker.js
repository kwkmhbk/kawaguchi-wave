// 遅延情報の中継サーバー（Cloudflare Workers）
// ODPT の APIキーはここ（Cloudflare の秘密の値 ODPT_KEY）にだけ置き、アプリには渡さない。
// アプリからの問い合わせを受けて ODPT から東京メトロの運行情報を取り、南北線の分だけを返す。
// 同じ結果を60秒ためておき、ODPT への問い合わせ回数を減らす。

const ODPT_URL = 'https://api.odpt.org/api/v4/odpt:TrainInformation?odpt:operator=odpt.Operator:TokyoMetro&acl:consumerKey=';
const NAMBOKU = 'odpt.Railway:TokyoMetro.Namboku';
const CACHE_SEC = 60;
// このアプリを置いている場所からの問い合わせだけを受け付ける（ブラウザでの読み込み制限）
const ALLOWED_ORIGINS = ['https://kwkmhbk.github.io'];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: cors });
    if (!env.ODPT_KEY) return new Response('ODPT_KEY が設定されていません', { status: 500, headers: cors });

    // ためておいた結果があれば、それを返す
    const cache = caches.default;
    const cacheKey = new Request('https://relay.cache/namboku');
    let body = null;
    const hit = await cache.match(cacheKey);
    if (hit) {
      body = await hit.text();
    } else {
      let res;
      try {
        res = await fetch(ODPT_URL + encodeURIComponent(env.ODPT_KEY), { cf: { cacheTtl: 0 } });
      } catch (e) {
        return new Response('ODPT に接続できません', { status: 502, headers: cors });
      }
      if (!res.ok) return new Response('ODPT HTTP ' + res.status, { status: 502, headers: cors });
      const json = await res.json();
      const list = Array.isArray(json) ? json.filter(x => x['odpt:railway'] === NAMBOKU) : [];
      body = JSON.stringify(list);
      ctx.waitUntil(cache.put(cacheKey, new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_SEC },
      })));
    }
    return new Response(body, {
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};
