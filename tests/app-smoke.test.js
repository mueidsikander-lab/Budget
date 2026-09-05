// Run the shipped app script against a small DOM/storage harness. These checks
// exercise integration and persistence, not browser layout or visual rendering.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const BC = require('../budget-core.js');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function boot(saved, appearanceOptions={}) {
  const elements = new Map();
  function element(id='', attrs={}) {
    const classes = new Set((attrs.class || '').split(' '));
    const handlers = {};
    return {id, attrs, handlers, style:{setProperty(k,v){this[k]=v}}, value:'', innerHTML:'', textContent:'', disabled:false,
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
  if(appearanceOptions.preference!==undefined)storage.set('bgt_appearance_v1',appearanceOptions.preference);
  const media={matches:!!appearanceOptions.dark,addEventListener(event,fn){this.change=fn}};
  const document={
    documentElement:element(),
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
    window:{BudgetCore:BC,navigator,location,matchMedia(){return media},addEventListener(){},scrollTo(){},history:{replaceState(){}}},
    confirm(){return true},prompt(){return null}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../appearance.js'),'utf8'),sandbox);
  vm.runInContext(source,sandbox);
  return {app:sandbox,media,root:document.documentElement,el:id=>elements.get(id),storage,failStorage(value){failStorage=value}};
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


test('appearance choices survive reload without changing any financial state',()=>{
  const {app,el,storage,root}=boot();const before=JSON.stringify(app.APP);
  app.openAppearance();app.setAppearance('mode','dark');app.setAppearance('tone','plum');
  assert.equal(root.getAttribute('data-mode'),'dark');assert.equal(root.getAttribute('data-tone'),'plum');
  assert.equal(el('mode-dark').checked,true);assert.equal(el('tone-plum').checked,true);
  assert.equal(JSON.stringify(app.APP),before);
  assert.equal(storage.has('bgt_v7'),false,'theme choices must not write a financial cache');
  const next=boot(JSON.parse(before),{preference:storage.get('bgt_appearance_v1')});
  assert.equal(next.root.getAttribute('data-tone'),'plum');assert.equal(next.root.style.colorScheme,'dark');
  next.app.setAppearance('mode','light');
  assert.equal(next.app.window.BudgetAppearance.get().tone,'plum','mode and tone are independent');
});

test('system mode follows live device changes while explicit mode stays fixed',()=>{
  const {app,media,root}=boot(undefined,{dark:true});
  assert.equal(root.getAttribute('data-mode'),'light','keep the existing light default');
  app.setAppearance('mode','system');assert.equal(root.getAttribute('data-mode'),'dark');
  media.matches=false;media.change();assert.equal(root.getAttribute('data-mode'),'light');
  app.setAppearance('mode','dark');media.change();assert.equal(root.getAttribute('data-mode'),'dark');
});

test('blocked appearance storage restores controls and malformed preferences recover safely',()=>{
  const {app,root,el,failStorage}=boot(undefined,{preference:'{"mode":"invalid","tone":"__proto__"}'});
  assert.equal(root.getAttribute('data-tone'),'earth');assert.equal(root.getAttribute('data-mode'),'light');
  failStorage(true);app.setAppearance('mode','dark');
  assert.equal(root.getAttribute('data-mode'),'light');assert.equal(el('mode-light').checked,true);
  assert.match(el('appearance-status').textContent,/Could not save/);
  assert.equal(boot(undefined,{preference:'broken json'}).root.getAttribute('data-tone'),'earth');
});

test('each light and dark palette keeps text and action labels readable',()=>{
  const {app}=boot();
  function lum(hex){const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
  function contrast(a,b){const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
  for(const tone of ['earth','sand','ocean','plum','graphite'])for(const mode of ['light','dark']){
    const c=app.window.BudgetAppearance.colors(tone,mode);
    for(const bg of ['bg','card','card-2','well'])for(const fg of ['text','text-2','text-3','green','red','orange','blue','purple','teal','pink','indigo','mint','yellow']){
      assert(contrast(c[fg],c[bg])>=4.5,`${tone}/${mode}: ${fg} on ${bg} = ${contrast(c[fg],c[bg]).toFixed(2)}`);
    }
    assert(contrast(c.accent,c['accent-fg'])>=4.5,`${tone}/${mode} action label`);
  }
});
