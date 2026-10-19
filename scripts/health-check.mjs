// スクレイピング結果の健全性チェック（外付けHDD／SSDセレクター用）。
// NAS/DASセレクターと同じ考え方に加えて、「件数は同じでも中身が抜けている」
// （公式ページの作りが変わって価格や画像が読めなくなった）ケースも検知する。
//
// 問題が無ければ終了コード0、問題があれば終了コード1。

import fs from "node:fs";

const OLD_PATH = "data/products.previous.json";
const NEW_PATH = "data/products.json";
const DROP_THRESHOLD = 0.15; // シリーズ数・型番数が15%以上減ったら異常

function load(path) {
  if (!fs.existsSync(path)) return null;
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch { return null; }
}
const count = (d) => d && Array.isArray(d.products)
  ? { series: d.products.length, skus: d.products.reduce((n, p) => n + (p.variants || []).length, 0) }
  : null;

const oldD = load(OLD_PATH);
const newD = load(NEW_PATH);
const oldC = count(oldD);
const newC = count(newD);
console.log("前回:", oldC ? `${oldC.series}シリーズ / ${oldC.skus}型番` : "不明（初回実行など）");
console.log("今回:", newC ? `${newC.series}シリーズ / ${newC.skus}型番` : "読み込み失敗");

const problems = [];
if (!newC || newC.series === 0) problems.push("新しいデータが空か、読み込めませんでした。");

if (newC && oldC && oldC.series > 0) {
  for (const k of ["series", "skus"]) {
    const drop = (oldC[k] - newC[k]) / oldC[k];
    if (drop > DROP_THRESHOLD) problems.push(`${k === "series" ? "シリーズ数" : "型番数"}が前回より${Math.round(drop * 100)}%減っています（${oldC[k]} → ${newC[k]}）。`);
  }
}

if (newC && newC.series > 0) {
  const ps = newD.products;
  const vs = ps.flatMap((p) => p.variants);
  const ratio = (n, d) => (d ? n / d : 0);
  const noPrice = ratio(vs.filter((v) => v.priceIncTax == null).length, vs.length);
  const noImage = ratio(ps.filter((p) => !p.imageUrl).length, ps.length);
  const noJan = ratio(vs.filter((v) => !v.jan).length, vs.length);
  console.log(`価格なし ${Math.round(noPrice * 100)}% / 画像なし ${Math.round(noImage * 100)}% / JANなし ${Math.round(noJan * 100)}%`);
  // オープン価格・受注生産品で価格が無いものは一定数あるので、閾値は高め
  if (noPrice > 0.4) problems.push(`価格が読み取れない型番が${Math.round(noPrice * 100)}%あります（価格表の作りが変わった可能性）。`);
  if (noImage > 0.3) problems.push(`画像が読み取れないシリーズが${Math.round(noImage * 100)}%あります。`);
  if (noJan > 0.5) problems.push(`JANコードが読み取れない型番が${Math.round(noJan * 100)}%あります。`);
}

if (problems.length) {
  problems.forEach((p) => console.error("異常あり: " + p));
  process.exit(1);
}
console.log("健全性チェック: 問題ありませんでした。");
