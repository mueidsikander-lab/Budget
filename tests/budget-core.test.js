// Financial-logic tests for budget-core.js.
//
// Run with:  node --test
// No dependencies, no build step — Node's built-in test runner only.
//
// Every case here is a regression that shipped (or nearly shipped) at some
// point: the savings basis, the forecast horizon, per-row over/under budget,
// the paid-placeholder double count, and duplicate identity.

const test = require("node:test");
const assert = require("node:assert/strict");
const BC = require("../budget-core.js");

function row(c, b, s, extra) {
  return Object.assign({ c, b, s, p: false, g: "variable" }, extra || {});
}

function state(over) {
  return Object.assign({
    currentMonth: "May 2026",
    inflow: 1000,
    savingsTargetMode: "auto",
    budget: [],
    transactions: [],
    reimbursements: [],
    outflows: [],
    imported: [],
    accounts: { debit: { balance: null }, cc: {} }
  }, over || {});
}

// ---------------------------------------------------------------------------
test("getSpent resolves paid, override and raw sum in that order", () => {
  assert.equal(BC.getSpent(row("A", 100, 40)), 40);
  assert.equal(BC.getSpent(row("A", 100, 40, { cs: 55 })), 55);
  assert.equal(BC.getSpent(row("A", 100, 0, { p: true })), 100);
  // Paid wins over a manual override.
  assert.equal(BC.getSpent(row("A", 100, 0, { p: true, cs: 55 })), 100);
});

test("a paid placeholder is a floor, not an addend (the 10,937 rent bug)", () => {
  // Rent budgeted and marked paid, then the actual payment is imported.
  const rent = row("Rent", 10937, 10937, { p: true, g: "fixed" });
  assert.equal(BC.getSpent(rent), 10937, "must not record 21,874");
});

test("a paid row still reports overspend when the real bill is larger", () => {
  const rent = row("Rent", 10937, 11500, { p: true, g: "fixed" });
  assert.equal(BC.getSpent(rent), 11500);
});

test("a paid row is unaffected by an unrelated small charge", () => {
  const tuition = row("Tuition", 5083, 200, { p: true, g: "fixed" });
  assert.equal(BC.getSpent(tuition), 5083);
});

// ---------------------------------------------------------------------------
test("savings is inflow minus everything actually spent", () => {
  const t = BC.computeBudgetTotals(state({
    budget: [row("A", 400, 100), row("B", 300, 50, { g: "fixed" })]
  }));
  assert.equal(t.spentTotal, 150);
  assert.equal(t.savings, 850, "unspent budget counts as saved");
  assert.equal(t.unusedBudget, 550);
});

test("outflows reduce savings, reimbursements raise inflow but not the target", () => {
  const st = state({
    budget: [row("A", 400, 100)],
    reimbursements: [{ id: "r", desc: "x", amount: 200 }],
    outflows: [{ id: "o", desc: "y", amount: 50 }]
  });
  const t = BC.computeBudgetTotals(st);
  assert.equal(t.INFLOW, 1200);
  assert.equal(t.spentTotal, 150);
  assert.equal(t.savings, 1050);
  // Target is base inflow less budget — unplanned income beats the goal.
  assert.equal(t.target, 600);
  assert.equal(t.targetDelta, 450);
});

test("the savings identity holds exactly", () => {
  const st = state({
    budget: [row("A", 400, 137.55), row("B", 300, 22.4, { g: "fixed" }), row("C", 200, 0, { p: true })],
    outflows: [{ id: "o", desc: "y", amount: 33.33 }]
  });
  const t = BC.computeBudgetTotals(st);
  assert.equal(BC.r2(t.fixS + t.varS + t.OUT + t.savings), t.INFLOW);
});

test("editing a category budget moves an auto target by the same amount", () => {
  const st = state({ budget: [row("A", 400, 0), row("B", 300, 0)] });
  assert.equal(BC.savingsTarget(st), 300);
  st.budget[0].b = 500;
  assert.equal(BC.savingsTarget(st), 200);
});

test("a custom target ignores budget edits, and 0 is a real target", () => {
  const st = state({ budget: [row("A", 400, 0)], savingsTargetMode: "custom", savingsTarget: 0 });
  assert.equal(BC.savingsTarget(st), 0);
  st.budget[0].b = 900;
  assert.equal(BC.savingsTarget(st), 0);
});

// ---------------------------------------------------------------------------
test("over/under budget is accumulated per row, never netted per group", () => {
  // Chiller over by 100, Electric under by 100. Netting hides both.
  const st = state({
    budget: [
      row("Chiller", 250, 350, { g: "fixed" }),
      row("Electric", 900, 800, { g: "fixed" })
    ]
  });
  const t = BC.computeBudgetTotals(st);
  assert.equal(t.overspend, 100, "overspend must not be cancelled out");
  assert.equal(t.overCount, 1);
  assert.equal(t.unusedBudget, 100, "unused budget must not be cancelled out");
});

// ---------------------------------------------------------------------------
test("projected savings equals committed, never a run-rate extrapolation", () => {
  const st = state({
    budget: [row("Fixed", 500, 0, { g: "fixed" }), row("Incidental", 150, 150)]
  });
  const t = BC.computeBudgetTotals(st);
  const f = BC.computeForecast(st, t, new Date(2026, 4, 2)); // 2 May: 2 days in
  assert.equal(f.cycleEndSavings, t.committed);
  // Full consumption: 500 fixed still due, incidental exactly used up.
  assert.equal(f.stillToSpend, 500);
  assert.equal(f.cycleEndSpend, 650);
  assert.equal(f.cycleEndSavings, 350);
});

