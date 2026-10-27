// 川口元郷駅の到着時刻を Mini Tokyo 3D の時刻表JSONから抜き出し、index.html に埋め込むスクリプト
//
// 使い方（このフォルダで実行）:
//   node extract.js              … GitHubから最新の時刻表をダウンロードして index.html を更新
//   node extract.js 保存済み.json … ダウンロード済みのJSONファイルを使う（通信なし）
//
// ダイヤ改正のときは、Mini Tokyo 3D 側のデータ更新を待ってからもう一度実行するだけでよい。

'use strict';
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://raw.githubusercontent.com/nagix/mini-tokyo-3d/master/data/train-timetables/saitamarailway-saitamarailway.json';
const STATION = 'SaitamaRailway.SaitamaRailway.KawaguchiMotogo';
const HTML_FILE = path.join(__dirname, 'index.html');
// 秒補正テーブル（平日の一部の列車について、川口元郷に着く秒数を推定したもの）。
// ホームで実測したら、このファイルの est を書き換えてから、このスクリプトを実行し直す。
// ダイヤ改正があったら中身は使えなくなるので、作り直すか空の配列 [] にする。
const CORRECTION_FILE = path.join(__dirname, 'seconds-correction.json');
const MARK_START = '/* @@TIMETABLE_START@@ */';
const MARK_END = '/* @@TIMETABLE_END@@ */';

// 0時台の時刻は "00:xx" と書かれている（"24:xx" 表記は使われていない）。
// この時刻より前は「前日の運行日の続き」とみなし、24時間を足して扱う。
const SERVICE_DAY_START_HOUR = 4;

// 行き先の日本語名（id の最後の部分 → 表示名）
const DEST_NAMES = {
  UrawaMisono: '浦和美園', Hatogaya: '鳩ヶ谷', AkabaneIwabuchi: '赤羽岩淵',
  Ichigaya: '市ケ谷', Komagome: '駒込', AzabuJuban: '麻布十番', ShirokaneTakanawa: '白金高輪',
  Meguro: '目黒', Okusawa: '奥沢', MusashiKosugi: '武蔵小杉', Hiyoshi: '日吉',
  ShinYokohama: '新横浜', Nishiya: '西谷', Ebina: '海老名', Shonandai: '湘南台', Oji: '王子',
};

// 方向（JSONの値 → 埋め込み用の1文字）
const DIRS = { Outbound: 'O', Inbound: 'I' };
// 平日/土休日（id の末尾 → 埋め込み用のキー）
const DAYS = { Weekday: 'weekday', SaturdayHoliday: 'holiday' };

async function loadJson(arg) {
  if (arg) return JSON.parse(fs.readFileSync(arg, 'utf8'));
  console.log('ダウンロード中: ' + SOURCE_URL);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error('ダウンロード失敗: HTTP ' + res.status);
  return res.json();
}

// "HH:MM" → 運行日の0時からの分数（深夜帯は 24時以降として数える）
function toServiceMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h < SERVICE_DAY_START_HOUR ? h + 24 : h) * 60 + m;
}

// "HH:MM:SS" → 運行日の0時からの秒数
function toServiceSeconds(hhmmss) {
  const [h, m, s] = hhmmss.split(':').map(Number);
  return ((h < SERVICE_DAY_START_HOUR ? h + 24 : h) * 60 + m) * 60 + (s || 0);
}

// 秒補正テーブルを読み込み、「方向|到着分」をキーにした表にする
function loadCorrections() {
  if (!fs.existsSync(CORRECTION_FILE)) return new Map();
  const map = new Map();
  for (const c of JSON.parse(fs.readFileSync(CORRECTION_FILE, 'utf8'))) {
    if (!/^\d\d:\d\d:\d\d$/.test(c.est)) throw new Error('秒補正テーブルの est の形が正しくありません: ' + JSON.stringify(c));
    map.set(c.direction + '|' + c.arr, { row: c, used: 0 });
  }
  return map;
}

