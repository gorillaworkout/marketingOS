import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
const linearPage = pages.find(p => p.url().includes('linear.app'));

if (linearPage) {
    await linearPage.goto('https://linear.app/gorillaworkout/settings/account/security', {waitUntil: 'networkidle2'});
    await new Promise(r => setTimeout(r, 2000));
    
    // Click the New API key button
    await linearPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'New API key');
        if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    
    // Type the name
    const nameInput = await linearPage.$('input[id="label"]');
    if (nameInput) {
        await nameInput.type('MarketingOS Agent', {delay: 50});
        console.log('Typed name');
        await new Promise(r => setTimeout(r, 500));
    }
    
    // Look for the Create button and click it
    const result = await linearPage.evaluate(() => {
        // Find all buttons in the dialog
        const buttons = Array.from(document.querySelectorAll('button'));
        const createBtn = buttons.find(b => 
            b.textContent.trim() === 'Create' || 
            b.textContent.trim() === 'Create key' ||
            b.textContent.includes('Create')
        );
        if (createBtn) {
            createBtn.click();
            return 'Clicked: ' + createBtn.textContent.trim();
        }
        // Try to find submit button
        const submitBtn = document.querySelector('[type="submit"]');
        if (submitBtn) {
            submitBtn.click();
            return 'Clicked submit';
        }
        return 'No create button found. Buttons: ' + buttons.map(b => b.textContent.trim()).filter(Boolean).join(', ');
    });
    console.log('Create result:', result);
    await new Promise(r => setTimeout(r, 2000));
    
    // Get the page content to see the API key
    const pageText = await linearPage.evaluate(() => document.body.innerText);
    console.log('=== Page text after creation ===');
    console.log(pageText.substring(0, 2000));
}

await browser.disconnect();