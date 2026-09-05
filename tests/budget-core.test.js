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

test("the spending plan reconciles income and protects the savings goal", () => {
  const st = state({ currentMonth: "September 2026", inflow: 42150,
    budget: [row("Bills", 21704, 18000, { g: "fixed" }), row("Household", 10000, 6200)] });
  const m = BC.computeSpendingPlan(st, new Date(2026, 8, 18));
  assert.equal(m.flexible, 3800);
  assert.equal(m.savingsReserved, 10446);
  assert.equal(m.days, 13, "today is still available for spending");
  assert.equal(m.daily, 292, "round down rather than overallocate daily");
  assert.equal(BC.r2(m.totals.spentTotal + m.forecast.fixedDue + m.flexible + m.savingsReserved + m.unallocated), m.totals.INFLOW);
});

test("custom savings goals, overspend and outflows reduce flexible allowance", () => {
  const st = state({ savingsTargetMode: "custom", savingsTarget: 300,
    budget: [row("Bills", 400, 100, { g: "fixed" }), row("Food", 200, 250), row("House", 200, 0)],
    outflows: [{ amount: 25 }] });
  const m = BC.computeSpendingPlan(st, new Date(2026, 4, 15));
  assert.equal(m.flexible, 25);
  assert.equal(m.envelopeGap, 175);
  assert.equal(m.savingsReserved, 300);
  assert.equal(m.forecast.fixedDue, 300);
});

test("unfunded bills and unattainable savings stay explicit instead of negative slices", () => {
  const st = state({ inflow: 1000, savingsTargetMode: "custom", savingsTarget: 200,
    budget: [row("Bills", 900, 0, { g: "fixed" }), row("Food", 100, 400)] });
  const m = BC.computeSpendingPlan(st);
  assert.equal(m.flexible, 0);
  assert.equal(m.fundingGap, 300);
  assert.equal(m.savingsReserved, 0);
  assert.equal(m.savingsGap, 200);
  assert.equal(m.totals.INFLOW + m.fundingGap, m.totals.spentTotal + m.forecast.fixedDue);
});

test("reimbursements can leave a surplus without silently increasing envelope budgets", () => {
  const m = BC.computeSpendingPlan(state({ budget: [row("Food", 400, 100)], reimbursements: [{ amount: 200 }] }));
  assert.equal(m.flexible, 300);
  assert.equal(m.savingsReserved, 600);
  assert.equal(m.unallocated, 200);
});

test("daily guide covers the final day but never an already closed cycle", () => {
  const st = state({ currentMonth: "February 2028", budget: [row("Food", 100, 0)] });
  assert.equal(BC.computeSpendingPlan(st, new Date(2028, 1, 29)).days, 1);
  assert.equal(BC.computeSpendingPlan(st, new Date(2028, 1, 29)).daily, 100);
  assert.equal(BC.computeSpendingPlan(st, new Date(2028, 2, 1)).daily, null);
  assert.equal(BC.computeSpendingPlan(st, new Date(2028, 0, 1)).days, 29);
});

test("recorded card purchases never become a guessed card balance or net cash", () => {
  const f = BC.computeForecast(state({ accounts: { debit: { balance: 500 } },
    transactions: [{ amount: 100, acct: "cc" }], reimbursements: [{ amount: 50 }] }));
  assert.equal(f.debitBal, 500);
  assert.equal(f.cardSpending, 100);
  assert.equal(f.cashPosition, null);
  assert.equal(f.ccPayable, null);
});

test("saving more previews a balanced plan without mutating the saved state", () => {
  for (const mode of ["auto", "custom"]) {
    const st = state({ inflow: 2000, savingsTargetMode: mode, savingsTarget: 1000, budget: [row("House", 1000, 100)] });
    const before = JSON.stringify(st);
    const next = BC.previewSavingsBoost(st, 0, 500, new Date(2026, 4, 15));
    assert.equal(JSON.stringify(st), before);
    assert.equal(next.plan.flexible, 400);
    assert.equal(next.plan.goal, 1500);
    assert.equal(next.state.budget[0].b, 500);
  }
  assert.throws(() => BC.previewSavingsBoost(state({budget:[row("Food",100,50)]}),0,500));
});

test("unknown planning dates stay unknown; a one-off override preserves recurrence", () => {
  const bill = row("Car", 200, 0, { g: "fixed" });
  assert.equal(BC.paymentDate(bill, "September 2026"), null);
  bill.schedule = BC.changePaymentDate(bill, "September 2026", "2026-09-22", "monthly");
  bill.schedule = BC.changePaymentDate(bill, "September 2026", "2026-09-28", "once");
  assert.equal(BC.paymentDate(bill, "September 2026"), "2026-09-28");
  assert.equal(BC.paymentDate(bill, "October 2026"), "2026-10-22");
});

test("monthly rules clamp short months and recover the original day afterwards", () => {
  const bill = row("Car", 200, 0, { g: "fixed" });
  bill.schedule = BC.changePaymentDate(bill, "January 2028", "2028-01-31", "monthly");
  assert.equal(BC.paymentDate(bill, "February 2028"), "2028-02-29");
  assert.equal(BC.paymentDate(bill, "March 2028"), "2028-03-31");
  assert.equal(BC.paymentDate(bill, "February 2029"), "2029-02-28");
});

test("rescheduling across months retains the budget reservation and survives restore", () => {
  const st = state({ currentMonth: "September 2026", budget: [row("Car", 200, 0, { g: "fixed" })] });
  const before = BC.computeSpendingPlan(st);
  st.budget[0].schedule = BC.changePaymentDate(st.budget[0], st.currentMonth, "2026-10-03", "once");
  const restored = BC.validateAppData(JSON.parse(JSON.stringify(st))).data;
  assert.equal(BC.paymentDate(restored.budget[0], st.currentMonth), "2026-10-03");
  assert.equal(BC.computeSpendingPlan(restored).flexible, before.flexible);
  assert.equal(BC.computeSpendingPlan(restored).forecast.fixedDue, 200);
});

test("upcoming payments sort chronologically, retain unset dates, and omit settled bills", () => {
  const st = state({ currentMonth: "September 2026", budget: [
    row("Unset",100,0,{g:"fixed"}),
    row("Later",100,0,{g:"fixed",schedule:{day:25}}),
    row("Overdue",100,20,{g:"fixed",schedule:{day:17}}),
    row("Paid",100,0,{g:"fixed",p:true,schedule:{day:19}})
  ] });
  const bills = BC.upcomingPayments(st, new Date(2026,8,18));
  assert.deepEqual(bills.map(b=>b.category),["Overdue","Later","Unset"]);
  assert.equal(bills[0].days,-1);
  assert.equal(bills[0].amount,80);
  assert.equal(bills[2].date,null);
});

test("invalid dates and restored schedule payloads cannot corrupt recurrence", () => {
  for (const date of ["2026-02-30","2026-13-01","not-a-date", "2026-01-00"]) {
    assert.equal(BC.validDate(date), false);
    assert.throws(()=>BC.changePaymentDate({},"January 2026",date,"monthly"));
  }
  const schedule=BC.sanitizeSchedule({day:99,overrides:{"September 2026":"<img>","October 2026":"2026-10-03","__proto__":"x"}});
  assert.equal(schedule.day,null);
  assert.deepEqual(schedule.overrides,{"October 2026":"2026-10-03"});
});
