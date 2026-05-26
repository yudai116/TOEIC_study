#!/usr/bin/env python3
"""
TOEIC文法問題スクレイパー - zitanstudy.com
Usage: python scraper.py
Output: questions.json

サイト構造:
  トップ  : https://zitanstudy.com/?page_id=206
  インデックス: https://zitanstudy.com/?page_id=4190  (第1〜100問)
  個別問題: https://zitanstudy.com/?page_id=210      (第1問)
"""

import json
import time
import re
import logging
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

# ── ログ設定 ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("scraper.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── 定数 ──────────────────────────────────────────────────────────────────────
BASE        = "https://zitanstudy.com"
TOP_PAGE    = f"{BASE}/?page_id=206"
FIRST_INDEX = f"{BASE}/?page_id=4190"
OUTPUT      = Path("questions.json")
PROGRESS    = Path(".scraper_progress.json")
DELAY       = 1.5  # リクエスト間隔（秒）

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    "Referer": BASE + "/",
    "Connection": "keep-alive",
}

sess = requests.Session()
sess.headers.update(HEADERS)


# ── HTTPフェッチ ──────────────────────────────────────────────────────────────
def fetch(url: str, tries: int = 3) -> BeautifulSoup | None:
    for i in range(tries):
        try:
            r = sess.get(url, timeout=20)
            r.raise_for_status()
            r.encoding = r.apparent_encoding or "utf-8"
            return BeautifulSoup(r.text, "html.parser")
        except requests.HTTPError as e:
            code = e.response.status_code
            log.warning(f"HTTP {code}: {url}")
            if code in (403, 404):
                return None
        except Exception as e:
            log.warning(f"エラー ({url}): {e}")
        time.sleep(2 ** (i + 1))
    log.error(f"フェッチ失敗: {url}")
    return None


# ── コンテンツ要素取得 ─────────────────────────────────────────────────────────
def main_content(soup: BeautifulSoup):
    """記事本文要素を返す。見つからなければ body を返す。"""
    for sel in [
        "div.entry-content",
        "div.post-content",
        "div.article-body",
        "article",
        "main",
    ]:
        el = soup.select_one(sel)
        if el:
            return el
    return soup.body or soup


# ── インデックスページURL収集 ──────────────────────────────────────────────────
def collect_index_urls(soup: BeautifulSoup) -> list[str]:
    """トップページからインデックスページURLを収集する。"""
    urls, seen = [], set()
    for a in main_content(soup).find_all("a", href=True):
        href = a["href"]
        if "page_id=" not in href:
            continue
        if "page_id=206" in href:  # トップページ自身を除外
            continue
        u = urljoin(BASE, href)
        text = a.get_text(strip=True)
        if u not in seen and re.search(r'\d', text):
            urls.append(u)
            seen.add(u)
    return urls


# ── 問題URLを収集 ──────────────────────────────────────────────────────────────
def collect_question_urls(soup: BeautifulSoup) -> list[str]:
    """インデックスページから個別問題ページURLを収集する。"""
    urls, seen = [], set()
    for a in main_content(soup).find_all("a", href=True):
        href = a["href"]
        if "page_id=" not in href:
            continue
        u = urljoin(BASE, href)
        text = a.get_text(strip=True)
        # 「第N問」「N問」「数字のみ」のリンクを問題リンクと判定
        if u not in seen and re.search(r'(第?\s*\d+\s*問|\b\d+\b)', text):
            urls.append(u)
            seen.add(u)
    return urls


