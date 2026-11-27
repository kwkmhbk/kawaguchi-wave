// ダイヤ改正の見張り（GitHub Actions が毎日実行する。PCでも実行できる）
//
// 使い方（このフォルダで実行）:
//   node watch.js         … 2つを調べる。変化がなければ終了コード 0、変化があれば 3、調べられなければ 1
//   node watch.js --save  … 今の南北線の時刻表の印を timetable-watch.json に保存する（時刻表の更新を終えたあとに使う）
//
// 調べるもの:
//   1. 南北線（赤羽岩淵駅）の時刻表 … 中継サーバー経由で ODPT から読み、前に保存した印と比べる。
//      南北線と埼玉高速鉄道は直通運転なので、ダイヤ改正はほぼ同じ日。Mini Tokyo 3D の更新より早く気づける。
//   2. Mini Tokyo 3D の時刻表 … node extract.js --check で、index.html に埋め込んだ時刻表と比べる。
//      こちらが変わったら、node extract.js で更新できる合図。
//
// 結果は画面に出し、REPORT_FILE が指定されていればそこにも書く（GitHub の Issue の本文に使う）。

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const STATE_FILE = path.join(__dirname, 'timetable-watch.json');
const HTML_FILE = path.join(__dirname, 'index.html');
const SAVE = process.argv.includes('--save');

function relayUrl() {
  const m = fs.readFileSync(HTML_FILE, 'utf8').match(/const RELAY_URL = '([^']*)'/);
  if (!m || !m[1]) throw new Error('index.html の RELAY_URL が空です');
  return m[1].replace(/\/$/, '') + '/timetable-watch';
}

async function fetchNamboku() {
  const res = await fetch(relayUrl(), { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.hash) throw new Error('南北線の時刻表を読めません: ' + (json.error || 'HTTP ' + res.status));
  return json;
}

function readState() {
  return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
}

async function main() {
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + '（日本時間）';
  const namboku = await fetchNamboku();
  const state = readState();

  if (SAVE) {
    state.namboku = { hash: namboku.hash, issued: namboku.issued, trains: namboku.trains, savedAt: now };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
    console.log('南北線の時刻表の印を保存しました: ' + namboku.hash);
    return;
  }

  const lines = [];
  let changed = false;

  // 1. 南北線
  const old = state.namboku;
  if (!old) {
    lines.push('## 南北線の時刻表', '', '前回の印が保存されていません。`node watch.js --save` を実行してください。');
    changed = true;
  } else if (old.hash !== namboku.hash) {
    lines.push('## 南北線の時刻表が変わりました',
      '',
      '埼玉高速鉄道も同じ日にダイヤ改正している可能性が高いです。',
      '',
      `| | 前回（${old.savedAt} 保存） | 今回 |`, '|---|---|---|',
      `| 印 | ${old.hash} | ${namboku.hash} |`,
      `| 本数（赤羽岩淵駅） | ${old.trains} | ${namboku.trains} |`,
      `| データの発行日 | ${(old.issued || []).join(', ') || '-'} | ${(namboku.issued || []).join(', ') || '-'} |`);
    changed = true;
  } else {
    lines.push('## 南北線の時刻表', '', '変わっていません。');
  }

  // 2. Mini Tokyo 3D
  const r = spawnSync(process.execPath, [path.join(__dirname, 'extract.js'), '--check'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const tail = out.slice(out.lastIndexOf('埋め込み済みの時刻表')).trim();
  lines.push('', '## Mini Tokyo 3D の時刻表', '');
  if (r.status === 0) {
    lines.push('アプリに入っている時刻表と同じです。');
    if (old && old.hash !== namboku.hash) lines.push('', 'Mini Tokyo 3D はダイヤ改正の数日後に更新されることが多いです（前回は4日後）。この Issue を開いたままにしておけば、変わったときにこの Issue に追記されます。');
  } else if (r.status === 3) {
    lines.push('**アプリに入っている時刻表と違います。** `node extract.js` で更新できます。', '', '```', tail, '```');
    changed = true;
  } else {
    throw new Error('extract.js --check が失敗しました\n' + out);
  }

  lines.push('', '## 対応の手順', '',
    '1. 埼玉高速鉄道の公式サイトでダイヤ改正のお知らせを確かめる',
    '2. Mini Tokyo 3D が更新されたら `node extract.js` で時刻表を更新し（到着秒も計算し直される）、公式時刻表と見比べる',
    '3. `node watch.js --save` で南北線の印を保存して公開する',
    '', `調べた日時: ${now}`);

  const report = lines.join('\n');
  console.log(report);
  if (process.env.REPORT_FILE) fs.writeFileSync(process.env.REPORT_FILE, report + '\n');
  process.exitCode = changed ? 3 : 0;
}

main().catch(err => { console.error('エラー: ' + err.message); process.exitCode = 1; });
