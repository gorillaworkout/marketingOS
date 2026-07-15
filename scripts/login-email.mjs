import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
let page = pages.find(p => p.url().includes('auth.openai'));
if (!page) page = await browser.newPage();

// Go to login page
await page.goto('https://auth.openai.com/log-in', {timeout: 10000}).catch(() => {});
await new Promise(r => setTimeout(r, 2000));

// Type email
const emailInput = await page.$('input[type="email"]');
if (emailInput) {
    await emailInput.type('darmawanbayu1@gmail.com', {delay: 30});
    console.log('Email typed');
    await new Promise(r => setTimeout(r, 500));
    
    // Click Continue
    const btns = await page.$$('button');
    for (const btn of btns) {
        const txt = await btn.evaluate(el => el.textContent.trim().toLowerCase());
        if (txt.includes('continue')) {
            await btn.click();
            console.log('Clicked continue');
            break;
        }
    }
    await new Promise(r => setTimeout(r, 4000));
    console.log('URL:', page.url());
    const text = await page.evaluate(() => document.body.innerText);
    console.log('After email:', text.substring(0, 1000));
}

await browser.disconnect();