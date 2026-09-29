import { afterEach, describe, expect, it, vi } from 'vitest';

const json = (value: unknown) => new Response(JSON.stringify(value),
  { headers: { 'content-type': 'application/json' } });

describe('checkpoint persistence acknowledgements', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports failure when browser storage is full and the server is read-only', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); } } });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'PUT'
      ? json({ ok: true, readonly: true }) : json(null)));
    const { writeDoc } = await import('../../lib/store');
    await expect(writeDoc('warsim-session', { runtime: { tick: 1 } })).rejects.toThrow('was not saved');
  });

  it('uses a newer server checkpoint when its browser copy could not be updated', async () => {
    vi.resetModules();
    const old = { runtime: { tick: 1, nextSequence: 1 }, status: 'running' };
    let server: unknown = null;
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => key.endsWith('warsim-session') ? JSON.stringify(old) : null,
      setItem: () => { throw new Error('quota exceeded'); } } });
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') { server = JSON.parse(options.body as string); return json({ ok: true }); }
      return json(url.endsWith('/warsim-session') ? server : null);
    }));
    const { readDoc, writeDoc } = await import('../../lib/store');
    const next = { runtime: { tick: 2, nextSequence: 3 }, status: 'paused' };
    await expect(writeDoc('warsim-session', next)).resolves.toBeUndefined();
    expect(await readDoc('warsim-session')).toEqual(next);
  });
});
