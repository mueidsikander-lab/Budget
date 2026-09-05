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
  assert.match(el('today-content').innerHTML,/Projected month-end savings/);
  assert.doesNotMatch(el('today-content').innerHTML,/hero-ring|Cash on hand|Credit card payable/);
  for(const page of ['pg-plan','pg-activity','pg-accounts','pg-history','pg-settings','pg-upload','pg-budget'])app.navigateToPage(page);
  assert.doesNotMatch(el('budget-content').innerHTML,/planning date|openPaymentDate/);
  assert.match(el('accounts-content').innerHTML,/Balance unknown/);
});

function savingsFixture(app) {
  app.APP.inflow=10000;
  app.APP.savingsTargetMode='auto';
  app.APP.reimbursements=[];app.APP.outflows=[];app.APP.transactions=[];
  app.APP.budget=[
    {c:'Rent',b:3000,s:0,p:true,g:'fixed'},
    {c:'Incidentals',b:1000,s:1300,p:false,g:'variable'},
    {c:'Groceries',b:2000,s:500,p:false,g:'variable'},
    {c:'Transport',b:1000,s:0,p:false,g:'variable'}
  ];
}
function savingsHeadline(el) {
  return el('today-content').innerHTML.match(/id="projected-savings"[^>]*><small>AED<\/small>([^<]+)/)[1];
}

test('Today shows full-budget savings with incidental overspending included',()=>{
  const {app,el}=boot();savingsFixture(app);app.drawBudget();
  assert.equal(savingsHeadline(el),'2,700.00');
  const view=el('today-content').innerHTML;
  assert.match(view,/AED 300.00 below your savings target/);
  assert.match(view,/− 4,800.00/);assert.match(view,/− 2,500.00/);
  assert.match(view,/Incidentals/);assert.match(view,/− AED 300.00/);
  assert.doesNotMatch(view,/Coming up|daily|per day|reserved|Try the plan|Reduce category allowances/i);
  assert.doesNotMatch(el('budget-content').innerHTML,/planning date|openPaymentDate/);
});

test('using other category budgets leaves projection unchanged, more overspending lowers it',()=>{
  const {app,el}=boot();savingsFixture(app);
  app.APP.budget[2].s=2000;app.APP.budget[3].s=1000;app.drawBudget();
  assert.equal(savingsHeadline(el),'2,700.00');
  app.APP.budget[1].s+=200;app.drawBudget();
  assert.equal(savingsHeadline(el),'2,500.00');
});

test('a custom savings goal cannot replace the projection or cut remaining category budgets',()=>{
  const {app,el}=boot();savingsFixture(app);
  app.APP.savingsTargetMode='custom';app.APP.savingsTarget=9000;app.drawBudget();
  assert.equal(savingsHeadline(el),'2,700.00');
  assert.match(el('today-content').innerHTML,/− 2,500.00/);
  assert.match(el('accounts-content').innerHTML,/Projected month-end savings: AED 2,700.00/);
});

test('reimbursements, outflows and deficits are reflected in the visible projection',()=>{
  const {app,el}=boot();savingsFixture(app);
  app.APP.reimbursements=[{amount:100}];app.APP.outflows=[{amount:200}];app.drawBudget();
  assert.equal(savingsHeadline(el),'2,600.00');
  app.APP.inflow=6000;app.drawBudget();
  assert.equal(savingsHeadline(el),'-1,400.00');
  assert.match(el('today-content').innerHTML,/Projected shortfall/);
  assert.doesNotMatch(el('today-content').innerHTML,/width:-/);
});

test('concluding a month saves actual unused budgets and preserves stored schedules',()=>{
  const {app,storage}=boot();savingsFixture(app);
  app.APP.budget[0].schedule={day:22,overrides:{}};
  const before=JSON.stringify(app.APP);app.drawBudget();
  assert.equal(JSON.stringify(app.APP),before,'rendering must not change budgets or spending');
  app.confirmConclude();
  assert.equal(app.APP.history[0].savings,5200,'unused budgets become final savings');
  assert.equal(app.APP.history[0].budget[0].schedule.day,22);
  assert.equal(JSON.parse(storage.get('bgt_v7')).budget[0].schedule.day,22);
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
