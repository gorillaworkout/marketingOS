import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
let page = pages.find(p => p.url().includes('openai'));
if (!page) page = await browser.newPage();

await page.goto('https://auth.openai.com/codex/device', {waitUntil: 'networkidle2'});
await new Promise(r => setTimeout(r, 2000));

// Click "Continue with Google"
const buttons = await page.$$('button');
for (const btn of buttons) {
    const text = await btn.evaluate(el => el.textContent.trim());
    if (text.includes('Google')) {
        console.log('Clicking Google login');
        await btn.click();
        break;
    }
}

await new Promise(r => setTimeout(r, 3000));
console.log('URL after click:', page.url());

const text = await page.evaluate(() => document.body.innerText);
console.log('Page text:', text.substring(0, 1500));

await browser.disconnect();