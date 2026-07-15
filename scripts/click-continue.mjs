import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
const page = pages.find(p => p.url().includes('auth.openai.com/sign-in-with-chatgpt'));

if (page) {
    // Click Continue
    const btn = await page.$('button[type="submit"]');
    if (btn) {
        await btn.click();
        console.log('Clicked Continue');
        await new Promise(r => setTimeout(r, 3000));
    }
    
    console.log('URL:', page.url());
    const text = await page.evaluate(() => document.body.innerText);
    console.log('Page text:', text.substring(0, 2000));
}

await browser.disconnect();