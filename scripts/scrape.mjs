// 外付けHDD／SSDセレクター（パソコン・スマホ・テレビ向け）のデータを取得するスクレイパー。
//
// 使い方：
//   node scripts/scrape.mjs
//
// しくみ：
//   1) I-O DATA公式の「HDD／SSD」配下のカテゴリページ（据え置き・ポータブル・SSD・
//      録画用・法人向け）を読み、そこに載っているシリーズのページURLを自動で集める。
//      → 新しいシリーズが公式に載れば、コードを触らなくても自動で増える。
//   2) シリーズごとに index.htm（価格表：型番・容量・価格・JAN・在庫状況）と
//      spec.htm（仕様表：コネクター・対応機種・付属品(ケーブル長)・保証 等）を読む。
//   3) 読み取りミスがあった場合は data/overrides.json に「正しい値」を書いておけば、
//      毎回の自動更新のたびにその値で上書きされる（コード修正なしで直せる）。
//
// アクセスは1件ずつ2秒間隔（NAS/DASセレクターと同じ方針）。

import fs from "node:fs/promises";

const BASE = "https://www.iodata.jp";

// カテゴリページ → カテゴリ名。同じシリーズが複数のページに載ることがある
// （例：HDD-UTBは「据え置き」と「録画用」の両方）ので、全部記録しておく。
const CATEGORY_PAGES = [
  { key: "stationary", url: BASE + "/product/hdd/hdd/" },
  { key: "portable", url: BASE + "/product/hdd/portable/" },
  { key: "ssd", url: BASE + "/product/hdd/ssd/" },
  { key: "rokuga", url: BASE + "/product/hdd/rokuga/" },
  { key: "biz", url: BASE + "/product/hdd/bizhdd/" }
];

// 対象外にするシリーズ（URLの末尾名で判定）。
//  hvl-*   : LAN接続の録画用HDD（USB接続のDASではない）
//  hd1-reut: カートリッジアダプター本体（容量を持たず、交換用カートリッジと組み合わせて使う）
const EXCLUDE_SLUG_PATTERNS = [/^hvl-/, /^hd1-reut$/];

const OUTPUT_PATH = new URL("../data/products.json", import.meta.url);
const OVERRIDES_PATH = new URL("../data/overrides.json", import.meta.url);
const REQUEST_INTERVAL_MS = 2000;
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT =
  "NasSelectorBot/1.0 (+https://github.com/ioplaza02/hdd-ssd-selector; " +
  "daily price/spec check for internal comparison tool)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return res.text();
}

// ---------- HTMLユーティリティ ----------

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    // 名前付きの文字参照。実例：「USB 3.2 Gen2&times;2」の「×」が化けて表示されていた
    .replace(/&(times|yen|reg|trade|copy|middot|hellip|minus|plusmn|deg|micro|sup2|sup3|frac12|rarr|larr|ndash|mdash);/g,
      (_, n) => ({ times: "×", yen: "￥", reg: "®", trade: "™", copy: "©", middot: "・", hellip: "…", minus: "−", plusmn: "±",
        deg: "°", micro: "µ", sup2: "²", sup3: "³", frac12: "½", rarr: "→", larr: "←", ndash: "–", mdash: "—" })[n]);
}

// タグを除去してテキスト化。<img alt="店頭在庫限り"> のようにアイコン画像で
// 状態を示している箇所もあるため、alt属性の文字は残す。
function cellText(html) {
  const withAlt = html.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, " $1 ");
  return decodeEntities(withAlt.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// <head>・<script>・<style>を除いた本文テキスト。
// meta keywords に「耐衝撃」が入っているだけの商品（例：SSPJ-UTC）を
// 耐衝撃と誤判定しないよう、<head>は必ず除く。
function bodyText(html) {
  if (!html) return "";
  let h = html.replace(/<head[\s\S]*?<\/head>/i, " ");
  h = h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  // ヘッダー／フッター／ナビは他商品の名前やカテゴリ名（「セキュリティ」等）を含むので除く
  h = h.replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, " ");
  return cellText(h);
}

function extractMeta(html, attr, name) {
  const re1 = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]+content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${name}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? decodeEntities(m[1]) : "";
}

function absUrl(src, pageUrl) {
  try { return new URL(src, pageUrl).href; } catch { return null; }
}

