// USBメモリーセレクターのデータを取得するスクレイパー。
//
// 使い方：
//   node scripts/scrape.mjs
//
// しくみ：
//   1) I-O DATA公式の「USBメモリー」「セキュリティUSBメモリー」のカテゴリページを読み、
//      そこに載っているシリーズのページURLを自動で集める。
//      → 新しいシリーズが公式に載れば、コードを触らなくても自動で増える。
//   2) シリーズごとに index.htm（価格表：型番・容量・カラー・JAN・在庫状況）と
//      spec.htm（仕様表：コネクター・対応OS・保証 等）を読む。
//   3) 価格は公式のメーカー希望小売価格。「オープン価格」の型番は openPrice: true にする
//      （価格が読めなかったのか、オープン価格なのかを区別するため）。
//   4) 読み取りミスがあった場合は data/overrides.json に「正しい値」を書いておけば、
//      毎回の自動更新のたびにその値で上書きされる（コード修正なしで直せる）。
//
// アクセスは1件ずつ2秒間隔（他のセレクターと同じ方針）。

import fs from "node:fs/promises";

const BASE = "https://www.iodata.jp";

// 公式のカテゴリページ。セキュリティUSBメモリーのページにはスタンダード配下の
// シリーズ（例：EU3-PW/R）も載っているので、両方から集める。
const CATEGORY_PAGES = [
  { key: "standard", url: BASE + "/product/usbmemory/standard/index.htm" },
  { key: "security", url: BASE + "/product/usbmemory/security/index.htm" }
];

// 対象外（容量を持たない商品）
//  suhm   : 管理者用ソフトウェア
//  ed-vlt : アンチウイルスのライセンス延長パック
//  ed-vl  : サポートサービス更新ソフトウェア
const EXCLUDE_SLUG_PATTERNS = [/^suhm$/, /^ed-vlt?$/, /^snservice/];

const OUTPUT_PATH = new URL("../data/products.json", import.meta.url);
const OVERRIDES_PATH = new URL("../data/overrides.json", import.meta.url);
const REQUEST_INTERVAL_MS = 2000;
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT =
  "NasSelectorBot/1.0 (+https://github.com/ioplaza02/usb-memory-selector; " +
  "daily price/spec check for internal comparison tool)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(url + " -> " + res.status);
  // Shift_JIS のページがあっても文字化けしないよう、文字コードを見て読み分ける
  const buf = Buffer.from(await res.arrayBuffer());
  const ctype = res.headers.get("content-type") || "";
  const head = buf.subarray(0, 2048).toString("latin1");
  const cs = (ctype.match(/charset=([\w-]+)/i) || head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  try {
    return new TextDecoder(/shift_jis|sjis|x-sjis|windows-31j|cp932/i.test(cs) ? "shift_jis" : /euc-jp/i.test(cs) ? "euc-jp" : "utf-8").decode(buf);
  } catch {
    return buf.toString("utf8");
  }
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

// <head>・<script>・<style>・ヘッダー／フッター／ナビを除いた本文テキスト
function bodyText(html) {
  if (!html) return "";
  let h = html.replace(/<head[\s\S]*?<\/head>/i, " ");
  h = h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
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
// 公式のスタンダードページは「スタンダードモデル」「法人向けスタンダードモデル」
// 「デザインモデル」「ハイスピードモデル」「抗菌モデル」の見出しで分かれているので、
// リンク直前の見出しも一緒に記録しておく（ラインナップの判定に使う）。

function discoverSeries(html, categoryKey, map) {
  const re = /<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>|href=["']((?:https?:\/\/www\.iodata\.jp)?\/product\/usbmemory\/(standard|security)\/([a-z0-9][a-z0-9-]*)\/(?:index\.htm)?)["']/gi;
  let heading = "";
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] != null) {
      const t = cellText(m[1]);
      if (/モデル/.test(t) && t.length < 30) heading = t;
      continue;
    }
    const folder = m[3];
    const slug = m[4].toLowerCase();
    if (EXCLUDE_SLUG_PATTERNS.some((p) => p.test(slug))) continue;
    const url = `${BASE}/product/usbmemory/${folder}/${slug}/index.htm`;
    if (!map.has(slug)) map.set(slug, { slug, folder, url, listedIn: new Set(), heading: "" });
    const s = map.get(slug);
    s.listedIn.add(categoryKey);
    if (!s.heading && heading && categoryKey === "standard") s.heading = heading;
  }
}

