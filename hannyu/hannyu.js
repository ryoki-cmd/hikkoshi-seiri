/* ひっこし整えメモ 道具2：搬入経路チェック。外部ライブラリなし。catalog.json を読む（#hannyu の data-src）。
   判定は3段階（ok＝計算上は通る／chk＝要確認／ng＝計算上は通らない）。ng は「どの向きでも断面が開口より大きい」ときだけ。
   URL の引数：?w=60&d=65&h=180&name=冷蔵庫&up=1（荷物量の道具・固定ページから。寸法は5〜400cm の数だけ使う）
   結果は3段（結論の一文 → 判定の一語 → 根拠の1行）＋区間ごとのゲージ。 */
(function () {
  "use strict";
  var root = document.getElementById("hannyu");
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fmt = function (n) { return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ""); };
  var num = function (v) {
    var t = String(v == null ? "" : v).replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    var n = parseFloat(t.replace(/[^\d.]/g, ""));
    return isFinite(n) && n > 0 ? n : NaN;
  };
  var ok = function (v) { return isFinite(v) && v > 0; };
  var M = 10; // 左右それぞれの余裕（cm）。日立の冷蔵庫の搬入の案内
  var LABEL = { ok: "計算上は通る", chk: "要確認", ng: "計算上は通らない" };
  // 全体の判定の言葉。要確認は、向きを変えられる物と、立てたまま運ぶ物（冷蔵庫・洗濯機）で言い分ける
  function overallLabel(lv, it) { return lv !== "chk" ? LABEL[lv] : it.up ? "要確認（余裕が少ない）" : "要確認（傾ける・立てれば通る可能性）"; }
  var RANK = { ok: 0, chk: 1, ng: 2 };
  var SEC_NAME = { ev: "エレベーター", stairs: "階段", door: "ドア", hall: "廊下", corner: "曲がり角" };
  var C = null;
  var EX = $("hnResult").innerHTML; // JS が動かなくても読める、例の結果（body.html）

  // 計測はくらしの Worker と同じ型：{e:"results_shown"|"ad_click"|"zero_result", place, cause, shop}。cause は英数字32字まで
  function track(ev, cause, shop) {
    var url = window.HIKKOSHI_TRACK_URL;
    if (!url || !navigator.sendBeacon) return;
    var b = { e: ev, place: "hannyu" };
    if (cause) b.cause = String(cause).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    if (shop) b.shop = shop;
    try { navigator.sendBeacon(url, new Blob([JSON.stringify(b)], { type: "text/plain" })); } catch (e) { /* 送れなくても止めない */ }
  }

  // 運ぶ向きと直角な断面 [幅, 高さ] の候補。立てたまま運ぶ物は、高さは縦のまま、幅は狭いほう
  function sections(it) {
    if (it.up) return [[Math.min(it.w, it.d), it.h], [Math.max(it.w, it.d), it.h]];
    var a = [it.w, it.d, it.h], out = [];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) if (i !== j) out.push([a[i], a[j]]);
    return out;
  }
  // 上から見た長方形 [幅, 長さ, 縦の高さ] の候補
  function plans(it) {
    if (it.up) return [[Math.min(it.w, it.d), Math.max(it.w, it.d), it.h]];
    var a = [it.w, it.d, it.h], out = [];
    for (var v = 0; v < 3; v++) { var r = a.filter(function (_, k) { return k !== v; }); out.push([Math.min(r[0], r[1]), Math.max(r[0], r[1]), a[v]]); }
    return out;
  }
  // 幅aから幅bへ直角に曲がるとき、幅wの長方形が通れる長さの上限（数値で最小値を探す）
  function lmax(a, b, w) {
    var best = Infinity;
    for (var i = 1; i < 900; i++) {
      var t = i / 10 * Math.PI / 180;
      best = Math.min(best, a / Math.cos(t) + b / Math.sin(t) - w * (Math.tan(t) + 1 / Math.tan(t)));
    }
    return best;
  }

  function judgeOpening(it, W, H, what) {
    var cs = sections(it).filter(function (c) { return !ok(H) || c[1] <= H; });
    if (!cs.length) return { lv: "ng", basis: what + "の高さ" + fmt(H) + "cmを、どの向きでも超える", text: "高さ" + fmt(H) + "cmを、どの向きでも通りません（運ぶ物の" + (it.up ? "高さ" : "いちばん短い辺") + "が高さを超えます）。" };
    var w = Math.min.apply(null, cs.map(function (c) { return c[0]; })), g = { kind: "open", W: W, w: w };
    if (w + 2 * M <= W) return { lv: "ok", g: g, basis: what + "の幅" + fmt(W) + "cm ≧ 断面の幅" + fmt(w) + "cm＋左右" + M + "cmずつ", text: what + "の幅" + fmt(W) + "cmに対し、断面の幅" + fmt(w) + "cm＋左右" + M + "cmずつの余裕があります。" };
    if (w <= W) return { lv: "chk", g: g, basis: what + "の幅" + fmt(W) + "cmに対し断面の幅" + fmt(w) + "cm（余り" + fmt(W - w) + "cm。左右" + M + "cmずつの余裕に足りない）", text: what + "の幅" + fmt(W) + "cmに対し、断面の幅は" + fmt(w) + "cm（余り" + fmt(W - w) + "cm）。左右" + M + "cmずつの余裕はありません。手や梱包材が入るかを確かめてください。" };
    return { lv: "ng", g: g, basis: what + "の幅" + fmt(W) + "cm ＜ 断面の幅" + fmt(w) + "cm（いちばん細い向き）", text: what + "の幅" + fmt(W) + "cmより、どの向きでも断面の幅（いちばん狭くて" + fmt(w) + "cm）が大きくなります。" };
  }
  function judgeCorner(it, a, b, ceil, what) {
    var ps = plans(it).filter(function (p) { return !ok(ceil) || p[2] <= ceil; });
    if (!ps.length) return { lv: "chk", basis: "天井の高さ" + fmt(ceil) + "cmでは立てて回せない", text: "天井の高さ" + fmt(ceil) + "cmでは、立てて回せません。" };
    var narrow = Math.min(a, b);
    var fit = ps.filter(function (p) { return p[0] <= narrow; });
    if (!fit.length) return { lv: "ng", basis: what + "の狭いほうの幅" + fmt(narrow) + "cmより物の幅が大きい", text: what + "の狭いほうの幅" + fmt(narrow) + "cmより、物の幅（いちばん狭くて" + fmt(Math.min.apply(null, ps.map(function (p) { return p[0]; }))) + "cm）が大きくなります。" };
    var good = fit.filter(function (p) { return p[0] + 2 * M <= narrow && p[1] <= lmax(a, b, p[0] + 2 * M); })[0];
    if (good) return { lv: "ok", g: { kind: "len", L: good[1], lim: lmax(a, b, good[0]), limM: lmax(a, b, good[0] + 2 * M) }, basis: "幅" + fmt(a) + "→" + fmt(b) + "cmの角を余裕を持って回れる", text: "幅" + fmt(a) + "cm→" + fmt(b) + "cmの角を、幅" + fmt(good[0]) + "cm・長さ" + fmt(good[1]) + "cmの向きで、左右" + M + "cmずつの余裕を持って回れる計算です。" };
    var tight = fit.filter(function (p) { return p[1] <= lmax(a, b, p[0]); })[0];
    if (tight) return { lv: "chk", g: { kind: "len", L: tight[1], lim: lmax(a, b, tight[0]), limM: tight[0] + 2 * M <= narrow ? Math.max(0, lmax(a, b, tight[0] + 2 * M)) : 0 }, basis: "幅" + fmt(a) + "→" + fmt(b) + "cmの角は回れるが余裕がほとんどない", text: "幅" + fmt(a) + "cm→" + fmt(b) + "cmの角を、幅" + fmt(tight[0]) + "cm・長さ" + fmt(tight[1]) + "cmの向きで回れる計算ですが、余裕がほとんどありません。" };
    var p = fit[0];
    return { lv: "chk", g: { kind: "len", L: p[1], lim: Math.max(0, lmax(a, b, p[0])) }, basis: "長さ" + fmt(p[1]) + "cmが角を回れる上限（約" + fmt(Math.max(0, lmax(a, b, p[0]))) + "cm）を超える", text: "上から見た計算では、長さ" + fmt(p[1]) + "cmは角を回れる上限（約" + fmt(Math.max(0, lmax(a, b, p[0]))) + "cm）を超えます。" + (it.up ? "" : "立てる・傾けると通る場合があるので、") + "引越し会社に確かめてください。" };
  }
  function judgeEv(it, s) {
    var out = [];
    if (ok(s.dw)) out.push(judgeOpening(it, s.dw, s.dh, "出入口"));
    if (ok(s.a) && ok(s.b)) {
      var A = s.a, B = s.b, H = ok(s.c) ? s.c : Infinity, r;
      var dims = [it.w, it.d, it.h];
      var fits = it.up ? ((it.w <= A && it.d <= B) || (it.d <= A && it.w <= B)) && it.h <= H
        : plans(it).some(function (p) { return ((p[0] <= A && p[1] <= B) || (p[0] <= B && p[1] <= A)) && p[2] <= H; });
      var longest = Math.max.apply(null, dims);
      if (fits) r = { lv: "ok", basis: "かごにそのまま入る", text: "かご（" + fmt(A) + "×" + fmt(B) + (isFinite(H) ? "×" + fmt(H) : "") + "cm）にそのまま入る計算です。" };
      else if (!it.up && isFinite(H) && longest <= Math.sqrt(B * B + H * H)) r = { lv: "chk", basis: "かごには斜めに立てれば入る可能性", text: "そのままでは入りませんが、長さ" + fmt(longest) + "cmは、かごの奥行と高さの対角（約" + fmt(Math.sqrt(B * B + H * H)) + "cm）以内です。斜めに立てれば入る可能性があります。" };
      else r = { lv: "chk", basis: "かごにはそのままでは入らない", text: "かご（" + fmt(A) + "×" + fmt(B) + (isFinite(H) ? "×" + fmt(H) : "") + "cm）にはそのままでは入らない計算です。" + (it.up ? "立てたままでは入りません。" : "") + "階段を使うか、引越し会社に確かめてください。" };
      out.push(r);
    }
    if (!out.length) return null;
    var worst = out.reduce(function (x, y) { return RANK[y.lv] > RANK[x.lv] ? y : x; });
    return { lv: worst.lv, g: out[0].g, basis: worst.basis || "かごにそのままでは入らない", text: out.map(function (x) { return x.text; }).join(" ") };
  }

  function readItem() {
    return { name: $("hnName").value.trim(), w: num($("hnW").value), d: num($("hnD").value), h: num($("hnH").value), up: $("hnUp").checked };
  }
  function readSec(id) {
    var el = root.querySelector('[data-sec="' + id + '"]'), c = el.querySelector("[data-cant]");
    var s = { on: el.querySelector(".hk-on input").checked, cant: !!(c && c.checked), raw: {} };
    each('[data-sec="' + id + '"] input[data-k]', function (i) { s[i.dataset.k] = num(i.value); s.raw[i.dataset.k] = i.value.trim(); });
    return s;
  }

  // 区間は動線の順（建物の入口 → 部屋）で固定。REQ＝判定に要る入力、WK/HK＝幅・高さとして範囲を確かめる入力
  var ORDER = ["ev", "stairs", "door", "hall", "corner"];
  var REQ = { ev: function (s) { return ok(s.dw) || (ok(s.a) && ok(s.b)); }, stairs: function (s) { return ok(s.w); }, door: function (s) { return ok(s.w); },
              hall: function (s) { return ok(s.w); }, corner: function (s) { return ok(s.a) && ok(s.b); } };
  var WK = { ev: ["dw", "a", "b"], stairs: ["w", "b"], door: ["w"], hall: ["w"], corner: ["a", "b"] };
  var HK = { ev: ["dh", "c"], stairs: [], door: ["h"], hall: [], corner: ["c"] };
  var RANGE_W = [10, 300], RANGE_H = [100, 300];
  function outOfRange(id, s) {
    var bad = function (k, r) { return s.raw[k] !== "" && s.raw[k] != null && (!ok(s[k]) || s[k] < r[0] || s[k] > r[1]); };
    return WK[id].some(function (k) { return bad(k, RANGE_W); }) || HK[id].some(function (k) { return bad(k, RANGE_H); });
  }
  function judge(id, it, s) {
    if (id === "door") return judgeOpening(it, s.w, s.h, "ドア");
    if (id === "hall") return judgeOpening(it, s.w, NaN, "廊下");
    if (id === "corner") return judgeCorner(it, s.a, s.b, s.c, "曲がり角");
    if (id === "ev") return judgeEv(it, s);
    var st = judgeOpening(it, s.w, NaN, "階段");
    if (ok(s.b)) { var tn = judgeCorner(it, s.w, s.b, NaN, "踊り場"), worse = RANK[tn.lv] > RANK[st.lv]; st = { lv: worse ? tn.lv : st.lv, g: worse ? tn.g : st.g, basis: worse ? "踊り場：" + tn.basis : st.basis, text: st.text + " 踊り場の折り返し：" + tn.text }; }
    st.text += "（手すり・天井の低いところは含みません）";
    return st;
  }
  var SYM = { ok: "○", chk: "△", ng: "×" };
  function badge(lv, text) { return '<span class="jg ' + lv + '">' + SYM[lv] + " " + text + "</span>"; }
  var TAG = '<p class="hk-tag">結果</p>';
  // 結論の幅：ドア・廊下・階段で「計算上は通る」に要る幅（いちばん細い向きの断面の幅＋左右の余裕）
  function needW(it) { return Math.min.apply(null, sections(it).map(function (c) { return c[0]; })); }
  function needLine(it) {
    var w = needW(it);
    return '<p class="hk-need">ドア・廊下・階段に要る幅の目安 <span class="num-big">' + fmt(w + 2 * M) + 'cm以上</span><span class="hk-exsub">断面の幅' + fmt(w) + "cm＋左右" + M + "cmずつの余裕（曲がり角・高さは別に判定）</span></p>";
  }
  var NOTE1 = '<p class="hk-note">※入力した寸法だけの計算の目安です。搬入の可否は引越し会社の下見・メーカーの仕様を優先してください（<a href="../method.html">詳しく</a>）</p>';

  // 区間ごとのゲージ。open＝通り道の幅（薄い面）と、物の断面（色の箱）と、左右の余裕を足した幅（点線）。len＝角を回れる長さの上限と物の長さ
  function pct(v, max) { return Math.max(0, Math.min(100, v / max * 100)).toFixed(1) + "%"; }
  function gauge(g, lv, secName) {
    if (!g) return "";
    if (g.kind === "open") {
      var max = Math.max(g.W, g.w + 2 * M) * 1.3, c = max / 2; // 左右に壁が見える余白をとる
      var openL = (c - g.W / 2) / max * 100, itemL = (c - g.w / 2) / max * 100, needL = (c - g.w / 2 - M) / max * 100;
      return '<div class="hk-gauge" role="img" aria-label="' + secName + "の幅" + fmt(g.W) + "cmに、断面の幅" + fmt(g.w) + 'cm">' +
        '<div class="hk-g-track"><span class="hk-g-open" style="left:' + openL.toFixed(1) + "%;width:" + pct(g.W, max) + '"></span>' +
        '<span class="hk-g-need" style="left:' + Math.max(0, needL).toFixed(1) + "%;width:" + pct(g.w + 2 * M, max) + '"></span>' +
        '<span class="hk-g-item ' + lv + '" style="left:' + itemL.toFixed(1) + "%;width:" + pct(g.w, max) + '">' + fmt(g.w) + "</span></div>" +
        '<p class="hk-g-legend"><span><i class="hk-g-k open"></i>通り道 ' + fmt(g.W) + 'cm</span><span><i class="hk-g-k item ' + lv + '"></i>物の断面 ' + fmt(g.w) +
        'cm</span><span><i class="hk-g-k need"></i>余裕込み ' + fmt(g.w + 2 * M) + "cm</span></p></div>";
    }
    var mx = Math.max(g.L, g.lim) * 1.15, hasM = g.limM > 0, noM = g.limM === 0;
    return '<div class="hk-gauge" role="img" aria-label="角を回れる長さの上限約' + fmt(g.lim) + "cmに、物の長さ" + fmt(g.L) + 'cm">' +
      '<div class="hk-g-track"><span class="hk-g-open" style="left:0;width:' + pct(g.lim, mx) + '"></span><span class="hk-g-item ' + lv + '" style="left:0;width:' + pct(g.L, mx) + '">' + fmt(g.L) + "</span>" +
      (hasM ? '<span class="hk-g-mark" style="left:' + pct(g.limM, mx) + '"></span>' : "") + "</div>" +
      '<p class="hk-g-legend"><span><i class="hk-g-k item ' + lv + '"></i>物の長さ ' + fmt(g.L) + 'cm</span><span><i class="hk-g-k open"></i>回れる上限 約' + fmt(g.lim) + "cm</span>" +
      (hasM ? '<span><i class="hk-g-k mark"></i>左右' + M + "cmの余裕込みの上限 約" + fmt(g.limM) + "cm</span>" : noM ? "<span>左右" + M + "cmの余裕を足すと、廊下の幅に入りません</span>" : "") + "</p></div>";
  }
  // 3段の見出し：一文（結論）→ 判定の一語 → 根拠の1行
  function headline(lv, undecided, it, worstSec, n) {
    var nm = esc(it.name || "運ぶ物");
    if (undecided) return nm + "は、未入力・測れない区間があるため、全体はまだ判定できません。";
    if (lv === "ok") return nm + "は、入力した" + n + "区間をすべて計算上は通ります。";
    if (lv === "ng") return nm + "は、" + worstSec + "を計算上は通りません。";
    return nm + "は、" + worstSec + "で余裕が少なくなります。";
  }

  var timer = 0, shownKey = "", first = true;
  function render() {
    var it = readItem(), have = ok(it.w) && ok(it.d) && ok(it.h);
    var res = [], used = 0, entered = 0, unknown = false;
    ORDER.forEach(function (id) {
      var s = readSec(id);
      if (!s.on) return;
      used++;
      if (s.cant) { entered++; unknown = true; res.push([id, { lv: "chk", basis: "測れない区間", text: "測れないため、計算していません。引越し会社の下見で確かめてください。" }]); return; }
      if (!REQ[id](s)) { unknown = true; return; }
      entered++;
      if (outOfRange(id, s)) { res.push([id, { lv: "chk", basis: "入力した値が想定の範囲の外", text: "入力した値が想定の範囲（幅10〜300cm・高さ100〜300cm）の外です。単位（cm）と値を確かめてください。" }]); return; }
      if (have) { var r = judge(id, it, s); if (r) res.push([id, r]); }
    });
    var html, barText;
    if (!have) {
      // 入力前は body.html の例。一度でも触ったら、例に戻さず「何を入れればいいか」を出す（入力が効いていないように見えるため）
      html = root._touched ? TAG + '<p class="hk-guide">運ぶ物の寸法（幅・奥行・高さ）が入ると判定します。上の「1」でよくある物を選ぶか、寸法を入れてください。</p>' : EX;
      barText = root._touched ? "運ぶ物の寸法を入れると判定します" : "例を表示中。運ぶ物を選ぶと判定します";
    } else if (!entered) {
      html = TAG + '<p class="hk-head">' + esc(it.name || "運ぶ物") + "（幅" + fmt(it.w) + "×奥行" + fmt(it.d) + "×高さ" + fmt(it.h) + "cm）を通すのに</p>" + needLine(it) +
        '<p class="hk-guide">通り道（ドア・廊下など）の幅を入れると、区間ごとに判定します。</p>';
      barText = "要る幅の目安 " + fmt(needW(it) + 2 * M) + "cm以上";
    } else {
      var worst = res.reduce(function (m, r) { return RANK[r[1].lv] > RANK[m] ? r[1].lv : m; }, "ok");
      var wi = -1;
      res.forEach(function (r, i) { if (wi < 0 && r[1].lv === worst && worst !== "ok") wi = i; });
      var undecided = unknown && worst !== "ng", lv = undecided ? "chk" : worst;
      var word = undecided ? "判定できません（要確認）" : overallLabel(worst, it);
      var basis = wi >= 0 ? SEC_NAME[res[wi][0]] + "：" + (res[wi][1].basis || "") : res.length ? "いちばん狭い区間も、左右" + M + "cmずつの余裕を含めて入る" : "";
      html = TAG +
        '<div class="hk-vh hk-vh-' + lv + '"><p class="hk-head">' + headline(worst, undecided, it, wi >= 0 ? SEC_NAME[res[wi][0]] : "", entered) + "</p>" +
        '<p class="hk-overall">' + badge(lv, word) + "</p>" + (basis ? '<p class="hk-basis">根拠　' + esc(basis) + "</p>" : "") + "</div>" +
        needLine(it) +
        '<p class="hk-prog">' + entered + "/" + used + "区間を入力済み" + (undecided ? "。未入力・測れない区間があるので、全体は判定していません" : "") + "</p>" +
        '<div class="hk-vlist">' + res.map(function (r, i) {
          return '<div class="hk-vrow' + (i === wi ? " hk-worst" : "") + '"><span class="hk-vname">' + SEC_NAME[r[0]] + "</span>" + badge(r[1].lv, LABEL[r[1].lv]) +
            gauge(r[1].g, r[1].lv, SEC_NAME[r[0]]) + '<p class="hk-vtext">' + esc(r[1].text) + "</p></div>";
        }).join("") + "</div>" + NOTE1 + options(worst === "ng" ? "ng" : (undecided || worst === "chk") ? "chk" : "ok", it);
      barText = SYM[lv] + " " + word;
      clearTimeout(timer);
      var key = (undecided ? "unknown" : worst) + "|" + res.map(function (r) { return r[0]; }).join(",");
      timer = setTimeout(function () { if (shownKey !== key) { shownKey = key; track("results_shown", key.split("|")[0]); } }, 900);
    }
    var box = $("hnResult");
    box.innerHTML = html;
    if (!first) { box.classList.remove("hk-upd"); void box.offsetWidth; box.classList.add("hk-upd"); } // 出し直したことを短く示す
    first = false;
    var bar = $("hnBar");
    if (bar) bar.textContent = barText;
    query(it);
  }

  // 通らない・要確認のときの選択肢。主ボタンは引越し会社への相談1つだけ、残りは行で。案件のリンクは枠（司令塔）が window.HIKKOSHI_* で渡したときだけ
  function options(lv, it) {
    if (lv === "ok") return "";
    var ad = function (g, tool, def) { return g && /^https:\/\//.test(g.url || "") ? ' <a href="' + esc(g.url) + '" rel="sponsored noopener" target="_blank" data-tool="' + tool + '">' + esc(g.label || def) + '</a> <span class="hk-prtag">PR</span>' : ""; };
    var est = window.HIKKOSHI_ESTIMATE;
    var main = est && /^https:\/\//.test(est.url || "")
      ? '<div class="hk-cta"><span class="hk-prtag">PR</span><a href="' + esc(est.url) + '" rel="sponsored noopener" target="_blank" data-tool="estimate">引越し会社に相談する（吊り上げ・別経路）</a></div>'
      : "<p>まず引越し会社に、吊り上げや別の経路で運べるかを相談してください。</p>";
    var rows = [];
    if (it.up) rows.push('<li>ひと回り小さい機種を探す（<a href="https://kurashi-seiri.com/sunpo/kaden/" data-tool="kaden">家電の置き場所チェック</a>）</li>');
    rows.push("<li>まだ使える物は、運ばずに売る（買取）" + ad(window.HIKKOSHI_BUYBACK, "buyback", "買取を申し込む") + "</li>");
    rows.push("<li>処分したい物は、回収を頼む" + ad(window.HIKKOSHI_DISPOSAL, "disposal", "不用品の回収") + "</li>");
    return '<div class="hk-big"><p class="hk-sublabel">' + (lv === "ng" ? "通らないときは" : "余裕が少ない・判定できないときは") + "</p>" + main + '<ul class="hk-opts">' + rows.join("") + "</ul></div>";
  }

  function query(it) {
    if (!(ok(it.w) && ok(it.d) && ok(it.h))) return;
    var q = "?w=" + fmt(it.w) + "&d=" + fmt(it.d) + "&h=" + fmt(it.h) + (it.name ? "&name=" + encodeURIComponent(it.name) : "") + (it.up ? "&up=1" : "");
    try { history.replaceState(null, "", q); } catch (e) { /* file:// などでは書き換えない */ }
  }
  function readQuery() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var dim = function (k, id) { var v = num(q.get(k)); if (isFinite(v) && v >= 5 && v <= 400) $(id).value = fmt(v); }; // 範囲外・数でない値は入れない
    dim("w", "hnW"); dim("d", "hnD"); dim("h", "hnH");
    if (q.has("name")) $("hnName").value = String(q.get("name")).slice(0, 40);
    $("hnUp").checked = q.get("up") === "1";
  }

  function fillPick() {
    var opt = function (v, t) { return '<option value="' + esc(v) + '">' + esc(t) + "</option>"; };
    var common = C.items.filter(function (x) { return x.cat !== "box" && x.w != null && x.d != null && x.h != null; }); // 目安なしの品目は出さない
    var fr = C.models.filter(function (m) { return m.kind === "fridge"; }), wa = C.models.filter(function (m) { return m.kind === "washer"; });
    $("hnPick").innerHTML = '<option value="">選んでください</option>' +
      '<optgroup label="よくある物（中央値）">' + common.map(function (x) { return opt("i:" + x.id, x.name + "（" + fmt(x.w) + "×" + fmt(x.d) + "×" + fmt(x.h) + "）"); }).join("") + "</optgroup>" +
      '<optgroup label="冷蔵庫（型番）">' + fr.map(function (m) { return opt("m:" + m.id, m.name + "（" + fmt(m.w) + "×" + fmt(m.d) + "×" + fmt(m.h) + "）"); }).join("") + "</optgroup>" +
      '<optgroup label="洗濯機（型番）">' + wa.map(function (m) { return opt("m:" + m.id, m.name + "（" + fmt(m.w) + "×" + fmt(m.d) + "×" + fmt(m.h) + "）"); }).join("") + "</optgroup>";
  }
  var QUICK = ["fridge-l", "fridge-m", "washer-top", "washer-drum", "sofa-2", "sofa-3", "bedframe-s", "bookshelf"];
  function fillQuick() {
    var box = $("hnQuick");
    if (!box) return;
    box.innerHTML = QUICK.map(function (id) {
      var x = C.items.filter(function (y) { return y.id === id && y.w != null; })[0];
      return x ? '<button type="button" data-v="i:' + id + '" aria-pressed="false">' + esc(x.name) + "</button>" : "";
    }).join("");
  }
  function markQuick() { each("#hnQuick button", function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === $("hnPick").value)); }); }
  function pick(v) {
    var x = null, up = false;
    if (v.indexOf("i:") === 0) { x = C.items.filter(function (y) { return y.id === v.slice(2); })[0]; up = !!(x && x.upright); }
    else if (v.indexOf("m:") === 0) { x = C.models.filter(function (y) { return y.id === v.slice(2); })[0]; up = true; }
    if (!x) return;
    $("hnName").value = x.name; $("hnW").value = fmt(x.w); $("hnD").value = fmt(x.d); $("hnH").value = fmt(x.h); $("hnUp").checked = up;
  }

  // チェックを外した区間は、入力欄を隠す（画面を短くする）
  function toggleSecs() {
    each(".hk-sec", function (el) {
      var on = el.querySelector(".hk-on input").checked, cant = el.querySelector("[data-cant]");
      el.querySelector(".hk-dims").hidden = !on || !!(cant && cant.checked);
      if (cant) cant.parentNode.hidden = !on;
    });
  }
  root.addEventListener("change", function (e) {
    root._touched = true;
    if (e.target.id === "hnPick") { pick(e.target.value); markQuick(); }
    toggleSecs();
    render();
  });
  root.addEventListener("input", function (e) {
    root._touched = true;
    if (e.target.id === "hnW" || e.target.id === "hnD" || e.target.id === "hnH") { $("hnPick").value = ""; markQuick(); } // 寸法を手で変えたら、選んだ品目の印を外す
    clearTimeout(root._t); root._t = setTimeout(render, 250);
  });
  root.addEventListener("click", function (e) {
    var a = e.target.closest('a[rel~="sponsored"][data-tool]');
    if (a) track("ad_click", a.dataset.tool, "a8");
    var q = e.target.closest("#hnQuick button");
    if (q) { $("hnPick").value = q.dataset.v; $("hnPick").dispatchEvent(new Event("change", { bubbles: true })); }
    if (e.target.closest("#hnBarBtn")) $("hnResult").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });

  function start(data) {
    C = data;
    fillPick();
    fillQuick();
    $("hnRef").innerHTML = "<p>測れないときの参考（法律の最低の値で、実際の建物がこれより広いとは限りません）：共同住宅の共用廊下は、片側に部屋がある場合1.2m以上・両側の場合1.6m以上（建築基準法施行令第119条。その階の住戸の床面積の合計が100㎡を超える場合）。住宅の階段の幅は75cm以上（同施行令第23条）。</p>";
    readQuery();
    toggleSecs();
    // 画面の下の固定バー（スマホ）。結果が見えている間は隠す
    var bar = document.createElement("button");
    bar.type = "button"; bar.id = "hnBarBtn"; bar.className = "hk-bar";
    bar.innerHTML = '<span id="hnBar"></span><span class="hk-barhint">結果を見る ↓</span>';
    root.appendChild(bar);
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { bar.hidden = es[0].isIntersecting; }).observe($("hnResult"));
    render();
  }
  (window.HANNYU_DATA ? Promise.resolve(window.HANNYU_DATA) : fetch(root.getAttribute("data-src") || "catalog.json", { cache: "no-cache" }).then(function (r) { return r.json(); }))
    .then(start)
    .catch(function () { $("hnResult").insertAdjacentHTML("afterbegin", '<p class="hk-must">一覧のデータを読み込めませんでした。寸法を入れると判定はできます。</p>'); toggleSecs(); });
})();
