import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const base = process.env.QA_URL ?? "http://localhost:8080";
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error("This journey creates disposable local records only.");
mkdirSync('/workspace/screenshots',{recursive:true});
const browser = await chromium.launch({...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}),args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-zygote"],headless:true});
const errors=[];const externalFailures=[];const pages=[];
const watch=p=>{pages.push(p);p.on('pageerror',e=>errors.push(e.message));p.on('console',e=>{
 if(e.type()!=='error')return;
 const error={message:e.text(),url:e.location().url};
 if(error.url === 'https://grok.com/grok-app-builder/extensions.js') externalFailures.push(error);
 else errors.push(error);
});return p;};
async function visible(p,name){await p.getByRole('heading',{name,exact:true}).waitFor({timeout:30000});}
async function screenshot(p,name){for(const [width,height,device] of [[1280,900,'desktop'],[390,844,'mobile']]){await p.setViewportSize({width,height});await p.screenshot({path:`/workspace/screenshots/${name}-${device}.png`,fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${device} overflows`);}await p.setViewportSize({width:1280,height:900});}
const owner=watch(await browser.newPage());
try {
 console.log('Owner account and setup');
 await owner.goto(base+'/login');await owner.getByRole('button',{name:'New owner? Create an account'}).click();
 await owner.getByLabel('Your name',{exact:true}).fill('QA Owner');await owner.getByLabel('Email',{exact:true}).fill(`qa-${Date.now()}@example.test`);await owner.getByLabel('Password',{exact:true}).fill('Local-only-test-Password!23');await owner.getByRole('button',{name:'Create owner account',exact:true}).click();
 await owner.waitForURL('**/setup',{timeout:30000});await owner.getByLabel('Business name',{exact:true}).fill('QA Takeaway');await owner.getByLabel('First branch',{exact:true}).fill('Johannesburg');
 for(const [role,pin] of [['Cashier','1234'],['Kitchen','2345'],['Manager','3456']])await owner.getByLabel(`${role} PIN`,{exact:true}).fill(pin);
 await owner.getByRole('button',{name:'Finish setup',exact:true}).click();await visible(owner,'Shop is ready. PINs are shown once.');await owner.getByRole('button',{name:'Owner dashboard',exact:true}).click();await visible(owner,'Business heartbeat');await screenshot(owner,'owner');
 console.log('Independent device pairing and staff PINs');
 const stations={};
 for(const [role,pin] of [['Manager','3456'],['Cashier','1234'],['Kitchen','2345']]){
  await owner.getByRole('button',{name:/^devices$/i}).click();await owner.getByRole('button',{name:role,exact:true}).click();await owner.getByText(`Pairing code ready for ${role}.`,{exact:true}).waitFor();
  const link=await owner.getByRole('link',{name:'Open invitation',exact:true}).getAttribute('href');const code=await owner.locator('p').filter({hasText:/^\d{6}$/}).innerText();
  const ctx=await browser.newContext();const p=watch(await ctx.newPage());await p.goto(base+link);await p.getByLabel('Device name',{exact:true}).fill(`QA ${role}`);await p.getByLabel('Pairing code',{exact:true}).fill(code);await p.getByRole('button',{name:'Pair device',exact:true}).click();await p.getByText(`This device is now a ${role} station. Sign in with that role's PIN.`,{exact:true}).waitFor();
  const options=await p.getByRole('combobox').locator('option').allTextContents();assert.equal(options.length,1);assert(options[0].includes(role));await p.getByLabel('PIN',{exact:true}).fill(pin);await p.getByRole('button',{name:'Open my workspace',exact:true}).click();await p.waitForURL(`**/station/${role.toLowerCase()}`);await p.getByRole('button',{name:'Got it — start the shift',exact:true}).waitFor();if(await p.getByRole('button',{name:'Got it — start the shift',exact:true}).count())await p.getByRole('button',{name:'Got it — start the shift',exact:true}).click();stations[role]=p;
 }
 const m=stations.Manager,c=stations.Cashier,k=stations.Kitchen;
 console.log('Stock receipt and cash shift');
 await m.getByLabel('Opening float',{exact:true}).fill('500');await m.getByRole('button',{name:'Open shift',exact:true}).click();await m.getByLabel('Physical count',{exact:true}).waitFor();
 const option=await m.getByRole('combobox').locator('option').filter({hasText:'Vetkoek mince'}).getAttribute('value');await m.getByRole('combobox').selectOption(option);await m.getByLabel('Quantity',{exact:true}).fill('10');await m.getByRole('button',{name:'Receive',exact:true}).click();await m.getByRole('heading',{name:'Stock activity',exact:true}).waitFor();await m.getByText(/^Received · 10(?:\.000)?$/).waitFor();await screenshot(m,'manager');
 console.log('Cash sale and kitchen preparation');
 await c.getByLabel('Search menu',{exact:true}).fill('Vetkoek');await c.getByRole('button',{name:/Vetkoek mince/}).click();await c.getByRole('button',{name:'Send to kitchen',exact:true}).click();await c.getByPlaceholder('Cash tendered',{exact:true}).waitFor();await c.getByPlaceholder('Cash tendered',{exact:true}).fill('50');await c.getByRole('button',{name:'Cash',exact:true}).click();await c.getByText('1 paid ticket still in kitchen.',{exact:true}).waitFor();await screenshot(c,'cashier');
 await k.getByRole('button',{name:'Start cooking',exact:true}).waitFor();await screenshot(k,'kitchen');await k.getByRole('button',{name:'Start cooking',exact:true}).click();await k.getByRole('button',{name:'Mark ready for counter',exact:true}).click();
 await c.getByRole('button',{name:'Hand over',exact:true}).click();await c.getByText('COLLECTED',{exact:true}).waitFor();await c.getByRole('button',{name:'Receipt',exact:true}).click();await c.getByText(/Change: R\s*22[.,]00/).waitFor();await screenshot(c,'receipt');
 console.log('Physical cash-up and owner reporting');
 await m.getByLabel('Physical count',{exact:true}).fill('528');await m.getByRole('button',{name:'Close shift',exact:true}).click();await m.getByRole('button',{name:'Open shift',exact:true}).waitFor();await owner.getByRole('button',{name:/^reports$/i}).click();await visible(owner,'Sales and operations');await owner.getByText(/^R\s*28[.,]00$/).first().waitFor();await screenshot(owner,'reports');
 await c.reload();await visible(c,'Sell, take payment, hand over');await c.getByText('COLLECTED',{exact:true}).waitFor();
 await owner.getByRole('button',{name:/^devices$/i}).click();const device=owner.locator('div.rounded-lg').filter({has:owner.getByText('QA Kitchen',{exact:true})}).first();await device.getByRole('button',{name:'Revoke',exact:true}).click();await k.getByText('This device is no longer paired. Ask the owner for a new invitation.',{exact:true}).waitFor();
 assert.deepEqual(errors,[],'Application browser errors');console.log(JSON.stringify({ok:true,journey:'owner setup → independent devices → stock → cash → kitchen → collection → receipt → cash-up → reports',viewports:['1280×900','390×844'],consoleErrors:errors,externalResourceFailures:externalFailures}));
} catch(e){console.error('QA FAILURE',e);for(let i=0;i<pages.length;i++){console.error('PAGE',i,pages[i].url(),(await pages[i].locator('body').innerText()).slice(0,2500));await pages[i].screenshot({path:`/workspace/screenshots/failure-${i}.png`,fullPage:true});}console.error('Console errors',errors);process.exitCode=1;}finally{await browser.close();}
