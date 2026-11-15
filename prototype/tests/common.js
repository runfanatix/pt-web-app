const { chromium } = require('playwright'); const fs=require('fs');
const P='/tmp/claude-0/-home-claude/93b4964b-ff0e-5ff9-a823-b6f0e214d5cf/scratchpad/bedfordview-zone-planner.html';
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>[hidden]{display:none!important}body{margin:0;font:14px system-ui}</style></head><body>'+fs.readFileSync(P,'utf8')+'</body></html>';
const mockPdf=`window.__pdf={texts:[]};window.jspdf={jsPDF:function(){const d=this;window.__pdf.texts=[];const n=()=>d;['setTextColor','setDrawColor','setFillColor','setFont','setFontSize','rect','circle','line','setLineWidth','setLineDashPattern','textWithLink','setPage','addPage'].forEach(k=>d[k]=n);d.text=(t)=>{window.__pdf.texts.push(String(t));return d};d.splitTextToSize=(t,w)=>[String(t)];d.getNumberOfPages=()=>1;d.output=()=>new Blob(['%PDF'],{type:'application/pdf'});}};`;
const it=(eid,ex,sets,reps,rest,note)=>({eid,xid:null,exercise:ex,sets,reps,rest,note:note||''});
const seed={
 'clients/c-thabo':{id:'c-thabo',name:'Thabo Mokoena',whatsapp:'082 123 4567',email:'thabo@example.com',subStatus:'active',goals:'Lose 6 kg',notes:'PRIVATE back niggle',programmes:[
   {id:'p-a',title:'Thabo: Push day',notes:'Warm up first.',assignedAt:2000,items:[it('chestpress','Seated chest press',3,'10',60),it('db','Dumbbell shoulder press',3,'12',60),it('mats','Plank hold',3,'30 s',30)]},
   {id:'p-b',title:'Thabo: Legs and cardio',notes:'',assignedAt:1000,items:[it('tread','Incline walk',1,'8 min',0),it('legpress','Leg press',4,'8-10',90),it('xtrain','Easy spin',1,'5 min',0)]}]},
 'clients/c-lerato':{id:'c-lerato',name:'Lerato Dlamini',whatsapp:'071 987 6543',email:'',subStatus:'trial',programmes:[
   {id:'p-c',title:'Lerato: Starter circuit',notes:'Take it easy.',assignedAt:3000,items:[it('seatedrow','Seated row',2,'12',45),it('mats','Dead bug',2,'10 each side',30)]}]},
 'clients/c-new':{id:'c-new',name:'Sam Newbie',whatsapp:'',email:'',subStatus:'active',programmes:[]},
 'templates/t-1':{id:'t-1',name:'Beginner full body',notes:'',created:1,items:[it('legpress','Leg press',3,'10',60),it('chestpress','Seated chest press',3,'10',60)]}
};
async function open(b, o){
  o=o||{};
  const ctx=await b.newContext({viewport:o.vp||{width:1280,height:900}});
  await ctx.addInitScript(({seed,noDb})=>{ const store=seed||{}; window.__store=store; window.__saves=[]; window.__writes=0;
    window.claude={use:async n=>{
      if(n==='db'){ if(noDb) return null; return {doc:p=>({get:async()=>({exists:p in store,data:()=>store[p]}),set:async v=>{window.__writes++;store[p]=JSON.parse(JSON.stringify(v))},delete:async()=>{window.__writes++;delete store[p]}}),
        collection:c=>({get:async()=>({docs:Object.keys(store).filter(k=>k.startsWith(c+'/')).map(k=>({id:k.slice(c.length+1),data:()=>store[k]}))})})};}
      if(n==='downloads') return {save:async r=>{window.__saves.push(r.filename);return {status:'saved'}}};
      return null;}};
  },{seed:JSON.parse(JSON.stringify(o.seed||{})),noDb:!!o.noDb});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
  await page.route('**/*',r=>{const u=r.request().url(); if(u.includes('jspdf')) return r.fulfill({contentType:'application/javascript',body:mockPdf}); if(u.startsWith('http://test.local')) return r.fulfill({contentType:'text/html',body:html}); return u.startsWith('http')?r.abort():r.continue();});
  await page.goto('http://test.local/'+(o.hash||''));
  await page.waitForTimeout(500);
  return {page,errs,ctx};
}

module.exports={open,seed,html,mockPdf};
