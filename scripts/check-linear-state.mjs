import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
const linearPage = pages.find(p => p.url().includes('linear.app'));

if (linearPage) {
    await linearPage.goto('https://linear.app/gorillaworkout/settings/account/security', {waitUntil: 'networkidle2'});
    await new Promise(r => setTimeout(r, 1000));
    
    // Click the New API key button
    const allBtns = await linearPage.$$('button');
    await allBtns[12].click();
    await new Promise(r => setTimeout(r, 1500));
    
    // Look for input fields, modals, or dialogs
    const pageState = await linearPage.evaluate(() => {
        // Check for any modals/dialogs
        const modals = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog, .modal, [class*="dialog"]'));
        const modalInfo = modals.map(m => ({
            tag: m.tagName,
            role: m.getAttribute('role'),
            classes: m.className,
            text: m.textContent.trim().substring(0, 500)
        }));
        
        // Check for input fields
        const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
        const inputInfo = inputs.map(i => ({
            tag: i.tagName,
            type: i.type,
            placeholder: i.placeholder || '',
            id: i.id,
            name: i.name
        }));
        
        // Check for any newly visible elements
        const allText = document.body.innerText;
        
        // Check URL hash or params
        const url = window.location.href;
        
        return {modalInfo, inputInfo, url, allText: allText.substring(0, 3000)};
    });
    
    console.log('=== Modals ===');
    console.log(JSON.stringify(pageState.modalInfo, null, 2));
    console.log('=== Inputs ===');
    console.log(JSON.stringify(pageState.inputInfo, null, 2));
    console.log('=== URL ===');
    console.log(pageState.url);
}

await browser.disconnect();