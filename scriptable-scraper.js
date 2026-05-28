// TOEIC Grammar Scraper for Scriptable
// 1. Install "Scriptable" from the App Store (free)
// 2. Tap "+" -> paste this entire script -> save as "TOEIC Scraper"
// 3. Tap play (keep screen on, use charger, wait 30-60 min)
// 4. When done dialog appears, JSON is in clipboard
// 5. Open GitHub -> questions.json -> edit -> select all -> paste -> Commit

const BASE  = 'https://zitanstudy.com';
const DELAY = 700;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wv    = new WebView();

// These functions are stringified via toString() and run inside the WebView.
// All non-ASCII in regex uses \uXXXX escapes (pure ASCII source code).

function _getIndexLinks() {
  return JSON.stringify(
    Array.from(document.querySelectorAll('a[href*="page_id="]'))
      .map(function(a) { return a.href; })
      .filter(function(h) { return h.indexOf('page_id=206') < 0; })
  );
}

function _getQuestionLinks() {
  // 第=第  問=問
  return JSON.stringify(
    Array.from(document.querySelectorAll('a[href*="page_id="]'))
      .filter(function(a) {
        return (/\u7b2c?\s*\d+\s*\u554f|\d+/).test(a.textContent);
      })
      .map(function(a) { return a.href; })
  );
}

function _parseQuestion() {
  // 第=第  問=問  答=答  え=え  い=い
  // 　=full-width-space  （=(  ）=)  ：=:
  // 訳=訳  和=和  日=日  本=本  語=語
  // 【=[  】=]  解=解  説=説
  // 彙=彙  単=単  サ=サ  イ=イ  ト=ト
  var RE = {
    num:  /\u7b2c\s*(\d+)\s*\u554f/,
    choi: /^[\s\u3000]*[\uff08(]([ABCDabcd])[\uff09)][.\s\u3000]*(.+)/,
    ans:  /\u7b54[\u3048\u3044][\s\u3000]*[\uff1a:]\s*[\uff08(]?([ABCDabcd])[\uff09]/,
    tran: /^(\u8a33|\u548c\u8a33|\u65e5\u672c\u8a9e\u8a33|\u3010\u8a33\u3011)/,
    expl: /^(\u89e3\u8aac|\u3010\u89e3\u8aac\u3011)/,
    voce: /^(\u8a9e\u5f59|\u5358\u8a9e|\u3010\u8a9e\u5f59\u3011)/,
    nav:  /^(HOME|TOEIC|Copyright|\u30b5\u30a4\u30c8)/i,
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
      if (/^[^\w]*\u7b2c\s*\d+\s*\u554f[^\w]*$/.test(blk)) { state = 'q'; continue; }
    }
    if ((m = RE.choi.exec(blk))) { choices[m[1].toUpperCase()] = m[2].trim(); state = 'c'; continue; }
    if ((m = RE.ans.exec(blk)))  { ans = m[1].toUpperCase(); state = 'a'; continue; }
    if (RE.tran.test(blk)) { trans = blk.replace(RE.tran, '').replace(/^[\s\uff1a:]*/, ''); state = 't'; continue; }
    if (RE.expl.test(blk)) { var x = blk.replace(RE.expl, '').replace(/^[\s\uff1a:]*/, ''); if (x) expl.push(x); state = 'e'; continue; }
    if (RE.voce.test(blk)) { var y = blk.replace(RE.voce, '').replace(/^[\s\uff1a:]*/, ''); if (y) vocab.push(y); state = 'v'; continue; }
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

var GET_IDX_JS = '(' + _getIndexLinks.toString()   + ')()';
var GET_Q_JS   = '(' + _getQuestionLinks.toString() + ')()';
var PARSER_JS  = '(' + _parseQuestion.toString()    + ')()';

// --- Step 1: index pages ---
console.log('TOEIC Scraper started');
await wv.loadURL(BASE + '/?page_id=206');
await sleep(DELAY);

var rawIdx  = await wv.evaluateJavaScript(GET_IDX_JS);
var idxUrls = Array.from(new Set(
  [BASE + '/?page_id=4190'].concat(JSON.parse(rawIdx))
));
console.log('Index pages: ' + idxUrls.length);

// --- Step 2: question URLs ---
var qUrls = [], seen = new Set();
for (var ii = 0; ii < idxUrls.length; ii++) {
  await wv.loadURL(idxUrls[ii]);
  await sleep(DELAY);
  var links = JSON.parse(await wv.evaluateJavaScript(GET_Q_JS));
  links.forEach(function(h) {
    if (!seen.has(h)) { qUrls.push(h); seen.add(h); }
  });
  console.log('Found so far: ' + qUrls.length);
}
console.log('Total question pages: ' + qUrls.length);

// --- Step 3: scrape each page ---
var questions = [];
for (var i = 0; i < qUrls.length; i++) {
  await wv.loadURL(qUrls[i]);
  await sleep(DELAY);
  var qJson = null;
  try { qJson = await wv.evaluateJavaScript(PARSER_JS); } catch(e) {}
  if (qJson && qJson !== 'null') questions.push(JSON.parse(qJson));
  if ((i + 1) % 20 === 0) {
    console.log((i + 1) + '/' + qUrls.length + ' done, ' + questions.length + ' parsed');
  }
}

questions.sort(function(a, b) { return a.id - b.id; });
Pasteboard.copy(JSON.stringify(questions));
console.log('Done! ' + questions.length + ' questions copied to clipboard');

var done = new Alert();
done.title = 'Done! ' + questions.length + ' questions';
done.message = 'Copied to clipboard.\nPaste into questions.json on GitHub and commit.';
done.addAction('OK');
await done.present();
