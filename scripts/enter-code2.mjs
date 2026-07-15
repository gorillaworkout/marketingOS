import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();

// Find the page that's already on auth.openai.com or create a new one
let page = pages.find(p => p.url().includes('auth.openai'));
if (!page) {
    page = await browser.newPage();
    await page.goto('https://auth.openai.com/codex/device', {timeout: 10000}).catch(() => {});
}

await new Promise(r => setTimeout(r, 3000));
console.log('URL:', page.url());
console.log('Title:', await page.title());

const text = await page.evaluate(() => document.body.innerText);
console.log('Text:', text.substring(0, 800));

// Find and fill code input
const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id, placeholder: i.placeholder, type: i.type
    }));
});
console.log('Inputs:', JSON.stringify(inputs));

// Type the code
const codeInput = await page.$('input');
if (codeInput) {
    await codeInput.type('409Q-HOKK8', {delay: 30});
    console.log('Code typed');
    await new Promise(r => setTimeout(r, 800));
    
    // Click submit/continue
    const btns = await page.$$('button');
    for (const btn of btns) {
        const txt = await btn.evaluate(el => el.textContent.trim().toLowerCase());
        if (txt.includes('continue') || txt.includes('submit')) {
            await btn.click();
            console.log('Clicked:', txt);
            break;
        }
    }
    await new Promise(r => setTimeout(r, 3000));
    const text2 = await page.evaluate(() => document.body.innerText);
    console.log('After submit:', text2.substring(0, 1000));
}

await browser.disconnect();