import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();

// Find or create the OpenAI auth page
let page = pages.find(p => p.url().includes('openai'));
if (!page) {
    page = await browser.newPage();
}

// Navigate to device code entry
await page.goto('https://auth.openai.com/codex/device', {waitUntil: 'networkidle2'});
console.log('Page loaded:', await page.title());

// Wait a moment then check for the code input
await new Promise(r => setTimeout(r, 2000));

// Get the page content
const text = await page.evaluate(() => document.body.innerText);
console.log('Page text:', text.substring(0, 1000));

// Try to find and fill the code input
const result = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.map(i => ({id: i.id, name: i.name, type: i.type, placeholder: i.placeholder}));
});
console.log('Inputs:', JSON.stringify(result));

await browser.disconnect();