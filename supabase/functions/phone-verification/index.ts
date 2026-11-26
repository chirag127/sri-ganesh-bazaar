import { createPhoneHandler } from './handler.ts';

Deno.serve(createPhoneHandler((name) => Deno.env.get(name)));
