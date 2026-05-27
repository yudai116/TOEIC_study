/**
 * TOEIC Grammar Scraper — ブラウザコンソール版
 *
 * 【全体の流れ】
 *   スクレイプ → questions.json を GitHub にコミット
 *   → GitHub Pages が自動デプロイ → サイトで学習
 *
 * 【PC での使い方】
 * 1. https://zitanstudy.com/?page_id=4190 をブラウザで開く
 * 2. F12 → Console タブ（Mac: Cmd+Option+J）
 * 3. このスクリプトをまるごと貼り付けて Enter
 * 4. questions.json が自動ダウンロードされる
 * 5. GitHub の yudai116/TOEIC_study に questions.json をコミット
 *    （リポジトリ → "Add file" → "Upload files" → questions.json を選択）
 * 6. main ブランチにマージ → GitHub Pages が自動更新される
 *
 * 【iPhone での使い方】
 * 1. 下部のブックマークレットをセットアップ（初回のみ）
 * 2. zitanstudy.com でブックマークレットを実行 → JSON テキストをコピー
 * 3. GitHub.com を Safari で開く → リポジトリ → "Add file" → "Create new file"
 * 4. ファイル名に "questions.json" と入力
 * 5. 本文欄にペースト → 画面下「Commit changes」をタップ
 * 6. main ブランチにマージ → GitHub Pages の URL をリロード
 *
 * ※ Android の場合は Kiwi Browser でコンソールが使えます
 */

(async () => {
  const BASE  = 'https://zitanstudy.com';
  const DELAY = 700; // ms（サーバー負荷軽減）
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const p     = new DOMParser();

  const parse  = html => p.parseFromString(html, 'text/html');
  const getDoc = async url => parse(await (await fetch(url)).text());

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
      tran: /^(訳|和訳|日本語訳|【訳】)/,
      expl: /^(解説|【解説】)/,
      voce: /^(語彙|単語|【語彙】)/,
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
        if (/^[^\w]*第\s*\d+\s*問[^\w]*$/.test(blk)) { state = 'q'; continue; }
      }
      if ((m = RE.choi.exec(blk))) {
        choices[m[1].toUpperCase()] = m[2].trim(); state = 'choices'; continue;
      }
      if ((m = RE.ans.exec(blk)))  { ans = m[1].toUpperCase(); state = 'ans'; continue; }
      if (RE.tran.test(blk)) { trans = blk.replace(RE.tran,'').replace(/^[\s：:]*/,''); state='trans'; continue; }
      if (RE.expl.test(blk)) { const b=blk.replace(RE.expl,'').replace(/^[\s：:]*/,''); if(b)expl.push(b); state='expl'; continue; }
      if (RE.voce.test(blk)) { const b=blk.replace(RE.voce,'').replace(/^[\s：:]*/,''); if(b)vocab.push(b); state='voce'; continue; }

      if (state==='pre'||state==='q') { if(blk.length>10&&!RE.nav.test(blk)){qtxt=(qtxt+' '+blk).trim();state='q';} }
      else if (state==='trans') { trans+=' '+blk; state='expl'; }
      else if (state==='expl')  expl.push(blk);
      else if (state==='voce')  vocab.push(blk);
    }

    if (!qtxt && !Object.values(choices).some(Boolean)) return null;
    return {
      id: qid, question: qtxt.trim(), choices, answer: ans,
      translation: trans.trim(),
      explanation: expl.join('\n').trim(),
      vocabulary:  vocab.join('\n').trim(),
      source_url:  url,
    };
  }

  // ── Step 1: インデックスページURLを収集 ──────────────────────────────────────
  console.log('📚 TOEIC Scraper 開始...');
  const topDoc  = await getDoc(`${BASE}/?page_id=206`);
  await sleep(DELAY);

  const idxUrls = [...new Set([
    `${BASE}/?page_id=4190`,
    ...[...mainContent(topDoc).querySelectorAll('a[href*="page_id="]')]
      .map(a => a.href)
      .filter(h => !h.includes('page_id=206')),
  ])];
  console.log(`インデックスページ: ${idxUrls.length}件`);

  // ── Step 2: 問題URLを収集 ───────────────────────────────────────────────────
  const qUrls = [], seen = new Set();
  for (const iu of idxUrls) {
    const doc = await getDoc(iu);
    [...mainContent(doc).querySelectorAll('a[href*="page_id="]')]
      .filter(a => /第?\s*\d+\s*問|\b\d+\b/.test(a.textContent))
      .forEach(a => { if (!seen.has(a.href)) { qUrls.push(a.href); seen.add(a.href); } });
    console.log(`  収集中... ${qUrls.length}問`);
    await sleep(DELAY);
  }
  console.log(`問題総数: ${qUrls.length}問`);

  // ── Step 3: 各問題ページをパース ─────────────────────────────────────────────
  const questions = [];
  for (let i = 0; i < qUrls.length; i++) {
    const doc = await getDoc(qUrls[i]);
    const q   = parseQuestion(doc, qUrls[i], i + 1);
    if (q) questions.push(q);
    if ((i + 1) % 20 === 0)
      console.log(`進捗: ${i+1}/${qUrls.length} — ${questions.length}問取得`);
    await sleep(DELAY);
  }

  questions.sort((a, b) => a.id - b.id);

  // ── ダウンロード ──────────────────────────────────────────────────────────────
  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' });
  Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'questions.json',
  }).click();

  console.log(`✅ 完了！ ${questions.length}問を questions.json としてダウンロードしました`);
  console.log('📖 questions.json を index.html と同じフォルダに置いてサイトを開いてください');
})();


/* ═══════════════════════════════════════════════════════════════════════════════
   📱 iPhone（iOS Safari）用ブックマークレット
   ─────────────────────────────────────────────────────────────────────────────
   【ブックマークのURL欄にこの1行だけを貼り付ける】

javascript:var s=document.createElement('script');s.src='https://yudai116.github.io/TOEIC_study/scraper-run.js?t='+Date.now();document.body.appendChild(s);void 0

   【使い方】
   1. Safari で https://zitanstudy.com を開く
   2. ブックマーク「TOEIC Scraper」をタップ
   3. 画面中央にオーバーレイが出て進捗表示 → 数十分待つ
   4. 完了後「全選択してコピー」をタップ
   5. GitHub の questions.json に貼り付けてコミット
   ═══════════════════════════════════════════════════════════════════════════════

*/