// ---------- 2) 価格表（index.htm） ----------

function toGB(value, unit) {
  const n = Number(value);
  return unit.toUpperCase() === "TB" ? Math.round(n * 1000) : Math.round(n);
}

function iconStatusText(rowHtml) {
  const t = [];
  if (/icon_order/i.test(rowHtml)) t.push("受注生産");
  return t.join(" ");
}

function detectStatus(text) {
  if (/生産終了/.test(text)) return "生産終了";
  if (/受注停止/.test(text)) return "受注停止";
  if (/在庫限り/.test(text)) return "在庫限り";
  if (/受注生産/.test(text)) return "受注生産";
  return "現行";
}

// 長い色名から先に当てる（「ピンク」より「ベビーピンク」を優先）
const COLOR_WORDS = ["ライラックパープル", "ベビーピンク", "ミントグリーン", "ライトブルー", "スケルトンブルー", "スケルトンブラウン",
  "ブラック", "ホワイト", "シルバー", "ピンク", "ブルー", "レッド", "グリーン", "ゴールド", "グレー"].sort((a, b) => b.length - a.length);

// 型番の末尾の記号 → 色名（例：U3-PSH16G/K → ブラック）。
// シリーズで色名が違う場合（例：U3-CLPの /B はライトブルー）は overrides.json の colorCodes で上書きする。
const COLOR_CODES = { K: "ブラック", W: "ホワイト", S: "シルバー", B: "ブルー", R: "レッド", P: "ピンク", G: "グリーン", V: "パープル", BR: "ブラウン", GD: "ゴールド", GY: "グレー" };
function colorSuffix(sku) {
  const m = String(sku).match(/\/(?:\d+G)?R?([A-Z]{1,2})$/);
  return m ? m[1] : null;
}
// 価格表から色が読めなかったときだけ、型番の記号から色名を補う。
// シリーズ内で記号が1種類しかない場合（例：EU3-PW/8GR の R）は色ではないので補わない。
function fillColorsFromSku(variants, codes) {
  const suffixes = new Set(variants.map((v) => colorSuffix(v.sku)).filter(Boolean));
  if (suffixes.size < 2) return;
  for (const v of variants) {
    if (v.color) continue;
    const c = colorSuffix(v.sku);
    v.color = (codes && codes[c]) || COLOR_CODES[c] || null;
  }
}

// 型番の末尾で保証年数が変わるシリーズ（例：ED-SVT4/8G3 = 3年版、ED-V4/8GR5 = 5年版）
function warrantyFromSku(sku) {
  const m = String(sku).match(/\/\d+GR?([35])$/);
  return m ? Number(m[1]) : null;
}

