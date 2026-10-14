import { describe, expect, it, vi } from 'vitest';
import { uuid } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid', () => {
  it('makes v4 UUIDs', () => {
    expect(uuid()).toMatch(V4);
  });

  it('works on pages where crypto.randomUUID is missing (plain http)', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(undefined as never);
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    const ids = new Set(Array.from({ length: 200 }, () => uuid()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
    spy.mockRestore();
  });
});