// <table>ごとに、行＝セル配列（テキスト）の二次元配列にする
function parseTables(html) {
  const tables = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(html)) !== null) {
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tm[1])) !== null) {
      const cells = [];
      const cellRe = /<(t[dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        cells.push({ tag: cm[1].toLowerCase(), html: cm[3], text: cellText(cm[3]) });
      }
      if (cells.length) rows.push(cells);
    }
    tables.push(rows);
  }
  return tables;
}

// ---------- 1) カテゴリページからシリーズURLを集める ----------

function discoverSeries(html, categoryKey, map) {
  const re = /href=["']((?:https?:\/\/www\.iodata\.jp)?\/product\/hdd\/(hdd|portable|ssd|rokuga|bizhdd)\/([a-z0-9][a-z0-9-]*)\/(?:index\.htm)?)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const folder = m[2];
    const slug = m[3].toLowerCase();
    if (EXCLUDE_SLUG_PATTERNS.some((p) => p.test(slug))) continue;
    const url = `${BASE}/product/hdd/${folder}/${slug}/index.htm`;
    if (!map.has(slug)) map.set(slug, { slug, folder, url, listedIn: new Set() });
    map.get(slug).listedIn.add(categoryKey);
  }
}

// ---------- 2) 価格表（index.htm） ----------

function toGB(value, unit) {
  const n = Number(value);
  return unit.toUpperCase() === "TB" ? Math.round(n * 1000) : Math.round(n);
}

// 状態がアイコン画像だけ（alt属性が空）で示されている行がある
// （実例：法人向けHDDの受注生産は icon_order.gif のみ）。画像ファイル名から補う。
function iconStatusText(rowHtml) {
  const t = [];
  if (/icon_order/i.test(rowHtml)) t.push("受注生産");
  // ※在庫限り・生産終了は公式では備考欄の文字で書かれている（アイコンでは判定しない。
  //   推測でアイコン名を判定したら、在庫ありの型番を在庫限りと誤判定した実例があった）
  return t.join(" ");
}

function detectStatus(text) {
  if (/生産終了/.test(text)) return "生産終了";
  if (/受注停止/.test(text)) return "受注停止";
  if (/在庫限り/.test(text)) return "在庫限り";
  if (/受注生産/.test(text)) return "受注生産";
  return "現行";
}

const COLOR_WORDS = ["ブラック×レッド", "シルバー×グリーン", "グレー×ブラック", "ホワイト×ブラック",
  "ブラック", "ホワイト", "ネイビー", "シルバー", "グレー", "ピンク", "ブルー", "レッド", "ゴールド", "グラファイト", "クラウドピンク"];

