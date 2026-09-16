import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/jayma/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const fixture=JSON.parse(readFileSync(new URL('../fixtures/tactical-bahrain-geography.json',import.meta.url))),{session,data}=fixture
const payload={
  location:data.drivers.flatMap(d=>d.fixes.map(f=>({driver_number:d.id,session_key:session.session_key,date:new Date(f.t).toISOString(),x:f.x,y:f.y,z:f.z}))),
  car_data:data.drivers.flatMap(d=>d.car.map(f=>({driver_number:d.id,session_key:session.session_key,date:new Date(f.t).toISOString(),speed:f.speed,throttle:f.throttle,brake:f.brake}))),
  drivers:data.drivers.map(d=>({driver_number:d.id,full_name:d.name,name_acronym:d.acronym})),intervals:[],
}
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],violations=[],missing=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error')console.log('BROWSER:',m.text().slice(0,300))})
  page.on('response',r=>{if(r.url().includes('/cesium/') && r.status()>=400)missing.push(r.url())})
  await page.exposeFunction('reportCsp',text=>violations.push(text))
  await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.reportCsp(e.violatedDirective+': '+e.blockedURI)))
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'Backend waking'}))
  await page.route('https://api.openf1.org/v1/**',route=>{const u=new URL(route.request().url()),end=u.pathname.split('/').at(-1);return route.fulfill({json:end==='sessions'?[{...session,year:Number(u.searchParams.get('year'))}]:payload[end]??[]})})
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.2:3002'}/tactical`)
  await page.getByRole('combobox',{name:'Race / session'}).locator(`option[value="${session.session_key}"]`).waitFor({state:'attached'})
  await page.getByRole('button',{name:'Load race',exact:true}).click()
  await page.getByRole('button',{name:'Satellite + terrain',exact:true}).waitFor()
  await page.getByRole('button',{name:'Satellite + terrain',exact:true}).click({timeout:25000})
  const map=page.locator('[data-renderer-ready="true"]')
  try { await map.waitFor({timeout:45000}) } catch(error) { console.log((await page.locator('body').innerText()).slice(-9000)); console.log({errors,violations,missing}); throw error }
  await page.locator('[data-alignment="accepted"]').waitFor({timeout:30000})
  await page.getByText('Elevation tiles active',{exact:false}).waitFor({timeout:45000})
  await page.waitForFunction(()=>Number(document.querySelector('[data-driver-count]')?.getAttribute('data-driver-count'))>10)
  await page.evaluate(()=>{const old=window.Cesium.CesiumWidget.prototype.render;window.Cesium.CesiumWidget.prototype.render=function(...args){window.__widget=this;return old.apply(this,args)}})
  await page.waitForFunction(()=>window.__widget?.scene.globe.tilesLoaded,{},{timeout:45000})
  await page.waitForFunction(()=>window.__widget?.scene.globe._surface._tilesToRender.some(t=>t.data.imagery.some(i=>i.readyImagery?.level>=12)),{},{timeout:45000})
  await page.screenshot({path:'tactical-geographic-overview.png',fullPage:true})
  await page.getByRole('button',{name:/Max Verstappen/i}).click()
  await page.getByRole('button',{name:'Chase',exact:true}).click()
  assert.equal(await map.getAttribute('data-camera-mode'),'chase')
  await page.waitForFunction(()=>window.__widget?.scene.globe.tilesLoaded && window.__widget.scene.globe._surface._tilesToRender.length>0,{},{timeout:45000})
  await page.waitForTimeout(2500)
  await page.screenshot({path:'tactical-geographic-verified.png',fullPage:true})
  await page.getByRole('button',{name:'Local track',exact:true}).click()
  assert.equal(await page.locator('.cesium-widget').count(),0,'Cesium destroyed on mode switch')
  await page.route('https://s3.amazonaws.com/**',route=>route.fulfill({status:503,body:'Tile outage'}))
  await page.getByRole('button',{name:'Satellite + terrain',exact:true}).click()
  await page.getByText('Elevation unavailable · flat satellite globe',{exact:false}).waitFor({timeout:45000})
  await page.setViewportSize({width:375,height:900})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow')
  await page.getByRole('button',{name:'Local track',exact:true}).click()
  assert.deepEqual(errors,[])
  assert.deepEqual(missing,[])
  assert.deepEqual(violations,[])
  console.log('PASS real Bahrain geometry, Cesium workers, real satellite/DEM tiles, driver overlays, chase, teardown, terrain outage fallback, CSP and mobile width')
} finally {await browser.close()}
