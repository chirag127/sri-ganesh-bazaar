import type { CommandName, CommandResult } from './types';

export type CommandTransport = (action: CommandName, payload: Record<string, unknown>, subject: string) => Promise<CommandResult>;

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('The request contains an unsupported value. Refresh and try again.');
}

/** Keep an ambiguous retry's ID and coalesce double clicks, without persisting private payloads. */
export function createCommandQueue(transport: CommandTransport, uuid: () => string = () => crypto.randomUUID()) {
  const pending = new Map<string, { id: string; inFlight?: Promise<CommandResult> }>();
  return {
    clear() { pending.clear(); },
    async run(subject: string, action: CommandName, payload: Record<string, unknown>): Promise<CommandResult> {
      if (!subject) throw new Error('Sign in before making changes.');
      if ('request_id' in payload) throw new Error('Request identifiers are managed by the application.');
      const key = `${subject}:${action}:${canonical(payload)}`;
      let entry = pending.get(key);
      if (!entry) {
        if (pending.size >= 100) throw new Error('Too many unconfirmed requests. Check your order history before refreshing.');
        entry = { id: uuid() };
        pending.set(key, entry);
      }
      if (entry.inFlight) return entry.inFlight;
      const record = entry;
      const request = Promise.resolve().then(() => transport(action, { ...payload, request_id: record.id }, subject));
      record.inFlight = request;
      try {
        const result = await request;
        if (pending.get(key) === record) pending.delete(key);
        return result;
      } finally {
        record.inFlight = undefined;
      }
    },
  };
}
