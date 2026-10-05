/** Renderer/API-contract QA only. All auth, data and native bridge responses are fixtures.
 * Does not claim real Supabase authentication, PIN entry, device pairing or LAN delivery.
 * Never sends customer records or fixture credentials to the live backend.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const base=process.env.QA_URL??'http://localhost:8082';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Renderer QA is local only.');
const origin=process.env.QA_RENDER_ORIGIN??base;
const directory=process.env.QA_SCREENSHOT_DIR??'/workspace/screenshots/supabase-correction';
mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote'],headless:true});
const ownerId='10000000-0000-4000-8000-000000000001',businessId='10000000-0000-4000-8000-000000000002',branchId='10000000-0000-4000-8000-000000000003';
const productId='10000000-0000-4000-8000-000000000004';
const now=new Date().toISOString();
const business={id:businessId,name:'Renderer QA Takeaway',owner_id:ownerId,onboarding_status:'COMPLETED'};
const staff=[{id:'10000000-0000-4000-8000-000000000005',branch_id:branchId,name:'Thandi',role:'CASHIER',status:'ACTIVE'},{id:'10000000-0000-4000-8000-000000000006',branch_id:branchId,name:'Sipho',role:'KITCHEN_STAFF',status:'ACTIVE'},{id:'10000000-0000-4000-8000-000000000007',branch_id:branchId,name:'Lebo',role:'MANAGER',status:'ACTIVE'}];
const product={id:productId,business_id:businessId,branch_id:branchId,name:'Vetkoek mince',category:'Bakes',price:28,stock_quantity:9,unit_of_measure:'Each',status:'ACTIVE'};
const order={id:'10000000-0000-4000-8000-000000000008',business_id:businessId,branch_id:branchId,total_amount:28,status:'COLLECTED',payment_status:'CAPTURED',created_at:now,cashier_name:'Thandi'};
const user={id:ownerId,aud:'authenticated',role:'authenticated',email:'owner@example.test',email_confirmed_at:now,created_at:now,app_metadata:{provider:'email',providers:['email']},user_metadata:{}};
const jwt=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:ownerId,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'renderer-fixture'].join('.');
const errors=[];const pages=[];
async function context(nativeRole){
 const ctx=await browser.newContext();
 if(origin!==base)await ctx.route(origin+'/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:base+url.pathname+url.search});await route.fulfill({response});});
 await ctx.route('**/*.supabase.co/**',async route=>{
  const url=new URL(route.request().url());const path=url.pathname;let payload;
  if(path==='/auth/v1/token')payload={access_token:jwt,refresh_token:'renderer-fixture',token_type:'bearer',expires_in:3600,user};
  else if(path==='/auth/v1/user')payload=user;
  else if(path==='/auth/v1/logout')payload={};
  else if(path==='/functions/v1/hub-owner-enrollment')payload={ok:true,terminals:[]};
  else if(path.startsWith('/rest/v1/')){
   const table=path.split('/').pop();
   const data={businesses:[business],business_memberships:[{business_id:businessId,role:'OWNER',businesses:business}],branches:[{id:branchId,name:'Cresta',location:'Johannesburg',is_active:true}],staff_members:staff,catalog_products:[product],orders:[order,{...order,id:'10000000-0000-4000-8000-000000000009',payment_status:'PENDING',total_amount:80}],devices:[{id:'cloud-device',status:'ACTIVE'}]}[table];
   assert(data,`Unexpected table ${table}`);
   payload=route.request().headers().accept?.includes('vnd.pgrst.object')?data[0]:data;
  } else throw new Error('Unexpected fixture request '+path);
  await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(payload)});
 });
 if(nativeRole)await ctx.addInitScript(({role,productId})=>{
  const snapshot={devices:[],outbox:[],inbox:[],failures:[],transportMetrics:[],networkHealth:{mode:'LOCAL_HUB_PRIMARY',availability:'READY',localPeerCount:2,packetLossRate:0,latencyMs:12,outboxDepth:0,inboxDepth:0,lastSyncTimestamp:new Date().toISOString(),cloudConnected:true,cloudStatus:'CONNECTED',activeTransport:'LAN_WIFI',message:'Renderer fixture only'}};
  const operator={staffName:role==='CASHIER'?'Thandi':role==='MANAGER'?'Lebo':'Sipho',role,vat:{enabled:false,rate:15},catalogProducts:[{id:productId,name:'Vetkoek mince',category:'Bakes',price:28,stockQuantity:9,unit:'Each',status:'ACTIVE'}],inventoryProducts:[{id:productId,name:'Vetkoek mince',stockQuantity:9,unit:'Each',status:'ACTIVE'}],activeCashShift:role==='KITCHEN_STAFF'?null:{id:'fixture-shift',status:'OPEN',openingFloat:500,cashSalesTotal:28,cashTenderedTotal:50,cashChangeTotal:22,expectedCash:528},pendingCashOrders:[],readyForCollectionOrders:[],cancellableOrders:[],pendingKitchenOrders:role==='KITCHEN_STAFF'?[{id:'10000000-0000-4000-8000-000000000008',status:'PLACED',items:[{productId,name:'Vetkoek mince',quantity:1}]}]:[],recoverableNativeCommands:[]};
  window.__rendererContext=operator;
  const plugin={getSnapshot:async()=>snapshot,refresh:async()=>snapshot,discoverDevices:async()=>[],registerDevice:async()=>{throw new Error('Renderer only');},revokeDevice:async()=>{throw new Error('Renderer only');},getNativeOperatorContext:async()=>structuredClone(window.__rendererContext),openNativeStaffSignIn:async()=>({opened:true}),endNativeStaffSession:async()=>({ended:true}),addListener:async()=>({remove:async()=>{}})};
  window.Capacitor={Plugins:{ThePlugOSLocalHub:plugin}};
 },{role:nativeRole,productId});
 const page=await ctx.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});return page;
}
async function shot(page,name){for(const [width,height,kind]of[[1280,900,'desktop'],[390,844,'mobile']]){await page.setViewportSize({width,height});await page.screenshot({path:`${directory}/${name}-${kind}.png`,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');}await page.setViewportSize({width:1280,height:900});}
try{
 const owner=await context();await owner.goto(origin);await owner.getByRole('button',{name:'Open ThePlugOS',exact:true}).click();await owner.getByLabel('Email address',{exact:true}).fill('owner@example.test');await owner.getByLabel('Password',{exact:true}).fill('renderer-only-credential');
 const panel=owner.getByRole('dialog');await panel.getByRole('button',{name:'Sign In',exact:true}).last().click();await owner.getByRole('heading',{name:'Business heartbeat',exact:true}).waitFor();await owner.getByRole('heading',{name:'Recent orders',exact:true}).waitFor();await owner.getByText('Registered devices',{exact:true}).waitFor();await shot(owner,'owner');
 await owner.getByRole('button',{name:'Menu & stock',exact:true}).click();await owner.getByLabel('Search menu and stock').fill('Vetkoek');await owner.getByText('Vetkoek mince',{exact:true}).waitFor();await shot(owner,'menu');
 await owner.getByRole('button',{name:'Reports',exact:true}).click();await owner.getByRole('heading',{name:'Branch sales',exact:true}).waitFor();await shot(owner,'reports');
 for(const [role,title,name]of[['CASHIER','Sell, take payment, hand over','cashier'],['KITCHEN_STAFF','Cook the queue','kitchen'],['MANAGER','Run the shift','manager']]){
  const page=await context(role);await page.goto(origin);await page.getByRole('heading',{name:title,exact:true}).waitFor();await shot(page,name);
  if(role==='KITCHEN_STAFF'){
   assert(!(await page.locator('body').innerText()).includes('R28'),'Kitchen price leak');
   await page.evaluate(()=>{window.__rendererContext.pendingKitchenOrders.push({id:'10000000-0000-4000-8000-000000000010',status:'PLACED',items:[{productId:'10000000-0000-4000-8000-000000000004',name:'Remote renderer refresh',quantity:1}]});});
   await page.getByText('Remote renderer refresh',{exact:true}).waitFor({timeout:10000});
  }
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,scope:'renderer and API-contract fixtures only; independent browser contexts; no real Supabase/PIN/pairing/LAN acceptance',errors}));
}catch(e){console.error(e);for(let i=0;i<pages.length;i++){console.error('PAGE',i,(await pages[i].locator('body').innerText()).slice(0,1200));await pages[i].screenshot({path:`${directory}/failure-${i}.png`,fullPage:true});}process.exitCode=1;}finally{await browser.close();}
