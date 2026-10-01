// Local-only browser fixture: never load production config or contact Supabase.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname,'..');
const output = fs.mkdtempSync(path.join(os.tmpdir(),'zhuyin-ui-'));
const mockConfig = `
window.fixtureWrites=[]; window.fixtureFailed=false;
const stamp = new Date(); stamp.setDate(stamp.getDate()-21);
const fixtureRow = key=>({character:key,attempt_count:2,best_reward:2,perfect_count:0,last_reward:2,updated_at:stamp.toISOString()});
const fixtureRows=['大','ㄅ','大人','A','p2_小'].map(fixtureRow);
const sb={from(table){let operation='select',payload;
 const query={select(){return query},eq(){return query},insert(value){operation='insert';payload=value;return query},upsert(value){operation='upsert';payload=value;return query},update(value){operation='update';payload=value;return query},
 maybeSingle(){return Promise.resolve({data:{id:1,coins:8}})},
 then(resolve,reject){if(operation!=='select'){window.fixtureWrites.push({table,operation,payload});const items=Array.isArray(payload)?payload:[payload];items.forEach(item=>{if(!item.character)return;const index=fixtureRows.findIndex(row=>row.character===item.character);if(index<0)fixtureRows.push(item);else fixtureRows[index]=item;});}
 return Promise.resolve({data:operation==='select'?fixtureRows:null,error:window.fixtureFailed?{message:'fixture offline'}:null}).then(resolve,reject)}};return query}};
`;
const server = http.createServer((req,res)=>{
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/config.js') {res.setHeader('Content-Type','application/javascript');res.end(mockConfig);return;}
  const file = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  if(!mime[path.extname(file)] || !fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(file)]);res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({viewport:{width:820,height:1180},deviceScaleFactor:1});
  const errors=[];
  let blockedDatabaseRequests=0;
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(url.startsWith(base)) return route.continue();
    if(/supabase/.test(url)) {if(!url.includes('supabase-js'))blockedDatabaseRequests++;return route.fulfill({contentType:'application/javascript',body:''});}
    if(url.startsWith('https://cdn.jsdelivr.net/npm/hanzi-writer'))return route.continue();
    if(url.startsWith('https://fonts.googleapis.com') || url.startsWith('https://fonts.gstatic.com'))return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(base);
    await page.waitForFunction(()=>!progressLoading);
    assert.match(await page.locator('#daily-review-summary').innerText(),/4 個/);
    assert.equal(await page.evaluate(()=>fixtureWrites.length),0,'opening the app must not write data');
    for(const [width,height] of [[320,568],[390,844],[820,1180],[1180,820]]){
      await page.setViewportSize({width,height});
      await page.screenshot({path:path.join(output,`home-${width}.png`),fullPage:true,animations:'disabled'});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`home overflow at ${width}`);
      await page.locator('#daily-open').click();
      await page.screenshot({path:path.join(output,`daily-${width}.png`),fullPage:true,animations:'disabled'});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`daily overflow at ${width}`);
      assert.equal(await page.locator('#daily-review-list button').count(),4);
      await page.locator('#daily-filters').getByRole('button',{name:'英文',exact:true}).click();
      assert.equal(await page.locator('#daily-review-list button').count(),1);
      assert.equal(await page.locator('#daily-filters button[aria-pressed="true"]').innerText(),'英文');
      await page.locator('#screen-daily .back-btn').click();
    }
    await page.locator('#daily-open').click();
    await page.locator('#daily-review-list').getByRole('button',{name:'練習國字 大',exact:true}).click();
    await page.waitForSelector('#intro-hanzi svg path',{state:'attached'});
    assert.equal(await page.locator('#intro-hanzi svg').isVisible(),true);
    assert.equal(await page.evaluate(()=>currentChar),'大');
    // Exercise existing completion handlers against the in-memory database fixture only.
    await page.evaluate(()=>{recordProgress('大',3);showResult(3);});
    assert.equal(await page.locator('#daily-continue').isVisible(),true);
    await page.locator('#daily-continue').click();
    assert.notEqual(await page.evaluate(()=>document.querySelector('.screen.active').id),'screen-result');
    await page.evaluate(()=>{recordProgress('大',3);recordProgress('ㄅ',3);recordProgress('大人',3);recordProgress('A',3);recordProgress('小',3);showResult(3);});
    assert.match(await page.locator('#daily-continue').innerText(),/成果/);
    await page.locator('#daily-continue').click();
    assert.equal(await page.locator('#daily-start').isDisabled(),true);
    assert.match(await page.locator('#daily-detail').innerText(),/已完成 5 個/);
    // Profile switch does not borrow another child's daily completion.
    await page.evaluate(()=>switchProfile(2));
    assert.match(await page.locator('#daily-summary').innerText(),/0 \/ 5/);
    assert.equal(await page.evaluate(()=>todayPracticePlan().due.length),1);
    await page.evaluate(()=>{fixtureFailed=true;return initFromSupabase();});
    await page.locator('#daily-open').click();
    assert.equal(await page.locator('#daily-retry').isVisible(),true);
    assert.equal(await page.locator('#daily-start').isDisabled(),true);
    await page.evaluate(()=>{fixtureFailed=false;});
    await page.locator('#daily-retry').click();
    await page.waitForFunction(()=>!progressLoading && !progressLoadFailed);
    assert.equal(await page.locator('#daily-retry').isVisible(),false);
    // All four direct-entry flows preserve the selected item; ordinary flows still work.
    for(const item of [{key:'ㄅ',type:'zhuyin'},{key:'大人',type:'word'},{key:'A',type:'letter'}]){
      await page.evaluate(item=>startPlannedPractice(item),item);
      const key=await page.evaluate(()=>({
        'screen-zhuyin-intro':zhuyinData[currentZhuyinIndex].symbol,
        'screen-word-intro':currentWord,
        'screen-letter-intro':currentLetter
      }[document.querySelector('.screen.active').id]));
      assert.equal(key,item.key);
    }
    await page.evaluate(()=>showScreen('screen-home'));
    await page.getByRole('button',{name:'遊戲時間 用金幣開啟冒險'}).click();
    assert.equal(await page.locator('#screen-arcade.active').count(),1);
    assert.match(await page.locator('#screen-arcade').innerText(),/釣魚/);
    assert.equal(blockedDatabaseRequests,0,'no production database requests attempted');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',screenshots:output,viewports:4,pageErrors:errors,productionDatabaseRequests:blockedDatabaseRequests,checks:['home and review layouts','due filters','real HanziWriter intro','completion and continuation','five-item goal','profile isolation','offline and retry','four learning entry points','fishing retained']},null,2));
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
