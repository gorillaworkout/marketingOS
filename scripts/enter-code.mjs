import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
let page = pages.find(p => p.url().includes('openai') || p.url().includes('auth.openai'));
if (!page) page = await browser.newPage();

// Go to device code page
await page.goto('https://auth.openai.com/codex/device', {waitUntil: 'networkidle2', timeout: 15000});
await new Promise(r => setTimeout(r, 2000));

console.log('URL:', page.url());
console.log('Title:', await page.title());

// Check if we're on login page or device code page
const text = await page.evaluate(() => document.body.innerText);
console.log('Text:', text.substring(0, 500));

// Look for the code input field
const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id, placeholder: i.placeholder, type: i.type
    }));
});
console.log('Inputs:', JSON.stringify(inputs));

// Try to enter the code if there's an input
const codeInput = await page.$('input');
if (codeInput) {
    await codeInput.type('409Q-HOKK8', {delay: 50});
    console.log('Typed code');
    await new Promise(r => setTimeout(r, 500));
    
    // Look for submit button
    const buttons = await page.$$('button');
    for (const btn of buttons) {
        const txt = await btn.evaluate(el => el.textContent.trim().toLowerCase());
        if (txt.includes('continue') || txt.includes('submit') || txt.includes('next')) {
            await btn.click();
            console.log('Clicked:', txt);
            break;
        }
    }
    await new Promise(r => setTimeout(r, 3000));
    console.log('URL after submit:', page.url());
    const text2 = await page.evaluate(() => document.body.innerText);
    console.log('After submit:', text2.substring(0, 1000));
}

await browser.disconnect();