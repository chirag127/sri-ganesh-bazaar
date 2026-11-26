import { test, expect } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('render failure hides private details and retry remounts without replaying actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'boundary-test-'));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  let server, browser;
  try {
    await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(root, 'index.html'), '<html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
    const boundary = '/@fs/' + join(repo, 'src/components/AppErrorBoundary.tsx').replaceAll('\\', '/');
    await writeFile(join(root, 'main.tsx'), `import React from 'react';
import {createRoot} from 'react-dom/client';
import Boundary from ${JSON.stringify(boundary)};
window.crash = true; window.transactions = 0;
function Screen(){ if(window.crash) throw new Error('PRIVATE_CUSTOMER_SECRET'); return <button onClick={()=>window.transactions++}>Record payment</button>; }
createRoot(document.getElementById('root')).render(<Boundary><Screen/></Boundary>);`);
    server = await createServer({ root, configFile: false, envDir: false, logLevel: 'silent', server: {host:'127.0.0.1', port:0, fs:{allow:[root, repo]}} });
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${port}/`) ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${port}/`);
    const alert = page.getByRole('alert');
    await expect.poll(() => alert.isVisible()).toBe(true);
    expect(await alert.textContent()).not.toContain('PRIVATE_CUSTOMER_SECRET');
    expect(await alert.textContent()).toContain('Check your order or payment history');
    expect(await page.getByRole('link', {name:'Browse the public catalog'}).getAttribute('href')).toBe('/products/');
    await page.getByRole('button', {name:'Retry screen'}).click();
    await expect.poll(() => alert.isVisible()).toBe(true);
    expect(await page.evaluate(() => window.transactions)).toBe(0);
    await page.evaluate(() => {window.crash = false;});
    await page.getByRole('button', {name:'Retry screen'}).click();
    await expect.poll(() => page.getByRole('button', {name:'Record payment'}).isVisible()).toBe(true);
    expect(await page.evaluate(() => window.transactions)).toBe(0);
    await page.getByRole('button', {name:'Record payment'}).click();
    expect(await page.evaluate(() => window.transactions)).toBe(1);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(root, {recursive:true, force:true});
  }
}, 30000);