function extractVariants(indexHtml) {
  const bySku = new Map();
  for (const rows of parseTables(indexHtml)) {
    const flat = rows.map((r) => r.map((c) => c.text).join(" ")).join(" ");
    if (!/型番/.test(flat) || !/(￥|オープン価格)/.test(flat)) continue;

    let colorCol = -1;
    for (const r of rows) {
      const idx = r.findIndex((c) => /カラー|色/.test(c.text));
      if (idx >= 0 && r.length > 2) { colorCol = idx; break; }
    }

    let groupColor = null; // 「ブラック」のように色名だけが書かれた見出し行の色
    for (const r of rows) {
      const texts = r.map((c) => c.text);
      // 型番の判定は、アイコン画像のalt文字を含めないテキストで行う（「NEW」が型番にくっつくのを防ぐ）
      const plain = r.map((c) => decodeEntities(c.html.replace(/<img[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
      const skuIdx = plain.findIndex((t) => /^[A-Z][A-Z0-9-]*\d[A-Z0-9-\/]*$/.test(t.replace(/\s/g, "")));
      if (skuIdx < 0) {
        const t = texts.join(" ");
        if (t.length <= 30) groupColor = COLOR_WORDS.find((w) => t.includes(w)) || groupColor;
        continue;
      }
      const sku = plain[skuIdx].replace(/\s/g, "").replace(/NEW$/, "");
      const rowText = texts.join(" ");
      const cap = rowText.match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
      if (!cap) continue;
      const price = rowText.match(/￥\s?([\d,]+)(?:[^￥\d]*税抜[^￥\d]*￥\s?([\d,]+))?/);
      const jan = rowText.match(/\b(4\d{12})\b/);
      let color = null;
      if (colorCol >= 0 && texts[colorCol] && texts.length > colorCol && !/^(カラー|色)$/.test(texts[colorCol])) color = texts[colorCol];
      if (!color) color = COLOR_WORDS.find((w) => rowText.includes(w)) || groupColor || null;

      if (bySku.has(sku)) continue;
      bySku.set(sku, {
        sku,
        capacityGB: toGB(cap[1], cap[2]),
        color,
        warrantyYears: warrantyFromSku(sku),
        priceIncTax: price ? Number(price[1].replace(/,/g, "")) : null,
        priceExTax: price && price[2] ? Number(price[2].replace(/,/g, "")) : null,
        openPrice: !price && /オープン価格/.test(rowText),
        jan: jan ? jan[1] : "",
        status: detectStatus(rowText + " " + iconStatusText(r.map((c) => c.html).join(" ")))
      });
    }
  }
  return [...bySku.values()].sort((a, b) => a.capacityGB - b.capacityGB || a.sku.localeCompare(b.sku));
}

// ---------- 3) 仕様表（spec.htm） ----------

function extractSpecMap(specHtml) {
  const map = {};
  let parent = null;
  for (const rows of parseTables(specHtml)) {
    for (const r of rows) {
      if (r.length < 2) continue;
      const value = r[r.length - 1].text;
      const label = r[r.length - 2].text.replace(/\s/g, "");
      if (!label || label.length > 40) continue;
      if (r.length >= 3) parent = r[0].text.replace(/\s/g, "");
      if (!(label in map)) map[label] = value;
      if (r.length >= 3 && parent && !(parent + ":" + label in map)) map[parent + ":" + label] = value;
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

// ---------- 4) 各項目の判定 ----------

function deriveFields({ slug, folder, listedIn, heading, indexHtml, specHtml }) {
  const spec = extractSpecMap(specHtml);
  const idxText = bodyText(indexHtml);
  const specText = bodyText(specHtml);
  const all = idxText + " " + specText;
  // 本文に書かれず、meta description だけに「スライド式モデル」と書かれているシリーズがある（例：ED-S4/R）
  const meta = [extractMeta(indexHtml, "name", "description"), extractMeta(indexHtml, "name", "keywords")].join(" ");
  const title = extractMeta(indexHtml, "property", "og:title") || cellText((indexHtml.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "") || slug;
  const h1 = cellText((indexHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
  const fullName = h1 || title;
  const seriesName = cleanSeriesName(fullName, slug);

  const interfaceText = findSpec(spec, [/^インターフェ[イー]ス$/, /インターフェ/]) || "";
  const connectorText = findSpec(spec, [/コネクター形状/, /コネクタ/]) || "";
  const compatText = findSpec(spec, [/^対応機種$/, /^動作環境$/, /対応機種/]) || "";
  const osText = findSpec(spec, [/^対応OS/, /対応OS/]) || "";
  const warrantyText = findSpec(spec, [/^保証期間$/, /保証期間/]) || "";
  const weightText = findSpec(spec, [/^質量$/, /質量/, /重さ/]) || "";
  const dimText = findSpec(spec, [/外形寸法/]) || "";
  const tempText = findSpec(spec, [/使用温度範囲/, /動作温度/]) || "";
  const lampText = findSpec(spec, [/アクセスランプ/, /^ランプ/]);

  // 本体の形：ノック式 → スライド式 → キャップ式 の順に判定する
  // （スライド式の説明に「キャップの紛失の心配なし」と書かれていることがあるため）
  const styleText = all + " " + meta;
  let bodyStyle = null;
  if (/ノック式/.test(styleText)) bodyStyle = "knock";
  else if (/スライド(式|機構|方式|スイッチ)|USB端子スライド/.test(styleText)) bodyStyle = "slide";
  else if (/キャップ(式|付き|を後ろ|装着)|保護キャップ|キャップを含む/.test(styleText)) bodyStyle = "cap";

  // 端子
  const connAll = connectorText + " " + compatText + " " + interfaceText;
  const host = new Set();
  if (/Type-?C|USB-?C/i.test(connAll)) host.add("C");
  if (/Standard\s*-?\s*A|USB-?A|Type-?A/i.test(connAll)) host.add("A");
  if (host.size === 0) host.add("A");

  // 使える機器（対応OS欄が基本。対応機種欄の「Windowsパソコン、Mac、Chromebook」も見る）
  const osAll = osText + " " + compatText;
  const os = {
    windows: /Windows/i.test(osAll) || !osAll.trim(),
    mac: /macOS|OS X|Mac/i.test(osAll),
    chromeos: /Chrome\s*OS|ChromeOS|Chromebook/i.test(osAll),
    ios: /iOS|iPadOS|iPhone|iPad/i.test(osAll),
    android: /Android/i.test(osAll),
    linux: /Ubuntu|Linux/i.test(osAll),
    winServer: /Windows\s*Server/i.test(osAll)
  };
  // 変換ケーブル（別売）でAndroidに使える、と本文だけに書かれている商品（例：U3-PSH）
  const androidViaAdapter = !os.android && /Android/.test(idxText) && /(OTG|変換ケーブル|変換アダプター)/.test(idxText);

  // セキュリティ
  const passwordButton = /パスワードボタン/.test(all);
  const passwordLock = passwordButton || /パスワードロック|SUGate|パスワードで強制的にロック/.test(all);
  const hwEncryption = /ハードウェア(?:で)?自動暗号化|ハードウェア暗号化|自動暗号化/.test(all);
  // 「抗ウイルス」（抗菌モデル）と区別するため、「ウイルス」単独では判定しない
  const antivirus = /アンチウイルス|ウイルスチェック|ウイルスパターン|USB\s*Security/i.test(all);
  const antivirusEngine = /Trellix/i.test(all) ? "Trellix" : /Trend\s*Micro|トレンドマイクロ/i.test(all) ? "トレンドマイクロ" : null;
  // 管理者用ソフト：他シリーズとの比較表にも名前が出るため、仕様ページの記載で判定する
  const adminSoftware = /SUHManager/i.test(specText);
  const fileEncryptSoftware = /QuickSecure/i.test(all);
  const writeProtect = /書き?込み禁止|ライトプロテクト|読み取り専用/.test(all);
  const retry = all.match(/(?:入力ミスの上限は|連続\s*)(\d+)\s*回/);

  const warrantyYears = (warrantyText.match(/(\d+)\s*年/) || all.match(/(\d)\s*年保証/) || [])[1];
  const weightG = (() => {
    const g = weightText.match(/([\d.]+)\s*g/i);
    return g ? Number(g[1]) : null;
  })();

  const features = [];
  if (/pSLC|LONG\s*LIFE/i.test(all)) features.push("書き換えに強い長寿命設計（pSLC）");
  else if (/書き換え回数.{0,30}約?\d+倍/.test(all)) features.push("書き換え回数が従来モデルより多い長寿命タイプ");
  if (/SIAA/.test(all) || /抗菌/.test(fullName)) features.push("抗菌・抗ウイルス加工（SIAA認証）");
  if (/クリップ/.test(all)) features.push("クリップ付き");
  if (/アルミ/.test(all)) features.push("アルミボディ");
  if (/データ復旧サービス/.test(all)) features.push("データ復旧サービス（有料）");
  if (/名入れ/.test(all)) features.push("名入れ対応");
  if (/ISS/.test(specText) || /ISS-LIGHT/.test(all)) features.push("延長保証（ISS）対象");

  const readM = all.match(/読み込み速度\s*(?:約|最大)?\s*([\d,]+)\s*MB\/s/);

  return {
    id: slug,
    sourceUrl: `${BASE}/product/usbmemory/${folder}/${slug}/index.htm`,
    seriesName,
    fullName,
    lineup: detectLineup({ folder, listedIn, heading, fullName, passwordLock, antivirus }),
    bodyStyle,
    strapHole: /ストラップホール|ストラップ穴/.test(all),
    clip: /クリップ/.test(all),
    accessLamp: lampText == null ? null : /^(有|あり|有り)/.test(lampText.trim()),
    hostConnectors: ["A", "C"].filter((k) => host.has(k)),
    connectorText: connectorText || null,
    interface: interfaceText || null,
    readMBps: readM ? Number(readM[1].replace(/,/g, "")) : null,
    os,
    androidViaAdapter,
    osText: osText || null,
    compatText: compatText || null,
    security: {
      passwordLock,
      passwordButton,
      hwEncryption,
      antivirus,
      antivirusEngine: antivirus ? antivirusEngine : null,
      adminSoftware,
      fileEncryptSoftware,
      writeProtect,
      retryLimit: passwordLock && retry ? Number(retry[1]) : null
    },
    longLife: /pSLC|LONG\s*LIFE/i.test(all),
    antibacterial: /SIAA/.test(all) || /抗菌/.test(fullName),
    warrantyYears: warrantyYears ? Number(warrantyYears) : null,
    weightG,
    dimensions: dimText || null,
    operatingTemp: tempText || null,
    features,
    imageUrl: extractImage(indexHtml, slug)
  };
}

// ラインナップ（カードの左上に出す種類）
function detectLineup({ folder, listedIn, heading, fullName, passwordLock, antivirus }) {
  if (folder === "security" || passwordLock || antivirus || /セキュリティ/.test(fullName)) return "security";
  if (/法人/.test(heading) || /法人/.test(fullName)) return "biz";
  if (/抗菌/.test(heading) || /抗菌/.test(fullName)) return "antibac";
  if (/ハイスピード|高速/.test(heading)) return "speed";
  if (/デザイン/.test(heading)) return "design";
  return "standard";
}

function extractImage(html, slug) {
  const og = extractMeta(html, "property", "og:image");
  if (og) return absUrl(og, BASE + "/");
  const body = html.replace(/<head[\s\S]*?<\/head>/i, "");
  const l = body.match(/<img[^>]+src=["']([^"']+_l\.(?:jpg|jpeg|png|webp))["']/i);
  if (l) return absUrl(l[1], BASE + "/");
  return `${BASE}/image/${slug}_l.jpg`;
}

// 「USB 3.2 Gen 1（USB 3.0）対応 USBメモリーU3-PSHシリーズ」→「U3-PSHシリーズ」
function cleanSeriesName(title, slug) {
  const t = title.split(/[|｜]/)[0].replace(/\s*-\s*I-O DATA.*$/i, "").trim();
  const m = t.match(/([A-Z][A-Z0-9]*-[A-Z0-9\/-]+シリーズ)/);
  if (m) return m[1];
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
  const { variants: vOv, security: sOv, os: oOv, ...rest } = ov;
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith("_")) continue; // _memo などのメモ欄
    product[k] = v;
  }
  if (sOv) Object.entries(sOv).forEach(([k, v]) => { if (!k.startsWith("_")) product.security[k] = v; });
  if (oOv) Object.entries(oOv).forEach(([k, v]) => { if (!k.startsWith("_")) product.os[k] = v; });
  if (vOv) {
    for (const v of product.variants) {
      if (vOv[v.sku]) Object.assign(v, vOv[v.sku]);
    }
    product.variants = product.variants.filter((v) => !v.exclude);
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
      console.log("  -> 容量付きの価格表が無いため対象外");
      continue;
    }
    const fields = deriveFields({ ...s, indexHtml, specHtml });
    // 型番で年数が決まらない型番は、シリーズの保証年数を入れる
    variants.forEach((v) => { if (v.warrantyYears == null) v.warrantyYears = fields.warrantyYears; });
    const specColor = findSpec(extractSpecMap(specHtml), [/^カラー$/, /本体色/]);
    if (specColor && !/[、,／\/]/.test(specColor)) variants.forEach((v) => { if (!v.color) v.color = specColor; });
    products.push({ ...fields, variants, lastCheckedAt: new Date().toISOString(), _slug: s.slug });
  }

  const finalList = [];
  for (const p of products) {
    const slug = p._slug;
    delete p._slug;
    fillColorsFromSku(p.variants, (overrides[slug] || {}).colorCodes);
    const product = applyOverride(p, overrides[slug]);
    delete product.colorCodes;
    if (product.exclude) { console.log(`  -> ${slug}: overrides.jsonで除外指定`); continue; }
    delete product.exclude;
    if (product.variants.length) finalList.push(product);
  }

  finalList.sort((a, b) => a.id.localeCompare(b.id));
  await fs.writeFile(OUTPUT_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), products: finalList }, null, 2) + "\n");
  console.log("完了:", finalList.length, "シリーズ /", finalList.reduce((n, p) => n + p.variants.length, 0), "型番");
}

main().catch((e) => { console.error(e); process.exit(1); });
