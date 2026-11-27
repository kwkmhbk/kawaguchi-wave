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
    if (new URL(request.url).pathname === '/timetable-watch') return timetableWatch(env, ctx, cors);

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

// ---- ダイヤ改正の見張り（GitHub の毎日の自動チェックと、アプリから呼ぶ） ----
// 南北線と埼玉高速鉄道は直通運転なので、ダイヤ改正はほぼ同じ日になる。
// 境目の赤羽岩淵駅の、南北線の駅時刻表から「印」（SHA-256 の先頭16文字）を作って返す。
// 時刻・行き先・種別・方向・曜日区分だけから作るので、データの取得日などが変わっても印は変わらない。
const WATCH_STATION = 'odpt.Station:TokyoMetro.Namboku.AkabaneIwabuchi';
const WATCH_URL = 'https://api.odpt.org/api/v4/odpt:StationTimetable?odpt:station=' + WATCH_STATION + '&acl:consumerKey=';
const WATCH_CACHE_SEC = 3600;

async function timetableWatch(env, ctx, cors) {
  const headers = { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const cache = caches.default;
  const cacheKey = new Request('https://relay.cache/timetable-watch');
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(await hit.text(), { headers });

  let res;
  try {
    res = await fetch(WATCH_URL + encodeURIComponent(env.ODPT_KEY), { cf: { cacheTtl: 0 } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'ODPT に接続できません' }), { status: 502, headers });
  }
  if (!res.ok) return new Response(JSON.stringify({ error: 'ODPT HTTP ' + res.status }), { status: 502, headers });
  const json = await res.json();
  const tables = Array.isArray(json) ? json : [];
  const norm = tables.map(t => [
    t['odpt:railDirection'] || '',
    t['odpt:calendar'] || '',
    (t['odpt:stationTimetableObject'] || []).map(o => [
      o['odpt:departureTime'] || o['odpt:arrivalTime'] || '',
      (o['odpt:destinationStation'] || []).join(','),
      o['odpt:trainType'] || '',
    ]),
  ]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const trains = norm.reduce((n, t) => n + t[2].length, 0);
  if (!trains) return new Response(JSON.stringify({ error: '時刻表が空です' }), { status: 502, headers });

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(norm)));
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const issued = [...new Set(tables.map(t => t['dct:issued']).filter(Boolean))].sort();
  const body = JSON.stringify({ station: WATCH_STATION, hash, tables: tables.length, trains, issued });
  ctx.waitUntil(cache.put(cacheKey, new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + WATCH_CACHE_SEC },
  })));
  return new Response(body, { headers });
}
