import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  ASSIGNABLE_PERMISSIONS,
  effectivePermissions,
  hasPermission,
} from './permissions';

describe('permissions', () => {
  it('gives the Super Admin everything, including branding', () => {
    expect(effectivePermissions('SUPER_ADMIN', [])).toEqual(ALL_PERMISSIONS);
    expect(hasPermission({ role: 'SUPER_ADMIN', permissions: [] }, 'branding.manage')).toBe(true);
  });

  it('gives the shop Admin everything except branding', () => {
    expect(effectivePermissions('ADMIN', [])).toEqual(ASSIGNABLE_PERMISSIONS);
    expect(hasPermission({ role: 'ADMIN', permissions: [] }, 'users.manage')).toBe(true);
    expect(
      hasPermission({ role: 'ADMIN', permissions: ['branding.manage'] }, 'branding.manage'),
    ).toBe(false);
  });

  it('limits cashiers to their stored permissions and drops unknown or Super Admin ones', () => {
    expect(effectivePermissions('CASHIER', ['sales.create', 'made.up', 'branding.manage'])).toEqual(
      ['sales.create'],
    );
    expect(hasPermission({ role: 'CASHIER', permissions: ['sales.create'] }, 'users.manage')).toBe(
      false,
    );
  });
});
