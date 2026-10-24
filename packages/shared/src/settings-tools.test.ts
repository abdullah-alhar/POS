import { describe, expect, it } from 'vitest';
import { RECEIPT_TEMPLATES } from './receipt-layout';
import { isLocalAiUrl, isSafeAiApiUrl } from './ai-providers';
import { aiSettingsSchema, DEFAULT_SETTINGS } from './schemas/settings';
import { checkSettings, diffSettings } from './settings-tools';

describe('diffSettings', () => {
  it('lists changed settings in words', () => {
    const after = {
      ...DEFAULT_SETTINGS,
      pos: { ...DEFAULT_SETTINGS.pos, roundingStep: 1000 as const, autoPrintReceipt: false },
      approvals: { ...DEFAULT_SETTINGS.approvals, cashierMaxDiscountBp: 1250 },
    };
    expect(diffSettings(DEFAULT_SETTINGS, after)).toEqual([
      {
        path: 'pos.roundingStep',
        section: 'pos',
        label: 'Round bill totals to',
        before: 'Nearest 1',
        after: 'Nearest 10',
      },
      {
        path: 'pos.autoPrintReceipt',
        section: 'pos',
        label: 'Print receipt after payment',
        before: 'On',
        after: 'Off',
      },
      {
        path: 'approvals.cashierMaxDiscountBp',
        section: 'approvals',
        label: 'Cashier discount limit',
        before: '10%',
        after: '12.5%',
      },
    ]);
  });

  it('compares receipt designs piece by piece and skips logos hidden in the audit log', () => {
    const layout = RECEIPT_TEMPLATES.classic.build();
    const rows = diffSettings(
      { receipt: { ...DEFAULT_SETTINGS.receipt, layout }, branding: { logo: '[image]' } },
      {
        receipt: { ...DEFAULT_SETTINGS.receipt, layout: layout.slice(1) },
        branding: { logo: 'data:image/png;base64,xx' },
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: 'receipt.layout',
      after: `${layout.length - 1} pieces (1 removed)`,
    });
    expect(rows[0]!.layoutChanges).toHaveLength(1);
  });
});

describe('checkSettings', () => {
  it('finds setup problems, worst first', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      backup: { ...DEFAULT_SETTINGS.backup, dailyAt: '' as const },
    };
    const issues = checkSettings(s);
    expect(issues.map((i) => i.id)).toContain('daily-backup');
    const order = { error: 0, warning: 1, tip: 2 };
    expect(issues.map((i) => order[i.level])).toEqual(
      [...issues.map((i) => order[i.level])].sort((a, b) => a - b),
    );
  });
});

describe('local AI address', () => {
  it('allows this computer and the shop network only', () => {
    for (const ok of [
      'http://127.0.0.1:11434',
      'http://localhost:11434/',
      'http://[::1]:11434',
      'http://192.168.1.20:11434',
      'http://10.0.0.5',
      'http://172.20.1.1:8080',
    ])
      expect(isLocalAiUrl(ok), ok).toBe(true);
    for (const bad of [
      'https://api.example.com',
      'http://8.8.8.8:11434',
      'http://172.32.0.1',
      'http://user:pass@127.0.0.1:11434',
      'http://127.0.0.1:11434/api/../x',
      'file:///etc/passwd',
      'http://999.1.1.1',
      'http://ai-box.local:11434',
      'http://ollama.example.com',
    ])
      expect(isLocalAiUrl(bad), bad).toBe(false);
  });

  it('allows https services anywhere but plain http only in the shop', () => {
    expect(isSafeAiApiUrl('https://api.example.com/v1')).toBe(true);
    expect(isSafeAiApiUrl('http://192.168.1.9:1234/v1')).toBe(true);
    expect(isSafeAiApiUrl('http://api.example.com/v1')).toBe(false);
    expect(isSafeAiApiUrl('https://a.com/../b')).toBe(false);
  });

  it('needs an address and a model for another service', () => {
    const custom = { ...DEFAULT_SETTINGS.ai, mode: 'online' as const, provider: 'custom' as const };
    expect(aiSettingsSchema.safeParse(custom).success).toBe(false);
    expect(
      aiSettingsSchema.safeParse({ ...custom, customUrl: 'https://x.example/v1', model: 'm-1' })
        .success,
    ).toBe(true);
  });

  it('checks the AI settings', () => {
    expect(aiSettingsSchema.safeParse(DEFAULT_SETTINGS.ai).success).toBe(true);
    expect(
      aiSettingsSchema.safeParse({ ...DEFAULT_SETTINGS.ai, localModel: 'qwen; rm -rf /' }).success,
    ).toBe(false);
  });
});
