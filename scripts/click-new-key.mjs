import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({browserURL: 'http://localhost:9222'});
const pages = await browser.pages();
const linearPage = pages.find(p => p.url().includes('linear.app'));

if (linearPage) {
    await linearPage.goto('https://linear.app/gorillaworkout/settings/account/security', {waitUntil: 'networkidle2'});
    await new Promise(r => setTimeout(r, 2000));
    
    // Click by evaluating JS directly
    const result = await linearPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => b.textContent.trim() === 'New API key');
        if (btn) {
            btn.click();
            return 'Clicked button via JS';
        }
        // Try span/div with onClick
        const spans = Array.from(document.querySelectorAll('span, div'));
        const spanBtn = spans.find(s => s.textContent.trim() === 'New API key' && s.closest('button'));
        if (spanBtn) {
            spanBtn.closest('button').click();
            return 'Clicked parent button';
        }
        return 'Button not found';
    });
    console.log('Click result:', result);
    await new Promise(r => setTimeout(r, 2000));
    
    // Now look for the modal/dialog and create the key
    const state = await linearPage.evaluate(() => {
        // Check for dialog
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
            return 'dialog_found:' + dialog.textContent.substring(0, 500);
        }
        // Check for any modal overlay
        const overlay = document.querySelector('[class*="overlay"], [class*="backdrop"]');
        if (overlay) {
            return 'overlay_found:' + (overlay.textContent || '').substring(0, 500);
        }
        // Check for any input that appeared
        const inputs = document.querySelectorAll('input');
        const inputInfo = Array.from(inputs).map(i => ({
            placeholder: i.placeholder,
            id: i.id,
            visible: i.offsetParent !== null
        }));
        return 'no_dialog inputs:' + JSON.stringify(inputInfo);
    });
    console.log('State:', state);
}

await browser.disconnect();