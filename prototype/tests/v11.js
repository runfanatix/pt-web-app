const { chromium } = require('playwright');
const { open, seed } = require('./common.js');
const SS='/tmp/claude-0/-home-claude/93b4964b-ff0e-5ff9-a823-b6f0e214d5cf/scratchpad/t/';
const R={};
const sp=(page,x,y)=>page.evaluate(([x,y])=>{const s=document.getElementById('map');const p=s.createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform(s.getScreenCTM());return {x:q.x,y:q.y}},[x,y]);
async function drag(page,from,to){ const a=await sp(page,...from), b=await sp(page,...to); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:8}); await page.mouse.up(); await page.waitForTimeout(80); }
const head=page=>page.evaluate(()=>({eyebrow:document.getElementById('eyebrow').textContent,h1:document.getElementById('h1').textContent,notice:!document.getElementById('notice').hidden}));
const sess=page=>page.evaluate(()=>[...document.querySelectorAll('#panelBody .sitem')].length);
const opts=(page,id)=>page.$$eval('#'+id+' option',x=>x.map(o=>o.textContent+(o.selected?'*':'')));
(async()=>{
 const b=await chromium.launch();
 let o=await open(b,{seed}); let page=o.page;
 R.head0=await head(page);
 R.gymOpts=await opts(page,'gymSelTop');
 R.gymbarEditHidden=await page.locator('#gymBar .gstat').count(); // plan mode, clean => none
 await page.click('#mEdit');
 R.editStat=await page.$eval('#gymBar .gstat',e=>e.textContent); R.saveDisabled=await page.$eval('[data-act="gymSave"]',e=>e.disabled);
 // edit layout -> dirty
 await drag(page,[150,120],[150,120]); await page.click('[data-act="addZone"]'); await page.waitForTimeout(100);
 R.dirtyStat=await page.$eval('#gymBar .gstat',e=>e.textContent); R.saveEnabled=!(await page.$eval('[data-act="gymSave"]',e=>e.disabled));
 await page.click('[data-act="gymSave"]'); await page.waitForTimeout(100);
 R.afterSave=await page.$eval('#gymBar .gstat',e=>e.textContent);
 // add another zone then discard (two-step)
 await page.click('[data-act="addZone"]'); await page.waitForTimeout(60);
 const zN=await page.locator('#map g.zone').count();
 await page.click('#gymBar [data-act="gymDiscard"]'); R.discardLabel=await page.$eval('#gymBar [data-act="gymDiscard"]',e=>e.textContent);
 await page.click('#gymBar [data-act="gymDiscard"]'); await page.waitForTimeout(100);
 R.discard={before:zN,after:await page.locator('#map g.zone').count(),stat:await page.$eval('#gymBar .gstat',e=>e.textContent)};
 // Gyms tab: add a blank gym
 await page.click('#tab-gyms'); R.gymsList=await page.$$eval('#panelBody ul.gyms li .txt > span:first-child',x=>x.map(e=>e.textContent));
 await page.fill('#ng-name','Planet Fitness'); await page.fill('#ng-branch','Sandton City'); await page.fill('#ng-address','Rivonia Rd, Sandton');
 await page.click('[data-act="gymAdd"]'); await page.waitForTimeout(150);
 R.askBanner=await page.locator('#gymBar .gask').count();
 R.askText=await page.$eval('#gymBar .gask p',e=>e.textContent);
 await page.screenshot({path:SS+'v11-ask.png'});
 await page.click('#gymBar [data-act="gymGo"]'); await page.waitForTimeout(200);
 R.afterSwitch={head:await head(page),zones:await page.locator('#map g.zone').count(),sessionItems:await page.evaluate(()=>document.getElementById('tab-session').textContent),gym:await opts(page,'gymSelTop')};
 // blank gym: add zone, equipment, save
 await page.click('#mEdit'); await page.click('[data-act="addZone"]'); await page.waitForTimeout(100);
 R.blankDirty=await page.$eval('#gymBar .gstat',e=>e.textContent);
 await page.click('[data-act="gymSave"]'); await page.waitForTimeout(100);
 // blank gym run tab picker
 await page.click('#mPlan'); await page.click('#tab-run');
 R.runPicker=await opts(page,'gymSelRun');
 await page.click('#tab-session'); R.sessPicker=(await opts(page,'gymSelSess')).length;
 // switch back to Bedfordview via Run tab dropdown
 await page.click('#tab-run'); await page.selectOption('#gymSelRun',{label:'Virgin Active Bedfordview'}); await page.waitForTimeout(150);
 R.backHead=await head(page); R.backZones=await page.locator('#map g.zone').count();
 // session stayed empty (dropped earlier); build a session item then switch to Planet and check ask with drops
 await page.click('#map g[data-eq="tread"]'); await page.waitForTimeout(80);
 await page.click('#pop [data-act="addx"], #pop button.add').catch(()=>{});
 R.itemsBefore=await page.evaluate(()=>document.getElementById('tab-session').textContent);
 await page.waitForTimeout(900);
 const store=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__store)));
 R.keys=Object.keys(store).filter(k=>/planner/.test(k));
 R.gymsDoc=store['planner/gyms'];
 R.errs1=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await o.ctx.close();
 // reload keeps gyms and active gym
 o=await open(b,{seed:store}); page=o.page;
 R.reload={head:await head(page),gym:await opts(page,'gymSelTop'),zones:await page.locator('#map g.zone').count()};
 await page.click('#tab-gyms');
 await page.click('[data-act="gymOpen"]'); await page.waitForTimeout(150);
 R.reloadPlanet={head:await head(page),zones:await page.locator('#map g.zone').count(),stat:await page.locator('#gymBar .gstat').count()};
 // details edit
 await page.click('#tab-gyms'); await page.fill('#gm-address','1 New Rd'); await page.press('#gm-address','Tab'); await page.waitForTimeout(100);
 R.addrHead=(await head(page)).eyebrow;
 // duplicate and delete
 await page.click('[data-act="gymDup"]'); await page.waitForTimeout(80);
 R.afterDup=await page.$$eval('#panelBody ul.gyms li .txt > span:first-child',x=>x.map(e=>e.textContent));
 await page.click('[data-act="gymDel"]'); await page.click('[data-act="gymDel"]'); await page.waitForTimeout(100);
 R.afterDel=await page.$$eval('#panelBody ul.gyms li .txt > span:first-child',x=>x.map(e=>e.textContent));
 R.errs2=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await page.screenshot({path:SS+'v11-gyms.png'});
 await b.close();
 console.log(JSON.stringify(R,null,1));
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