test("blowing one budget in week one does not project a loss", () => {
  const st = state({
    inflow: 1000,
    budget: [row("Incidental", 150, 400), row("Groceries", 300, 0)]
  });
  const f = BC.computeForecast(st, null, new Date(2026, 4, 2));
  // Overspend is real (250), but the only money still at risk is the 300 of
  // groceries budget. A run-rate would have extrapolated 400 in 2 days.
  assert.equal(f.spentToDate, 400);
  assert.equal(f.stillToSpend, 300);
  assert.equal(f.cycleEndSavings, 300);
});

test("the forecast horizon is the end of the cycle month, not payday", () => {
  const cyc = BC.getCycleDays(state({ currentMonth: "February 2028" }), new Date(2028, 1, 10));
  assert.equal(cyc.total, 29, "leap year");
  assert.equal(cyc.elapsed, 10, "elapsed is day-of-month, not days since the 1st");
  assert.equal(cyc.remaining, 19);
});

test("elapsed days and elapsed fraction agree", () => {
  const st = state({ currentMonth: "May 2026" });
  const now = new Date(2026, 4, 15);
  const cyc = BC.getCycleDays(st, now);
  assert.equal(BC.getElapsedFraction(st, now), cyc.elapsed / cyc.total);
});

test("a past cycle is fully elapsed and a future one has not begun", () => {
  const now = new Date(2026, 4, 15);
  assert.equal(BC.getCycleDays(state({ currentMonth: "April 2026" }), now).remaining, 0);
  assert.equal(BC.getCycleDays(state({ currentMonth: "June 2026" }), now).elapsed, 0);
});

// ---------------------------------------------------------------------------
test("two identical purchases on one day stay two transactions", () => {
  const txns = [
    { dateStr: "05/05/2026", desc: "BLACK SHEEP COFFEE", amount: 24 },
    { dateStr: "05/05/2026", desc: "BLACK SHEEP COFFEE", amount: 24 }
  ];
  BC.assignImportKeys(txns, []);
  assert.notEqual(txns[0].key, txns[1].key);
  assert.equal(txns[0].skip, false);
  assert.equal(txns[1].skip, false);
});

test("re-importing the same statement flags every row as a duplicate", () => {
  const mk = () => [
    { dateStr: "05/05/2026", desc: "BLACK SHEEP COFFEE", amount: 24 },
    { dateStr: "05/05/2026", desc: "BLACK SHEEP COFFEE", amount: 24 },
    { dateStr: "06/05/2026", desc: "CARREFOUR", amount: 130.5 }
  ];
  const first = BC.assignImportKeys(mk(), []);
  const imported = first.map((t) => t.key);
  const second = BC.assignImportKeys(mk(), imported);
  assert.deepEqual(second.map((t) => t.isDup), [true, true, true]);
});

test("the first occurrence keeps the legacy bare key", () => {
  const legacy = "05/05/2026|CARREFOUR|130.5";
  const txns = BC.assignImportKeys([{ dateStr: "05/05/2026", desc: "CARREFOUR", amount: 130.5 }], [legacy]);
  assert.equal(txns[0].key, legacy);
  assert.equal(txns[0].isDup, true);
});

test("merchant noise does not change a transaction's identity", () => {
  assert.equal(BC.normalizeDescKey("CARREFOUR  DUBAI ARE"), BC.normalizeDescKey("CARREFOUR"));
});

// ---------------------------------------------------------------------------
test("transactions in a deleted category are detectable, not silently lost", () => {
  const st = state({
    budget: [row("Groceries", 300, 0)],
    transactions: [
      { id: "1", category: "Groceries", amount: 10 },
      { id: "2", category: "Gone", amount: 90 }
    ]
  });
  const orphans = BC.orphanTransactions(st);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].id, "2");
});

// ---------------------------------------------------------------------------
test("a restored backup is validated and coerced", () => {
  const res = BC.validateAppData({
    budget: [{ c: "Rent", b: "10937", s: "10937", p: true, g: "fixed" }],
    inflow: 42150,
    transactions: [{ id: "t1", amount: "12.5", category: "Rent", acct: "bogus" }],
    mappings: { carrefour: "Groceries", bad: 42 },
    alertSync: { gistId: "javascript:alert(1)", processed: [1, 2] }
  });
  assert.equal(res.ok, true);
  assert.equal(res.data.budget[0].b, 10937);
  assert.equal(res.data.transactions[0].amount, 12.5);
  assert.equal(res.data.transactions[0].acct, "cc", "unknown account falls back to cc");
  assert.equal(res.data.mappings.bad, undefined, "non-string mapping is dropped");
  assert.equal(res.data.alertSync.gistId, null, "a non-hex gist id is rejected");
  assert.deepEqual(res.data.alertSync.processed, ["1", "2"]);
});

test("junk and empty files are rejected outright", () => {
  assert.equal(BC.validateAppData(null).ok, false);
  assert.equal(BC.validateAppData("nope").ok, false);
  assert.equal(BC.validateAppData({}).ok, false);
  assert.equal(BC.validateAppData({ budget: [] }).ok, false);
  assert.equal(BC.validateAppData({ budget: [{ b: 1 }] }).ok, false, "a row with no name is malformed");
});

test("escHtml neutralises the characters that break out of markup", () => {
  assert.equal(BC.escHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(BC.escHtml("it's"), "it&#39;s");
  assert.equal(BC.escHtml(null), "");
});

test("nextMonthYear rolls the year over", () => {
  assert.equal(BC.nextMonthYear("December 2026"), "January 2027");
  assert.equal(BC.nextMonthYear("May 2026"), "June 2026");
});
