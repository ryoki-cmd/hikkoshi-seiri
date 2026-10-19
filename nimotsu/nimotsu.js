/* ひっこし整えメモ 道具1：荷物量 → トラックの大きさ。外部ライブラリなし。catalog.json を読む（#nimotsu の data-src）。
   体積＝品目の外形（幅×奥行×高さ）の合計 × 積み方の余裕1.2（このサイトの仮定）。区分は日本通運の積載の目安の上限と比べる。体積の表示は幅で（band）。
   URL の引数：?people=1..4&amount=low|mid|high&boxes=20&items=fridge-m:1,washer-top:1 */
(function () {
  "use strict";
  var root = document.getElementById("nimotsu");
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fmt = function (n) { return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ""); };
  var num = function (v) {
    var t = String(v == null ? "" : v).replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    var n = parseFloat(t.replace(/[^\d.]/g, ""));
    return isFinite(n) && n > 0 ? n : NaN;
  };
  var GROUPS = [["appliance", "家電"], ["bed", "ベッド"], ["furniture", "家具"], ["bedding", "寝具"], ["clothes", "服"]];
  var EXAMPLE = { "1": { "fridge-m": 1, "washer-top": 1, "bedframe-s": 1, "tvstand": 1, "desk": 1 },
                  "2": { "fridge-l": 1, "washer-top": 1, "bedframe-s": 2, "sofa-2": 1, "tvstand": 1, "dining": 1, "chest": 1, "bookshelf": 1 } };
  var BIG = 90; // これ以上の辺がある物は、搬入経路の確認を勧める
  var C = null, S = { people: "1", amount: "mid", boxes: NaN, count: {}, custom: [], touched: false, top: {} };

  // 計測はくらしの Worker と同じ型：{e:"results_shown"|"ad_click"|"zero_result", place, cause, shop}。cause は英数字32字まで
  function track(ev, cause, shop) {
    var url = window.HIKKOSHI_TRACK_URL;
    if (!url || !navigator.sendBeacon) return;
    var b = { e: ev, place: "nimotsu" };
    if (cause) b.cause = String(cause).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    if (shop) b.shop = shop;
    try { navigator.sendBeacon(url, new Blob([JSON.stringify(b)], { type: "text/plain" })); } catch (e) { /* 送れなくても止めない */ }
  }
  function item(id) { return C.items.filter(function (x) { return x.id === id; })[0]; }
  function boxRange() { return C.boxes.per_people[S.people] || C.boxes.per_people["4"]; }
  function boxCount() {
    if (isFinite(S.boxes)) return S.boxes;
    var r = boxRange();
    return S.amount === "low" ? r[0] : S.amount === "high" ? r[1] : Math.round((r[0] + r[1]) / 2);
  }
  function vol(x) { return x.w * x.d * x.h / 1e6; }
  // 体積は細かい数字を出さず、丸めた1つの数で（5㎥未満は0.5㎥刻み、それ以上は1㎥刻み）。丸めは表示のときに1回だけ。make_pages.py の band と同じ
  function band(v) {
    if (!(v >= 0.25)) return "約0.5㎥未満";
    return "約" + fmt(v < 5 ? Math.floor(v * 2 + 0.5) / 2 : Math.floor(v + 0.5)) + "㎥";
  }

  function compute() {
    var list = [];
    Object.keys(S.count).forEach(function (id) { var x = item(id); if (has(x) && S.count[id] > 0) list.push({ x: x, n: S.count[id] }); });
    S.custom.forEach(function (x) { list.push({ x: x, n: 1 }); });
    var bm = item("box-m"), nb = boxCount();
    var goods = list.reduce(function (a, y) { return a + vol(y.x) * y.n; }, 0);
    var boxes = bm ? vol(bm) * nb : 0;
    var total = goods + boxes, need = total * (C.loading_factor || 1.2);
    var trucks = C.trucks.filter(function (t) { return t.id !== "box"; });
    var pick = trucks.filter(function (t) { return need <= t.load[1]; })[0] || trucks[trucks.length - 1];
    var i = trucks.indexOf(pick), also = null;
    if (i >= 0 && i < trucks.length - 1 && need > pick.load[1] * 0.85) also = trucks[i + 1]; // 境目の前後15%は大きい区分も
    var bx = C.trucks.filter(function (t) { return t.id === "box"; })[0], boxOk = false;
    if (bx && need <= bx.load[1] * 2) {
      var m = bx.max_item;
      boxOk = list.every(function (y) {
        var s = [y.x.w, y.x.d, y.x.h].sort(function (a, b) { return a - b; });
        return y.x.upright ? (Math.max(y.x.w, y.x.d) <= m.w && y.x.h <= m.h) : (s[0] <= m.w && s[1] <= m.d && s[2] <= m.h);
      });
    }
    return { list: list, nb: nb, goods: goods, boxes: boxes, total: total, need: need, pick: pick, also: also, box: boxOk ? bx : null };
  }

  function truckCard(t, main) {
    return '<div class="hk-truck' + (main ? " hk-main" : "") + '"><p class="hk-tname">' + (main ? "候補：" : "大きいほうの候補：") + '<span class="num-big' + (main ? "" : " small") + '">' + esc(t.name) + "</span></p>" +
      '<p class="hk-tload">積載の目安 約' + t.load[0] + "〜" + t.load[1] + "㎥（寸法上の目安。積めることの保証ではありません）</p></div>";
  }
  // 荷台の概念図：積載の目安の上限に対する今の荷物の割合を、運転席側から箱で埋める（実際の積み方ではない）
  function truckSvg(ratio) {
    var f = Math.max(0.03, Math.min(1, ratio)), W = 150, x0 = 10, fw = W * f;
    return '<svg class="hk-tk" viewBox="0 0 240 104" role="img" aria-label="荷台の目安の約' + Math.round(Math.min(1, ratio) * 100) + '%">' +
      '<defs><pattern id="hkBx" width="18" height="16" patternUnits="userSpaceOnUse"><rect width="18" height="16" class="hk-tk-box"/><path d="M0 .75H18M.75 0V16" class="hk-tk-seam"/></pattern></defs>' +
      '<rect x="' + x0 + '" y="8" width="' + W + '" height="66" rx="4" class="hk-tk-bed"/>' +
      '<rect x="' + (x0 + W - fw).toFixed(1) + '" y="10" width="' + fw.toFixed(1) + '" height="62" fill="url(#hkBx)"/>' +
      '<rect x="' + x0 + '" y="8" width="' + W + '" height="66" rx="4" class="hk-tk-line"/>' +
      '<path d="M166 26h38l22 22v26h-60z" class="hk-tk-cab"/><path d="M174 32h27l15 16h-42z" class="hk-tk-win"/>' +
      '<rect x="6" y="74" width="222" height="8" rx="2" class="hk-tk-cab"/>' +
      '<circle cx="42" cy="86" r="11" class="hk-tk-wh"/><circle cx="124" cy="86" r="11" class="hk-tk-wh"/><circle cx="200" cy="86" r="11" class="hk-tk-wh"/></svg>';
  }
  // 区分のはしご：全部の区分と、今の荷物がどこに入るか（候補・大きいほうの候補・収まらない）
  function ladder(r) {
    return '<div class="hk-ladder"><p class="hk-sublabel">区分ごとの積載の目安と、今の荷物（' + band(r.need) + "）</p>" + C.trucks.map(function (t) {
      var cap = t.id === "box" ? t.load[1] * 2 : t.load[1], over = r.need > cap;
      var on = r.box ? t.id === "box" : t === r.pick, also = !!(r.also && t === r.also);
      var st = on ? "候補" : also ? "大きいほうの候補" : over ? "収まらない" : "入る";
      return '<div class="hk-lrow' + (on ? " on" : also ? " also" : over ? " over" : "") + '"><span class="hk-lname">' + esc(t.name) + "</span>" +
        '<span class="hk-lbar"><i style="width:' + Math.max(2, Math.min(100, Math.round(r.need / cap * 100))) + '%"></i></span><span class="hk-lst">' + st + "</span>" +
        '<span class="hk-lload">約' + (t.id === "box" ? "1.7㎥×2本まで" : t.load[0] + "〜" + t.load[1] + "㎥") + (t.note && t.id !== "box" ? "・" + esc(t.note) : "") + "</span></div>";
    }).join("") + "</div>";
  }

  var timer = 0, shownKey = "", first = true;
  function render() {
    var r = compute();
    if (document.activeElement !== $("nmBoxes")) $("nmBoxes").value = r.nb; // 入力中の欄には書き戻さない（日本語キーボードで消えないように）
    var br = boxRange();
    $("nmBoxHint").textContent = (S.people === "4" ? "4人暮らし" : S.people + "人暮らし") + "の段ボールの目安は" + br[0] + "〜" + br[1] + "枚です（アート引越センター公式）。数は直接変えられます。";
    var big = r.list.filter(function (y) { return Math.max(y.x.w, y.x.d, y.x.h) >= BIG; });
    var est = window.HIKKOSHI_ESTIMATE;
    var extra = [];  // 補足は1行にまとめる
    if (r.also) extra.push("境目に近いので大きいほうも並べています");
    if (!r.box && r.pick.id === "2t" && r.need < r.pick.load[0]) extra.push("2トン車の目安より少なめで、軽トラックで足りる場合もあります");
    var cap = r.box ? r.box.load[1] * 2 : r.pick.load[1], name = r.box ? "単身向けボックス" : r.pick.name;
    var html = '<p class="hk-tag">結果</p>' +
      (S.touched ? "" : '<p class="hk-exband">例：' + (S.people === "1" ? "一人暮らし" : "二人暮らし") + 'のよくある荷物<span class="hk-exsub">上の入力を変えると自動で出し直します</span></p>') +
      '<p class="hk-head">' + (r.need > cap ? "この荷物は、" + esc(name) + "の目安も超えます。2台に分けるなどを引越し会社に相談してください。" : "この荷物なら、" + esc(name) + (r.box ? "でも運べる大きさです。" : "が候補です。")) + "</p>" +
      (r.box ? '<div class="hk-truck hk-main"><p class="hk-tname"><span class="hk-tsm">トラックの候補</span><span class="num-big">単身向けボックス</span></p><p class="hk-basis">根拠　推定 ' + band(r.need) + "はボックス2本（約" + fmt(r.box.load[1] * 2) + "㎥）以内で、全部の物がボックスの内寸に入る大きさです。</p></div>"
        : '<div class="hk-truck hk-main"><p class="hk-tname"><span class="hk-tsm">トラックの候補</span><span class="num-big">' + esc(r.pick.name) + "</span></p>" + truckSvg(r.need / cap) +
          '<p class="hk-basis">根拠　推定 ' + band(r.need) + "は、積載の目安（約" + r.pick.load[0] + "〜" + r.pick.load[1] + "㎥）の上限の約" + Math.round(r.need / cap * 100) + "%" + (r.need > cap ? "で、超えています" : "") + "。図は割合を示す概念図で、実際の積み方ではありません。</p></div>") +
      (r.also ? truckCard(r.also, false) : "") +
      '<p class="hk-sum">外形の合計 ' + band(r.total) + "（家具・家電＋段ボールM " + r.nb + "箱）× 積み方の余裕1.2 ＝ 推定 " + '<span class="num-big small">' + band(r.need) + "</span></p>" +
      ladder(r) +
      '<p class="hk-note">前提：荷台の大きさは積める量そのものではなく、実際の車は引越し会社が荷物を見て決めます。' + (extra.length ? extra.join("。") + "。" : "") + '（<a href="../method.html">詳しく</a>）</p>' +
      (big.length ? '<p class="hk-sublabel">大きい物の搬入経路を確かめる</p><div class="hk-chipsl">' + big.map(function (y) {
        var q = "?w=" + fmt(y.x.w) + "&d=" + fmt(y.x.d) + "&h=" + fmt(y.x.h) + "&name=" + encodeURIComponent(y.x.name) + (y.x.upright ? "&up=1" : "");
        return '<a class="hk-chip" href="../hannyu/' + q + '">' + esc(y.x.name) + "</a>";
      }).join("") + "</div>" : "") +
      (est && /^https:\/\//.test(est.url || "") ? '<div class="hk-cta"><span class="hk-prtag">PR</span><a href="' + esc(est.url) + '" rel="sponsored noopener" target="_blank" data-tool="estimate">' + esc(est.label || "この荷物で引越しの見積もりを取る") + "</a>" +
        (est.note ? '<p class="hk-hint">' + esc(est.note) + "</p>" : "") + "</div>" : "");
    var box = $("nmResult");
    box.innerHTML = html;
    if (!first) { box.classList.remove("hk-upd"); void box.offsetWidth; box.classList.add("hk-upd"); } // 出し直したことを短く示す
    first = false;
    var bar = $("nmBar");
    if (bar) bar.textContent = "候補：" + name + "（" + band(r.need) + "）";
    clearTimeout(timer);
    var key = r.pick.id + (r.box ? "+box" : "");
    timer = setTimeout(function () { if (S.touched && shownKey !== key) { shownKey = key; track("results_shown", key.replace("+", "-")); } }, 900);
    renderItems();
  }

  // よく使う品目を先に、残りは「すべての品目を見る」に畳む。寸法の目安が無い品目（件数不足）は、寸法の入力へ誘導する
  var TOP = ["fridge-m", "fridge-l", "washer-top", "washer-drum", "bedframe-s", "sofa-2", "dining", "tvstand", "bookshelf", "microwave"];
  function has(x) { return x && x.w != null && x.d != null && x.h != null; }
  function row(x) {
    if (!has(x)) return '<div class="hk-row"><div class="hk-iname">' + esc(x.name) + '<span class="hk-nodata">' + esc(x.note || "データが少ないため目安なし") +
      '<button type="button" data-fill="' + esc(x.name) + '">寸法を入れて追加</button></span></div></div>';
    var n = S.count[x.id] || 0;
    return '<div class="hk-row"><div class="hk-iname">' + esc(x.name) + '<span class="hk-isize">' + fmt(x.w) + "×" + fmt(x.d) + "×" + fmt(x.h) + "cm</span></div>" +
      '<div class="hk-step3"><button type="button" data-id="' + x.id + '" data-step="-1" aria-label="' + esc(x.name) + 'を減らす"' + (n ? "" : " disabled") + ">−</button>" +
      '<span aria-live="polite">' + n + '</span><button type="button" data-id="' + x.id + '" data-step="1" aria-label="' + esc(x.name) + 'を増やす">＋</button></div></div>';
  }
  function renderItems() {
    var top = C.items.filter(function (x) { return S.top[x.id]; });
    $("nmItemsTop").innerHTML = top.map(row).join("") + (S.custom.length ? "<h3>追加した物</h3>" + S.custom.map(function (x, i) {
      return '<div class="hk-row"><div class="hk-iname">' + esc(x.name) + '<span class="hk-isize">' + fmt(x.w) + "×" + fmt(x.d) + "×" + fmt(x.h) + 'cm</span></div><div class="hk-step3"><button type="button" data-del="' + i + '" aria-label="' + esc(x.name) + 'を外す">外す</button></div></div>';
    }).join("") : "");
    $("nmItemsRest").innerHTML = GROUPS.map(function (g) {
      var xs = C.items.filter(function (x) { return x.cat === g[0] && !S.top[x.id]; });
      return xs.length ? "<h3>" + g[1] + "</h3>" + xs.map(row).join("") : "";
    }).join("");
  }
  // 先に出す品目は、開いたときに決めて動かさない（数を変えても並びが入れ替わらないように）
  function pickTop() {
    S.top = {};
    TOP.forEach(function (id) { if (item(id)) S.top[id] = 1; });
    Object.keys(S.count).forEach(function (id) { if (S.count[id] > 0 && item(id)) S.top[id] = 1; });
  }

  function sources() {
    var seen = {}, out = [];
    C.trucks.concat(C.items).forEach(function (x) {
      [].concat(x.src || []).forEach(function (s) { if (s && s.name && !seen[s.name]) { seen[s.name] = 1; out.push(s); } });
    });
    $("nmSources").innerHTML = "<p>出典：</p><ul>" + out.map(function (s) {
      return "<li>" + (s.url ? '<a href="' + esc(s.url) + '" rel="noopener" target="_blank">' + esc(s.name) + "</a>" : esc(s.name)) + "</li>";
    }).join("") + "</ul><p>家具・家電の中央値は " + esc(String(C.updated).replace(/-/g, "/")) + " 時点のものです。</p>";
  }

  root.addEventListener("click", function (e) {
    var a = e.target.closest('a[rel~="sponsored"][data-tool]');
    if (a) track("ad_click", a.dataset.tool, "a8");
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.fill) { // 目安が無い品目は、寸法の入力欄へ（名前を入れておく）
      $("nmAdd").open = true; $("nmCName").value = b.dataset.fill; $("nmCW").focus(); return;
    }
    if (b.dataset.id) {
      S.count[b.dataset.id] = Math.max(0, (S.count[b.dataset.id] || 0) + Number(b.dataset.step));
    } else if (b.dataset.del != null) {
      S.custom.splice(Number(b.dataset.del), 1);
    } else if (b.parentNode.id === "nmPeople") {
      S.people = b.dataset.v; if (!S.typed) S.boxes = NaN;
      if (!S.touched && EXAMPLE[S.people]) { S.count = JSON.parse(JSON.stringify(EXAMPLE[S.people])); pickTop(); }
      each("#nmPeople button", function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    } else if (b.parentNode.id === "nmAmount") {
      S.amount = b.dataset.v; if (!S.typed) S.boxes = NaN;
      each("#nmAmount button", function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    } else if (b.id === "nmCAdd") {
      var x = { name: $("nmCName").value.trim() || "追加した物", w: num($("nmCW").value), d: num($("nmCD").value), h: num($("nmCH").value) };
      if (!(isFinite(x.w) && isFinite(x.d) && isFinite(x.h))) { $("nmCW").focus(); return; }
      S.custom.push(x);
      ["nmCName", "nmCW", "nmCD", "nmCH"].forEach(function (id) { $(id).value = ""; });
    } else if (b.id === "nmBarBtn") {
      $("nmResult").scrollIntoView({ behavior: "smooth", block: "start" }); return;
    } else return;
    S.touched = true;
    render();
    query();
  });
  root.addEventListener("input", function (e) {
    if (e.target.id === "nmBoxes") { S.boxes = num(e.target.value); S.typed = isFinite(S.boxes); S.touched = true; clearTimeout(S.t); S.t = setTimeout(function () { render(); query(); }, 400); }
  });
  function each(sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }

  function query() {
    var items = Object.keys(S.count).filter(function (k) { return S.count[k] > 0; }).map(function (k) { return k + ":" + S.count[k]; }).join(",");
    var q = "?people=" + S.people + "&amount=" + S.amount + (isFinite(S.boxes) ? "&boxes=" + S.boxes : "") + (items ? "&items=" + items : "");
    try { history.replaceState(null, "", q); } catch (e) { /* file:// などでは書き換えない */ }
  }
  function readQuery() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (/^[1-4]$/.test(q.get("people") || "")) S.people = q.get("people");
    if (/^(low|mid|high)$/.test(q.get("amount") || "")) S.amount = q.get("amount");
    if (q.has("boxes")) { var bq = Math.round(num(q.get("boxes"))); if (isFinite(bq) && bq <= 300) { S.boxes = bq; S.typed = true; } } // 範囲外・数でない値は使わない
    S.count = JSON.parse(JSON.stringify(EXAMPLE[S.people] || EXAMPLE["2"]));
    if (q.has("items")) {
      S.count = {};
      q.get("items").split(",").forEach(function (p) { var kv = p.split(":"); if (has(item(kv[0]))) S.count[kv[0]] = Math.min(20, parseInt(kv[1], 10) || 1); });
      S.touched = true;
    }
    each("#nmPeople button", function (x) { x.setAttribute("aria-pressed", String(x.dataset.v === S.people)); });
    each("#nmAmount button", function (x) { x.setAttribute("aria-pressed", String(x.dataset.v === S.amount)); });
  }

  function start(data) {
    C = data;
    // 例の品目のうち、データに無いもの（取り込みで件数が足りなかった家具）は外す
    Object.keys(EXAMPLE).forEach(function (p) { Object.keys(EXAMPLE[p]).forEach(function (k) { if (!has(item(k))) delete EXAMPLE[p][k]; }); });
    readQuery();
    pickTop();
    var bar = document.createElement("button");
    bar.type = "button"; bar.id = "nmBarBtn"; bar.className = "hk-bar";
    bar.innerHTML = '<span id="nmBar"></span><span class="hk-barhint">結果を見る ↓</span>';
    root.appendChild(bar);
    // 結果が画面に見えている間は、下のバーを隠す
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { bar.hidden = es[0].isIntersecting; }).observe($("nmResult"));
    sources();
    render();
  }
  (window.NIMOTSU_DATA ? Promise.resolve(window.NIMOTSU_DATA) : fetch(root.getAttribute("data-src") || "catalog.json", { cache: "no-cache" }).then(function (r) { return r.json(); }))
    .then(start)
    .catch(function () { $("nmResult").innerHTML = '<p class="hk-must">データを読み込めませんでした。時間をおいて開き直してください。</p>'; });
})();
