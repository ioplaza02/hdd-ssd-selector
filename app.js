(() => {
  "use strict";

  // ===== 設定 =====
  const SITE_PASSWORD = "hddssd2026";
  const STORAGE_KEY = "hddssd-selector-auth";
  // USBメモリーセレクターを公開したら、ここにURLを入れるとページ上部のリンクが有効になる
  const USB_MEMORY_SELECTOR_URL = "https://ioplaza02.github.io/usb-memory-selector/";
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
    // variant: 型番（容量）単位で判定する条件 / series: シリーズ単位で判定する条件
    const CAP_OPTIONS = [
      { v: "s", label: "〜500GB", test: (gb) => gb < 900 },
      { v: "1", label: "1TB", test: (gb) => gb >= 900 && gb < 1500 },
      { v: "2", label: "2TB", test: (gb) => gb >= 1500 && gb < 2500 },
      { v: "4", label: "3〜4TB", test: (gb) => gb >= 2500 && gb < 4500 },
      { v: "8", label: "5〜8TB", test: (gb) => gb >= 4500 && gb < 9000 },
      { v: "16", label: "10〜16TB", test: (gb) => gb >= 9000 && gb < 17000 },
      { v: "20", label: "20TB以上", test: (gb) => gb >= 17000 }
    ];
    const PRICE_OPTIONS = [
      // 価格は公式のメーカー希望小売価格のため、店頭価格より高め。帯もそれに合わせている
      { v: "2", label: "〜2万円", test: (p) => p <= 20000 },
      { v: "3", label: "2〜3万円", test: (p) => p > 20000 && p <= 30000 },
      { v: "5", label: "3〜5万円", test: (p) => p > 30000 && p <= 50000 },
      { v: "10", label: "5〜10万円", test: (p) => p > 50000 && p <= 100000 },
      { v: "20", label: "10〜20万円", test: (p) => p > 100000 && p <= 200000 },
      { v: "x", label: "20万円〜", test: (p) => p > 200000 }
    ];
    // mode "and"：チェックした条件を全部満たす / mode "or"：どれか1つに当てはまる
    const CHECK_GROUPS = {
      use: { mode: "and", options: [
        { v: "phone", label: "スマホ/タブレット", test: (p) => p.smartphone },
        { v: "game", label: "ゲーム機", test: (p) => p.gameConsole },
        { v: "tv", label: "テレビ", test: (p) => p.tv },
        { v: "mac", label: "MacのTimeMachine利用", test: (p) => p.macTimeMachine }
      ] },
      power: { mode: "and", options: [
        { v: "bus", label: "バスパワー", sub: "USBケーブル1本で動く（ACアダプター不要）", test: (p) => p.busPower }
      ] },
      secure: { mode: "and", options: [
        { v: "shock", label: "耐衝撃", sub: "落下・振動に強い設計", test: (p) => p.shockproof },
        { v: "enchw", label: "ハードウェア暗号化", sub: "本体で自動的に暗号化（AES256bit）", test: (p) => p.encryptionHw },
        { v: "encsw", label: "パソコンの暗号化・管理ソフトに対応", sub: "専用アプリでパスワード設定・一元管理", test: (p) => p.encryptionSw }
      ] },
      form: { mode: "or", options: [
        { v: "portable", label: "ポータブル", sub: "持ち運びやすいコンパクトタイプ", test: (p) => p.formFactor === "portable" },
        { v: "stationary", label: "据え置き", sub: "机の上などに置いて使う", test: (p) => p.formFactor === "stationary" },
        { v: "stick", label: "スティック型", sub: "ケーブルなしで直接挿す", test: (p) => p.formFactor === "stick" },
        { v: "compact", label: "小型（スマホ直挿し）", sub: "USB-Cに直接挿す超小型", test: (p) => p.formFactor === "compact" }
      ] },
      // 保証期間：1つだけ選ぶ（「5年」を選べば5年保証だけ、「3年以上」なら3年・5年）
      warranty: { mode: "or", single: true, chips: true, options: [
        { v: "3", label: "3年以上", test: (p) => (p.warrantyYears || 0) >= 3 },
        { v: "5", label: "5年", test: (p) => (p.warrantyYears || 0) >= 5 }
      ] }
    };
    const SEG_GROUPS = {
      media: { test: (p, v) => p.mediaType === v },
      conn: { test: (p, v) => (p.hostConnectors || []).includes(v) }
    };

    const state = {
      media: new Set(), cap: new Set(), price: new Set(), conn: new Set(),
      use: new Set(), power: new Set(), secure: new Set(), form: new Set(), warranty: new Set(),
      q: "", sort: "recommend", eol: false,
      selected: {},        // シリーズID → 選択中の型番
      compare: []          // 比較中の型番（順番を保持）
    };
    const FILTER_KEYS = ["media", "cap", "price", "conn", "use", "power", "secure", "form", "warranty"];

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
      return true;
    }

    function seriesPasses(p, st) {
      for (const [k, g] of Object.entries(SEG_GROUPS)) {
        if (st[k].size && ![...st[k]].some((v) => g.test(p, v))) return false;
      }
      for (const [k, g] of Object.entries(CHECK_GROUPS)) {
        if (!st[k].size) continue;
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

    // 「この条件を足したら何件になるか」を数える（0件の選択肢は薄く表示）
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
    function capLabel(gb) {
      if (gb >= 1000) {
        const tb = gb / 1000;
        return (Number.isInteger(tb) ? tb : tb.toFixed(1)) + "TB";
      }
      return gb + "GB";
    }
    function displayName(p) {
      const n = p.seriesName || p.id.toUpperCase();
      if (n.length <= 28) return n;
      // 「法人向け 5年保証 …… HDJA-UTNBシリーズ」のような長い名前は「○○シリーズ」だけにする
      const m = n.match(/([A-Z0-9][A-Z0-9\-\/]+シリーズ)/);
      const nick = n.match(/「([^」]+)」/);
      return m ? (nick ? `${nick[1]}（${m[1]}）` : m[1]) : n;
    }
    const FORM_LABEL = { portable: "ポータブル", stationary: "据え置き", stick: "スティック型", compact: "小型（直挿し）" };
    const CATEGORY_ORDER = { portable: 0, ssd: 1, stationary: 2, rokuga: 3, biz: 4 };
    const STATUS_LABEL = { "在庫限り": "店頭在庫限り", "受注生産": "受注生産", "生産終了": "生産終了", "受注停止": "一時受注停止" };

    function cableText(p) {
      if (p.formFactor === "stick" || p.formFactor === "compact") return "ケーブルなし（直挿し）";
      if (p.cableLengthCm) return p.cableLengthCm >= 100 && p.cableLengthCm % 10 === 0 ? `約${p.cableLengthCm / 100}m` : `約${p.cableLengthCm}cm`;
      if (p.cables && /一体/.test(p.cables)) return "ケーブル一体型";
      return "—";
    }
    // 公式ページ由来の文字に残った文字参照（例：&times;）を直す。古いデータ向けの保険
    function fixText(s) {
      return String(s ?? "").replace(/&times;/g, "×").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&reg;/g, "®").replace(/&trade;/g, "™");
    }
    const plugName = (c) => c === "A" ? "USB-A" : c === "C" ? "USB-C" : c;
    // 差し込み口の形のイラスト。USB-A＝四角い口の中に板（舌）がある形、USB-C＝角の丸い楕円の口
    function plugIcon(c, size = 1) {
      const w = Math.round(30 * size), h = Math.round(14 * size);
      if (c === "A") return `<svg class="plug-ico" width="${w}" height="${h}" viewBox="0 0 30 14" aria-hidden="true"><rect x="1" y="1" width="28" height="12" rx="1.2" fill="#fff" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="3.4" width="22" height="4.2" rx=".5" fill="currentColor"/><g fill="#fff"><rect x="7" y="4.6" width="2.6" height="1.8"/><rect x="11.8" y="4.6" width="2.6" height="1.8"/><rect x="16.6" y="4.6" width="2.6" height="1.8"/><rect x="21.4" y="4.6" width="2.6" height="1.8"/></g></svg>`;
      if (c === "C") return `<svg class="plug-ico" width="${w}" height="${h}" viewBox="0 0 30 14" aria-hidden="true"><rect x="2" y="1.5" width="26" height="11" rx="5.5" fill="#fff" stroke="currentColor" stroke-width="1.6"/><rect x="7" y="5.6" width="16" height="2.8" rx="1.4" fill="currentColor"/></svg>`;
      return "";
    }
    // 規格名から「USB 20Gbps（USB 3.2 Gen2×2）」のような最初の速度表記だけを取り出す
    function mainSpeed(p) {
      const t = fixText(p.interface || "").split(/[／\/]/)[0].trim();
      return t || "";
    }
    function speedOnly(t) {
      const s = String(t || "");
      const m = s.match(/(USB\s*\d+\s*Gbps|Thunderbolt\s*\d+|USB4)/i);
      if (m) return m[1].replace(/\s+/g, " ");
      // 「USB 3.2 Gen 1」のように速度の数字が書かれていない古い表記は、規格名から速度に直す
      if (/Gen\s*2\s*[x×]\s*2/i.test(s)) return "USB 20Gbps";
      if (/Gen\s*2/i.test(s) || /USB\s*3\.1/i.test(s)) return "USB 10Gbps";
      if (/Gen\s*1/i.test(s) || /USB\s*3\.0/i.test(s)) return "USB 5Gbps";
      return /USB\s*2\.0/i.test(s) ? "USB 2.0" : "";
    }
    // 長さの表記をそろえる（「約100cm」→「約1m」）
    function lenText(n, unit) {
      const cm = /^m$/i.test(unit) ? Number(n) * 100 : Number(n);
      return cm >= 100 ? `約${+(cm / 100).toFixed(1)}m` : `約${cm}cm`;
    }
    // 本体側の端子名の表記ゆれをそろえる（「USB-microB×1」「microB コネクター」→「USB microB」）
    function deviceConnLabel(p) {
      const dc = fixText(p.deviceConnector || "");
      if (/micro\s*-?\s*B/i.test(dc)) return "USB microB";
      if (/USB\s*-?\s*B\b|^B$|Bタイプ/i.test(dc)) return "USB-B";
      return dc.replace(/[×x]\s*\d+\s*$/, "").trim();
    }
    // 付属ケーブルの説明から、「どの端子のケーブルが、どの速度・長さで付くか」を読み取る
    // 例：「USBケーブル（A-C、USB 10Gbps）約50cm、USBケーブル（C-C、USB 20Gbps）約30cm」
    function cableList(p) {
      const text = fixText(p.cables || "");
      if (!text) return [];
      const parts = text.split(/[、，,\n]|(?=USBケーブル)|(?=[AC]\s*[-－–]\s*micro)/).map((x) => x.trim()).filter(Boolean);
      const out = [];
      let last = null;
      for (const seg of parts) {
        const m = seg.match(/(?:USB-?)?\b([AC])\s*[-－–]\s*(?:micro\s*-?\s*B|B|C|A)/i) || seg.match(/USB-?([AC])\b/i);
        const sp = seg.match(/USB\s*(\d+)\s*Gbps/i);
        const len = seg.match(/約?\s*([\d.]+)\s*(cm|m)(?![a-z])/i);
        if (m) {
          last = { plug: m[1].toUpperCase(), speed: sp ? `USB ${sp[1]}Gbps` : speedOnly(seg), len: len ? lenText(len[1], len[2]) : "" };
          if (!out.some((c) => c.plug === last.plug)) out.push(last);
        } else if (last && !last.len && len) {
          last.len = lenText(len[1], len[2]); // 「（C-microB USB 5Gbps）約30cm」のように長さが後ろに来る書き方
        }
      }
      return out.sort((a, b) => (a.plug === "C" ? -1 : 1) - (b.plug === "C" ? -1 : 1));
    }
    // 「接続」欄の表示：端子ごとに、ケーブルの有無・速度・長さをまとめる
    function connLines(p) {
      const fallbackSpeed = speedOnly(mainSpeed(p));
      if (p.formFactor === "stick" || p.formFactor === "compact") {
        return (p.hostConnectors || []).map((c) => ({ plug: c, head: `${plugName(c)} 直挿し`, body: fallbackSpeed }));
      }
      const cl = cableList(p);
      if (cl.length) {
        return cl.map((c) => ({ plug: c.plug, head: `${plugName(c.plug)}ケーブル`, body: [c.speed || fallbackSpeed, c.len].filter(Boolean).join("・") }));
      }
      if (p.cables && /一体/.test(p.cables)) return [{ plug: (p.hostConnectors || [])[0], head: `${connText(p)} ケーブル一体型`, body: fallbackSpeed }];
      return [{ plug: (p.hostConnectors || []).length === 1 ? p.hostConnectors[0] : null, head: connText(p), body: [fallbackSpeed, cableText(p) !== "—" ? cableText(p) : ""].filter(Boolean).join("・") }];
    }
    // 本体側がmicroB／B端子なのに、USB-C で使える商品の注釈（「本体にUSB-C端子がある」と誤解されやすいため）
    function microBNote(p) {
      const dc = deviceConnLabel(p);
      if (!/microB|USB-B/.test(dc)) return "";
      if (!(p.hostConnectors || []).includes("C")) return "";
      const plugs = cableList(p).map((c) => plugName(c.plug));
      return `本体の端子は${dc}です（本体にUSB-C端子はありません）。付属の${(plugs.length ? plugs : (p.hostConnectors || []).map(plugName)).join("・")}ケーブルで接続します。`;
    }
    // パソコン専用の注意：暗号化モデルは、専用ソフト（SHGate・I-O Security Lock App 等）で
    // パスワード認証しないとアクセスできないため、スマホ・タブレットやテレビでは使えない。
    // 端子の形（USB-A／USB-C）は関係ない（実例：HDJA-SUTCはUSB-Aのみだが同じくパソコン専用）。
    // data/overrides.json で "pcOnly": true / false を指定すれば個別に上書きできる。
    function isPcOnly(p) {
      if (typeof p.pcOnly === "boolean") return p.pcOnly;
      return !!((p.encryptionHw || p.encryptionSw) && !p.smartphone);
    }
    // 「パソコン専用」の説明文。商品ごとに data/overrides.json の "pcOnlyText" で差し替えられる
    // （例：SSCA-SUW はノーマルモードがあるため、「動作未検証」という言い方にしている）
    const PC_ONLY_CARD_TEXT = "ロック解除にパソコン用アプリが必要なため、スマホ・タブレットでは使えません。";
    const pcOnlyCardText = (p) => p.pcOnlyText || PC_ONLY_CARD_TEXT;
    const PC_ONLY_TEXT = "パソコン専用です。専用ソフトでパスワード認証（ロック解除）しないとデータにアクセスできないため、スマホ・タブレットやテレビにつないでも使えません。";

    // 「Windows PC」「Mac」タグ。LAN DISK用バックアップ専用品は「LAN DISK専用」と出す
    function isLanDiskOnly(p) { return (p.features || []).includes("NASバックアップ専用"); }
    function pcBadges(p) {
      if (isLanDiskOnly(p)) return ["🗄 LAN DISK専用"];
      const out = [];
      if (p.pcWindows !== false) out.push("💻 Windows PC");
      if (p.pcMac === true) out.push("Mac");
      return out;
    }

    // 読み書き速度（公式の一覧ページの「Read／Write」枠）。記載のある商品だけ表示する
    function speedHtml(p, compact) {
      const sp = p.speed;
      if (!sp || (!sp.readMBps && !sp.writeMBps)) return "";
      const n = (x) => x ? `約${x.toLocaleString("ja-JP")}<small>MB/s</small>` : "—";
      return `<div class="speed${compact ? " speed--compact" : ""}">
        <div class="speed__tile"><span class="speed__label">Read<i>読み込み</i></span><span class="speed__val">${n(sp.readMBps)}</span></div>
        <div class="speed__tile"><span class="speed__label">Write<i>書き込み</i></span><span class="speed__val">${n(sp.writeMBps)}</span></div>
        ${sp.note ? `<p class="speed__note">${escapeHtml(fixText(sp.note))}</p>` : ""}
      </div>`;
    }

    function connText(p) {
      return (p.hostConnectors || []).map((c) => c === "A" ? "USB-A" : "USB-C").join("／") || "—";
    }
    function powerText(p) { return p.busPower ? "バスパワー（ACアダプター不要）" : "ACアダプター／電源内蔵"; }
    function unitPrice(v) {
      if (v.priceIncTax == null || !v.capacityGB) return null;
      return Math.round(v.priceIncTax / (v.capacityGB / 1000));
    }
    function escapeHtml(s) {
      return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    // ---------- フィルターUIを組み立てる ----------
    function buildFilters() {
      const capBox = $('[data-filter="cap"]');
      capBox.innerHTML = CAP_OPTIONS.map((o) => `<button type="button" data-value="${o.v}" aria-pressed="false">${o.label}<span class="cnt"></span></button>`).join("");
      const priceBox = $('[data-filter="price"]');
      priceBox.innerHTML = PRICE_OPTIONS.map((o) => `<button type="button" data-value="${o.v}" aria-pressed="false">${o.label}<span class="cnt"></span></button>`).join("");
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
      // ボタン型（HDD/SSD・端子・容量・価格）
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

      // 端子ボタンのアイコンを、カードと同じ差し込み口のイラストに差し替える
      $$('[data-filter="conn"] .conn-ico').forEach((el) => {
        el.outerHTML = `<span class="conn-ico-svg">${plugIcon(el.classList.contains("conn-ico--a") ? "A" : "C", 1.4)}</span>`;
      });

      // 蛇腹（アコーディオン）：各グループの見出しを押すと開閉する。NASセレクターと同じ操作感
      const OPEN_BY_DEFAULT = ["media", "cap", "price"];
      $$(".filter-panel .fgroup").forEach((g) => {
        const title = g.querySelector(".fgroup__title");
        const key = (g.querySelector("[data-filter]") || {}).dataset?.filter || "";
        const body = document.createElement("div");
        body.className = "fgroup__body";
        body.id = `fg-body-${key}`;
        [...g.children].filter((c) => c !== title).forEach((c) => body.appendChild(c));
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fgroup__toggle";
        btn.dataset.group = key;
        btn.setAttribute("aria-controls", body.id);
        btn.innerHTML = `<span class="fgroup__arrow" aria-hidden="true">▸</span><span class="fgroup__name">${title.textContent}</span><span class="fgroup__count" hidden></span>`;
        title.replaceWith(btn);
        g.appendChild(body);
        g.dataset.group = key;
        const open = OPEN_BY_DEFAULT.includes(key) || (state[key] && state[key].size > 0);
        setGroupOpen(g, open);
        btn.addEventListener("click", () => setGroupOpen(g, !g.classList.contains("is-open")));
      });
      $("#reset-btn-bottom").addEventListener("click", () => $("#reset-btn").click());

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
    function setGroupOpen(g, open) {
      g.classList.toggle("is-open", open);
      const btn = g.querySelector(".fgroup__toggle");
      const body = g.querySelector(".fgroup__body");
      if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (body) body.hidden = !open;
    }
    function toggle(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

    function syncFilterUi() {
      // 閉じているグループでも、選んでいる数を見出しの横に出す
      $$(".filter-panel .fgroup").forEach((g) => {
        const key = g.dataset.group;
        const n = key && state[key] ? state[key].size : 0;
        const c = g.querySelector(".fgroup__count");
        if (c) { c.hidden = n === 0; c.textContent = n ? `${n}件選択中` : ""; }
      });
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
      $("#keyword-input").value = state.q;
      $("#sort-select").value = state.sort;
      $("#include-eol").checked = state.eol;
    }

    // 現在の条件をチップで表示（クリックで外せる）
    function activeConditions() {
      const list = [];
      const add = (group, v, label) => list.push({ group, v, label });
      state.media.forEach((v) => add("media", v, v));
      CAP_OPTIONS.forEach((o) => state.cap.has(o.v) && add("cap", o.v, o.label));
      PRICE_OPTIONS.forEach((o) => state.price.has(o.v) && add("price", o.v, o.label));
      state.conn.forEach((v) => add("conn", v, v === "A" ? "USB-A" : "USB-C"));
      for (const [k, g] of Object.entries(CHECK_GROUPS)) g.options.forEach((o) => state[k].has(o.v) && add(k, o.v, k === "warranty" ? `保証${o.label}` : o.label));
      if (state.q) list.push({ group: "q", v: state.q, label: `「${state.q}」` });
      return list;
    }

    // ---------- 結果を描画 ----------
    const cardsEl = $("#cards");

    function sortList(list) {
      const sel = (x) => x.vs.find((v) => v.sku === state.selected[x.p.id]) || x.vs[0];
      const priceOf = (x) => sel(x).priceIncTax ?? Infinity;
      const cmp = {
        "recommend": (a, b) => (allLimited(a) - allLimited(b)) || (CATEGORY_ORDER[a.p.category] - CATEGORY_ORDER[b.p.category]) || (minPrice(a) - minPrice(b)),
        "price-asc": (a, b) => priceOf(a) - priceOf(b),
        "price-desc": (a, b) => (sel(b).priceIncTax ?? -1) - (sel(a).priceIncTax ?? -1),
        "cap-desc": (a, b) => Math.max(...b.vs.map((v) => v.capacityGB)) - Math.max(...a.vs.map((v) => v.capacityGB)),
        "unit-price": (a, b) => (unitPrice(sel(a)) ?? Infinity) - (unitPrice(sel(b)) ?? Infinity)
      }[state.sort];
      return list.sort(cmp);
    }
    const minPrice = (x) => Math.min(...x.vs.map((v) => v.priceIncTax ?? Infinity));
    // 在庫限り・生産終了だけのシリーズは「おすすめ順」で後ろに回す
    const allLimited = (x) => x.vs.every((v) => v.status === "在庫限り" || v.status === "生産終了" || v.status === "受注停止") ? 1 : 0;

    function render() {
      const list = sortList(matches(state));
      const total = products.length;
      $("#result-count").innerHTML = `該当 <b>${list.length}</b> シリーズ <span style="font-weight:600">（全${total}シリーズ中）</span>`;

      const conds = activeConditions();
      $("#active-chips").innerHTML = conds.map((c, i) => `<button type="button" class="active-chip" data-i="${i}">${escapeHtml(c.label)}</button>`).join("");
      $$("#active-chips .active-chip").forEach((b) => b.addEventListener("click", () => {
        const c = conds[Number(b.dataset.i)];
        if (c.group === "q") state.q = ""; else state[c.group].delete(c.v);
        onChange();
      }));

      $("#no-result").hidden = list.length > 0;
      if (!list.length) {
        $("#no-result-chips").innerHTML = conds.map((c, i) => `<button type="button" class="active-chip" data-i="${i}">${escapeHtml(c.label)} を外す</button>`).join("");
        $$("#no-result-chips .active-chip").forEach((b) => b.addEventListener("click", () => {
          const c = conds[Number(b.dataset.i)];
          if (c.group === "q") state.q = ""; else state[c.group].delete(c.v);
          onChange();
        }));
      }

      cardsEl.innerHTML = list.map(({ p, vs }) => cardHtml(p, vs)).join("");
      bindCards(list);
      renderCompareBar();
    }

    function cardHtml(p, vs) {
      const okSkus = new Set(vs.map((v) => v.sku));
      let v = p.variants.find((x) => x.sku === state.selected[p.id] && okSkus.has(x.sku)) || vs[0];
      state.selected[p.id] = v.sku;
      const visible = p.variants.filter((x) => state.eol || !isEol(x));
      // 同じ容量で色違いがあるときだけ、ボタンに色名を添える
      const capCount = {};
      visible.forEach((x) => { capCount[x.capacityGB] = (capCount[x.capacityGB] || 0) + 1; });

      const kinds = [
        `<span class="kind kind--${p.mediaType === "SSD" ? "ssd" : "hdd"}">${p.mediaType}</span>`,
        `<span class="kind kind--hdd">${FORM_LABEL[p.formFactor] || ""}</span>`,
        p.tvRecordingMain ? `<span class="kind kind--tv">録画用</span>` : ""
      ].join("");

      const badges = [];
      // パソコンで使えることは「中の人の前提」なので、カードにも必ず明記する
      pcBadges(p).forEach((t) => badges.push(`<span class="badge badge--pc">${t}</span>`));
      if (p.smartphone) badges.push(`<span class="badge badge--on">📱 スマホ・タブレット</span>`);
      if (p.tv) badges.push(`<span class="badge badge--on">📺 テレビ録画</span>`);
      if (p.gameConsole) badges.push(`<span class="badge badge--on">🎮 ゲーム機</span>`);
      if (p.busPower) badges.push(`<span class="badge">バスパワー</span>`);
      (p.hostConnectors || []).forEach((c) => badges.push(`<span class="badge badge--conn">${plugIcon(c, .8)}${plugName(c)}</span>`));
      if (p.shockproof) badges.push(`<span class="badge badge--sec">耐衝撃</span>`);
      if (p.encryptionHw) badges.push(`<span class="badge badge--sec">ハードウェア暗号化</span>`);
      if (p.encryptionSw) badges.push(`<span class="badge badge--sec">暗号化・管理ソフト対応</span>`);
      if (p.driveCount > 1) badges.push(`<span class="badge">${p.driveCount}ドライブ</span>`);
      if (p.macTimeMachine) badges.push(`<span class="badge">Time Machine</span>`);

      const up = unitPrice(v);
      const status = STATUS_LABEL[v.status] ? `<span class="status status--${v.status}">${STATUS_LABEL[v.status]}</span>` : "";
      const inCompare = state.compare.includes(v.sku);

      return `
      <article class="card${inCompare ? " is-selected" : ""}" data-id="${p.id}">
        <div class="card__top">
          <div class="card__img">${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(displayName(p))}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'card__img-ph',textContent:'${p.mediaType}'}))">` : `<span class="card__img-ph">${p.mediaType}</span>`}</div>
          <div class="card__head">
            <div class="card__kind">${kinds}</div>
            <h2 class="card__series">${escapeHtml(displayName(p))}</h2>
            <p class="card__sku">${escapeHtml(v.sku)}${v.color ? `<span style="font-family:inherit;font-weight:600">　${escapeHtml(v.color)}</span>` : ""}</p>
            ${status}
          </div>
        </div>
        <div class="card__caps" role="group" aria-label="容量を選ぶ">
          ${visible.map((x) => `<button type="button" class="cap-btn${okSkus.has(x.sku) ? "" : " is-out"}" data-sku="${escapeHtml(x.sku)}" aria-pressed="${x.sku === v.sku}" title="${escapeHtml(x.sku)}${okSkus.has(x.sku) ? "" : "（今の条件には合いません）"}">${capLabel(x.capacityGB)}${capCount[x.capacityGB] > 1 ? `<span class="cap-color">${escapeHtml(x.color || variantSuffix(x.sku))}</span>` : ""}</button>`).join("")}
        </div>
        <div class="card__price">
          ${v.priceIncTax != null
            ? `<span class="price-inc">${yen(v.priceIncTax)}<small>（税込）</small></span>${v.priceExTax != null ? `<span class="price-ex">税抜 ${yen(v.priceExTax)}</span>` : ""}${up ? `<span class="unit-price">1TBあたり 約${yen(up)}</span>` : ""}`
            : `<span class="price-open">オープン価格</span>`}
        </div>
        ${speedHtml(p)}
        <div class="badges">${badges.join("")}</div>
        <dl class="spec-mini">
          <dt>JAN</dt><dd>${v.jan ? `${escapeHtml(v.jan)}<button type="button" class="copy-jan" data-copy="${escapeHtml(v.jan)}">コピー</button>` : "—"}</dd>
          <dt>接続</dt><dd>${connLines(p).map((l) => `<span class="conn-line">${l.plug ? plugIcon(l.plug, .75) : ""}<b>${escapeHtml(l.head)}</b>${l.body ? `：${escapeHtml(l.body)}` : ""}</span>`).join("")}</dd>
          <dt>保証</dt><dd>${p.warrantyYears ? p.warrantyYears + "年" : "—"}</dd>
        </dl>
        ${isPcOnly(p) ? `<div class="alert alert--pc"><span class="alert__icon" aria-hidden="true">💻</span><span><b>パソコン専用</b>${escapeHtml(pcOnlyCardText(p))}</span></div>` : ""}
        ${microBNote(p) ? `<p class="note-info"><span aria-hidden="true">ⓘ</span>${escapeHtml(microBNote(p))}</p>` : ""}
        <div class="card__foot">
          <a class="card__link" href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">商品ページ ↗</a>
          <label class="compare-check"><input type="checkbox" data-compare="${escapeHtml(v.sku)}"${inCompare ? " checked" : ""}> 比較に追加</label>
        </div>
      </article>`;
    }
    // 「SSCA-SUW500GR」→「GR」のように、容量の数字の後ろの記号だけを取り出す
    function variantSuffix(sku) {
      const m = String(sku).match(/\d+([A-Z]+(?:\/[A-Z]+)?)$/);
      return m ? m[1] : sku;
    }
    function shortInterface(s) {
      if (!s) return "—";
      const t = s.split(/[／\/]/)[0].trim();
      return t.length > 40 ? t.slice(0, 40) + "…" : t;
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

    // 比較表の行。plain は「違いがあるか」の判定用の文字列
    function compareRows(items) {
      const row = (label, fn, plainFn) => ({ label, cells: items.map(({ p, v }) => { const html = fn(p, v); return { html, plain: plainFn ? plainFn(p, v) : html.replace(/<[^>]+>/g, "") }; }) });
      const group = (label) => ({ label, group: true });
      return [
        group("価格・容量"),
        row("価格（税込）", (p, v) => v.priceIncTax != null ? `<b>${yen(v.priceIncTax)}</b>` : "オープン価格"),
        row("価格（税抜）", (p, v) => v.priceExTax != null ? yen(v.priceExTax) : "—"),
        row("1TBあたり", (p, v) => unitPrice(v) ? "約" + yen(unitPrice(v)) : "—"),
        row("容量", (p, v) => capLabel(v.capacityGB) + (p.driveCount > 1 ? `（${p.driveCount}ドライブ合計）` : "")),
        row("JANコード", (p, v) => v.jan || "—"),
        row("在庫状況", (p, v) => STATUS_LABEL[v.status] || "販売中"),
        row("カラー", (p, v) => escapeHtml(v.color || "—")),
        group("種類・使い方"),
        row("種類", (p) => p.mediaType),
        row("形", (p) => FORM_LABEL[p.formFactor] || "—"),
        row("パソコン", (p) => isLanDiskOnly(p)
          ? `<span class="yes">LAN DISK専用</span><br><small>当社NAS「LAN DISK」のバックアップ専用です</small>`
          : `<span class="yes">${pcBadges(p).map((t) => t.replace(/^💻 /, "")).join("・")}</span>${p.pcNote ? `<br><small>${escapeHtml(fixText(p.pcNote))}</small>` : ""}`,
          (p) => pcBadges(p).join("・")),
        row("スマホ・タブレット", (p) => p.smartphone
          ? `<span class="yes">対応</span>${p.smartphoneNote ? `<br><small>${escapeHtml(fixText(p.smartphoneNote))}</small>` : ""}`
          : isPcOnly(p) ? `<span class="ng">${p.pcOnlyText ? "パソコン専用" : "使えません（パソコン専用）"}</span><br><small>${escapeHtml(p.pcOnlyText || PC_ONLY_TEXT)}</small>` : yesNo(false),
          (p) => p.smartphone ? "対応" : isPcOnly(p) ? "PC専用" : "—"),
        row("テレビ録画", (p) => p.tvRecordingMain ? `<span class="yes">対応（録画用モデル）</span>` : yesNo(p.tv)),
        row("ゲーム機", (p) => p.gameConsole ? `<span class="yes">対応</span>${p.gameNote ? `<br><small>${escapeHtml(fixText(p.gameNote))}</small>` : ""}` : yesNo(false), (p) => p.gameConsole ? "対応" : "—"),
        row("その他の機器", (p) => escapeHtml(fixText(p.otherDevices || "—"))),
        row("Mac Time Machine", (p) => yesNo(p.macTimeMachine)),
        group("接続・電源"),
        row("パソコン・スマホ側の端子", (p) => (p.hostConnectors || []).map((c) => `<span class="ct-plug">${plugIcon(c)}${plugName(c)}</span>`).join(" "), (p) => connText(p)),
        row("読み書き速度", (p) => p.speed && (p.speed.readMBps || p.speed.writeMBps)
          ? `Read 約${(p.speed.readMBps || 0).toLocaleString("ja-JP")}MB/s<br>Write 約${(p.speed.writeMBps || 0).toLocaleString("ja-JP")}MB/s${p.speed.note ? `<br><small>${escapeHtml(fixText(p.speed.note))}</small>` : ""}`
          : "—"),
        row("接続方法・速度・ケーブル長", (p) => connLines(p).map((l) => `${l.plug ? plugIcon(l.plug, .75) : ""}<b>${escapeHtml(l.head)}</b>${l.body ? `：${escapeHtml(l.body)}` : ""}`).join("<br>")),
        row("本体側の端子", (p) => escapeHtml(deviceConnLabel(p) || "—") + (microBNote(p) ? `<br><small>${escapeHtml(microBNote(p))}</small>` : "")),
        row("付属ケーブル", (p) => escapeHtml(fixText(p.cables || (p.formFactor === "stick" || p.formFactor === "compact" ? "なし（直挿し）" : "—")))),
        row("インターフェイス", (p) => escapeHtml(fixText(p.interface || "—"))),
        row("電源", (p) => powerText(p)),
        group("安心・セキュリティ"),
        row("耐衝撃", (p) => p.shockproof ? `<span class="yes">対応</span>${p.shockNote && /MIL/i.test(p.shockNote) ? `<br><small>${escapeHtml(fixText(p.shockNote))}</small>` : ""}` : yesNo(false), (p) => p.shockproof ? "対応" : "—"),
        row("ハードウェア暗号化", (p) => p.encryptionHw ? `<span class="yes">対応</span>${p.encryptionNote ? `<br><small>${escapeHtml(fixText(p.encryptionNote))}</small>` : ""}` : yesNo(false), (p) => p.encryptionHw ? "対応" : "—"),
        row("暗号化・管理ソフト", (p) => yesNo(p.encryptionSw)),
        row("保証期間", (p) => p.warrantyYears ? p.warrantyYears + "年" : "—"),
        group("本体"),
        row("重さ", (p) => p.weightG ? (p.weightG >= 1000 ? `約${(p.weightG / 1000).toFixed(1)}kg` : `約${p.weightG}g`) : "—"),
        row("外形寸法", (p) => escapeHtml(fixText(p.dimensions || "—"))),
        row("特長", (p) => (p.features || []).length ? (p.features || []).map(escapeHtml).join("<br>") : "—")
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
        <div class="ps-top"><b>外付けHDD／SSD ${items.length > 1 ? "商品比較" : "商品詳細"}</b><span>出力日：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日</span></div>
        <p class="ps-cond">${conds.length ? "絞り込み条件：" + conds.map(escapeHtml).join("、") : "絞り込み条件：なし"}${items.length > 1 ? "　／　色付きの行は商品によって違う項目です" : ""}</p>
        <table class="ps-table"><thead>${head}</thead><tbody>${body}</tbody></table>
        <p class="ps-note">価格はI-O DATA公式サイト掲載のメーカー希望小売価格です。価格・在庫状況は変動する場合があります。対応機種・仕様の詳細は各商品ページでご確認ください。</p>`;
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
      // 比較中の型番はカードでも選択状態にしておく
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

    // USBメモリーセレクター（公開後にURLを設定すると有効になる）
    const um = $("#usbmem-link");
    if (USB_MEMORY_SELECTOR_URL) {
      um.href = USB_MEMORY_SELECTOR_URL;
      um.target = "_blank";
      um.rel = "noopener";
      um.removeAttribute("aria-disabled");
      um.classList.add("is-active");
      $("#usbmem-link-sub").textContent = "USBメモリーセレクターへ ↗";
    }

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
          // 容量の小さい順 → 同じ容量なら公式の掲載順（色違い）に並べる
          p.variants = p.variants.map((v, i) => ({ v, i })).sort((a, b) => a.v.capacityGB - b.v.capacityGB || a.i - b.i).map((x) => x.v);
          p.variants.forEach((v) => skuIndex.set(v.sku, { p, v }));
        });
        renderUpdatedAt(data.updatedAt);
        const open = readUrl();
        // URLで条件が指定されているグループは、閉じたままだと気づけないので開いておく
        $$(".filter-panel .fgroup").forEach((g) => { if (state[g.dataset.group] && state[g.dataset.group].size) setGroupOpen(g, true); });
        syncFilterUi();
        render();
        if (open && state.compare.length) openModal();
      })
      .catch((e) => {
        cardsEl.innerHTML = `<div class="no-result"><p class="no-result__title">商品データを読み込めませんでした</p><p class="no-result__body">時間をおいて再読み込みしてください。（${escapeHtml(e.message)}）</p></div>`;
      });
  }
})();