function fmt(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

async function main() {
  const trains = await loadJson(process.argv[2]);
  const out = { weekday: [], holiday: [] };
  const warnings = [];
  const notStopping = [];
  const terminal = [];
  const corrections = loadCorrections();

  for (const t of trains) {
    const dayKey = DAYS[t.id.split('.').pop()];
    const dir = DIRS[t.d];
    if (!dayKey) { warnings.push('未知の曜日区分: ' + t.id); continue; }
    if (!dir) { warnings.push('未知の方向: ' + t.d + ' (' + t.id + ')'); continue; }

    const idx = t.tt.findIndex(r => r.s === STATION);
    if (idx < 0) { notStopping.push(t.id); continue; }
    if (idx === 0 || idx === t.tt.length - 1) terminal.push(t.id + (idx === 0 ? '（始発）' : '（終点）'));

    const row = t.tt[idx];
    const time = row.a || row.d; // 到着時刻がなければ発車時刻で代用
    if (!time) { warnings.push('時刻なし: ' + t.id); continue; }

    const destKey = (t.ds && t.ds[0] || '').split('.').pop();
    if (!DEST_NAMES[destKey]) warnings.push('行き先の日本語名が未登録: ' + destKey + '（英語名のまま表示されます）');
    // [運行日の分, 方向, 行き先, 列車番号, (推定到着の秒数：補正テーブルと一致した列車だけ)]
    const rec = [toServiceMinutes(time), dir, DEST_NAMES[destKey] || destKey, t.n];
    // 秒補正テーブルとの照合は平日ダイヤだけ。キーは「方向」と「到着分」
    const c = dayKey === 'weekday' && corrections.get(t.d + '|' + time);
    if (c) {
      c.used++;
      if (c.row.dep && row.d && c.row.dep !== row.d) warnings.push(`秒補正: ${t.d} ${time}着 の発車時刻が違います（表 ${c.row.dep} / 時刻表 ${row.d}）`);
      rec.push(toServiceSeconds(c.row.est));
    }
    out[dayKey].push(rec);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));

  // ---- 確認用の表示（公式時刻表と見比べる） ----
  console.log('\n全列車数: ' + trains.length);
  for (const [k, label] of [['weekday', '平日'], ['holiday', '土休日']]) {
    for (const [d, dl] of [['O', '浦和美園方面(下り)'], ['I', '赤羽岩淵方面(上り)']]) {
      const list = out[k].filter(r => r[1] === d);
      console.log(`  ${label} ${dl}: ${String(list.length).padStart(3)} 本  始発 ${fmt(list[0][0])}  最終 ${fmt(list[list.length - 1][0])}`);
    }
  }
  console.log('川口元郷に止まらない列車: ' + (notStopping.length ? notStopping.join(', ') : 'なし'));
  console.log('川口元郷が始発/終点の列車: ' + (terminal.length ? terminal.join(', ') : 'なし'));
  [...new Set(warnings)].forEach(w => console.log('警告: ' + w));

  // 秒補正テーブルの照合結果。照合できない行は、ダイヤ改正・方向名の違い・特定日だけ走る列車が考えられる
  if (corrections.size) {
    const all = [...corrections.values()];
    const unmatched = all.filter(c => c.used === 0);
    console.log(`\n秒補正テーブル: ${all.length} 行中 ${all.length - unmatched.length} 行を平日の列車に適用`);
    if (unmatched.length) {
      console.log('照合できなかった行（その列車には補正を使わず、今までどおりの計算になります）:');
      for (const c of unmatched) console.log(`  ${c.row.direction} ${c.row.arr}着  est ${c.row.est}${c.row.note ? '  ※' + c.row.note : ''}`);
    }
    for (const c of all.filter(c => c.used > 1)) console.log(`警告: 秒補正 ${c.row.direction} ${c.row.arr}着 に一致する列車が ${c.used} 本あります`);
  }

  // ---- index.html への埋め込み ----
  if (!fs.existsSync(HTML_FILE)) { console.log('\nindex.html がないため埋め込みは省略しました。'); return; }
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const s = html.indexOf(MARK_START), e = html.indexOf(MARK_END);
  if (s < 0 || e < s) throw new Error('index.html に埋め込み用の印が見つかりません');
  const data = {
    generated: new Date().toISOString().slice(0, 10),
    weekday: out.weekday,
    holiday: out.holiday,
  };
  const body = '\nconst TIMETABLE = ' + JSON.stringify(data)
    .replace(/\],\[/g, '],\n[') + ';\n';
  fs.writeFileSync(HTML_FILE, html.slice(0, s + MARK_START.length) + body + html.slice(e));
  console.log(`\nindex.html を更新しました（平日 ${out.weekday.length} 本 / 土休日 ${out.holiday.length} 本）`);
}

main().catch(err => { console.error('エラー: ' + err.message); process.exit(1); });
