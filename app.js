(() => {
  "use strict";

  // ===== 設定 =====
  const SITE_PASSWORD = "usbmem2026";
  const STORAGE_KEY = "usbmem-selector-auth";
  // ページ右上の「HDD／SSDセレクターへ」のリンク先
  const HDD_SSD_SELECTOR_URL = "https://ioplaza02.github.io/hdd-ssd-selector/";
  const DATA_URL = "data/products.json";
  const STALE_DAYS = 40;

  // ===== パスワード =====
  const gate = document.getElementById("password-gate");
  const appRoot = document.getElementById("app-root");
  const pwForm = document.getElementById("password-form");
  const pwInput = document.getElementById("password-input");
  const pwError = document.getElementById("password-error");

  function unlock() {
    gate.hidden = true;
    appRoot.hidden = false;
    initApp();
  }
  let authed = false;
  try { authed = localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* ストレージ不可の環境 */ }
  if (authed) unlock(); else pwInput.focus();

  pwForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (pwInput.value === SITE_PASSWORD) {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* 無視 */ }
      pwError.hidden = true;
      unlock();
    } else {
      pwError.hidden = false;
    }
  });
  document.getElementById("password-toggle").addEventListener("click", () => {
    pwInput.type = pwInput.type === "password" ? "text" : "password";
  });

  // ===== 本体 =====
  function initApp() {
    const $ = (s, root = document) => root.querySelector(s);
    const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

    // ---------- 絞り込みの定義 ----------
    const CAP_OPTIONS = [4, 8, 16, 32, 64, 128, 256].map((gb) => ({ v: String(gb), label: gb + "GB", test: (x) => x === gb }));
    const PRICE_OPTIONS = [
      { v: "3", label: "〜3,000円", test: (p) => p <= 3000 },
      { v: "5", label: "3,000〜5,000円", test: (p) => p > 3000 && p <= 5000 },
      { v: "10", label: "5,000〜1万円", test: (p) => p > 5000 && p <= 10000 },
      { v: "20", label: "1〜2万円", test: (p) => p > 10000 && p <= 20000 },
      { v: "30", label: "2〜3万円", test: (p) => p > 20000 && p <= 30000 },
      { v: "x", label: "3万円〜", test: (p) => p > 30000 }
    ];
    const sec = (p) => p.security || {};
    const os = (p) => p.os || {};
    // mode "and"：チェックした条件を全部満たす / mode "or"：どれか1つに当てはまる
    // variant: true の条件は型番（容量・保証年数）単位で判定する
    const CHECK_GROUPS = {
      device: { mode: "and", options: [
        { v: "win", label: "Windowsパソコン", test: (p) => os(p).windows },
        { v: "mac", label: "Mac", test: (p) => os(p).mac },
        { v: "chrome", label: "Chromebook", test: (p) => os(p).chromeos },
        { v: "ios", label: "iPhone・iPad", sub: "USB-C端子のモデル（iPhone 15以降など）", test: (p) => os(p).ios },
        { v: "android", label: "Androidスマホ・タブレット", sub: "変換ケーブル（別売）が必要な商品も含む", test: (p) => os(p).android || p.androidViaAdapter }
      ] },
      secure: { mode: "and", options: [
        { v: "pw", label: "パスワードロック", sub: "パスワードを入れるまでデータを読めない", test: (p) => sec(p).passwordLock },
        { v: "btn", label: "パスワードボタン付き", sub: "本体のボタンで入力。パソコンにソフト不要", test: (p) => sec(p).passwordButton },
        { v: "hw", label: "ハードウェア自動暗号化", sub: "書き込んだデータを本体が自動で暗号化（AES256bit）", test: (p) => sec(p).hwEncryption },
        { v: "av", label: "ウイルス対策（アンチウイルス）", sub: "書き込むデータを自動でウイルスチェック", test: (p) => sec(p).antivirus },
        { v: "admin", label: "管理者ソフトで一元管理", sub: "SUHManager（別売）で会社のUSBメモリーをまとめて管理", test: (p) => sec(p).adminSoftware },
        { v: "file", label: "ファイル暗号化ソフト対応", sub: "無料ソフトで大事なファイルだけ暗号化", test: (p) => sec(p).fileEncryptSoftware }
      ] },
      extra: { mode: "and", options: [
        { v: "strap", label: "ストラップホールあり", sub: "ストラップを付けて紛失防止", test: (p) => p.strapHole },
        { v: "clip", label: "クリップ付き", sub: "手帳やポケットに挟める", test: (p) => p.clip },
        { v: "lamp", label: "アクセスランプあり", sub: "読み書き中が光で分かる", test: (p) => p.accessLamp === true },
        { v: "long", label: "書き換えに強い（長寿命）", sub: "業務機器のログ保存など、書き換えが多い用途に", test: (p) => p.longLife },
        { v: "antibac", label: "抗菌・抗ウイルス", sub: "SIAA認証。共用のパソコンで使うときに", test: (p) => p.antibacterial },
        { v: "wp", label: "書き込み禁止設定", sub: "うっかり上書き・削除を防ぐ", test: (p) => sec(p).writeProtect },
        { v: "server", label: "Windows Server対応", sub: "サーバーでも使える（法人向け）", test: (p) => os(p).winServer }
      ] },
      warranty: { mode: "or", single: true, chips: true, variant: true, options: [
        { v: "3", label: "3年以上", test: (v) => (v.warrantyYears || 0) >= 3 },
        { v: "5", label: "5年", test: (v) => (v.warrantyYears || 0) >= 5 }
      ] }
    };
    const SEG_GROUPS = {
      style: { test: (p, v) => p.bodyStyle === v },
      conn: { test: (p, v) => (p.hostConnectors || []).includes(v) }
    };

    const state = {
      cap: new Set(), style: new Set(), conn: new Set(), device: new Set(), secure: new Set(),
      extra: new Set(), price: new Set(), warranty: new Set(),
      q: "", sort: "recommend", eol: false,
      selected: {},        // シリーズID → 選択中の型番
      compare: []          // 比較中の型番（順番を保持）
    };
    const FILTER_KEYS = ["cap", "style", "conn", "device", "secure", "extra", "price", "warranty"];

    let products = [];
    const skuIndex = new Map(); // 型番 → { product, variant }

    // ---------- 判定 ----------
    const isEol = (v) => v.status === "生産終了";
    const norm = (s) => String(s || "").toUpperCase().replace(/[\s\-‐－ー_/]/g, "");

    function variantPasses(v, st) {
      if (!st.eol && isEol(v)) return false;
      if (st.cap.size && !CAP_OPTIONS.some((o) => st.cap.has(o.v) && o.test(v.capacityGB))) return false;
      if (st.price.size) {
        if (v.priceIncTax == null) return false;
        if (!PRICE_OPTIONS.some((o) => st.price.has(o.v) && o.test(v.priceIncTax))) return false;
      }
      for (const [k, g] of Object.entries(CHECK_GROUPS)) {
        if (!g.variant || !st[k].size) continue;
        const opts = g.options.filter((o) => st[k].has(o.v));
        if (g.mode === "and" ? !opts.every((o) => o.test(v)) : !opts.some((o) => o.test(v))) return false;
      }
      return true;
    }

    function seriesPasses(p, st) {
      for (const [k, g] of Object.entries(SEG_GROUPS)) {
        if (st[k].size && ![...st[k]].some((v) => g.test(p, v))) return false;
      }
      for (const [k, g] of Object.entries(CHECK_GROUPS)) {
        if (g.variant || !st[k].size) continue;
        const opts = g.options.filter((o) => st[k].has(o.v));
        if (g.mode === "and" ? !opts.every((o) => o.test(p)) : !opts.some((o) => o.test(p))) return false;
      }
      if (st.q) {
        const q = norm(st.q);
        const hay = [p.id, p.seriesName, ...p.variants.flatMap((v) => [v.sku, v.jan])].map(norm).join("|");
        if (!hay.includes(q)) return false;
      }
      return true;
    }

    function matches(st) {
      const out = [];
      for (const p of products) {
        if (!seriesPasses(p, st)) continue;
        const vs = p.variants.filter((v) => variantPasses(v, st));
        if (vs.length) out.push({ p, vs });
      }
      return out;
    }

    // 「この条件を足したら何件になるか」を数える（0件の選択肢は押せなくする）
    function countWith(group, value) {
      const st = cloneState();
      const multiOr = group in SEG_GROUPS || group === "cap" || group === "price" || (CHECK_GROUPS[group] && CHECK_GROUPS[group].mode === "or");
      if (multiOr) st[group] = new Set([value]); else st[group].add(value);
      return matches(st).length;
    }
    function cloneState() {
      const st = { ...state };
      FILTER_KEYS.forEach((k) => { st[k] = new Set(state[k]); });
      return st;
    }

    // ---------- 表示用 ----------
    const yen = (n) => n == null ? "" : "￥" + n.toLocaleString("ja-JP");
    const capLabel = (gb) => gb >= 1000 ? (gb / 1000) + "TB" : gb + "GB";
    const displayName = (p) => p.seriesName || p.id.toUpperCase();
    const STYLE_LABEL = { cap: "キャップ式", slide: "スライド式", knock: "ノック式" };
    const LINEUP_LABEL = { standard: "スタンダード", design: "デザイン", speed: "ハイスピード", antibac: "抗菌", biz: "法人向け", security: "セキュリティ" };
    const LINEUP_ORDER = { standard: 0, design: 1, speed: 2, antibac: 3, biz: 4, security: 5 };
    const STATUS_LABEL = { "在庫限り": "店頭在庫限り", "受注生産": "受注生産", "生産終了": "生産終了", "受注停止": "一時受注停止" };

    function fixText(s) {
      return String(s ?? "").replace(/&times;/g, "×").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&reg;/g, "®").replace(/&trade;/g, "™");
    }
    function escapeHtml(s) {
      return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }
    const plugName = (c) => c === "A" ? "USB-A" : c === "C" ? "USB-C" : c;
    // 差し込み口の形のイラスト（HDD／SSDセレクターと共通）
    function plugIcon(c, size = 1) {
      const w = Math.round(30 * size), h = Math.round(14 * size);
      if (c === "A") return `<svg class="plug-ico" width="${w}" height="${h}" viewBox="0 0 30 14" aria-hidden="true"><rect x="1" y="1" width="28" height="12" rx="1.2" fill="#fff" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="3.4" width="22" height="4.2" rx=".5" fill="currentColor"/><g fill="#fff"><rect x="7" y="4.6" width="2.6" height="1.8"/><rect x="11.8" y="4.6" width="2.6" height="1.8"/><rect x="16.6" y="4.6" width="2.6" height="1.8"/><rect x="21.4" y="4.6" width="2.6" height="1.8"/></g></svg>`;
      if (c === "C") return `<svg class="plug-ico" width="${w}" height="${h}" viewBox="0 0 30 14" aria-hidden="true"><rect x="2" y="1.5" width="26" height="11" rx="5.5" fill="#fff" stroke="currentColor" stroke-width="1.6"/><rect x="7" y="5.6" width="16" height="2.8" rx="1.4" fill="currentColor"/></svg>`;
      return "";
    }
    // 本体の形のイラスト（キャップ式・スライド式・ノック式）
    function styleIcon(s) {
      const body = `<rect x="11" y="3" width="20" height="12" rx="3" fill="#fff" stroke="currentColor" stroke-width="1.6"/>`;
      if (s === "cap") return `<svg class="style-svg" width="40" height="18" viewBox="0 0 40 18" aria-hidden="true">${body}<rect x="4" y="5.5" width="7" height="7" fill="currentColor" opacity=".35"/><rect x="1" y="4" width="8" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 1.6"/></svg>`;
      if (s === "slide") return `<svg class="style-svg" width="40" height="18" viewBox="0 0 40 18" aria-hidden="true">${body}<rect x="4" y="5.5" width="7" height="7" fill="currentColor" opacity=".35"/><rect x="17" y="1" width="6" height="3.4" rx="1" fill="currentColor"/><path d="M15 9h10M22 7l3 2-3 2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
      if (s === "knock") return `<svg class="style-svg" width="40" height="18" viewBox="0 0 40 18" aria-hidden="true">${body}<rect x="4" y="5.5" width="7" height="7" fill="currentColor" opacity=".35"/><rect x="31" y="6" width="5" height="6" rx="1.5" fill="currentColor"/><path d="M39 9h-2" stroke="currentColor" stroke-width="1.6"/></svg>`;
      return "";
    }
    // 規格名から速度だけ取り出す（「USB 3.2 Gen 1（USB 3.0）／2.0」→「USB 5Gbps」）
    function speedOnly(t) {
      const s = fixText(t || "").split(/[／\/]/)[0];
      const m = s.match(/USB\s*(\d+)\s*Gbps/i);
      if (m) return `USB ${m[1]}Gbps`;
      if (/Gen\s*2/i.test(s) || /USB\s*3\.1/i.test(s)) return "USB 10Gbps";
      if (/Gen\s*1/i.test(s) || /USB\s*3\.0/i.test(s)) return "USB 5Gbps";
      return /USB\s*2\.0/i.test(s) ? "USB 2.0" : "";
    }
    function connLine(p) {
      const sp = speedOnly(p.interface);
      return (p.hostConnectors || []).map((c) => `<span class="conn-line">${plugIcon(c, .75)}<b>${plugName(c)} 直挿し</b>${sp ? `：${sp}` : ""}</span>`).join("");
    }
    const connText = (p) => (p.hostConnectors || []).map(plugName).join("／") || "—";
    function unitPrice(v) {
      if (v.priceIncTax == null || !v.capacityGB) return null;
      return Math.round(v.priceIncTax / v.capacityGB);
    }
    const weightText = (p) => p.weightG ? `約${p.weightG}g` : "";

    // 使える機器のタグ
    function deviceBadges(p) {
      const o = os(p), out = [];
      if (o.windows) out.push({ t: "💻 Windows PC", cls: "badge--pc" });
      if (o.mac) out.push({ t: "Mac", cls: "badge--pc" });
      if (o.chromeos) out.push({ t: "Chromebook", cls: "badge--pc" });
      if (o.ios) out.push({ t: "📱 iPhone・iPad", cls: "badge--on" });
      if (o.android) out.push({ t: "📱 Android", cls: "badge--on" });
      else if (p.androidViaAdapter) out.push({ t: "📱 Android（変換ケーブル別売）", cls: "badge--on" });
      return out;
    }
    function securityBadges(p) {
      const s = sec(p), out = [];
      if (s.passwordButton) out.push("パスワードボタン");
      else if (s.passwordLock) out.push("パスワードロック");
      if (s.hwEncryption) out.push("ハードウェア暗号化");
      if (s.antivirus) out.push(`ウイルス対策${s.antivirusEngine ? `（${s.antivirusEngine}）` : ""}`);
      if (s.adminSoftware) out.push("管理者ソフト対応");
      if (s.writeProtect) out.push("書き込み禁止設定");
      if (s.fileEncryptSoftware && !s.passwordLock) out.push("ファイル暗号化ソフト");
      return out;
    }
    function extraBadges(p) {
      const out = [];
      if (p.strapHole) out.push("ストラップホール");
      if (p.clip) out.push("クリップ付き");
      if (p.longLife) out.push("書き換えに強い");
      if (p.antibacterial) out.push("抗菌・抗ウイルス");
      if (p.readMBps) out.push(`読込 最大約${p.readMBps}MB/s`);
      return out;
    }

    // 注意書き（カードと比較表で共通）
    // パソコン専用：パスワードの入力にパソコンのソフトが必要なタイプ（ボタン入力タイプは除く）
    function isPcOnly(p) {
      if (typeof p.pcOnly === "boolean") return p.pcOnly;
      return !!(sec(p).passwordLock && !sec(p).passwordButton);
    }
    function pcOnlyText(p) {
      if (p.pcOnlyText) return p.pcOnlyText;
      const o = os(p);
      const pcs = ["Windowsパソコン", o.mac ? "Mac" : ""].filter(Boolean).join("・");
      return `パスワードの入力にパソコンのソフトを使うため、${pcs}${o.mac ? "" : "（Macは非対応）"}でのみ使えます。スマホ・タブレットやテレビでは使えません。`;
    }
    function infoNotes(p) {
      const out = [];
      const s = sec(p);
      if (s.passwordButton) out.push("パスワードは本体のボタンで入力するため、パソコンにソフトを入れる必要がありません。抜くと自動でロックされます。");
      if (s.antivirus) out.push("初めて使うときと、ウイルス定義ファイルの更新時にインターネット接続が必要です。ウイルス対策のライセンス期間は保証期間（型番の年数）と同じです。");
      if (os(p).ios) out.push("iPhone・iPadは、USB-C端子を搭載したモデルで使えます。");
      if (p.androidViaAdapter) out.push("Androidスマホ・タブレットで使うには、USB-C変換ケーブル（USB-OTG10・別売）が必要です。");
      if (sec(p).passwordLock && !s.passwordButton && os(p).mac) out.push("パスワードを忘れたときの初期化には、Windowsパソコンが必要です。");
      return out;
    }

    // 同じ容量の型番が複数あるとき、ボタンに「保証3年」や色名を添える
    function variantSubLabel(x, siblings) {
      const same = siblings.filter((y) => y.capacityGB === x.capacityGB);
      if (same.length < 2) return "";
      const years = new Set(same.map((y) => y.warrantyYears));
      if (years.size > 1) return `保証${x.warrantyYears}年`;
      return x.color || variantSuffix(x.sku);
    }
    function variantSuffix(sku) {
      const m = String(sku).match(/\/([A-Z]+)$/);
      return m ? m[1] : sku;
    }

    // ---------- フィルターUIを組み立てる ----------
    // 左の絞り込みメニューは、ほかのセレクターと同じ「じゃばら」（開閉できる見出し）にする。
    // よく使う項目は最初から開いておき、それ以外は閉じておく。
    const OPEN_BY_DEFAULT = ["cap", "style", "conn", "device", "secure"];
    function buildAccordion() {
      $$("#filter-panel .fgroup").forEach((g) => {
        const key = (g.querySelector("[data-filter]") || {}).dataset?.filter || "";
        const title = g.querySelector(".fgroup__title");
        const d = document.createElement("details");
        d.className = "fgroup";
        d.dataset.key = key;
        const sm = document.createElement("summary");
        sm.className = "fgroup__title";
        sm.innerHTML = `<span class="fgroup__name">${title.innerHTML}</span><span class="fgroup__sel"></span>`;
        title.remove();
        d.appendChild(sm);
        while (g.firstChild) d.appendChild(g.firstChild);
        d.open = OPEN_BY_DEFAULT.includes(key);
        g.replaceWith(d);
      });
    }
    // 選択中の数を見出しに出す（閉じていても、何か選んでいることが分かるように）
    function syncAccordion(openSelected) {
      $$("#filter-panel details.fgroup").forEach((d) => {
        const n = state[d.dataset.key] ? state[d.dataset.key].size : 0;
        d.querySelector(".fgroup__sel").textContent = n ? `${n}件選択中` : "";
        if (openSelected && n) d.open = true;
      });
    }

    function buildFilters() {
      buildAccordion();
      $('[data-filter="cap"]').innerHTML = CAP_OPTIONS.map((o) => `<button type="button" data-value="${o.v}" aria-pressed="false">${o.label}<span class="cnt"></span></button>`).join("");
      $('[data-filter="price"]').innerHTML = PRICE_OPTIONS.map((o) => `<button type="button" data-value="${o.v}" aria-pressed="false">${o.label}<span class="cnt"></span></button>`).join("");
      for (const [k, g] of Object.entries(CHECK_GROUPS)) {
        if (g.chips) {
          $(`[data-filter="${k}"]`).innerHTML = g.options.map((o) => `<button type="button" data-value="${o.v}" aria-pressed="false">${o.label}<span class="cnt"></span></button>`).join("");
          continue;
        }
        $(`[data-filter="${k}"]`).innerHTML = g.options.map((o) => `
          <label class="check">
            <input type="checkbox" data-group="${k}" value="${o.v}">
            <span class="check__label">${o.label}<span class="cnt"></span>${o.sub ? `<small>${o.sub}</small>` : ""}</span>
          </label>`).join("");
      }
      $$("[data-filter] button[data-value]").forEach((btn) => {
        const group = btn.closest("[data-filter]").dataset.filter;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", () => {
          const g = CHECK_GROUPS[group];
          if (g && g.single && !state[group].has(btn.dataset.value)) state[group].clear();
          toggle(state[group], btn.dataset.value);
          onChange();
        });
      });
      $$('input[type="checkbox"][data-group]').forEach((cb) => {
        cb.addEventListener("change", () => {
          if (cb.checked) state[cb.dataset.group].add(cb.value); else state[cb.dataset.group].delete(cb.value);
          onChange();
        });
      });

      // 端子・形のボタンにイラストを入れる
      $$('[data-filter="conn"] .conn-ico').forEach((el) => {
        el.outerHTML = `<span class="conn-ico-svg">${plugIcon(el.classList.contains("conn-ico--a") ? "A" : "C", 1.4)}</span>`;
      });
      $$('[data-filter="style"] .style-ico').forEach((el) => { el.outerHTML = `<span class="style-ico-svg">${styleIcon(el.dataset.style)}</span>`; });

      // スマホ表示では絞り込みを折りたためるようにする
      const panel = $("#filter-panel");
      const tg = document.createElement("button");
      tg.type = "button";
      tg.className = "filter-toggle";
      tg.textContent = "絞り込み条件をひらく";
      panel.querySelector(".filter-panel__head").after(tg);
      if (window.matchMedia("(max-width: 900px)").matches) panel.classList.add("is-collapsed");
      tg.addEventListener("click", () => {
        panel.classList.toggle("is-collapsed");
        tg.textContent = panel.classList.contains("is-collapsed") ? "絞り込み条件をひらく" : "絞り込み条件をとじる";
      });
    }
    function toggle(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

    function syncFilterUi() {
      $$("[data-filter] button[data-value]").forEach((btn) => {
        const group = btn.closest("[data-filter]").dataset.filter;
        const on = state[group].has(btn.dataset.value);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        const cntEl = btn.querySelector(".cnt");
        const n = on ? null : countWith(group, btn.dataset.value);
        if (cntEl) cntEl.textContent = n == null ? "" : `(${n})`;
        btn.disabled = !on && n === 0;
      });
      $$('input[type="checkbox"][data-group]').forEach((cb) => {
        const on = state[cb.dataset.group].has(cb.value);
        cb.checked = on;
        const n = on ? null : countWith(cb.dataset.group, cb.value);
        const lab = cb.closest(".check");
        lab.querySelector(".cnt").textContent = n == null ? "" : ` (${n})`;
        lab.classList.toggle("is-zero", n === 0);
      });
      syncAccordion(false);
      $("#keyword-input").value = state.q;
      $("#sort-select").value = state.sort;
      $("#include-eol").checked = state.eol;
    }

    function activeConditions() {
      const list = [];
      const add = (group, v, label) => list.push({ group, v, label });
      CAP_OPTIONS.forEach((o) => state.cap.has(o.v) && add("cap", o.v, o.label));
      state.style.forEach((v) => add("style", v, STYLE_LABEL[v]));
      state.conn.forEach((v) => add("conn", v, plugName(v)));
      for (const [k, g] of Object.entries(CHECK_GROUPS)) g.options.forEach((o) => state[k].has(o.v) && add(k, o.v, k === "warranty" ? `保証${o.label}` : o.label));
      PRICE_OPTIONS.forEach((o) => state.price.has(o.v) && add("price", o.v, o.label));
      if (state.q) list.push({ group: "q", v: state.q, label: `「${state.q}」` });
      return list;
    }

    // ---------- 結果を描画 ----------
    const cardsEl = $("#cards");
    const minPrice = (x) => Math.min(...x.vs.map((v) => v.priceIncTax ?? Infinity));
    // 在庫限り・生産終了だけのシリーズは「おすすめ順」で後ろに回す
    const allLimited = (x) => x.vs.every((v) => v.status === "在庫限り" || v.status === "生産終了" || v.status === "受注停止") ? 1 : 0;

    function sortList(list) {
      const sel = (x) => x.vs.find((v) => v.sku === state.selected[x.p.id]) || x.vs[0];
      const cmp = {
        "recommend": (a, b) => (allLimited(a) - allLimited(b)) || ((LINEUP_ORDER[a.p.lineup] ?? 9) - (LINEUP_ORDER[b.p.lineup] ?? 9)) || (minPrice(a) - minPrice(b)),
        "price-asc": (a, b) => (sel(a).priceIncTax ?? Infinity) - (sel(b).priceIncTax ?? Infinity),
        "price-desc": (a, b) => (sel(b).priceIncTax ?? -1) - (sel(a).priceIncTax ?? -1),
        "cap-desc": (a, b) => Math.max(...b.vs.map((v) => v.capacityGB)) - Math.max(...a.vs.map((v) => v.capacityGB)),
        "unit-price": (a, b) => (unitPrice(sel(a)) ?? Infinity) - (unitPrice(sel(b)) ?? Infinity)
      }[state.sort];
      return list.sort(cmp);
    }

    function render() {
      const list = sortList(matches(state));
      $("#result-count").innerHTML = `該当 <b>${list.length}</b> シリーズ <span style="font-weight:600">（全${products.length}シリーズ中）</span>`;

      const conds = activeConditions();
      const bindChips = (sel) => $$(`${sel} .active-chip`).forEach((b) => b.addEventListener("click", () => {
        const c = conds[Number(b.dataset.i)];
        if (c.group === "q") state.q = ""; else state[c.group].delete(c.v);
        onChange();
      }));
      $("#active-chips").innerHTML = conds.map((c, i) => `<button type="button" class="active-chip" data-i="${i}">${escapeHtml(c.label)}</button>`).join("");
      bindChips("#active-chips");

      $("#no-result").hidden = list.length > 0;
      if (!list.length) {
        $("#no-result-chips").innerHTML = conds.map((c, i) => `<button type="button" class="active-chip" data-i="${i}">${escapeHtml(c.label)} を外す</button>`).join("");
        bindChips("#no-result-chips");
      }

      cardsEl.innerHTML = list.map(({ p, vs }) => cardHtml(p, vs)).join("");
      bindCards();
      renderCompareBar();
    }

    function cardHtml(p, vs) {
      const okSkus = new Set(vs.map((v) => v.sku));
      const v = p.variants.find((x) => x.sku === state.selected[p.id] && okSkus.has(x.sku)) || vs[0];
      state.selected[p.id] = v.sku;
      const visible = p.variants.filter((x) => state.eol || !isEol(x) || x.sku === v.sku);

      const kinds = [
        `<span class="kind kind--${p.lineup || "standard"}">${LINEUP_LABEL[p.lineup] || "スタンダード"}</span>`,
        p.bodyStyle ? `<span class="kind kind--style">${STYLE_LABEL[p.bodyStyle]}</span>` : ""
      ].join("");

      const badges = [];
      deviceBadges(p).forEach((b) => badges.push(`<span class="badge ${b.cls}">${b.t}</span>`));
      (p.hostConnectors || []).forEach((c) => badges.push(`<span class="badge badge--conn">${plugIcon(c, .8)}${plugName(c)}</span>`));
      securityBadges(p).forEach((t) => badges.push(`<span class="badge badge--sec">🔒 ${t}</span>`));
      extraBadges(p).forEach((t) => badges.push(`<span class="badge">${t}</span>`));

      const up = unitPrice(v);
      const status = STATUS_LABEL[v.status] ? `<span class="status status--${v.status}">${STATUS_LABEL[v.status]}</span>` : "";
      const inCompare = state.compare.includes(v.sku);

      return `
      <article class="card${inCompare ? " is-selected" : ""}" data-id="${p.id}">
        <div class="card__top">
          <div class="card__img">${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(displayName(p))}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'card__img-ph',textContent:'USB'}))">` : `<span class="card__img-ph">USB</span>`}</div>
          <div class="card__head">
            <div class="card__kind">${kinds}</div>
            <h2 class="card__series">${escapeHtml(displayName(p))}</h2>
            <p class="card__sku">${escapeHtml(v.sku)}${v.color ? `<span class="card__color">　${escapeHtml(v.color)}</span>` : ""}</p>
            ${status}
          </div>
        </div>
        <div class="card__caps" role="group" aria-label="容量を選ぶ">
          ${visible.map((x) => {
            const sub = variantSubLabel(x, visible);
            return `<button type="button" class="cap-btn${okSkus.has(x.sku) ? "" : " is-out"}" data-sku="${escapeHtml(x.sku)}" aria-pressed="${x.sku === v.sku}" title="${escapeHtml(x.sku)}${okSkus.has(x.sku) ? "" : "（今の条件には合いません）"}">${capLabel(x.capacityGB)}${sub ? `<span class="cap-color">${escapeHtml(sub)}</span>` : ""}</button>`;
          }).join("")}
        </div>
        <div class="card__price">
          ${v.priceIncTax != null
            ? `<span class="price-inc">${yen(v.priceIncTax)}<small>（税込）</small></span>${v.priceExTax != null ? `<span class="price-ex">税抜 ${yen(v.priceExTax)}</span>` : ""}${up ? `<span class="unit-price">1GBあたり 約${yen(up)}</span>` : ""}`
            : `<span class="price-open">オープン価格</span>`}
        </div>
        <div class="badges">${badges.join("")}</div>
        <dl class="spec-mini">
          <dt>JAN</dt><dd>${v.jan ? `${escapeHtml(v.jan)}<button type="button" class="copy-jan" data-copy="${escapeHtml(v.jan)}">コピー</button>` : "—"}</dd>
          <dt>接続</dt><dd>${connLine(p) || "—"}</dd>
          <dt>形</dt><dd>${STYLE_LABEL[p.bodyStyle] || "—"}${p.strapHole ? "・ストラップホールあり" : ""}${p.clip ? "・クリップ付き" : ""}</dd>
          <dt>保証</dt><dd>${v.warrantyYears ? v.warrantyYears + "年" : "—"}${sec(p).antivirus ? "（ウイルス対策ライセンスも同じ期間）" : ""}</dd>
          <dt>大きさ</dt><dd>${escapeHtml(shortDim(p.dimensions))}${weightText(p) ? `・${weightText(p)}` : ""}</dd>
        </dl>
        ${isPcOnly(p) ? `<div class="alert alert--pc"><span class="alert__icon" aria-hidden="true">💻</span><span><b>パソコン専用</b>${escapeHtml(pcOnlyText(p))}</span></div>` : ""}
        ${infoNotes(p).map((t) => `<p class="note-info"><span aria-hidden="true">ⓘ</span>${escapeHtml(t)}</p>`).join("")}
        <div class="card__foot">
          <a class="card__link" href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">商品ページ ↗</a>
          <label class="compare-check"><input type="checkbox" data-compare="${escapeHtml(v.sku)}"${inCompare ? " checked" : ""}> 比較に追加</label>
        </div>
      </article>`;
    }
    // 「約18（W）×70（D）×8.2（H）mm ※…」→「約18×70×8.2mm」
    function shortDim(d) {
      if (!d) return "—";
      const m = fixText(d).match(/約?\s*([\d.]+)\s*[（(]W[)）]\s*[x×]\s*([\d.]+)\s*[（(]D[)）]\s*[x×]\s*([\d.]+)\s*[（(]H[)）]/i);
      return m ? `約${m[1]}×${m[2]}×${m[3]}mm` : fixText(d).split(/[※（(]/)[0].trim();
    }

    function bindCards() {
      $$(".cap-btn", cardsEl).forEach((b) => b.addEventListener("click", () => {
        const card = b.closest(".card");
        const id = card.dataset.id;
        const prev = state.selected[id];
        state.selected[id] = b.dataset.sku;
        // 比較中の型番の容量を切り替えたら、比較対象も新しい型番に差し替える
        const ci = state.compare.indexOf(prev);
        if (ci >= 0 && !state.compare.includes(b.dataset.sku)) state.compare[ci] = b.dataset.sku;
        if (b.classList.contains("is-out")) {
          // 条件外の容量を選んだ場合でもカードは残す（選択した型番を見せる）
          const p = products.find((x) => x.id === id);
          card.outerHTML = cardHtml(p, [p.variants.find((x) => x.sku === b.dataset.sku), ...p.variants.filter((x) => variantPasses(x, state))]);
          bindCards();
          renderCompareBar();
          writeUrl();
          return;
        }
        render();
        writeUrl();
      }));
      $$("input[data-compare]", cardsEl).forEach((cb) => cb.addEventListener("change", () => {
        const sku = cb.dataset.compare;
        if (cb.checked) { if (!state.compare.includes(sku)) state.compare.push(sku); }
        else state.compare = state.compare.filter((s) => s !== sku);
        cb.closest(".card").classList.toggle("is-selected", cb.checked);
        renderCompareBar();
        writeUrl();
      }));
      $$(".copy-jan", cardsEl).forEach((b) => b.addEventListener("click", () => copyText(b.dataset.copy, "JANコードをコピーしました")));
    }

    // ---------- 比較 ----------
    const compareBar = $("#compare-bar");
    function renderCompareBar() {
      state.compare = state.compare.filter((s) => skuIndex.has(s));
      compareBar.hidden = state.compare.length === 0;
      $("#compare-bar-items").innerHTML = state.compare.map((s) => `<span class="cbar-item">${escapeHtml(s)}<button type="button" data-rm="${escapeHtml(s)}" aria-label="${escapeHtml(s)}を外す">×</button></span>`).join("");
      $$("#compare-bar-items [data-rm]").forEach((b) => b.addEventListener("click", () => removeCompare(b.dataset.rm)));
      const btn = $("#compare-btn");
      btn.disabled = state.compare.length === 0;
      btn.textContent = state.compare.length >= 2 ? `詳細を比較する（${state.compare.length}件）` : "詳細を見る";
    }
    function removeCompare(sku) {
      state.compare = state.compare.filter((s) => s !== sku);
      const cb = $(`input[data-compare="${CSS.escape(sku)}"]`, cardsEl);
      if (cb) { cb.checked = false; cb.closest(".card").classList.remove("is-selected"); }
      renderCompareBar();
      if (!$("#compare-modal").hidden) {
        if (state.compare.length) renderCompareTable(); else closeModal();
      }
      writeUrl();
    }
    $("#compare-clear").addEventListener("click", () => {
      state.compare = [];
      render();
      writeUrl();
    });

    const yesNo = (b, yes = "対応", no = "—") => b ? `<span class="yes">${yes}</span>` : `<span class="no">${no}</span>`;
    const small = (t) => t ? `<br><small>${escapeHtml(fixText(t))}</small>` : "";

    function compareRows(items) {
      const row = (label, fn, plainFn) => ({ label, cells: items.map(({ p, v }) => { const html = fn(p, v); return { html, plain: plainFn ? plainFn(p, v) : html.replace(/<[^>]+>/g, "") }; }) });
      const group = (label) => ({ label, group: true });
      return [
        group("価格・容量"),
        row("価格（税込）", (p, v) => v.priceIncTax != null ? `<b>${yen(v.priceIncTax)}</b>` : "オープン価格"),
        row("価格（税抜）", (p, v) => v.priceExTax != null ? yen(v.priceExTax) : "—"),
        row("1GBあたり", (p, v) => unitPrice(v) ? "約" + yen(unitPrice(v)) : "—"),
        row("容量", (p, v) => capLabel(v.capacityGB)),
        row("JANコード", (p, v) => v.jan || "—"),
        row("在庫状況", (p, v) => STATUS_LABEL[v.status] || "販売中"),
        row("カラー", (p, v) => escapeHtml(v.color || "—")),
        group("種類・使う機器"),
        row("種類", (p) => LINEUP_LABEL[p.lineup] || "—"),
        row("本体の形", (p) => STYLE_LABEL[p.bodyStyle] || "—"),
        row("Windowsパソコン", (p) => yesNo(os(p).windows)),
        row("Mac", (p) => yesNo(os(p).mac)),
        row("Chromebook", (p) => yesNo(os(p).chromeos)),
        row("iPhone・iPad", (p) => os(p).ios ? `<span class="yes">対応</span><br><small>USB-C端子のモデル</small>` : isPcOnly(p) ? `<span class="ng">使えません（パソコン専用）</span>` : yesNo(false), (p) => os(p).ios ? "対応" : isPcOnly(p) ? "PC専用" : "—"),
        row("Androidスマホ・タブレット", (p) => os(p).android ? `<span class="yes">対応</span>` : p.androidViaAdapter ? `<span class="yes">変換ケーブル（別売）で対応</span>` : isPcOnly(p) ? `<span class="ng">使えません（パソコン専用）</span>` : yesNo(false), (p) => os(p).android ? "対応" : p.androidViaAdapter ? "変換" : isPcOnly(p) ? "PC専用" : "—"),
        row("Windows Server", (p) => yesNo(os(p).winServer)),
        row("対応OS（公式表記）", (p) => escapeHtml(fixText(p.osText || "—"))),
        group("接続"),
        row("端子", (p) => (p.hostConnectors || []).map((c) => `<span class="ct-plug">${plugIcon(c)}${plugName(c)}</span>`).join(" "), (p) => connText(p)),
        row("インターフェイス", (p) => escapeHtml(fixText(p.interface || "—"))),
        row("読み込み速度", (p) => p.readMBps ? `最大約${p.readMBps}MB/s<br><small>理論値</small>` : "—"),
        group("セキュリティ"),
        row("パスワードロック", (p) => sec(p).passwordButton ? `<span class="yes">対応（本体のボタンで入力）</span>` : sec(p).passwordLock ? `<span class="yes">対応（パソコンのソフトで入力）</span>${small(isPcOnly(p) ? pcOnlyText(p) : "")}` : yesNo(false), (p) => sec(p).passwordButton ? "btn" : sec(p).passwordLock ? "pw" : "—"),
        row("パスワード誤入力の上限", (p) => sec(p).retryLimit ? `連続${sec(p).retryLimit}回<br><small>上限に達すると初期化が必要（データは消去）</small>` : "—", (p) => String(sec(p).retryLimit || "—")),
        row("ハードウェア自動暗号化", (p) => sec(p).hwEncryption ? `<span class="yes">対応</span><br><small>AES256bit</small>` : yesNo(false), (p) => sec(p).hwEncryption ? "対応" : "—"),
        row("ウイルス対策", (p) => sec(p).antivirus ? `<span class="yes">対応</span>${small(sec(p).antivirusEngine ? sec(p).antivirusEngine + "製エンジン" : "")}` : yesNo(false), (p) => sec(p).antivirus ? "対応" : "—"),
        row("管理者ソフト（SUHManager）", (p) => sec(p).adminSoftware ? `<span class="yes">対応</span><br><small>SUHManagerは別売</small>` : yesNo(false), (p) => sec(p).adminSoftware ? "対応" : "—"),
        row("書き込み禁止設定", (p) => yesNo(sec(p).writeProtect)),
        row("ファイル暗号化ソフト", (p) => sec(p).fileEncryptSoftware ? `<span class="yes">対応</span><br><small>QuickSecureAES256（無料ダウンロード）</small>` : yesNo(false), (p) => sec(p).fileEncryptSoftware ? "対応" : "—"),
        group("本体・その他"),
        row("ストラップホール", (p) => yesNo(p.strapHole, "あり")),
        row("クリップ", (p) => yesNo(p.clip, "あり")),
        row("アクセスランプ", (p) => p.accessLamp === true ? `<span class="yes">あり</span>` : p.accessLamp === false ? `<span class="no">なし</span>` : "—"),
        row("書き換えに強い（長寿命）", (p) => yesNo(p.longLife)),
        row("抗菌・抗ウイルス", (p) => yesNo(p.antibacterial)),
        row("保証期間", (p, v) => v.warrantyYears ? v.warrantyYears + "年" : "—"),
        row("外形寸法", (p) => escapeHtml(fixText(p.dimensions || "—"))),
        row("重さ", (p) => weightText(p) || "—"),
        row("使用温度範囲", (p) => escapeHtml(fixText(p.operatingTemp || "—"))),
        row("特長", (p) => (p.features || []).length ? p.features.map(escapeHtml).join("<br>") : "—")
      ];
    }

    function compareItems() {
      return state.compare.map((s) => skuIndex.get(s)).filter(Boolean);
    }

    function renderCompareTable() {
      const items = compareItems();
      const rows = compareRows(items);
      const diffOnly = $("#diff-only").checked;
      $("#compare-title").textContent = items.length >= 2 ? `詳細比較（${items.length}件）` : "商品の詳細";
      const head = `<thead><tr><th></th>${items.map(({ p, v }) => `
        <th><div class="ct-head">
          ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" onerror="this.remove()">` : ""}
          <span class="ct-head__sku">${escapeHtml(v.sku)}</span>
          <span class="ct-head__series">${escapeHtml(displayName(p))}</span>
          <a href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;font-weight:700;color:var(--accent-deep)">商品ページ ↗</a>
          <button type="button" class="ct-head__remove" data-rm="${escapeHtml(v.sku)}">比較から外す</button>
        </div></th>`).join("")}</tr></thead>`;
      const body = rows.map((r) => {
        if (r.group) return `<tr class="is-group"><th>${r.label}</th>${items.map(() => "<td></td>").join("")}</tr>`;
        const diff = items.length > 1 && r.cells.some((c) => c.plain !== r.cells[0].plain);
        if (diffOnly && !diff) return "";
        return `<tr${diff ? ' class="is-diff"' : ""}><th>${r.label}</th>${r.cells.map((c) => `<td>${c.html}</td>`).join("")}</tr>`;
      }).join("");
      $("#compare-table").innerHTML = head + `<tbody>${body}</tbody>`;
      $$("#compare-table [data-rm]").forEach((b) => b.addEventListener("click", () => removeCompare(b.dataset.rm)));
    }

    function openModal() {
      if (!state.compare.length) return;
      renderCompareTable();
      $("#compare-modal").hidden = false;
      document.body.style.overflow = "hidden";
      $("#compare-close").focus();
      writeUrl();
    }
    function closeModal() {
      $("#compare-modal").hidden = true;
      document.body.style.overflow = "";
      writeUrl();
    }
    $("#compare-btn").addEventListener("click", openModal);
    $("#compare-close").addEventListener("click", closeModal);
    $(".compare-modal__overlay").addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#compare-modal").hidden) closeModal(); });
    $("#diff-only").addEventListener("change", renderCompareTable);

    // ---------- PDF（印刷ダイアログの「PDFに保存」を使う） ----------
    const ymd = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

    function buildPrintSheet() {
      const items = compareItems();
      const rows = compareRows(items);
      const now = new Date();
      const first = items[0].v.sku.replace(/\//g, "-");
      const fileName = items.length > 1 ? `${first}_ほか${items.length - 1}件_${ymd()}` : `${first}_${ymd()}`;
      const conds = activeConditions().map((c) => c.label);
      const strip = (h) => h.replace(/<\/?a\b[^>]*>/g, "");
      const head = `<tr><th></th>${items.map(({ p, v }) => `<th>${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="">` : ""}${escapeHtml(v.sku)}<br><span style="font-weight:400;font-size:7.5pt">${escapeHtml(displayName(p))}</span></th>`).join("")}</tr>`;
      const body = rows.map((r) => {
        if (r.group) return `<tr class="ps-group"><th colspan="${items.length + 1}">${r.label}</th></tr>`;
        const diff = items.length > 1 && r.cells.some((c) => c.plain !== r.cells[0].plain);
        return `<tr${diff ? ' class="ps-diff"' : ""}><th>${r.label}</th>${r.cells.map((c) => `<td>${strip(c.html)}</td>`).join("")}</tr>`;
      }).join("");
      $("#print-sheet").innerHTML = `
        <div class="ps-top"><b>USBメモリー ${items.length > 1 ? "商品比較" : "商品詳細"}</b><span>出力日：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日</span></div>
        <p class="ps-cond">${conds.length ? "絞り込み条件：" + conds.map(escapeHtml).join("、") : "絞り込み条件：なし"}${items.length > 1 ? "　／　色付きの行は商品によって違う項目です" : ""}</p>
        <table class="ps-table"><thead>${head}</thead><tbody>${body}</tbody></table>
        <p class="ps-note">価格はI-O DATA公式サイト掲載のメーカー希望小売価格です（オープン価格の商品は価格を表示していません）。価格・在庫状況は変動する場合があります。対応機種・仕様の詳細は各商品ページでご確認ください。</p>`;
      return fileName;
    }
    $("#compare-pdf").addEventListener("click", () => {
      if (!state.compare.length) return;
      const fileName = buildPrintSheet();
      const old = document.title;
      document.title = fileName; // 「PDFに保存」の初期ファイル名になる
      const restore = () => { document.title = old; window.removeEventListener("afterprint", restore); };
      window.addEventListener("afterprint", restore);
      const imgs = $$("#print-sheet img");
      Promise.all(imgs.map((im) => im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; })))
        .then(() => setTimeout(() => window.print(), 150));
    });

    // ---------- URL（状態の保存と復元） ----------
    function buildUrl(includeModal) {
      const prm = new URLSearchParams();
      FILTER_KEYS.forEach((k) => { if (state[k].size) prm.set(k, [...state[k]].join(",")); });
      if (state.q) prm.set("q", state.q);
      if (state.sort !== "recommend") prm.set("sort", state.sort);
      if (state.eol) prm.set("eol", "1");
      if (state.compare.length) prm.set("cmp", state.compare.join(","));
      if (includeModal && !$("#compare-modal").hidden) prm.set("open", "1");
      const qs = prm.toString();
      return location.origin + location.pathname + (qs ? "?" + qs : "");
    }
    function writeUrl() {
      try { history.replaceState(null, "", buildUrl(true)); } catch { /* file://等 */ }
    }
    function readUrl() {
      const prm = new URLSearchParams(location.search);
      FILTER_KEYS.forEach((k) => {
        const val = prm.get(k);
        if (val) val.split(",").filter(Boolean).forEach((x) => state[k].add(x));
      });
      state.q = prm.get("q") || "";
      state.sort = prm.get("sort") || "recommend";
      state.eol = prm.get("eol") === "1";
      const cmp = (prm.get("cmp") || "").split(",").filter((s) => skuIndex.has(s));
      state.compare = cmp;
      cmp.forEach((s) => { const { p, v } = skuIndex.get(s); state.selected[p.id] = v.sku; if (isEol(v)) state.eol = true; });
      return prm.get("open") === "1";
    }

    async function copyText(text, message) {
      try {
        await navigator.clipboard.writeText(text);
        toast(message);
      } catch {
        // クリップボードが使えない環境向け（alert/promptには頼らない）
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        ta.remove();
        toast(ok ? message : "コピーできませんでした。アドレスバーのURLをコピーしてください");
      }
    }
    let toastTimer;
    function toast(msg) {
      const t = $("#toast");
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
    }
    $("#share-btn").addEventListener("click", () => copyText(buildUrl(false), "この絞り込み結果のURLをコピーしました"));
    $("#compare-share").addEventListener("click", () => copyText(buildUrl(true), "この比較のURLをコピーしました"));

    // ---------- その他の操作 ----------
    function onChange() {
      syncFilterUi();
      render();
      writeUrl();
    }
    let qTimer;
    $("#keyword-input").addEventListener("input", (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = e.target.value.trim(); onChange(); }, 200);
    });
    $("#sort-select").addEventListener("change", (e) => { state.sort = e.target.value; render(); writeUrl(); });
    $("#include-eol").addEventListener("change", (e) => { state.eol = e.target.checked; onChange(); });
    $("#reset-btn").addEventListener("click", () => {
      FILTER_KEYS.forEach((k) => state[k].clear());
      state.q = "";
      onChange();
    });

    // 右上の「HDD／SSDセレクターへ」リンク
    const sl = $("#sister-link");
    if (sl && HDD_SSD_SELECTOR_URL) sl.href = HDD_SSD_SELECTOR_URL;

    function renderUpdatedAt(iso) {
      if (!iso) return;
      const d = new Date(iso);
      const el = $("#updated-at");
      const days = (Date.now() - d.getTime()) / 86400000;
      el.textContent = `データ最終更新：${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` + (days > STALE_DAYS ? `（${Math.floor(days)}日間更新されていません。価格・在庫は公式サイトでご確認ください）` : "");
      el.classList.toggle("is-stale", days > STALE_DAYS);
      const top = $("#updated-top");
      if (top) { top.textContent = el.textContent; top.classList.toggle("is-stale", days > STALE_DAYS); }
    }

    // ---------- 起動 ----------
    buildFilters();
    fetch(DATA_URL, { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((data) => {
        products = (data.products || []).filter((p) => p.variants && p.variants.length);
        products.forEach((p) => {
          // 容量の小さい順 → 同じ容量なら保証年数の短い順 → 公式の掲載順（色違い）
          p.variants = p.variants.map((v, i) => ({ v, i }))
            .sort((a, b) => a.v.capacityGB - b.v.capacityGB || (a.v.warrantyYears || 0) - (b.v.warrantyYears || 0) || a.i - b.i)
            .map((x) => x.v);
          p.variants.forEach((v) => skuIndex.set(v.sku, { p, v }));
        });
        renderUpdatedAt(data.updatedAt);
        const open = readUrl();
        syncFilterUi();
        syncAccordion(true); // URLで条件が付いている項目は開いて見せる
        render();
        if (open && state.compare.length) openModal();
      })
      .catch((e) => {
        cardsEl.innerHTML = `<div class="no-result"><p class="no-result__title">商品データを読み込めませんでした</p><p class="no-result__body">時間をおいて再読み込みしてください。（${escapeHtml(e.message)}）</p></div>`;
      });
  }
})();
