import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/lib/api', () => ({ command: vi.fn(), request: vi.fn() }));
import CartPanel from '../../src/components/customer/CartPanel';
import type { Workspace, CatalogSnapshot } from '../../src/lib/types';
const catalog = {configured:true,products:[{id:'p',name:'Feed',slug:'feed',category:'Feed',description:'',image_url:null,active:true,variants:[{id:'v',product_id:'p',label:'Bag',weight_kg:50,available:true}]}]} as CatalogSnapshot;
function render(approved:boolean, signedIn=true, online=true) {
 const workspace = {customer:{id:'customer-1',phone:'123',estimate_approved:approved}} as unknown as Workspace;
 return renderToStaticMarkup(<CartPanel cart={[{variant_id:'v',quantity:2}]} catalog={catalog} workspace={workspace} signedIn={signedIn} online={online} busy={false} perform={async()=>{}} onSignIn={()=>{}} onProfile={()=>{}} />);
}
describe('cart estimate entry visibility',()=>{
 it('offers calculation only to approved signed-in customers',()=>{
  expect(render(true)).toContain('Calculate approximate total');
  expect(render(false)).not.toContain('Calculate approximate total');
  expect(render(true,false)).not.toContain('Calculate approximate total');
 });
 it('never pre-renders an amount or unit price',()=>{
  expect(render(true)).not.toContain('₹');
  expect(render(false)).not.toContain('₹');
 });
 it('labels estimate as non-reserving and subject to final quote',()=>{
  expect(render(true)).toContain('does not reserve stock');
  expect(render(true)).toContain('final quotation');
 });
 it('disables offline calculation and explains lack of offline persistence',()=>{
  expect(render(true,true,false)).toMatch(/<button type="button" disabled="">Calculate approximate total/);
  expect(render(true,true,false)).toContain('Private estimates are not saved offline');
 });
});
