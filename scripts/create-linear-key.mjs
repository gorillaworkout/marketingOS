import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
const linearPage = pages.find(p => p.url().includes('linear.app'));

if (linearPage) {
    await linearPage.goto('https://linear.app/gorillaworkout/settings/account/security', {waitUntil: 'networkidle2'});
    
    // Find and click the "New API key" button
    const buttons = await linearPage.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.map((b, i) => ({index: i, text: b.textContent.trim()}));
    });
    console.log('Buttons found:', JSON.stringify(buttons, null, 2));
    
    const newKeyBtn = buttons.find(b => b.text.includes('New API key'));
    if (newKeyBtn) {
        console.log('Clicking button index:', newKeyBtn.index);
        const allBtns = await linearPage.$$('button');
        await allBtns[newKeyBtn.index].click();
        await new Promise(r => setTimeout(r, 2000));
        
        // Check for dialog/modal
        const text = await linearPage.evaluate(() => document.body.innerText);
        console.log('After click:', text.substring(0, 2000));
    } else {
        console.log('New API key button not found');
    }
}

await browser.disconnect();