// TOEIC Grammar Scraper for Scriptable
// ─────────────────────────────────────────────────────
// 【準備】
//   1. App Store で「Scriptable」(無料) をインストール
//   2. Scriptable を開く → 右上「+」→ このコードを全部貼り付け
//   3. スクリプト名を「TOEIC Scraper」にして保存
//
// 【実行】
//   4. ▶（再生）ボタンをタップ
//   5. iPhone の画面をつけたまま 30〜60 分待つ（充電しながら推奨）
//   6. 完了ダイアログが出たらクリップボードに JSON がコピーされている
//
// 【GitHub への保存】
//   7. Safari で github.com を開き yudai116/TOEIC_study リポジトリへ
//   8. questions.json をタップ → 鉛筆アイコン（Edit）
//   9. 全選択して削除 → 貼り付け → 「Commit changes」
// ─────────────────────────────────────────────────────

const BASE  = 'https://zitanstudy.com';
const DELAY = 700; // ms（サーバー負荷軽減）
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wv    = new WebView();

// ── 問題パーサー（WebView のページ上で実行される JS）─────────────────
// 注: テンプレートリテラル内では \\ → \ になる
const PARSER_JS = `(function() {
  var RE = {
    num:  /第\\s*(\\d+)\\s*問/,
    choi: /^[\\s\\u3000]*[（(]([ABCDabcd])[）)][.\\s\\u3000]*(.+)/,
    ans:  /答[えい][\\s\\u3000]*[：:]\\s*[（(]?([ABCDabcd])[）)]/,
    tran: /^(訳|和訳|日本語訳|【訳】)/,
    expl: /^(解説|【解説】)/,
    voce: /^(語彙|単語|【語彙】)/,
    nav:  /^(HOME|TOEIC|Copyright|サイト)/i,
  };
  var mc = document.querySelector('.entry-content,.post-content,article,main') || document.body;
  var blocks = Array.from(mc.querySelectorAll('p,h1,h2,h3,h4,li'))
    .filter(function(el) { return !el.querySelector('p,h1,h2,h3,h4,li'); })
    .map(function(el) { return el.textContent.replace(/\\s+/g,' ').trim(); })
    .filter(function(t) { return t.length > 2; });
  var qid=0, qtxt='', ans='', trans='',
      choices={A:'',B:'',C:'',D:''},
      expl=[], vocab=[], state='pre', m;
  for (var bi=0; bi<blocks.length; bi++) {
    var blk=blocks[bi];
    if ((m=RE.num.exec(blk)) && state==='pre') {
      qid=+m[1];
      if (/^[^\\w]*第\\s*\\d+\\s*問[^\\w]*$/.test(blk)) { state='q'; continue; }
    }
    if ((m=RE.choi.exec(blk))) { choices[m[1].toUpperCase()]=m[2].trim(); state='c'; continue; }
    if ((m=RE.ans.exec(blk)))  { ans=m[1].toUpperCase(); state='a'; continue; }
    if (RE.tran.test(blk)) { trans=blk.replace(RE.tran,'').replace(/^[\\s：:]*/,''); state='t'; continue; }
    if (RE.expl.test(blk)) { var x=blk.replace(RE.expl,'').replace(/^[\\s：:]*/,''); if(x)expl.push(x); state='e'; continue; }
    if (RE.voce.test(blk)) { var y=blk.replace(RE.voce,'').replace(/^[\\s：:]*/,''); if(y)vocab.push(y); state='v'; continue; }
    if (state==='pre'||state==='q') { if(blk.length>10&&!RE.nav.test(blk)){qtxt=(qtxt+' '+blk).trim();state='q';} }
    else if (state==='t') { trans+=' '+blk; state='e'; }
    else if (state==='e') expl.push(blk);
    else if (state==='v') vocab.push(blk);
  }
  if (!qtxt && ![choices.A,choices.B,choices.C,choices.D].some(Boolean)) return null;
  return JSON.stringify({
    id: qid, question: qtxt.trim(), choices: choices, answer: ans,
    translation: trans.trim(),
    explanation: expl.join('\\n').trim(),
    vocabulary:  vocab.join('\\n').trim(),
    source_url:  window.location.href
  });
})()`;

// ── Step 1: インデックスページURL収集 ─────────────────────────────
console.log('📚 TOEIC Scraper 開始...');
await wv.loadURL(`${BASE}/?page_id=206`);
await sleep(DELAY);

const rawIdx = await wv.evaluateJavaScript(
  `JSON.stringify(Array.from(document.querySelectorAll('a[href*="page_id="]')).map(function(a){return a.href;}).filter(function(h){return h.indexOf('page_id=206')<0;}))`
);
const idxUrls = Array.from(new Set([`${BASE}/?page_id=4190`].concat(JSON.parse(rawIdx))));
console.log(`インデックス: ${idxUrls.length}件`);

// ── Step 2: 問題URL収集 ───────────────────────────────────────────
const qUrls = [], seen = new Set();
for (let ii = 0; ii < idxUrls.length; ii++) {
  await wv.loadURL(idxUrls[ii]);
  await sleep(DELAY);
  const rawLinks = await wv.evaluateJavaScript(
    `JSON.stringify(Array.from(document.querySelectorAll('a[href*="page_id="]')).filter(function(a){return(/第?\\s*\\d+\\s*問|\\d+/).test(a.textContent);}).map(function(a){return a.href;}))`
  );
  JSON.parse(rawLinks).forEach(function(h) {
    if (!seen.has(h)) { qUrls.push(h); seen.add(h); }
  });
  console.log(`  収集中... ${qUrls.length}問`);
}
console.log(`問題総数: ${qUrls.length}問`);

// ── Step 3: 各問題ページをスクレイプ ─────────────────────────────
const questions = [];
for (let i = 0; i < qUrls.length; i++) {
  await wv.loadURL(qUrls[i]);
  await sleep(DELAY);
  let qJson = null;
  try { qJson = await wv.evaluateJavaScript(PARSER_JS); } catch(e) { /* スキップ */ }
  if (qJson && qJson !== 'null') questions.push(JSON.parse(qJson));
  if ((i + 1) % 20 === 0) {
    console.log(`進捗: ${i+1}/${qUrls.length} — ${questions.length}問取得`);
  }
}

questions.sort(function(a, b) { return a.id - b.id; });
Pasteboard.copy(JSON.stringify(questions));
console.log(`✅ 完了！${questions.length}問をクリップボードにコピーしました`);

const done = new Alert();
done.title = `✅ 完了！${questions.length}問`;
done.message = 'クリップボードにコピーしました\nGitHub の questions.json に貼り付けてコミットしてください';
done.addAction('OK');
await done.present();
