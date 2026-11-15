const { chromium } = require('playwright');
const { open, seed } = require('./common.js');
const R={};
const zc=page=>page.locator('#map g.zone').count();
(async()=>{
 const b=await chromium.launch();
 let o=await open(b,{seed}); let page=o.page;
 await page.click('#tab-data');
 const exp=JSON.parse(await page.inputValue('#json'));
 await o.ctx.close();
 const mk=(pre)=>{ const P=id=>pre+id;
   const eq=exp.equipment.map(e=>({id:P(e.id),name:e.name,zone:P(e.zone||''),type:e.type,x:e.x,y:e.y,muscles:e.muscles,notes:e.notes||'',floor:e.floor}));
   const zones=exp.zones.map(z=>Object.assign({},z,{id:P(z.id)}));
   const links={}; exp.exercises.forEach(x=>{ if(x.equipmentIds.length) links[x.id]=x.equipmentIds.map(P); });
   return {layout:{floors:exp.floors,zones,structs:exp.structs,equipment:eq},links}; };
 const main=mk(''), bb=mk('b-');
 const store={'planner/gyms':{activeId:'g-main',gyms:[{id:'g-main',name:'Gym A',branch:'One',address:'1 A St'},{id:'g-b',name:'Gym B',branch:'Two',address:'2 B St'}]},
   'planner/gym-g-main':main,'planner/gym-g-b':bb,
   'templates/t-1':{id:'t-1',name:'Beginner full body',notes:'',created:1,gymId:'g-main',items:[{eid:'legpress',xid:null,exercise:'Leg press',sets:3,reps:'10',rest:60,note:''},{eid:'chestpress',xid:null,exercise:'Seated chest press',sets:3,reps:'10',rest:60,note:''}]}};
 o=await open(b,{seed:store}); page=o.page;
 R.start={eyebrow:await page.$eval('#eyebrow',e=>e.textContent),zones:await zc(page),stat:await page.locator('#gymBar .gstat').count()};
 await page.selectOption('#gymSelTop',{label:'Gym B Two'}); await page.waitForTimeout(200);
 R.ask=await page.locator('#gymBar .gask').count();
 R.afterSwitch={eyebrow:await page.$eval('#eyebrow',e=>e.textContent),sess:await page.$eval('#tab-session',e=>e.textContent),toast:await page.$eval('#toast',e=>e.textContent)};
 await page.click('#tab-session');
 R.items=await page.$$eval('#panelBody .sitem .shead',x=>x.length);
 R.markers=await page.$$eval('#map g[data-eq]',g=>g.map(x=>x.getAttribute('data-eq')).slice(0,3));
 R.badges=await page.$$eval('#map g.sidx, #map .snum',x=>x.length);
 // links: exercises linked to machines in gym B
 await page.click('#map g[data-eq="b-tread"]'); await page.waitForTimeout(100);
 R.popLinks=await page.$$eval('#pop li, #pop .opt',x=>x.length);
 await page.keyboard.press('Escape');
 // template made at gym A loads here via name remap
 await page.click('#tab-library'); await page.click('[data-act="libView"][data-v="tpl"]'); await page.click('[data-act="tplLoad"]'); await page.waitForTimeout(150);
 R.tplToast=await page.$eval('#toast',e=>e.textContent);
 R.tplItems=await page.evaluate(()=>document.getElementById('tab-session').textContent);
 // history records gym
 R.errs=o.errs.filter(e=>!/ERR_FAILED/.test(e));
 await b.close();
 console.log(JSON.stringify(R,null,1));
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
