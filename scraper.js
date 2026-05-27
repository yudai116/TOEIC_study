/**
 * TOEIC Grammar Scraper — ブラウザコンソール版
 *
 * 【使い方】
 * 1. https://zitanstudy.com/?page_id=4190 をブラウザで開く
 * 2. F12 → Console タブ（Macは Cmd+Option+J）
 * 3. このスクリプトをまるごとコピー＆ペーストしてEnter
 * 4. 完了すると questions.json が自動ダウンロードされる
 *
 * ※ スマホ（Android）の場合は Kiwi Browser を使うとコンソールが使えます
 * ※ スマホ（iOS）の場合はブックマークレット版（下部参照）を使ってください
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
   【セットアップ手順】
   1. Safari で https://zitanstudy.com/?page_id=4190 を開いてブックマーク登録
      （共有ボタン → "ブックマークを追加"）
   2. ブックマーク一覧を開き、今追加したブックマークを「編集」
   3. 名前を「TOEIC Scraper」などに変更
   4. URL 欄を全部消して、↓の javascript: から始まる1行をまるごと貼り付けて保存

   【使い方】
   1. Safari で https://zitanstudy.com/?page_id=4190 を開く
   2. アドレスバーに「TOEIC」と入力してブックマークを選択（タップ）
   3. 「スクレイピング開始」のアラートが出たら OK → 数十分待つ
   4. 完了アラートが出たら画面に JSON テキストが表示される
   5. 「全選択してコピー」ボタンをタップ → コピー完了
   6. index.html を開き「JSONを読み込む」→ 貼り付け → 読み込む
   ═══════════════════════════════════════════════════════════════════════════════

javascript:(async()=>{const B='https://zitanstudy.com',D=700,s=ms=>new Promise(r=>setTimeout(r,ms)),p=new DOMParser(),g=async u=>p.parseFromString(await(await fetch(u)).text(),'text/html'),c=d=>d.querySelector('.entry-content,article,main')||d.body,b=d=>[...c(d).querySelectorAll('p,h1,h2,h3,h4,li')].filter(e=>!e.querySelector('p,h1,h2,h3,h4,li')).map(e=>e.textContent.replace(/\s+/g,' ').trim()).filter(t=>t.length>2);function q(d,u,f){const bl=b(d),R={n:/第\s*(\d+)\s*問/,c:/^[\s　]*[（(]([ABCDabcd])[）)][.\s　]*(.+)/,a:/答[えい][\s　]*[：:]\s*[（(]?([ABCDabcd])[）)]/,t:/^(訳|和訳)/,e:/^(解説)/,v:/^(語彙|単語)/};let id=f,qt='',an='',tr='';const ch={A:'',B:'',C:'',D:''},ex=[],vc=[];let st='pre';for(const k of bl){let m;if((m=R.n.exec(k))&&st==='pre'){id=+m[1];if(/^[^\w]*第\s*\d+\s*問/.test(k)){st='q';continue;}}if((m=R.c.exec(k))){ch[m[1].toUpperCase()]=m[2].trim();st='c';continue;}if((m=R.a.exec(k))){an=m[1].toUpperCase();st='a';continue;}if(R.t.test(k)){tr=k.replace(R.t,'').replace(/^[\s：:]*/,'');st='t';continue;}if(R.e.test(k)){const x=k.replace(R.e,'').replace(/^[\s：:]*/,'');if(x)ex.push(x);st='e';continue;}if(R.v.test(k)){const x=k.replace(R.v,'').replace(/^[\s：:]*/,'');if(x)vc.push(x);st='v';continue;}if(st==='pre'||st==='q'){if(k.length>10&&!/^(HOME|TOEIC|Copyright)/i.test(k)){qt=(qt+' '+k).trim();st='q';}}else if(st==='t'){tr+=' '+k;st='e';}else if(st==='e')ex.push(k);else if(st==='v')vc.push(k);}if(!qt&&!Object.values(ch).some(Boolean))return null;return{id,question:qt.trim(),choices:ch,answer:an,translation:tr.trim(),explanation:ex.join('\n').trim(),vocabulary:vc.join('\n').trim(),source_url:u};}alert('スクレイピング開始！画面はそのまま待ってください（数十分かかります）');const td=await g(`${B}/?page_id=206`);await s(D);const iu=[...new Set([`${B}/?page_id=4190`,...[...c(td).querySelectorAll('a[href*="page_id="]')].map(a=>a.href).filter(h=>!h.includes('page_id=206'))])];const qu=[],se=new Set();for(const i of iu){const d=await g(i);[...c(d).querySelectorAll('a[href*="page_id="]')].filter(a=>/第?\s*\d+\s*問|\b\d+\b/.test(a.textContent)).forEach(a=>{if(!se.has(a.href)){qu.push(a.href);se.add(a.href);}});await s(D);}const qs=[];for(let i=0;i<qu.length;i++){const d=await g(qu[i]),r=q(d,qu[i],i+1);if(r)qs.push(r);await s(D);}qs.sort((a,b)=>a.id-b.id);const json=JSON.stringify(qs);const ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;background:#fff;z-index:99999;display:flex;flex-direction:column;padding:16px;font-family:sans-serif';ov.innerHTML=`<div style="font-weight:700;font-size:1.1rem;margin-bottom:8px">✅ 完了！${qs.length}問取得</div><p style="font-size:.85rem;color:#555;margin-bottom:10px">①下のボタンで全選択してコピー → ②index.htmlの「JSONを読み込む」に貼り付け</p><button onclick="const t=this.nextElementSibling;t.select();document.execCommand('copy');this.textContent='✅ コピーしました！'" style="background:#2563eb;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:1rem;font-weight:700;margin-bottom:10px;cursor:pointer">全選択してコピー</button><textarea readonly style="flex:1;border:1px solid #ccc;border-radius:8px;padding:10px;font-size:.75rem;font-family:monospace">${json}</textarea>`;document.body.appendChild(ov);})();

*/
