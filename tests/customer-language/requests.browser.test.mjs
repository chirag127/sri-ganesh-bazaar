import { test, expect } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('request language changes preserve Unicode drafts and remount choice without storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'request-language-'));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  let server, browser;
  try {
    await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(root, 'api.ts'), `export const getClient=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'buyer'},access_token:'fixture'}},error:null})}}); export async function request(path,body){if(path.endsWith('_page'))return {items:[{id:'one',description:'चोकर original',resolution:'मूल उत्तर',status:'pending'}],total:1};return {request_id:body.p_payload.request_id};}`);
    await writeFile(join(root, 'index.html'), '<html lang="en"><head><meta charset="utf-8"></head><body><header class="site-header" lang="hi"><select data-language-toggle aria-label="Language"><option value="hi">Hindi</option><option value="en">English</option></select></header><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
    const component = '/@fs/' + join(repo, 'src/components/ProductRequests.tsx').replaceAll('\\', '/');
    await writeFile(join(root, 'main.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import Requests from ${JSON.stringify(component)};const root=createRoot(document.getElementById('root'));window.remount=()=>{root.render(<Requests key={Math.random()} subject="buyer"/>)};window.remount();document.querySelector('select').addEventListener('change',e=>window.dispatchEvent(new CustomEvent('pashu-saathi:language-change',{detail:{language:e.target.value}})));`);
    server = await createServer({root,configFile:false,envDir:false,logLevel:'silent',resolve:{alias:[{find:'../lib/api',replacement:join(root,'api.ts')}]},server:{host:'127.0.0.1',port:0,fs:{allow:[root,repo]}}});
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage();
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('blocked');}}));
    await page.goto(origin);
    await expect.poll(()=>page.getByRole('heading',{name:'उत्पाद का अनुरोध करें'}).count()).toBe(1);
    const draft = 'मेरे लिए चोकर — original English';
    await page.locator('textarea').fill(draft);
    await page.getByLabel('Language').selectOption('en');
    await expect.poll(()=>page.getByRole('heading',{name:'Request a product'}).count()).toBe(1);
    expect(await page.locator('textarea').inputValue()).toBe(draft);
    expect(await page.locator('li').textContent()).toContain('चोकर original');
    expect(await page.locator('li').textContent()).toContain('मूल उत्तर');
    await page.getByLabel('Language').selectOption('hi');
    await page.evaluate(()=>window.remount());
    await expect.poll(()=>page.getByRole('heading',{name:'उत्पाद का अनुरोध करें'}).count()).toBe(1);
    expect(await page.locator('li strong').textContent()).toBe('लंबित');
  } finally { await browser?.close(); await server?.close(); await rm(root,{recursive:true,force:true}); }
},30000);
