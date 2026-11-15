const { chromium } = require('playwright');
const { open, seed } = require('./common.js');
const SS='/tmp/claude-0/-home-claude/93b4964b-ff0e-5ff9-a823-b6f0e214d5cf/scratchpad/t/';
const R={};
const head=page=>page.evaluate(()=>({eyebrow:document.getElementById('eyebrow').textContent,h1:document.getElementById('h1').textContent}));
const zc=page=>page.locator('#map g.zone').count();
const sessN=page=>page.evaluate(()=>document.getElementById('tab-session').textContent);
(async()=>{
 const b=await chromium.launch();
 let o=await open(b,{seed}); let page=o.page;
 // edit -> dirty -> Save as new gym (fork)
 await page.click('#mEdit'); await page.click('[data-act="addZone"]'); await page.waitForTimeout(80);
 await page.click('[data-act="gymFork"]'); await page.waitForTimeout(80);
 R.forkTab=await page.$eval('#ng-start',e=>e.value);
 await page.fill('#ng-name','Anytime Fitness'); await page.fill('#ng-branch','Edenvale'); await page.click('[data-act="gymAdd"]'); await page.waitForTimeout(200);
 R.fork={head:await head(page),zones:await zc(page),stat:await page.$eval('#gymBar .gstat',e=>e.textContent),sess:await sessN(page),gyms:await page.$$eval('#gymSelTop option',x=>x.map(o=>o.textContent+(o.selected?'*':'')))};
 // original gym should NOT contain the extra zone (still 14 saved)
 await page.click('#mPlan');
 await page.selectOption('#gymSelTop',{label:'Virgin Active Bedfordview'}); await page.waitForTimeout(150);
 R.origZones=await zc(page); R.origStat=await page.locator('#gymBar .gstat').count();
 // now edit (dirty) and try switching: ask Save&switch
 await page.click('#mEdit'); await page.click('[data-act="addZone"]'); await page.waitForTimeout(60);
 await page.selectOption('#gymSelTop',{label:'Anytime Fitness Edenvale'}); await page.waitForTimeout(120);
 R.ask=await page.$eval('#gymBar .gask p',e=>e.textContent);
 R.askButtons=await page.$$eval('#gymBar .gask button',x=>x.map(e=>e.textContent));
 await page.click('#gymBar [data-how="save"]'); await page.waitForTimeout(150);
 R.afterSaveSwitch={head:await head(page),zones:await zc(page),sess:await sessN(page)};
 await page.selectOption('#gymSelTop',{label:'Virgin Active Bedfordview'}); await page.waitForTimeout(150);
 R.origAfterSave=await zc(page);
 // dirty again then Discard & switch
 await page.click('[data-act="addZone"]'); await page.waitForTimeout(60);
 await page.selectOption('#gymSelTop',{label:'Anytime Fitness Edenvale'}); await page.waitForTimeout(100);
 await page.click('#gymBar [data-how="discard"]'); await page.waitForTimeout(150);
 await page.selectOption('#gymSelTop',{label:'Virgin Active Bedfordview'}); await page.waitForTimeout(150);
 R.origAfterDiscard=await zc(page);
 // run tab: start workout disables the gym select
 await page.click('#mPlan'); await page.click('#tab-run');
 await page.click('[data-act="runStart"]'); await page.waitForTimeout(150);
 R.runDisabled=await page.$eval('#gymSelRun',e=>e.disabled);
 await page.screenshot({path:SS+'v11-run.png'});
 await page.evaluate(()=>0);
 // example-start gym keeps same ids -> session items kept
 await page.click('[data-act="runConfirm"][data-k="end"]').catch(()=>{}); await page.click('[data-act="runConfirm"][data-k="end"]').catch(()=>{});
 await page.waitForTimeout(150);
 R.runStatusAfter=await page.evaluate(()=>document.querySelector('#hud')?.hidden);
 await page.click('#tab-gyms'); await page.selectOption('#ng-start','example'); await page.fill('#ng-name','Virgin Active'); await page.fill('#ng-branch','Rosebank'); await page.click('[data-act="gymAdd"]'); await page.waitForTimeout(200);
 R.example={head:await head(page),zones:await zc(page),sess:await sessN(page),askShown:await page.locator('#gymBar .gask').count()};
 // Client programme assigned at example gym; open at blank-ish gym 'Anytime' -> remapped by name
 await page.click('#tab-session');
 // link carries gym
 await page.click('#mClient'); await page.waitForTimeout(350);
 const link=await page.inputValue('#cvLinkTxt'); const hash=link.slice(link.indexOf('#'));
 R.pdfModel=await page.evaluate(()=>0);
 await page.waitForTimeout(900);
 const store=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__store)));
 R.errs1=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await o.ctx.close();
 o=await open(b,{hash}); page=o.page;
 R.locked=await head(page); R.lockedZones=await zc(page);
 R.errs2=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await o.ctx.close();
 // reload full store, open fork gym, confirm persisted zones
 o=await open(b,{seed:store}); page=o.page;
 R.reload={head:await head(page),gyms:await page.$$eval('#gymSelTop option',x=>x.map(o=>o.textContent+(o.selected?'*':'')))};
 await page.selectOption('#gymSelTop',{label:'Anytime Fitness Edenvale'}); await page.waitForTimeout(150);
 const g=await page.locator('#gymBar .gask').count();
 if(g) await page.click('#gymBar [data-act="gymGo"]');
 await page.waitForTimeout(150);
 R.reloadFork={zones:await zc(page),stat:await page.locator('#gymBar .gstat.dirty').count()};
 // PDF with gym line
 await page.click('#tab-session'); await page.click('#btnPdf').catch(()=>{}); await page.waitForTimeout(250);
 R.errs3=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 // JSON tab has gym
 await page.click('#tab-data'); R.json=(await page.inputValue('#json')).slice(0,400).replace(/\s+/g,' ');
 // legacy: no gyms doc, customized draft layout => migrates clean (not dirty)
 await o.ctx.close();
 const legacy={'planner/layout':store['planner/layout']};
 o=await open(b,{seed:legacy}); page=o.page; await page.click('#mEdit');
 R.legacy={stat:await page.$eval('#gymBar .gstat',e=>e.textContent),opts:await page.$$eval('#gymSelTop option',x=>x.length)};
 R.errs4=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await b.close();
 console.log(JSON.stringify(R,null,1));
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
