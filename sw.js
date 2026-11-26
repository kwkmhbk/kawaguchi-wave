// サービスワーカー: Android の Chrome でアプリとしてインストールできるようにするためのもの。
// このサイトのファイルは、毎回まずネットから最新を取り（ブラウザの使い回しも確かめ直す。取れたら保存しておく）、
// ネットにつながらないときだけ保存しておいたものを返す。古い版が出続けることはない。
// 中継サーバー（遅延情報）やフォントなど、ほかのサイトへの読み込みには手を出さない。
const CACHE = 'kawaguchi-wave-v1';
const NETWORK_WAIT_MS = 3000; // ネットからの返事を待つ時間。過ぎたら保存してあるもので開く

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // 保存してあるもの（なければ null）
  const cached = async () => await caches.match(req, { ignoreSearch: true }) ||
    (req.mode === 'navigate' ? await caches.match('./', { ignoreSearch: true }) : null);

  // cache: 'no-cache' で、ブラウザが前に取ったもの（GitHub Pages は10分使い回してよいとしている）をそのまま使わず、
  // 毎回サーバーに「変わっていないか」を確かめる。変わっていなければ短い返事だけで済む。
  // これで、アプリを終了して開き直せば、公開直後でも新しい版になる
  const network = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) {
      const copy = res.clone();
      // 「再読み込み」ボタンで付ける ?r= は、保存するときは外す（毎回別のものとして溜まらないように）
      const key = new URL(req.url);
      key.searchParams.delete('r');
      return caches.open(CACHE).then(c => c.put(key.href, copy)).then(() => res, () => res);
    }
    return res;
  });
  // ネットからの返事が遅いときでも、保存の更新は最後まで続ける（次に開いたときは新しい版になる）
  e.waitUntil(network.catch(() => {}));

  e.respondWith((async () => {
    // 電波がとても弱いと返事がなかなか来ないので、3秒待って来なければ保存してあるもので開く
    const timeout = new Promise(r => setTimeout(r, NETWORK_WAIT_MS, 'timeout'));
    try {
      const first = await Promise.race([network, timeout]);
      if (first !== 'timeout') return first;
      const hit = await cached();
      return hit || await network; // 保存がなければ、そのままネットの返事を待つ
    } catch (err) {
      const hit = await cached(); // 電波がない（すぐに失敗した）とき
      if (hit) return hit;
      throw err;
    }
  })());
});
