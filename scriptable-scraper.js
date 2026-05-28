// TOEIC Grammar Scraper for Scriptable
// 1. App Store で「Scriptable」(無料) をインストール
// 2. 右上「+」→ このコードを全部貼り付け → 保存
// 3. ▶ で実行、画面をつけたまま 30〜60 分待つ（充電推奨）
// 4. 完了ダイアログが出たらクリップボードに JSON がコピーされている
// 5. GitHub の questions.json を開いて全削除 → 貼り付け → Commit

const BASE  = 'https://zitanstudy.com';
const DELAY = 700;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wv    = new WebView();

// ── 以下3つの関数は WebView 上で実行する（toString() で文字列化）──────
// Scriptable 上では定義するだけで実行しない

function _getIndexLinks() {
  return JSON.stringify(
    Array.from(document.querySelectorAll('a[href*="page_id="]'))
      .map(function(a) { return a.href; })
      .filter(function(h) { return h.indexOf('page_id=206') < 0; })
  );
}

function _getQuestionLinks() {
  return JSON.stringify(
    Array.from(document.querySelectorAll('a[href*="page_id="]'))
      .filter(function(a) {
        return (/第?\s*\d+\s*問|\d+/).test(a.textContent);
      })
      .map(function(a) { return a.href; })
  );
}

function _parseQuestion() {
  var RE = {
    num:  /第\s*(\d+)\s*問/,
    choi: /^[\s　]*[（(]([ABCDabcd])[）)][.\s　]*(.+)/,
    ans:  /答[えい][\s　]*[：:]\s*[（(]?([ABCDabcd])[）)]/,
    tran: /^(訳|和訳|日本語訳|【訳】)/,
    expl: /^(解説|【解説】)/,
    voce: /^(語彙|単語|【語彙】)/,
    nav:  /^(HOME|TOEIC|Copyright|サイト)/i,
  };
  var mc = document.querySelector('.entry-content,.post-content,article,main') || document.body;
  var blocks = Array.from(mc.querySelectorAll('p,h1,h2,h3,h4,li'))
    .filter(function(el) { return !el.querySelector('p,h1,h2,h3,h4,li'); })
    .map(function(el) { return el.textContent.replace(/\s+/g, ' ').trim(); })
    .filter(function(t) { return t.length > 2; });
  var qid = 0, qtxt = '', ans = '', trans = '';
  var choices = {A:'', B:'', C:'', D:''};
  var expl = [], vocab = [], state = 'pre', m;
  for (var bi = 0; bi < blocks.length; bi++) {
    var blk = blocks[bi];
    if ((m = RE.num.exec(blk)) && state === 'pre') {
      qid = +m[1];
      if (/^[^\w]*第\s*\d+\s*問[^\w]*$/.test(blk)) { state = 'q'; continue; }
    }
    if ((m = RE.choi.exec(blk))) { choices[m[1].toUpperCase()] = m[2].trim(); state = 'c'; continue; }
    if ((m = RE.ans.exec(blk)))  { ans = m[1].toUpperCase(); state = 'a'; continue; }
    if (RE.tran.test(blk)) { trans = blk.replace(RE.tran, '').replace(/^[\s：:]*/, ''); state = 't'; continue; }
    if (RE.expl.test(blk)) { var x = blk.replace(RE.expl, '').replace(/^[\s：:]*/, ''); if (x) expl.push(x); state = 'e'; continue; }
    if (RE.voce.test(blk)) { var y = blk.replace(RE.voce, '').replace(/^[\s：:]*/, ''); if (y) vocab.push(y); state = 'v'; continue; }
    if (state === 'pre' || state === 'q') {
      if (blk.length > 10 && !RE.nav.test(blk)) { qtxt = (qtxt + ' ' + blk).trim(); state = 'q'; }
    } else if (state === 't') { trans += ' ' + blk; state = 'e'; }
    else if (state === 'e') expl.push(blk);
    else if (state === 'v') vocab.push(blk);
  }
  if (!qtxt && ![choices.A, choices.B, choices.C, choices.D].some(Boolean)) return null;
  return JSON.stringify({
    id: qid,
    question: qtxt.trim(),
    choices: choices,
    answer: ans,
    translation: trans.trim(),
    explanation: expl.join('\n').trim(),
    vocabulary: vocab.join('\n').trim(),
    source_url: window.location.href
  });
}

// 関数を IIFE 文字列に変換（エスケープ不要）
var GET_IDX_JS = '(' + _getIndexLinks.toString()   + ')()';
var GET_Q_JS   = '(' + _getQuestionLinks.toString() + ')()';
var PARSER_JS  = '(' + _parseQuestion.toString()    + ')()';

// ── Step 1: インデックスURL収集 ─────────────────────────────────
console.log('TOEIC Scraper 開始...');
await wv.loadURL(BASE + '/?page_id=206');
await sleep(DELAY);

var rawIdx  = await wv.evaluateJavaScript(GET_IDX_JS);
var idxUrls = Array.from(new Set(
  [BASE + '/?page_id=4190'].concat(JSON.parse(rawIdx))
));
console.log('インデックス: ' + idxUrls.length + '件');

// ── Step 2: 問題URL収集 ─────────────────────────────────────────
var qUrls = [], seen = new Set();
for (var ii = 0; ii < idxUrls.length; ii++) {
  await wv.loadURL(idxUrls[ii]);
  await sleep(DELAY);
  var links = JSON.parse(await wv.evaluateJavaScript(GET_Q_JS));
  links.forEach(function(h) {
    if (!seen.has(h)) { qUrls.push(h); seen.add(h); }
  });
  console.log('  収集中... ' + qUrls.length + '問');
}
console.log('問題総数: ' + qUrls.length + '問');

// ── Step 3: 各問題をスクレイプ ──────────────────────────────────
var questions = [];
for (var i = 0; i < qUrls.length; i++) {
  await wv.loadURL(qUrls[i]);
  await sleep(DELAY);
  var qJson = null;
  try { qJson = await wv.evaluateJavaScript(PARSER_JS); } catch(e) {}
  if (qJson && qJson !== 'null') questions.push(JSON.parse(qJson));
  if ((i + 1) % 20 === 0) {
    console.log('進捗: ' + (i+1) + '/' + qUrls.length + ' - ' + questions.length + '問取得');
  }
}

questions.sort(function(a, b) { return a.id - b.id; });
Pasteboard.copy(JSON.stringify(questions));
console.log('完了！ ' + questions.length + '問をクリップボードにコピーしました');

var done = new Alert();
done.title = '完了！ ' + questions.length + '問';
done.message = 'クリップボードにコピーしました\nGitHub の questions.json に貼り付けてコミットしてください';
done.addAction('OK');
await done.present();
