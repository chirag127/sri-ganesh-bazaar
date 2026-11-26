import { test, expect } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('real browser consent, history changes and failed revocation stay fail-closed', async () => {
  const source = await readFile(new URL('../../src/lib/public-analytics.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/module.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/module.js' ? js : `<section data-analytics-consent hidden><button data-analytics-accept>Allow</button><button data-analytics-reject>Reject</button><p data-analytics-status></p></section><script type="module">import {mountPublicAnalytics} from '/module.js'; mountPublicAnalytics({config:{ga4:'G-ABC123',clarity:'abc123'},native:false,anonymous:async()=>!window.signedIn});</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    let providerLoads = 0;
    await page.route('**/*', async route => {
      if (route.request().url().startsWith(origin)) return route.continue();
      providerLoads++;
      await route.fulfill({contentType:'text/javascript',body:'/* synthetic provider, no network */'});
    });
    await page.addInitScript(() => { localStorage.setItem('pashu-saathi.analytics.v1','yes'); });
    await page.goto(origin + '/');
    await page.locator('[data-analytics-accept]').waitFor({state:'visible'});
    expect(providerLoads).toBe(0);
    await page.locator('[data-analytics-reject]').click();
    await page.locator('[data-analytics-accept]').click();
    await expect.poll(() => providerLoads).toBe(2);
    expect(await page.evaluate(() => window['ga-disable-G-ABC123'])).toBe(false);
    expect(await page.locator('body').getAttribute('data-clarity-mask')).toBe('true');
    for (const method of ['pushState','replaceState']) {
      const invalid = await page.evaluate(method => {
        try { history[method]({}, '', 'https://elsewhere.invalid/'); return 'accepted'; }
        catch (error) { return error.name; }
      }, method);
      expect(invalid).toBe('SecurityError');
      expect(new URL(page.url()).pathname).toBe('/');
      await page.evaluate(method => history[method]({}, '', '/products/?q=choker#results'), method);
      await page.waitForURL('**/products/?q=choker#results');
      expect(new URL(page.url()).search).toBe('?q=choker');
      expect(new URL(page.url()).hash).toBe('#results');
      const previous = providerLoads;
      await page.goto(origin + '/');
      await page.locator('[data-analytics-accept]').waitFor({state:'visible'});
      expect(providerLoads).toBe(previous);
      await page.locator('[data-analytics-accept]').click();
      await expect.poll(() => providerLoads).toBe(previous + 2);
    }
    await page.evaluate(() => { Storage.prototype.setItem = () => {throw new Error('blocked');}; });
    await page.locator('[data-analytics-reject]').click();
    await page.waitForURL('**/?analytics=off');
    const previous = providerLoads;
    await page.goto(origin + '/');
    await page.locator('[data-analytics-accept]').waitFor({state:'visible'});
    expect(providerLoads).toBe(previous);
    await page.goto(origin + '/admin/');
    expect(await page.locator('[data-analytics-consent]').isVisible()).toBe(false);
    expect(providerLoads).toBe(previous);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}, 30000);
