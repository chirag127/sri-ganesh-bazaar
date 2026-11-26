import { createNotificationHandler } from './handler.ts';
Deno.serve(createNotificationHandler(name => Deno.env.get(name)));
