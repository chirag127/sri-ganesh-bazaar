import { describe, it, expect, vi } from 'vitest';
import { createTelegramTransport } from '../../server/telegram.mjs';
const token = '123456789:' + 'a'.repeat(35);
const config = { enabled: true, token, chatId: '-100123456789' };
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
describe('admin Telegram transport', () => {
  it('defaults disabled without network', async () => {
    const fetcher = vi.fn(); expect(await createTelegramTransport({fetcher}).send('new_enquiry')).toEqual({state:'failed',reason:'disabled'}); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{token:'bad'}, {chatId:'@public'}, {chatId:'1?token=x'}, {timeoutMs:30001}, {timeoutMs:0}])('rejects invalid configuration %j', async patch => {
    const fetcher=vi.fn(); expect((await createTelegramTransport({...config,...patch,fetcher}).send('low_stock')).reason).toBe('configuration'); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['customer name', '__proto__', 'constructor', {event:'low_stock',name:'private'}])('rejects arbitrary content', async event => {
    const fetcher=vi.fn(); expect((await createTelegramTransport({...config,fetcher}).send(event)).reason).toBe('unknown_event'); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['new_enquiry','quote_accepted','payment_submitted','low_stock','application_error'])('sends fixed %s template once', async event => {
    const fetcher=vi.fn(async()=>reply(200,{ok:true,result:{message_id:42}}));
    expect(await createTelegramTransport({...config,fetcher}).send(event)).toEqual({state:'sent',provider_id:'42'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options]=fetcher.mock.calls[0]; expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(options.redirect).toBe('error'); const body=JSON.parse(options.body);
    expect(Object.keys(body).sort()).toEqual(['allow_paid_broadcast','chat_id','protect_content','text']); expect(body.allow_paid_broadcast).toBe(false); expect(body.text).not.toContain(token);
  });
  it('returns retry_after without sleeping or resending', async()=> {
    const fetcher=vi.fn(async()=>reply(429,{ok:false,parameters:{retry_after:60},description:token}));
    expect(await createTelegramTransport({...config,fetcher}).send('low_stock')).toEqual({state:'failed',reason:'rate_limited',retry_after:60}); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([200,408,500,502])('treats unconfirmed HTTP %s as uncertain', async status=> {
    const fetcher=vi.fn(async()=>reply(status,{ok:false,description:token})); const result=await createTelegramTransport({...config,fetcher}).send('low_stock'); expect(result.state).toBe('uncertain'); expect(JSON.stringify(result)).not.toContain(token); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects definite client errors',async()=>expect(await createTelegramTransport({...config,fetcher:async()=>reply(403,{ok:false})}).send('low_stock')).toEqual({state:'failed',reason:'rejected'}));
  it('requires a message receipt',async()=>expect((await createTelegramTransport({...config,fetcher:async()=>reply(200,{ok:true,result:{}})}).send('low_stock')).state).toBe('uncertain'));
  it('sanitizes network errors and does not retry',async()=> {
    const fetcher=vi.fn(async()=>{throw Error(token);}); expect(await createTelegramTransport({...config,fetcher}).send('low_stock')).toEqual({state:'uncertain',reason:'transport'}); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds a hung fetch and aborts it',async()=> {
    let signal; const fetcher=vi.fn((_url,options)=>{signal=options.signal; return new Promise(()=>{});});
    expect(await createTelegramTransport({...config,fetcher,timeoutMs:10}).send('low_stock')).toEqual({state:'uncertain',reason:'timeout'}); expect(signal.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
