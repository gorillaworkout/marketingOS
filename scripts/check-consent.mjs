import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
const page = pages.find(p => p.url().includes('auth.openai.com/sign-in-with-chatgpt'));

if (page) {
    const text = await page.evaluate(() => document.body.innerText);
    console.log('=== Consent Page ===');
    console.log(text.substring(0, 2000));
    
    // Look for the approve/consent button
    const buttons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.textContent.trim(),
            id: b.id,
            type: b.type
        }));
    });
    console.log('=== Buttons ===');
    console.log(JSON.stringify(buttons, null, 2));
}

await browser.disconnect();