/*
 * budget-core.js — the app's financial arithmetic, as pure functions.
 *
 * Everything here takes an explicit `state` (an APP-shaped object) and returns
 * a value; nothing touches the DOM, localStorage or globals. That is the whole
 * point: index.html is a 3,000-line single file that has shipped several
 * savings-calculation regressions, and this is the part of it that can be
 * tested. `tests/budget-core.test.js` runs against this file with `node --test`
 * and no build step, no bundler and no dependencies — load order in the browser
 * is a plain <script src> before the app script, exactly as before.
 *
 * index.html keeps thin wrappers (getSpent(r), computeBudgetTotals(), ...) that
 * pass the live APP object in, so call sites are unchanged.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BudgetCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var DEFAULT_INFLOW = 42150;
  // Monthly savings goal: inflow (42,150) less the total budgeted spend (31,704).
  var DEFAULT_SAVINGS_TARGET = 10446;

  function r2(n) { return Math.round(n * 100) / 100; }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function nowMonthYear(now) { var d = now || new Date(); return MONTHS[d.getMonth()] + " " + d.getFullYear(); }
  function nextMonthYear(s) {
    var p = String(s || "").split(" "), m = MONTHS.indexOf(p[0]), y = parseInt(p[1], 10);
    if (m < 0 || isNaN(y)) return nowMonthYear();
    m++; if (m > 11) { m = 0; y++; }
    return MONTHS[m] + " " + y;
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Single source of truth for "how much was spent" on a budget row.
  //
  // `p` (marked paid) is a FLOOR, not an addend. It means "assume this bill
  // consumed its budget even though no transaction records it"; once real
  // transactions land in the row they are the record, and the row costs
  // whichever is larger. The old rule cleared `p` and set s = b + amount, so
  // marking rent (10,937) paid and then importing the actual 10,937 payment
  // recorded 21,874.
  //
  // `cs` (manual spent override) still wins over the raw sum, and `p` still
  // wins over `cs` — the UI clears one when you set the other.
  function getSpent(r) {
    if (!r) return 0;
    if (r.p) return Math.max(num(r.b), num(r.s));
    if (r.cs !== undefined && r.cs !== null) return num(r.cs);
    return num(r.s);
  }

  function catIndex(state, cat) {
    var b = (state && state.budget) || [];
    for (var i = 0; i < b.length; i++) if (b[i].c === cat) return i;
    return -1;
  }

  function budgetTotal(state) {
    var b = (state && state.budget) || [], t = 0;
    for (var i = 0; i < b.length; i++) t += num(b[i].b);
    return t;
  }

  function reimbTotal(state) {
    var l = (state && state.reimbursements) || [], t = 0;
    for (var i = 0; i < l.length; i++) t += num(l[i].amount);
    return t;
  }

  function outflowTotal(state) {
    var l = (state && state.outflows) || [], t = 0;
    for (var i = 0; i < l.length; i++) t += num(l[i].amount);
    return t;
  }

  function baseInflow(state) {
    var v = state && state.inflow;
    return (v === undefined || v === null || isNaN(v) || v === 0) ? DEFAULT_INFLOW : v;
  }

  function getTotalInflow(state) { return baseInflow(state) + reimbTotal(state); }

  // Single source of truth for the savings goal.
  //
  // In "auto" mode (the default) the target is whatever the plan implies:
  // monthly inflow less everything budgeted. Raise a category's budget and the
  // target drops by the same amount. Reimbursements are deliberately excluded —
  // unplanned income should beat the target, not raise the bar. A manual value
  // pins the goal instead. 0 is a legitimate target, hence the explicit
  // null/NaN checks rather than a falsy test.
  function savingsTarget(state) {
    if (state && state.savingsTargetMode === "custom") {
      var t = state.savingsTarget;
      if (t !== undefined && t !== null && !isNaN(t)) return t;
    }
    return r2(baseInflow(state) - budgetTotal(state));
  }

  function acctSpendTotals(state) {
    var txns = (state && state.transactions) || [];
    var deb = 0, cc = 0;
    for (var i = 0; i < txns.length; i++) {
      var a = parseFloat(txns[i].amount); if (isNaN(a)) continue;
      if (txns[i].acct === "debit") deb += a; else cc += a;
    }
    return { debit: deb, cc: cc };
  }

  // Transactions whose category no longer exists in the budget. Deleting a
  // custom category used to leave these behind, and since every total walks
  // APP.budget the spend simply vanished from the app.
  function orphanTransactions(state) {
    var txns = (state && state.transactions) || [];
    var have = {};
    var b = (state && state.budget) || [];
    for (var i = 0; i < b.length; i++) have[b[i].c] = true;
    var out = [];
    for (var j = 0; j < txns.length; j++) {
      if (!txns[j].category || !have[txns[j].category]) out.push(txns[j]);
    }
    return out;
  }

  // Single source of truth for budget totals/savings, consumed by every render
  // path (live Budget page, conclude-month modal/history, share text, share-card
  // images) so they can never independently drift out of sync.
  function computeBudgetTotals(state) {
    var data = (state && state.budget) || [];
    var BASE = baseInflow(state);
    var REIMB = reimbTotal(state);
    var OUT = outflowTotal(state);
    var INFLOW = BASE + REIMB;
    var fixB = 0, fixS = 0, varB = 0, varS = 0, totalS = 0;
    var fixCommit = 0, varCommit = 0, overspend = 0, unspent = 0, overCount = 0;
    var fixedIdx = [], varIdx = [], fixedItems = [], varItems = [];
    for (var i = 0; i < data.length; i++) {
      var sp = getSpent(data[i]);
      var bud = num(data[i].b);
      totalS += sp;
      // Over/under budget is accumulated PER ROW, never per group. Netting an
      // overspent Chiller against an underspent Electric at group level hides
      // the overspend, and the full-consumption projection below is built on
      // exactly that per-row split.
      overspend += Math.max(0, sp - bud);
      unspent += Math.max(0, bud - sp);
      if (sp > bud) overCount++;
      if (data[i].g === "fixed") { fixedIdx.push(i); fixedItems.push(data[i]); fixB += bud; fixS += sp; fixCommit += Math.max(bud, sp); }
      else { varIdx.push(i); varItems.push(data[i]); varB += bud; varS += sp; varCommit += Math.max(bud, sp); }
    }
    // Savings is money in minus money out, full stop: inflow (+ reimbursements)
    // less everything actually spent, including outflows. Budget that was never
    // utilised therefore lands in savings instead of being written off, and
    // fixS + varS + OUT + savings === INFLOW exactly.
    var spentTotal = r2(totalS + OUT);
    var savings = r2(INFLOW - spentTotal);
    var savingsPct = INFLOW > 0 ? Math.round(savings / INFLOW * 100) : 0;
    // Full-consumption basis: what savings become if every category runs to
    // 100% of its budget, with rows already over budget counted at what they
    // actually cost, since overspend cannot be un-spent.
    fixCommit = r2(fixCommit);
    varCommit = r2(varCommit + OUT);
    overspend = r2(overspend);
    var committed = r2(INFLOW - fixCommit - varCommit);
    var unusedBudget = r2(unspent);
    var target = savingsTarget(state);
    var targetDelta = r2(savings - target);
    var targetPct = target > 0 ? Math.round(savings / target * 100) : 0;
    return {
      BASE: BASE, REIMB: REIMB, OUT: OUT, INFLOW: INFLOW,
      fixB: fixB, fixS: fixS, varB: varB, varS: varS, totalS: totalS,
      fixedIdx: fixedIdx, varIdx: varIdx, fixedItems: fixedItems, varItems: varItems,
      fixCommit: fixCommit, varCommit: varCommit, overspend: overspend, overCount: overCount,
      savings: savings, savingsPct: savingsPct,
      spentTotal: spentTotal, committed: committed, unusedBudget: unusedBudget,
      target: target, targetDelta: targetDelta, targetPct: targetPct
    };
  }

  // Whole-day view of the cycle month. Elapsed is the day-of-month (on the 2nd,
  // two days of the cycle have gone), NOT the difference from the 1st.
  function getCycleDays(state, now) {
    var d = now || new Date();
    var parts = String((state && state.currentMonth) || "").split(" ");
    var mi = MONTHS.indexOf(parts[0]), yr = parseInt(parts[1], 10);
    var cy = d.getFullYear(), cm = d.getMonth();
    if (mi < 0 || isNaN(yr)) { mi = cm; yr = cy; }
    var total = new Date(yr, mi + 1, 0).getDate();
    var elapsed;
    if (yr < cy || (yr === cy && mi < cm)) elapsed = total;          // past cycle: over
    else if (yr > cy || (yr === cy && mi > cm)) elapsed = 0;         // future cycle: not begun
    else elapsed = Math.min(total, d.getDate());
    return { total: total, elapsed: elapsed, remaining: total - elapsed };
  }

  // Fractional counterpart of getCycleDays(); the two must agree.
  function getElapsedFraction(state, now) {
    var parts = String((state && state.currentMonth) || "").split(" ");
    var mi = MONTHS.indexOf(parts[0]), yr = parseInt(parts[1], 10);
    if (mi < 0 || isNaN(yr)) return 1;
    var cyc = getCycleDays(state, now);
    return cyc.total > 0 ? Math.min(1, cyc.elapsed / cyc.total) : 1;
  }

  // Projects where savings land at cycle end, on a FULL-CONSUMPTION basis:
  // every category is assumed to use 100% of its budget before the cycle ends,
  // and any category already over budget is counted at what it actually cost,
  // because overspend cannot be un-spent. projected savings therefore equals
  // computeBudgetTotals().committed exactly — that function owns the
  // arithmetic, this one only splits it out for display.
  //
  // Never extrapolate a per-day run-rate across the cycle: a lumpy sample says
  // nothing useful, and blowing the incidental budget in week one projected a
  // loss when the only money still at risk was the budget not yet spent.
  //
  // The horizon is the END OF THE CYCLE, not payday. Inflow, every budget row
  // and savingsTarget() are whole-calendar-month figures.
  function computeForecast(state, t, now) {
    t = t || computeBudgetTotals(state);
    var cyc = getCycleDays(state, now);

    var spentToDate = t.spentTotal;

    // Fixed commitments not yet paid — rent and tuition are going out whether
    // or not they have landed yet.
    var fixedDue = 0;
    for (var i = 0; i < t.fixedItems.length; i++) fixedDue += Math.max(0, num(t.fixedItems[i].b) - getSpent(t.fixedItems[i]));
    fixedDue = r2(fixedDue);

    // Variable budget not yet used, assumed spent in full by cycle end. Rows
    // already over budget contribute 0 here — their overspend is in spentToDate.
    var variableDue = 0;
    for (var k = 0; k < t.varItems.length; k++) variableDue += Math.max(0, num(t.varItems[k].b) - getSpent(t.varItems[k]));
    variableDue = r2(variableDue);

    var stillToSpend = r2(fixedDue + variableDue);
    var cycleEndSpend = r2(spentToDate + stillToSpend);

    // Cash position: what you'll actually have after paying the CC bill
    var acc = (state && state.accounts) || {};
    var debitBal = (acc.debit && acc.debit.balance != null) ? acc.debit.balance : null;
    var reimb = reimbTotal(state);
    var sp = acctSpendTotals(state);
    var cashPosition = debitBal != null ? r2(debitBal + reimb - sp.cc) : null;

    return {
      elapsed: getElapsedFraction(state, now), daysElapsed: cyc.elapsed, daysRemaining: cyc.remaining,
      spentToDate: spentToDate, fixedDue: fixedDue, variableDue: variableDue,
      stillToSpend: stillToSpend, overspend: t.overspend, overCount: t.overCount,
      cycleEndSpend: cycleEndSpend, cycleEndSavings: t.committed,
      cashPosition: cashPosition, debitBal: debitBal, reimb: reimb, ccPayable: sp.cc
    };
  }

  // ---------------------------------------------------------------------------
  // Import identity / duplicate detection
  // ---------------------------------------------------------------------------

  function cleanDesc(d) {
    return String(d || "")
      .replace(/\s+(DUBAI|ABU DHABI|ABUDHABI|LONDON|ISLAMABAD)\s+(ARE|GBR|PAK|IRL).*$/i, "")
      .replace(/\s+ARE$/, "").replace(/\s+WWW\..+$/, "").trim();
  }

  function normalizeDescKey(d) { return cleanDesc(d).toUpperCase().replace(/\s+/g, " ").trim(); }

  // A transaction's identity is date + merchant + amount + WHICH occurrence of
  // that triple it is. Two identical purchases at the same merchant on the same
  // day are two real transactions, and keying on the triple alone silently
  // collapsed them into one.
  //
  // The first occurrence keeps the bare legacy key so keys already in
  // state.imported from earlier versions still match; the second and later
  // occurrences get a "#n" suffix.
  function txnKey(dateStr, desc, amount, occurrence) {
    var base = dateStr + "|" + normalizeDescKey(desc) + "|" + amount;
    return (occurrence && occurrence > 1) ? base + "#" + occurrence : base;
  }

  // Assigns occurrence-aware keys to a batch of parsed transactions and marks
  // the ones already imported. Occurrences are counted within the batch, so
  // re-importing the same statement reproduces the same keys (both copies flag
  // as duplicates) while a genuinely repeated purchase gets a fresh key.
  function assignImportKeys(txns, imported) {
    var seen = {};
    var already = {};
    for (var i = 0; i < (imported || []).length; i++) already[imported[i]] = true;
    for (var j = 0; j < txns.length; j++) {
      var t = txns[j];
      var base = t.dateStr + "|" + normalizeDescKey(t.desc) + "|" + t.amount;
      seen[base] = (seen[base] || 0) + 1;
      t.key = txnKey(t.dateStr, t.desc, t.amount, seen[base]);
      t.isDup = !!already[t.key];
      t.skip = t.isDup;
      t.occurrence = seen[base];
    }
    return txns;
  }

  // ---------------------------------------------------------------------------
  // Restore / transfer validation
  // ---------------------------------------------------------------------------

  function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

  // Backups and #transfer= payloads are re-read as trusted app state and their
  // strings are interpolated into the DOM, so a malformed or hostile file must
  // be rejected before it ever reaches APP. Returns {ok, data} or {ok:false, error}.
  function validateAppData(obj) {
    if (!isPlainObject(obj)) return { ok: false, error: "Not a budget backup file" };
    if (!Array.isArray(obj.budget) || obj.budget.length === 0) return { ok: false, error: "No budget categories in this file" };

    var out = {};
    var i;
    var budget = [];
    for (i = 0; i < obj.budget.length; i++) {
      var r = obj.budget[i];
      if (!isPlainObject(r) || typeof r.c !== "string" || !r.c.trim()) return { ok: false, error: "Budget row " + (i + 1) + " is malformed" };
      var row = {
        c: r.c, b: num(r.b), s: num(r.s),
        p: !!r.p, g: r.g === "fixed" ? "fixed" : "variable"
      };
      if (r.cs !== undefined && r.cs !== null && !isNaN(r.cs)) row.cs = num(r.cs);
      if (r.custom) row.custom = true;
      budget.push(row);
    }
    out.budget = budget;

    out.currentMonth = (typeof obj.currentMonth === "string" && obj.currentMonth.split(" ").length === 2 && MONTHS.indexOf(obj.currentMonth.split(" ")[0]) > -1)
      ? obj.currentMonth : nowMonthYear();
    out.inflow = (obj.inflow !== undefined && !isNaN(obj.inflow) && num(obj.inflow) > 0) ? num(obj.inflow) : DEFAULT_INFLOW;
    out.savingsTargetMode = obj.savingsTargetMode === "custom" ? "custom" : "auto";
    out.savingsTarget = (obj.savingsTarget !== undefined && obj.savingsTarget !== null && !isNaN(obj.savingsTarget)) ? num(obj.savingsTarget) : DEFAULT_SAVINGS_TARGET;

    out.mappings = {};
    if (isPlainObject(obj.mappings)) {
      var mk = Object.keys(obj.mappings);
      for (i = 0; i < mk.length; i++) if (typeof obj.mappings[mk[i]] === "string") out.mappings[String(mk[i])] = obj.mappings[mk[i]];
    }

    out.transactions = [];
    if (Array.isArray(obj.transactions)) {
      for (i = 0; i < obj.transactions.length; i++) {
        var t = obj.transactions[i];
        if (!isPlainObject(t)) continue;
        out.transactions.push({
          id: typeof t.id === "string" ? t.id : "t" + i,
          date: typeof t.date === "string" ? t.date : new Date().toISOString(),
          dateStr: typeof t.dateStr === "string" ? t.dateStr : "",
          desc: String(t.desc == null ? "" : t.desc),
          cleanDesc: String(t.cleanDesc == null ? (t.desc == null ? "" : t.desc) : t.cleanDesc),
          amount: num(t.amount),
          category: typeof t.category === "string" ? t.category : null,
          card: String(t.card == null ? "" : t.card),
          key: typeof t.key === "string" ? t.key : undefined,
          source: String(t.source == null ? "" : t.source),
          acct: t.acct === "debit" ? "debit" : "cc",
          addedAt: typeof t.addedAt === "string" ? t.addedAt : undefined
        });
      }
    }

    out.reimbursements = sanitizeLedger(obj.reimbursements);
    out.outflows = sanitizeLedger(obj.outflows);

    out.imported = [];
    if (Array.isArray(obj.imported)) for (i = 0; i < obj.imported.length; i++) if (typeof obj.imported[i] === "string") out.imported.push(obj.imported[i]);

    out.history = [];
    if (Array.isArray(obj.history)) {
      for (i = 0; i < obj.history.length; i++) {
        var h = obj.history[i];
        if (!isPlainObject(h) || typeof h.month !== "string") continue;
        h.month = String(h.month);
        if (h.topCategories && !Array.isArray(h.topCategories)) h.topCategories = [];
        if (h.overBudget && !Array.isArray(h.overBudget)) h.overBudget = [];
        if (h.budget && !Array.isArray(h.budget)) h.budget = [];
        h.reimbursements = sanitizeLedger(h.reimbursements);
        h.outflows = sanitizeLedger(h.outflows);
        out.history.push(h);
      }
    }

    out.expanded = isPlainObject(obj.expanded) ? obj.expanded : {};
    out.lastImport = typeof obj.lastImport === "string" ? obj.lastImport : null;
    out.lastExportAt = typeof obj.lastExportAt === "string" ? obj.lastExportAt : null;

    var acc = isPlainObject(obj.accounts) ? obj.accounts : {};
    out.accounts = {
      debit: {
        balance: (isPlainObject(acc.debit) && acc.debit.balance != null && !isNaN(acc.debit.balance)) ? num(acc.debit.balance) : null,
        balanceDate: (isPlainObject(acc.debit) && typeof acc.debit.balanceDate === "string") ? acc.debit.balanceDate : null,
        lastUploadTo: (isPlainObject(acc.debit) && typeof acc.debit.lastUploadTo === "string") ? acc.debit.lastUploadTo : null
      },
      cc: { lastUploadTo: (isPlainObject(acc.cc) && typeof acc.cc.lastUploadTo === "string") ? acc.cc.lastUploadTo : null }
    };

    var sync = isPlainObject(obj.alertSync) ? obj.alertSync : {};
    var processed = [];
    if (Array.isArray(sync.processed)) for (i = 0; i < sync.processed.length; i++) processed.push(String(sync.processed[i]));
    out.alertSync = {
      // A gist id is hex; anything else would be pasted straight into a URL.
      gistId: (typeof sync.gistId === "string" && /^[A-Za-z0-9]{8,}$/.test(sync.gistId)) ? sync.gistId : null,
      processed: processed,
      lastSync: typeof sync.lastSync === "string" ? sync.lastSync : null
    };

    return { ok: true, data: out };
  }

  function sanitizeLedger(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!isPlainObject(e)) continue;
      out.push({
        id: typeof e.id === "string" ? e.id : "e" + i,
        desc: String(e.desc == null ? "" : e.desc),
        amount: num(e.amount)
      });
    }
    return out;
  }

  return {
    MONTHS: MONTHS,
    DEFAULT_INFLOW: DEFAULT_INFLOW,
    DEFAULT_SAVINGS_TARGET: DEFAULT_SAVINGS_TARGET,
    r2: r2,
    nowMonthYear: nowMonthYear,
    nextMonthYear: nextMonthYear,
    escHtml: escHtml,
    getSpent: getSpent,
    catIndex: catIndex,
    budgetTotal: budgetTotal,
    reimbTotal: reimbTotal,
    outflowTotal: outflowTotal,
    getTotalInflow: getTotalInflow,
    savingsTarget: savingsTarget,
    acctSpendTotals: acctSpendTotals,
    orphanTransactions: orphanTransactions,
    computeBudgetTotals: computeBudgetTotals,
    getCycleDays: getCycleDays,
    getElapsedFraction: getElapsedFraction,
    computeForecast: computeForecast,
    cleanDesc: cleanDesc,
    normalizeDescKey: normalizeDescKey,
    txnKey: txnKey,
    assignImportKeys: assignImportKeys,
    validateAppData: validateAppData
  };
});