# ── 問題ページパース ───────────────────────────────────────────────────────────
def parse_question(soup: BeautifulSoup, url: str, fallback_id: int) -> dict | None:
    """問題ページを解析して辞書形式で返す。"""
    root = main_content(soup)

    # テキストブロックを収集（子要素を持つコンテナは除外して重複を防ぐ）
    blocks = []
    for el in root.descendants:
        if el.name not in ("p", "h1", "h2", "h3", "h4", "h5", "li", "td"):
            continue
        if el.find(["p", "h1", "h2", "h3", "h4", "li"]):
            continue
        t = el.get_text(" ", strip=True)
        if t and len(t) > 2:
            blocks.append(t)

    if not blocks:
        log.warning(f"コンテンツなし: {url}")
        return None

    # 正規表現パターン
    P_NUM  = re.compile(r'第\s*(\d+)\s*問')
    P_CHOI = re.compile(r'^[\s　]*[\(（]([ABCDabcd])[\)）][.\s　]*(.+)')
    P_ANS  = re.compile(r'答[えい][\s　]*[：:：][\s　]*[\(（]?([ABCDabcd])[\)）]?')
    P_TRAN = re.compile(r'^(訳|和訳|日本語訳|【訳】|翻訳)[\s：:：]*')
    P_EXPL = re.compile(r'^(解説|【解説】|ポイント)[\s：:：]*')
    P_VOCE = re.compile(r'^(語彙|単語|【語彙】|【単語】|Words?)[\s：:：]*')
    P_NAV  = re.compile(r'^(HOME|TOEIC|Copyright|サイト|メニュー|Menu|Skip)', re.I)

    qid  = fallback_id
    qtxt = ""
    choices = {"A": "", "B": "", "C": "", "D": ""}
    ans   = ""
    trans = ""
    expl_parts: list[str] = []
    vocab_parts: list[str] = []
    state = "pre"

    for blk in blocks:
        # 問題番号
        m = P_NUM.search(blk)
        if m and state == "pre":
            qid = int(m.group(1))
            if re.fullmatch(r'[^\w]*第\s*\d+\s*問[^\w]*', blk.strip()):
                state = "q"
                continue

        # 選択肢
        m = P_CHOI.match(blk)
        if m:
            choices[m.group(1).upper()] = m.group(2).strip()
            state = "choices"
            continue

        # 答え
        m = P_ANS.search(blk)
        if m:
            ans = m.group(1).upper()
            state = "ans"
            continue

        # 訳
        if P_TRAN.match(blk):
            trans = P_TRAN.sub("", blk).strip()
            state = "trans"
            continue

        # 解説
        if P_EXPL.match(blk):
            body = P_EXPL.sub("", blk).strip()
            if body:
                expl_parts.append(body)
            state = "expl"
            continue

        # 語彙
        if P_VOCE.match(blk):
            body = P_VOCE.sub("", blk).strip()
            if body:
                vocab_parts.append(body)
            state = "vocab"
            continue

        # 状態別の蓄積
        if state in ("pre", "q"):
            if len(blk) > 10 and not P_NAV.match(blk):
                qtxt = (qtxt + " " + blk).strip()
                state = "q"
        elif state == "trans":
            trans = (trans + " " + blk).strip()
        elif state == "expl":
            expl_parts.append(blk)
        elif state == "vocab":
            vocab_parts.append(blk)

    if not qtxt and not any(choices.values()):
        log.warning(f"Q{qid}: コンテンツ抽出失敗 {url}")
        return None

    return {
        "id":          qid,
        "question":    qtxt.strip(),
        "choices":     choices,
        "answer":      ans,
        "translation": trans.strip(),
        "explanation": "\n".join(expl_parts).strip(),
        "vocabulary":  "\n".join(vocab_parts).strip(),
        "source_url":  url,
    }


# ── 進捗の保存・読み込み ────────────────────────────────────────────────────────
def load_progress() -> tuple[set, list]:
    if PROGRESS.exists():
        d = json.loads(PROGRESS.read_text("utf-8"))
        return set(d.get("done", [])), d.get("qs", [])
    return set(), []


def save_progress(done: set, qs: list) -> None:
    PROGRESS.write_text(
        json.dumps({"done": sorted(done), "qs": qs}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ── メイン ────────────────────────────────────────────────────────────────────
def main() -> None:
    log.info("=== TOEIC Grammar Scraper (zitanstudy.com) ===")

    done, qs = load_progress()
    log.info(f"進捗読み込み: {len(done)} 完了, {len(qs)} 問保存済み")

    # Step 1: トップページからインデックスURLを収集
    log.info(f"トップページ取得: {TOP_PAGE}")
    top_soup = fetch(TOP_PAGE)
    time.sleep(DELAY)

    idx_urls: list[str] = []
    if top_soup:
        idx_urls = collect_index_urls(top_soup)
        log.info(f"インデックスページ: {len(idx_urls)} 件")

    # 既知の最初のインデックスページを必ず含める
    if FIRST_INDEX not in idx_urls:
        idx_urls.insert(0, FIRST_INDEX)

    if not idx_urls:
        log.error("インデックスページが見つかりません。終了します。")
        sys.exit(1)

    # Step 2: 各インデックスページから問題URLを収集
    q_urls: list[str] = []
    q_seen: set[str]  = set()

    for i_url in idx_urls:
        log.info(f"インデックス取得: {i_url}")
        i_soup = fetch(i_url)
        time.sleep(DELAY)
        if i_soup:
            found = collect_question_urls(i_soup)
            for u in found:
                if u not in q_seen:
                    q_urls.append(u)
                    q_seen.add(u)
            log.info(f"  → {len(found)} 問リンク (累計 {len(q_urls)})")

    log.info(f"スクレイプ対象: {len(q_urls)} 問")

    # Step 3: 各問題ページをスクレイプ
    for i, q_url in enumerate(q_urls, 1):
        if q_url in done:
            log.debug(f"[{i}/{len(q_urls)}] スキップ (取得済み): {q_url}")
            continue

        log.info(f"[{i}/{len(q_urls)}] {q_url}")
        q_soup = fetch(q_url)

        if q_soup:
            q = parse_question(q_soup, q_url, i)
            if q:
                qs.append(q)
                log.info(f"  Q{q['id']}: {q['question'][:60]}…")

        done.add(q_url)

        if i % 10 == 0:
            save_progress(done, qs)
            log.info(f"  中間保存: {len(qs)} 問完了")

        time.sleep(DELAY)

    # 最終保存
    qs.sort(key=lambda x: x["id"])
    OUTPUT.write_text(
        json.dumps(qs, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info(f"✓ {len(qs)} 問を {OUTPUT} に保存しました")

    if PROGRESS.exists():
        PROGRESS.unlink()


if __name__ == "__main__":
    main()
