/* zitanstudy.com 上で実行されるスクレイパー本体
   ブックマークレットから script タグ経由で読み込まれます */
(async () => {
  if (document.getElementById('__toeic_scraper__')) return; // 二重実行防止

  const B = 'https://zitanstudy.com';
  const D = 700;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const parser = new DOMParser();
  const getDoc = async url => parser.parseFromString(await (await fetch(url)).text(), 'text/html');

  function mainContent(doc) {
    return doc.querySelector('.entry-content,.post-content,article,main') || doc.body;
  }

  function textBlocks(doc) {
    return [...mainContent(doc).querySelectorAll('p,h1,h2,h3,h4,li')]
      .filter(el => !el.querySelector('p,h1,h2,h3,h4,li'))
      .map(el => el.textContent.replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 2);
  }

  function parseQuestion(doc, url, fid) {
    const blocks = textBlocks(doc);
    const RE = {
      num:  /第\s*(\d+)\s*問/,
      choi: /^[\s　]*[（(]([ABCDabcd])[）)][.\s　]*(.+)/,
      ans:  /答[えい][\s　]*[：:]\s*[（(]?([ABCDabcd])[）)]/,
      tran: /^(訳|和訳)/,
      expl: /^(解説)/,
      voce: /^(語彙|単語)/,
      nav:  /^(HOME|TOEIC|Copyright|サイト)/i,
    };
    let qid = fid, qtxt = '', ans = '', trans = '';
    const choices = { A:'', B:'', C:'', D:'' };
    const expl = [], vocab = [];
    let state = 'pre';

    for (const blk of blocks) {
      let m;
      if ((m = RE.num.exec(blk)) && state === 'pre') {
        qid = +m[1];
        if (/^[^\w]*第\s*\d+\s*問/.test(blk)) { state = 'q'; continue; }
      }
      if ((m = RE.choi.exec(blk))) { choices[m[1].toUpperCase()] = m[2].trim(); state = 'c'; continue; }
      if ((m = RE.ans.exec(blk)))  { ans = m[1].toUpperCase(); state = 'a'; continue; }
      if (RE.tran.test(blk)) { trans = blk.replace(RE.tran, '').replace(/^[\s：:]*/, ''); state = 't'; continue; }
      if (RE.expl.test(blk)) { const x = blk.replace(RE.expl, '').replace(/^[\s：:]*/, ''); if (x) expl.push(x); state = 'e'; continue; }
      if (RE.voce.test(blk)) { const x = blk.replace(RE.voce, '').replace(/^[\s：:]*/, ''); if (x) vocab.push(x); state = 'v'; continue; }

      if (state === 'pre' || state === 'q') {
        if (blk.length > 10 && !RE.nav.test(blk)) { qtxt = (qtxt + ' ' + blk).trim(); state = 'q'; }
      } else if (state === 't') { trans += ' ' + blk; state = 'e'; }
      else if (state === 'e') expl.push(blk);
      else if (state === 'v') vocab.push(blk);
    }
    if (!qtxt && !Object.values(choices).some(Boolean)) return null;
    return {
      id: qid, question: qtxt.trim(), choices, answer: ans,
      translation: trans.trim(),
      explanation: expl.join('\n').trim(),
      vocabulary: vocab.join('\n').trim(),
      source_url: url,
    };
  }

  // ── 進捗表示オーバーレイ ──────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '__toeic_scraper__';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:sans-serif';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:28px 24px;width:90%;max-width:400px;text-align:center';
  box.innerHTML = '<div style="font-size:1.4rem;font-weight:800;margin-bottom:8px">📚 TOEIC Scraper</div><div id="__sc_msg__" style="color:#555;font-size:.95rem;margin-bottom:4px">準備中...</div><div id="__sc_prog__" style="color:#2563eb;font-weight:700;font-size:1.1rem">0 問取得</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const msg  = () => document.getElementById('__sc_msg__');
  const prog = () => document.getElementById('__sc_prog__');

  // ── Step 1: インデックスURL収集 ─────────────────────────────────
  msg().textContent = 'インデックスページを読み込み中...';
  const topDoc = await getDoc(`${B}/?page_id=206`);
  await sleep(D);

  const idxUrls = [...new Set([
    `${B}/?page_id=4190`,
    ...[...mainContent(topDoc).querySelectorAll('a[href*="page_id="]')]
      .map(a => a.href)
      .filter(h => !h.includes('page_id=206')),
  ])];

  // ── Step 2: 問題URL収集 ──────────────────────────────────────────
  msg().textContent = `${idxUrls.length} ページから問題URLを収集中...`;
  const qUrls = [], seen = new Set();
  for (const iu of idxUrls) {
    const doc = await getDoc(iu);
    [...mainContent(doc).querySelectorAll('a[href*="page_id="]')]
      .filter(a => /第?\s*\d+\s*問|\b\d+\b/.test(a.textContent))
      .forEach(a => { if (!seen.has(a.href)) { qUrls.push(a.href); seen.add(a.href); } });
    await sleep(D);
  }

  // ── Step 3: 各問題をスクレイプ ──────────────────────────────────
  const questions = [];
  for (let i = 0; i < qUrls.length; i++) {
    msg().textContent = `問題ページを取得中... (${i + 1}/${qUrls.length})`;
    prog().textContent = `${questions.length} 問取得`;
    const doc = await getDoc(qUrls[i]);
    const q   = parseQuestion(doc, qUrls[i], i + 1);
    if (q) questions.push(q);
    await sleep(D);
  }

  questions.sort((a, b) => a.id - b.id);
  const json = JSON.stringify(questions);

  // ── iOS Shortcuts 環境では completion() で結果を返す ────────────────
  if (typeof completion !== 'undefined') {
    overlay.remove();
    completion(json);
    return;
  }

  // ── ブラウザ環境では画面にコピーUIを表示 ──────────────────────────
  box.innerHTML = `
    <div style="font-size:1.3rem;font-weight:800;margin-bottom:8px">✅ 完了！${questions.length}問取得</div>
    <p style="font-size:.85rem;color:#555;margin-bottom:12px;line-height:1.6">
      ① 下のボタンでコピー<br>
      ② GitHub の questions.json に貼り付けてコミット
    </p>
    <button id="__sc_copy__"
      style="width:100%;background:#2563eb;color:#fff;border:none;padding:13px;border-radius:10px;font-size:1rem;font-weight:700;margin-bottom:10px;cursor:pointer">
      全選択してコピー
    </button>
    <textarea id="__sc_json__" readonly
      style="width:100%;height:120px;border:1px solid #ccc;border-radius:8px;padding:8px;font-size:.7rem;font-family:monospace;resize:none"
    >${json}</textarea>
    <button onclick="document.getElementById('__toeic_scraper__').remove()"
      style="margin-top:8px;background:none;border:none;color:#999;font-size:.85rem;cursor:pointer">閉じる</button>
  `;
  document.getElementById('__sc_copy__').addEventListener('click', function () {
    const ta = document.getElementById('__sc_json__');
    ta.select();
    ta.setSelectionRange(0, 99999);
    document.execCommand('copy');
    this.textContent = '✅ コピーしました！';
    this.style.background = '#16a34a';
  });
})();
