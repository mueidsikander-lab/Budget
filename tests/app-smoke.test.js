// Run the shipped app script against a small DOM/storage harness. These checks
// exercise integration and persistence, not browser layout or visual rendering.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const BC = require('../budget-core.js');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function boot(saved) {
  const elements = new Map();
  function element(id='', attrs={}) {
    const classes = new Set((attrs.class || '').split(' '));
    const handlers = {};
    return {id, attrs, handlers, style:{}, value:'', innerHTML:'', textContent:'', disabled:false,
      classList:{add(x){classes.add(x)},remove(x){classes.delete(x)},contains(x){return classes.has(x)},toggle(x,on){if(on===undefined)on=!classes.has(x);if(on)classes.add(x);else classes.delete(x)}},
      getAttribute(k){return attrs[k]},setAttribute(k,v){attrs[k]=v},removeAttribute(k){delete attrs[k]},
      addEventListener(k,v){(handlers[k] ||= []).push(v)},
      fire(k,event={}){for(const h of handlers[k]||[])h.call(this,{preventDefault(){},stopPropagation(){},target:this,...event})},
      querySelector(){return element()},querySelectorAll(){return []},focus(){},select(){},scrollIntoView(){},appendChild(){},remove(){},contains(){return true}
    };
  }
  for(const m of html.matchAll(/<[^>]*\bid="([^"<>]+)"[^>]*>/g))elements.set(m[1],element(m[1]));
  const pages=['pg-budget','pg-plan','pg-activity','pg-accounts','pg-history','pg-settings','pg-upload'].map(id=>elements.get(id));
  const nav=['pg-budget','pg-plan','pg-activity','pg-accounts','pg-history'].map(id=>element('',{'data-pg':id}));
  let failStorage=false;
  const storage = new Map(saved ? [['bgt_v7',JSON.stringify(saved)]] : []);
  const document={
    body:element(),head:element(),activeElement:element(),
    getElementById(id){assert(elements.has(id),`App references missing element: ${id}`);return elements.get(id)},
    querySelector(){return null},
    querySelectorAll(selector){if(selector==='.page')return pages;if(selector==='.nav-btn')return nav;if(selector==='.modal-overlay')return [...elements.values()].filter(e=>e.id.endsWith('-modal'));return []},
    addEventListener(){},createElement(){return element()}
  };
  const location={hash:'',href:'https://example.test/Budget/index.html',pathname:'/Budget/index.html',search:''};
  const navigator={standalone:false};
  const sandbox={document,navigator,location,console,Date,Math,Number,JSON,Intl,URL,Blob,
    setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},
    localStorage:{getItem(k){return storage.get(k)||null},removeItem(k){storage.delete(k)},setItem(k,v){if(failStorage)throw Error('Storage blocked');storage.set(k,v)}},
    window:{BudgetCore:BC,navigator,location,addEventListener(){},scrollTo(){},history:{replaceState(){}}},
    confirm(){return true},prompt(){return null}
  };
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox);
  return {app:sandbox,el:id=>elements.get(id),storage,failStorage(value){failStorage=value}};
}

test('the actual shipped app starts and all navigation destinations render',()=>{
  const {app,el}=boot();
  assert.match(el('today-content').innerHTML,/Available in your plan/);
  assert.doesNotMatch(el('today-content').innerHTML,/hero-ring|Cash on hand|Credit card payable/);
  for(const page of ['pg-plan','pg-activity','pg-accounts','pg-history','pg-settings','pg-upload','pg-budget'])app.navigateToPage(page);
  assert.match(el('budget-content').innerHTML,/Set planning date/);
  assert.match(el('accounts-content').innerHTML,/Balance unknown/);
});

test('saved dates survive reload and a concluded cycle without changing financial totals',()=>{
  const run=boot(),{app,el,storage}=run;
  app.APP.currentMonth='September 2026';
  const before=BC.computeBudgetTotals(app.APP);
  app.openPaymentDate(1);
  el('payment-date').value='2026-09-28';el('payment-scope').value='monthly';el('payment-form').fire('submit');
  assert.equal(BC.paymentDate(app.APP.budget[1],app.APP.currentMonth),'2026-09-28');
  assert.deepEqual(BC.computeBudgetTotals(app.APP),before);
  const reloaded=boot(JSON.parse(storage.get('bgt_v7')));
  assert.equal(BC.paymentDate(reloaded.app.APP.budget[1],'September 2026'),'2026-09-28');
  reloaded.app.confirmConclude();
  assert.equal(BC.paymentDate(reloaded.app.APP.budget[1],reloaded.app.APP.currentMonth),'2026-10-28');
  assert.equal(reloaded.app.APP.history[0].budget[1].schedule.day,28);
});

test('date edits and savings changes roll back when device storage fails',()=>{
  const run=boot(),{app,el}=run;
  app.openPaymentDate(1);el('payment-date').value='2026-09-29';run.failStorage(true);
  el('payment-form').fire('submit');assert.equal(app.APP.budget[1].schedule,undefined);
  run.failStorage(false);app.closeModal('payment-modal');
  const before=JSON.stringify(app.APP);app.openSavingsBoost(11);run.failStorage(true);app.applySavingsBoost();
  assert.equal(JSON.stringify(app.APP),before);
});

test('previewing savings does not save until Apply and preserves payment schedules',()=>{
  const {app,storage}=boot();
  app.APP.budget[1].schedule={day:22,overrides:{}};
  const original=JSON.stringify(app.APP);app.openSavingsBoost(11);
  assert.equal(JSON.stringify(app.APP),original);
  const target=BC.savingsTarget(app.APP);app.applySavingsBoost();
  assert.equal(BC.savingsTarget(app.APP),target+500);
  assert.equal(JSON.parse(storage.get('bgt_v7')).budget[1].schedule.day,22);
});

test('import account selection is explicit and card alerts retain their card account',()=>{
  const {app,el}=boot();
  el('statement-account').value='debit';el('statement-account').fire('change');
  assert.equal(app.importAcct,'debit');
  app.pendingTxns=[{amount:1}];el('statement-account').value='cc';el('statement-account').fire('change');
  assert.equal(app.importAcct,'debit');assert.equal(el('statement-account').value,'debit');
  app.pendingTxns=[];
  app.processStatement=function(){};
  app.previewAlertTxns({txns:[{date:new Date(2026,8,5)}]});
  assert.equal(app.importAcct,'cc');assert.equal(el('statement-account').value,'cc');
});

test('dynamic category and ledger content is escaped in new views',()=>{
  const {app,el}=boot();
  app.APP.budget[1].c='<img src=x onerror=alert(1)>';
  app.APP.transactions.push({category:app.APP.budget[1].c,desc:'<script>bad()</script>',amount:10,dateStr:'05/09/2026',acct:'cc'});
  app.drawBudget();app.renderActivity();
  assert.match(el('today-content').innerHTML,/&lt;img/);
  assert.doesNotMatch(el('activity-content').innerHTML,/<script>bad/);
});
