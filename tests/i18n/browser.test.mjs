import { test, expect } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('header toggle preserves entered text, links and cart hooks with or without storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'header-language-'));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  let server, browser;
  try {
    const component = await readFile(join(repo, 'src/components/LanguageToggle.astro'), 'utf8');
    const script = component.match(/<script>([\s\S]*?)<\/script>/)[1].replace("'../lib/i18n'", JSON.stringify('/@fs/' + join(repo, 'src/lib/i18n.ts').replaceAll('\\', '/')));
    const selector = component.split('<style>')[0];
    await writeFile(join(root, 'main.ts'), script);
    await writeFile(join(root, 'index.html'), `<html lang="en"><head><meta charset="utf-8"></head><body><header class="site-header"><a href="/products/" data-i18n="shop">Shop bags</a><input aria-label="Query" data-i18n-placeholder="searchHint" value="चोकर"><a href="/app/#cart"><span data-i18n="cart">Bag list</span><span data-cart-count>(4)</span></a>${selector}</header><main><p>Original product name</p><textarea>मेरी आवश्यकता</textarea></main><script type="module" src="/main.ts"></script></body></html>`);
    server = await createServer({ root, configFile:false, envDir:false, logLevel:'silent', server:{host:'127.0.0.1',port:0,fs:{allow:[root,repo]}} });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({headless:true});
    for (const blocked of [false, true]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      if (blocked) await page.addInitScript(() => Object.defineProperty(window, 'localStorage', {get(){throw new Error('blocked');}}));
      page.setDefaultTimeout(5000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      expect(errors).toEqual([]);
      const toggle = page.getByRole('combobox', {name:'Language / भाषा'});
      await expect.poll(() => page.locator('header').getAttribute('lang')).toBe('en');
      await toggle.selectOption('hi');
      await expect.poll(() => page.locator('[data-i18n="cart"]').textContent()).toBe('खरीद सूची');
      expect(await page.locator('html').getAttribute('lang')).toBe('en');
      expect(await page.getByLabel('Query').inputValue()).toBe('चोकर');
      expect(await page.locator('textarea').inputValue()).toBe('मेरी आवश्यकता');
      expect(await page.locator('[data-cart-count]').textContent()).toBe('(4)');
      expect(await page.locator('[data-i18n="shop"]').getAttribute('href')).toBe('/products/');
      expect(await page.getByLabel('Query').getAttribute('placeholder')).toContain('चोकर');
      await page.reload();
      await expect.poll(() => page.locator('header').getAttribute('lang')).toBe(blocked ? 'en' : 'hi');
      await toggle.selectOption('en');
      await expect.poll(() => page.locator('[data-i18n="cart"]').textContent()).toBe('Bag list');
      await context.close();
    }
  } finally { await browser?.close(); await server?.close(); await rm(root,{recursive:true,force:true}); }
}, 30000);
