import { chromium } from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
for(const path of ['/','/marketplace','/login','/signup']) {
 const res=await page.goto('http://localhost:3107'+path,{waitUntil:'domcontentloaded',timeout:60000});
 if(path==='/login'||path==='/signup') await page.locator('.cl-card').waitFor({timeout:20000}).catch(()=>{});
 console.log(path,res?.status(),(await page.locator('body').innerText()).slice(0,1400));
}
await page.goto('http://localhost:3107');
await page.screenshot({path:'/private/tmp/shareference-desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'/private/tmp/shareference-mobile.png',fullPage:true});
console.log('mobile overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
console.log('page errors',errors);
await browser.close();