function extractVariants(indexHtml) {
  const bySku = new Map();
  for (const rows of parseTables(indexHtml)) {
    const flat = rows.map((r) => r.map((c) => c.text).join(" ")).join(" ");
    if (!/型番/.test(flat) || !/(￥|オープン価格)/.test(flat)) continue;

    // 見出し行から「カラー」列の位置が分かれば使う
    let colorCol = -1;
    for (const r of rows) {
      const idx = r.findIndex((c) => /カラー|色/.test(c.text));
      if (idx >= 0 && r.length > 2) { colorCol = idx; break; }
    }

    for (const r of rows) {
      const texts = r.map((c) => c.text);
      // 型番の判定用：アイコン画像のalt文字を含めないテキスト。
      // 新商品の「NEW」アイコンのaltが型番にくっつく（例：HD4-UTN8CNEW）のを防ぐ
      const plain = r.map((c) => decodeEntities(c.html.replace(/<img[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
      // 1列目（またはどこか）に型番らしいセルがある行だけ
      const skuIdx = plain.findIndex((t) => /^[A-Z][A-Z0-9-]*\d[A-Z0-9-\/]*$/.test(t.replace(/\s/g, "")));
      if (skuIdx < 0) continue;
      const sku = plain[skuIdx].replace(/\s/g, "").replace(/NEW$/, "");
      const rowText = texts.join(" ");
      const cap = rowText.match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
      if (!cap) continue;
      const price = rowText.match(/￥\s?([\d,]+)(?:[^￥\d]*税抜[^￥\d]*￥\s?([\d,]+))?/);
      const jan = rowText.match(/\b(4\d{12})\b/);
      let color = null;
      if (colorCol >= 0 && texts[colorCol] && texts.length > colorCol) color = texts[colorCol];
      if (!color) color = COLOR_WORDS.find((w) => rowText.includes(w)) || null;

      if (bySku.has(sku)) continue;
      bySku.set(sku, {
        sku,
        capacityGB: toGB(cap[1], cap[2]),
        color,
        priceIncTax: price ? Number(price[1].replace(/,/g, "")) : null,
        priceExTax: price && price[2] ? Number(price[2].replace(/,/g, "")) : null,
        jan: jan ? jan[1] : "",
        status: detectStatus(rowText + " " + iconStatusText(r.map((c) => c.html).join(" ")))
      });
    }
  }
  return [...bySku.values()].sort((a, b) => a.capacityGB - b.capacityGB || a.sku.localeCompare(b.sku));
}

// ---------- 3) 仕様表（spec.htm） ----------

// 仕様表を「見出し → 値」の辞書にする。
// 対応機種のように「対応機種｜スマートフォン・タブレット｜iPhone…」と
// 見出しが2段（rowspan）になっている行は、後ろ側の見出しで登録する
// （例：spec["スマートフォン・タブレット"]）。前側の見出しも「親:子」で残す。
function extractSpecMap(specHtml) {
  const map = {};
  let parent = null;
  for (const rows of parseTables(specHtml)) {
    for (const r of rows) {
      if (r.length < 2) continue;
      const value = r[r.length - 1].text;
      const label = r[r.length - 2].text.replace(/\s/g, "");
      if (!label || label.length > 30) continue;
      if (r.length >= 3) parent = r[0].text.replace(/\s/g, "");
      if (!(label in map)) map[label] = value;
      if (r.length >= 3 && parent && !(parent + ":" + label in map)) map[parent + ":" + label] = value;
      else if (r.length === 2 && parent && r[0].tag === "th" && !(label in map)) map[label] = value;
    }
  }
  return map;
}

function findSpec(spec, patterns) {
  for (const p of patterns) {
    for (const [k, v] of Object.entries(spec)) {
      if (p.test(k)) return v;
    }
  }
  return null;
}

const isDash = (v) => v == null || /^[\s－\-―ー–—]*$/.test(v) || /^(非対応|なし|ー)$/.test(v.trim());

// ---------- 4) 各項目の判定 ----------

function deriveFields({ slug, folder, listedIn, indexHtml, specHtml }) {
  const spec = extractSpecMap(specHtml);
  const idxText = bodyText(indexHtml);
  const specText = bodyText(specHtml);
  const all = idxText + " " + specText;
  const title = extractMeta(indexHtml, "property", "og:title") || (indexHtml.match(/<title>([^<]*)/i) || [])[1] || slug;

  const seriesName = cleanSeriesName(title, slug);

  const interfaceText = findSpec(spec, [/^インターフェ[イー]ス$/, /インターフェ/]) || "";
  const connectorText = findSpec(spec, [/コネクター形状/, /コネクタ/]) || "";
  // 古いテンプレートは「添付品」、新しいテンプレートは「付属品」
  const accessoryText = findSpec(spec, [/^付属品$/, /付属品/, /^添付品$/, /添付品/]) || "";
  // 電源の見出しは「定格電圧」「電源」「定格」のいずれか（テンプレートにより異なる）
  const powerText = [findSpec(spec, [/定格電圧/]), findSpec(spec, [/^電源/, /電源方式/]), findSpec(spec, [/^定格$/])].filter(Boolean).join(" ");
  const phoneText = findSpec(spec, [/スマートフォン/, /タブレット/]);
  const tvText = findSpec(spec, [/^テレビ$/, /対応機種:テレビ/]);
  // 対応機種の「ゲーム機」「その他」欄（例：「PlayStation 5」「Windows／Mac以外のUSB機器」）
  const gameText = findSpec(spec, [/^ゲーム機$/, /対応機種:ゲーム機/]);
  const otherText = findSpec(spec, [/^対応機種:その他$/, /^その他$/]);
  const warrantyText = findSpec(spec, [/保証期間/]) || "";
  const weightText = findSpec(spec, [/質量/, /重さ/, /重量/]) || "";
  const dimText = findSpec(spec, [/外形寸法/]) || "";

  const mediaType = /^(ss|avssd|r-ss)/.test(slug) || /SSD/.test(seriesName) ? "SSD" : "HDD";

  let formFactor = "stationary";
  if (mediaType === "SSD" && (/^(ssps|sspq|avssd)/.test(slug) || /スティック/.test(title))) formFactor = "stick";
  else if (/^sspj/.test(slug) || (mediaType === "SSD" && /小型SSD/.test(all) && !/ポータブルSSD/.test(seriesName))) formFactor = "compact";
  else if (folder === "portable" || listedIn.has("portable") || mediaType === "SSD" || /^hdp/.test(slug)) formFactor = "portable";

  const driveMatch = all.match(/(\d)\s*ドライブ/);
  const driveCount = /^hd4-/.test(slug) ? 4 : /^hdw-/.test(slug) ? 2 : driveMatch ? Number(driveMatch[1]) : 1;

  // バスパワー：定格電圧/電源欄に「バスパワー」。ACアダプター表記があれば非バスパワー
  let busPower;
  if (/バスパワー/.test(powerText)) busPower = true;
  else if (/ACアダプター|AC100V|AC\s*100/.test(powerText)) busPower = false;
  else busPower = /バスパワー/.test(all) && !/ACアダプター/.test(accessoryText);

  // スマホ：専用の行が無いページ（例：R-SSPT-UF）は「対応機種」欄の中身で判定する
  const compatText = findSpec(spec, [/^対応機種$/, /対応機種/]) || "";
  // 対応機種の「パソコン」欄（例：「Windowsパソコン、Mac」）。専用の行が無いページは対応機種欄全体で判定
  const pcText = findSpec(spec, [/^パソコン$/, /対応機種:パソコン/]) || compatText;
  const smartphone = phoneText != null && !isDash(phoneText)
    ? true
    : /(iPhone|iPad|Android|スマートフォン)/.test(compatText);
  // テレビ：専用の行が無いページ（例：HDPH-UTV）は「対応機種」欄の「録画に対応したAV機器」等で判定。
  // 「テレビでは使えません」と明記されている商品（例：HDPH-UTV5DK）は必ず非対応にする。
  const tvNegative = /テレビ.{0,12}(使用できません|使えません|非対応|ご利用いただけません|ご使用いただけません)/.test(all) || /AV機器は非対応/.test(all);
  let tv;
  if (listedIn.has("rokuga")) tv = true; // 例：HDD-UTB・SSPS-US（録画用ページ掲載＝テレビ録画対応）
  else if (tvNegative) tv = false;
  else if (tvText != null && !/^対応機種/.test(tvText)) tv = !isDash(tvText);
  else tv = /(AV機器|テレビ|レコーダー)/.test(compatText) || folder === "rokuga";
  const tvRecordingMain = folder === "rokuga" || /^(av|hdpl|hdpz)/.test(slug);

  // 「耐衝撃」と書かず「衝撃・振動に強い」と書く商品もある（例：R-SSPT-UF、SSMG-UWCB）
  const shockproof = /耐衝撃|衝撃(?:や|・|、)?(?:振動)?に強/.test(all);
  const shockNote = (all.match(/[^。 ]{0,30}(MIL[^。]{0,40}|耐衝撃[^。]{0,30}|衝撃[^。]{0,20}に強[^。]{0,10})/) || [])[0] || null;

  const encHw = /(ハードウェア暗号化|自動暗号化|AES\s*-?\s*\d{3}\s*bit[^。]{0,20}暗号化|暗号化チップ)/i.test(all);
  // 「パソコンの暗号化・管理ソフトに対応」：パソコン側のアプリ（I-O Security Lock App、
  // SUHManager 等）でパスワード設定・一元管理するタイプ。BitLocker対応の明記も含める。
  const encSw = /(Security Lock App|SUHManager|暗号化ソフト|ソフトウェア暗号化|暗号化.{0,10}アプリ|BitLocker)/i.test(all);
  const encNoteMatch = all.match(/[^。 ]{0,20}(AES\s*-?\s*\d{3}\s*bit|ハードウェア暗号化|自動暗号化|暗号化ソフト[^。]{0,20})/i);

  // 端子：本体側コネクター＋付属ケーブルからパソコン／スマホ側の差し込み口を判定
  const conn = (connectorText + " " + accessoryText + " " + interfaceText);
  const host = new Set();
  // 「A-microB」「A - microB」「A－microB」など、空白や全角ハイフンのゆれを許容する
  if (/(Type-?C|USB-?C|\bC\s*[-－–]\s*(micro\s*B|C|A)|USB4|Thunderbolt|C to|Cケーブル)/i.test(conn)) host.add("C");
  if (/(Type-?A|USB-?A|\bA\s*[-－–]\s*(micro\s*B|B|C)|A to|Aケーブル|変換アダプター)/i.test(conn)) host.add("A");
  if (/(C-C|USB-?C.{0,6}USB-?C)/i.test(accessoryText) && /(変換|アダプター).{0,10}(A|USB-A)/i.test(accessoryText)) host.add("A");
  if (host.size === 0) host.add("A"); // 記載が無い古い据え置き機はUSB-A

  // ケーブル長（付属品欄の「約○cm」「約○m」の最大値）
  let cableLengthCm = null;
  const lenRe = /約?\s*([\d.]+)\s*(cm|ｃｍ|m|ｍ)(?![a-zA-Zｍ])/g;
  let lm;
  while ((lm = lenRe.exec(accessoryText)) !== null) {
    const n = Number(lm[1]);
    const cm = /c/.test(lm[2]) || /ｃ/.test(lm[2]) ? n : n * 100;
    if (cm >= 5 && cm <= 500) cableLengthCm = Math.max(cableLengthCm || 0, Math.round(cm));
  }

  const warrantyYears = (warrantyText.match(/(\d+)\s*年/) || all.match(/(\d)\s*年保証/) || [])[1];
  const weightG = (() => {
    const kg = weightText.match(/([\d.]+)\s*kg/i);
    if (kg) return Math.round(Number(kg[1]) * 1000);
    const g = weightText.match(/([\d.]+)\s*g/i);
    return g ? Math.round(Number(g[1])) : null;
  })();

  const imageUrl = extractImage(indexHtml, slug);

  const features = [];
  if (/Time Machine/i.test(all)) features.push("Mac Time Machine対応");
  if (/24時間.{0,6}(連続|常時)/.test(all)) features.push("24時間連続稼働");
  if (/タイムシフト/.test(all)) features.push("タイムシフト録画対応");
  if (/静音/.test(all)) features.push("静音設計");
  if (/データ移行アプリ内蔵|かんたんデータ移行/.test(all)) features.push("データ移行アプリ内蔵");
  if (/MagSafe/i.test(all)) features.push("MagSafe対応");
  if (/グリーン購入法/.test(all)) features.push("グリーン購入法適合");
  if (/バックアップ専用/.test(all) && /\/ld/i.test(seriesName + slug)) features.push("NASバックアップ専用");

  return {
    id: slug,
    sourceUrl: `${BASE}/product/hdd/${folder}/${slug}/index.htm`,
    seriesName,
    // HDJA-SUTCのように「/hdd/hdd/」配下でも法人向けセキュリティモデルのものがあるため、
    // 型番に「-SUTC」（セキュリティモデル共通の命名）を含むものは法人向けに寄せる
    category: /-sutc/.test(slug) ? "biz" : folderToCategory(folder),
    mediaType,
    formFactor,
    driveCount,
    busPower,
    smartphone,
    smartphoneNote: smartphone && phoneText ? phoneText : null,
    tv,
    tvRecordingMain,
    pcWindows: pcText ? /Windows/i.test(pcText) : null,
    pcMac: pcText ? /Mac/i.test(pcText) : null,
    pcNote: pcText && pcText.length < 120 ? pcText : null,
    gameConsole: gameText != null && !isDash(gameText),
    gameNote: gameText != null && !isDash(gameText) ? gameText : null,
    otherDevices: otherText != null && !isDash(otherText) && otherText.length < 120 ? otherText : null,
    shockproof,
    shockNote: shockproof ? shockNote : null,
    encryptionHw: encHw,
    encryptionSw: encSw,
    encryptionNote: (encHw || encSw) && encNoteMatch ? encNoteMatch[0].trim() : null,
    deviceConnector: connectorText || null,
    hostConnectors: ["A", "C"].filter((k) => host.has(k)),
    cables: accessoryText || null,
    cableLengthCm,
    interface: interfaceText || null,
    macTimeMachine: /Time Machine/i.test(all),
    warrantyYears: warrantyYears ? Number(warrantyYears) : null,
    weightG,
    dimensions: dimText || null,
    features,
    imageUrl
  };
}

// 商品画像。og:imageが無いページが多い（据え置き系は全滅だった）ので、
// ①og:image → ②「_l.jpg」で終わる画像 → ③ファイル名に型番（slug）を含む画像 の順で探す。
// HDJA-UTRのように画像の置き場所が他と違うページもあるため、パスの決め打ちはしない。
function extractImage(html, slug) {
  const og = extractMeta(html, "property", "og:image");
  if (og) return absUrl(og, BASE + "/");
  const body = html.replace(/<head[\s\S]*?<\/head>/i, "");
  const l = body.match(/<img[^>]+src=["']([^"']+_l\.(?:jpg|jpeg|png|webp))["']/i);
  if (l) return absUrl(l[1], BASE + "/");
  const key = slug.replace(/-/g, "[-_]?");
  const re = new RegExp(`<img[^>]+src=["']([^"']*${key}[^"']*\\.(?:jpg|jpeg|png|webp))["']`, "i");
  const m = body.match(re);
  if (m) return absUrl(m[1], BASE + "/");
  // 最後の手段：公式の商品画像の標準的な置き場所（多くのシリーズがこの形）
  return `${BASE}/image/${slug}_l.jpg`;
}

function folderToCategory(folder) {
  return { hdd: "stationary", portable: "portable", ssd: "ssd", rokuga: "rokuga", bizhdd: "biz" }[folder] || folder;
}

function cleanSeriesName(title, slug) {
  let t = title.split(/[|｜]/)[0].replace(/\s*-\s*I-O DATA.*$/i, "").trim();
  t = t.replace(/^.*?(?=(カクうす|トロッカ|floworks|[A-Z]{2,}[A-Z0-9-]*\/?[A-Z]*シリーズ|[A-Z]{2,}-[A-Z0-9]+))/, "");
  return t || slug.toUpperCase();
}

// ---------- 5) 上書き設定 ----------

async function loadOverrides() {
  try {
    const raw = JSON.parse(await fs.readFile(OVERRIDES_PATH, "utf8"));
    return raw.series || {};
  } catch {
    return {};
  }
}

function applyOverride(product, ov) {
  if (!ov) return product;
  const { variants: vOv, ...rest } = ov;
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith("_")) continue; // _memo などのメモ欄
    product[k] = v;
  }
  if (vOv) {
    for (const v of product.variants) {
      if (vOv[v.sku]) Object.assign(v, vOv[v.sku]);
    }
  }
  return product;
}

// ---------- main ----------

async function main() {
  const seriesMap = new Map();
  for (const cat of CATEGORY_PAGES) {
    console.log("カテゴリページを取得:", cat.url);
    try {
      discoverSeries(await fetchText(cat.url), cat.key, seriesMap);
    } catch (e) {
      console.warn("  -> 取得失敗:", e.message);
    }
    await sleep(REQUEST_INTERVAL_MS);
  }
  console.log("シリーズ候補:", seriesMap.size, "件");

  const overrides = await loadOverrides();
  const products = [];
  let i = 0;
  for (const s of seriesMap.values()) {
    i++;
    console.log(`[${i}/${seriesMap.size}] ${s.slug}`);
    let indexHtml = "", specHtml = "";
    try { indexHtml = await fetchText(s.url); } catch (e) { console.warn("  -> index取得失敗:", e.message); }
    await sleep(REQUEST_INTERVAL_MS);
    if (!indexHtml) continue;
    try { specHtml = await fetchText(s.url.replace(/index\.htm$/, "spec.htm")); } catch (e) { console.warn("  -> spec取得失敗:", e.message); }
    await sleep(REQUEST_INTERVAL_MS);

    const variants = extractVariants(indexHtml);
    if (variants.length === 0) {
      // 価格表の無いページ（シリーズの一覧ページ・アクセサリ等）は対象外
      console.log("  -> 容量付きの価格表が無いため対象外");
      continue;
    }
    const fields = deriveFields({ ...s, indexHtml, specHtml });
    // 価格表に色が無く、仕様表の「カラー」が1色だけのとき（例：SSPS-US/S）はそれを使う
    const specColor = findSpec(extractSpecMap(specHtml), [/^カラー$/, /本体色/]);
    if (specColor && !/[、,／\/]/.test(specColor)) variants.forEach((v) => { if (!v.color) v.color = specColor; });
    const product = applyOverride({ ...fields, variants, lastCheckedAt: new Date().toISOString() }, overrides[s.slug]);
    if (product.exclude) { console.log("  -> overrides.jsonで除外指定"); continue; }
    delete product.exclude;
    products.push(product);
  }

  products.sort((a, b) => a.id.localeCompare(b.id));
  await fs.writeFile(OUTPUT_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), products }, null, 2) + "\n");
  console.log("完了:", products.length, "シリーズ /", products.reduce((n, p) => n + p.variants.length, 0), "型番");
}

main().catch((e) => { console.error(e); process.exit(1); });
