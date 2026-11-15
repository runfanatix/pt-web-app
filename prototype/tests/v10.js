const { chromium } = require('playwright');
const { open, seed } = require('./common.js');
const SS='/tmp/claude-0/-home-claude/93b4964b-ff0e-5ff9-a823-b6f0e214d5cf/scratchpad/t/';
const R={};
const sp=(page,x,y)=>page.evaluate(([x,y])=>{const s=document.getElementById('map');const p=s.createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform(s.getScreenCTM());return {x:q.x,y:q.y}},[x,y]);
async function drag(page,from,to){ const a=await sp(page,...from), b=await sp(page,...to); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:8}); await page.mouse.up(); await page.waitForTimeout(80); }
const zinfo=(page,id)=>page.evaluate(id=>{const g=document.querySelector('#map g.zone[data-zone="'+id+'"]');if(!g)return null;const r=g.querySelector('rect:not(.partline)'),p=g.querySelector('path.zp');return {rect:r?[+r.getAttribute('x'),+r.getAttribute('y'),+r.getAttribute('width'),+r.getAttribute('height')]:null,d:p?p.getAttribute('d'):null,label:g.querySelector('.zl').textContent,count:g.querySelector('.zc')?.textContent||'',lx:+g.querySelector('.zl').getAttribute('x'),ly:+g.querySelector('.zl').getAttribute('y')}},id);
const zcount=page=>page.locator('#map g.zone').count();
const pts=d=>d?(d.match(/[ML]/g)||[]).length:0;
(async()=>{
 const b=await chromium.launch();
 let o=await open(b,{seed}); let page=o.page;
 await page.click('#mEdit');
 R.zonesStart=await zcount(page);
 await drag(page,[150,120],[150,120]); // select cardio
 R.cardioCard=await page.$eval('#panelBody',e=>e.textContent.replace(/\s+/g,' ').slice(0,60));
 R.joinBtns=await page.$$eval('[data-act="joinZone"]',x=>x.map(c=>c.textContent.trim()));
 R.dupSection=await page.locator('[data-act="dupZone"]').count();
 // join strength (gap 10 closes)
 await page.click('[data-act="joinZone"][data-id="machines"]'); await page.waitForTimeout(100);
 R.afterJoin1={zones:await zcount(page),z:await zinfo(page,'cardio'),machinesGone:await zinfo(page,'machines')};
 R.chips=await page.$$eval('#panelBody [data-act="selPart"]',x=>x.map(c=>c.textContent+':'+c.getAttribute('aria-pressed')));
 R.hasPartlines=await page.locator('#map .partline').count();
 // join functional -> L shape
 R.joinBtns2=await page.$$eval('[data-act="joinZone"]',x=>x.map(c=>c.textContent.trim()));
 await page.click('[data-act="joinZone"][data-id="functional"]'); await page.waitForTimeout(100);
 R.afterJoin2={zones:await zcount(page),z:await zinfo(page,'cardio')};
 R.lShapePts=pts(R.afterJoin2.z.d);
 R.items=R.afterJoin2.z.count;
 await page.screenshot({path:SS+'v10-L.png'});
 // select part 3 chip and edit width
 await page.click('[data-act="selPart"][data-i="2"]');
 R.partHeading=await page.$eval('#panelBody h4',e=>e.textContent);
 await page.fill('#zn-w','200'); await page.press('#zn-w','Tab'); await page.waitForTimeout(80);
 R.afterWidth=await zinfo(page,'cardio'); R.widthPts=pts(R.afterWidth.d);
 // handle drag on selected part: east edge handle
 R.handles=await page.locator('#map g.hnd').count();
 // drag whole zone by body (on part 1 area) +100,+60
 const eqBefore=await page.getAttribute('#map g[data-eq="tread"]','transform');
 await drag(page,[100,100],[200,160]);
 const zmv=await zinfo(page,'cardio');
 R.moved={d:zmv.d,eqBefore,eqAfter:await page.getAttribute('#map g[data-eq="tread"]','transform')};
 // undo move by dragging back
 await drag(page,[200,160],[100,100]);
 R.backD=(await zinfo(page,'cardio')).d;
 // split part 3 off
 await page.click('[data-act="selPart"][data-i="2"]');
 await page.click('[data-act="splitPart"]'); await page.waitForTimeout(100);
 R.afterSplit={zones:await zcount(page),card:await page.$eval('#zf-name',e=>e.value),cardio:await zinfo(page,'cardio')};
 R.splitEqCounts=await page.$$eval('#map g.zone',g=>g.map(x=>x.querySelector('.zl').textContent+':'+(x.querySelector('.zc')?.textContent||'')).filter(t=>/CARDIO|SPLIT/.test(t)));
 // duplicate free weights to first floor with machines
 await drag(page,[400,300],[400,300]);
 R.freeCard=await page.$eval('#zf-name',e=>e.value);
 const exBefore=await page.evaluate(()=>0);
 await page.selectOption('#zd-floor','f2');
 await page.click('[data-act="dupZone"]'); await page.waitForTimeout(150);
 R.dupF2={floor:await page.$eval('.chip[aria-pressed="true"]',e=>e.textContent.trim()),zones:await zcount(page),eq:await page.locator('#map g[data-eq]').count(),name:await page.$eval('#zf-name',e=>e.value)};
 await page.screenshot({path:SS+'v10-dup.png'});
 // same floor duplicate, without machines
 await page.click('#floors [data-id="f1"]'); await drag(page,[400,300],[400,300]);
 await page.uncheck('#zd-eq');
 const zc0=await zcount(page);
 await page.click('[data-act="dupZone"]'); await page.waitForTimeout(100);
 R.dupSame={zones:await zcount(page)-zc0,name:await page.$eval('#zf-name',e=>e.value),x:await page.$eval('#zn-x',e=>e.value),y:await page.$eval('#zn-y',e=>e.value),items:await page.$$eval('#map g.zone.sel .zc',x=>x.length)};
 // exercise links for duplicated machines
 const links=await page.evaluate(()=>{const lay=window.__store['planner/layout'];return null});
 await page.waitForTimeout(900);
 const store=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__store)));
 const lay=store['planner/layout'];
 R.saved={zones:lay.zones.length,withParts:lay.zones.filter(z=>z.parts).map(z=>[z.id,z.parts.length]),eq:lay.equipment.length,custom:lay.equipment.filter(e=>/^custom-/.test(e.id)).length};
 const libDoc=Object.keys(store).filter(k=>/library|exercises/.test(k));
 R.libKeys=libDoc; R.libCustomLinks=(JSON.stringify(store['planner/library']).match(/custom-/g)||[]).length;
 R.errs1=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await o.ctx.close();
 // reload
 o=await open(b,{seed:store}); page=o.page;
 R.reload=await page.evaluate(()=>[...document.querySelectorAll('#map g.zone path.zp')].length);
 // pdf + client link carry joined shape
 await page.click('#btnPdf').catch(()=>{}); await page.waitForTimeout(250);
 R.pdfTexts=(await page.evaluate(()=>window.__pdf.texts)).filter(t=>/CARDIO|FUNCTIONAL/.test(t)).length;
 await page.click('#mClient'); await page.waitForTimeout(300);
 const link=await page.inputValue('#cvLinkTxt'); const hash=link.slice(link.indexOf('#'));
 R.errs2=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await o.ctx.close();
 o=await open(b,{hash}); page=o.page;
 R.locked={paths:await page.locator('#map g.zone path.zp').count(),zones:await zcount(page),d:(await zinfo(page,'cardio'))?.d};
 await page.screenshot({path:SS+'v10-locked.png'});
 R.errs3=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await o.ctx.close();
 // json import round trip of parts
 o=await open(b,{seed:{'planner/layout':{floors:[{id:'f1',name:'G',w:1000,h:620}],zones:[{id:'a',name:'A',cat:'strength',x:100,y:100,w:200,h:100,floor:'f1',parts:[{x:300,y:100,w:100,h:200},{x:'bad'}]}],structs:[],equipment:[{id:'q',name:'Q',zone:'a',type:'free',x:350,y:250,floor:'f1'}]}}}); page=o.page;
 R.imp=await zinfo(page,'a'); R.impPts=pts(R.imp.d);
 await page.click('#mEdit'); await drag(page,[350,250],[350,250]);
 R.partsClamp=await page.$$eval('#map g.zone .partline',x=>x.length);
 await page.click('#mPlan');
 await page.screenshot({path:SS+'v10-imp.png'});
 R.errs4=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await b.close();
 console.log(JSON.stringify(R,null,1));
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
