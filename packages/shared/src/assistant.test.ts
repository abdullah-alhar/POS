import { describe, expect, it } from 'vitest';
import {
  applyReceiptActions,
  applySettingChanges,
  interpretReceiptCommand,
  interpretSettingsCommand,
  resolveTargets,
} from './assistant';
import { RECEIPT_TEMPLATES, type ReceiptElement } from './receipt-layout';
import { DEFAULT_SETTINGS } from './schemas/settings';

const classic = () => RECEIPT_TEMPLATES.classic.build();

/** Understand a request and carry it out on the design. */
function run(message: string, layout: ReceiptElement[] = classic(), selectedIds: string[] = []) {
  const r = interpretReceiptCommand(message, layout, selectedIds);
  expect(r.understood, r.reply).toBe(true);
  return {
    ...applyReceiptActions(layout, r.actions, { copies: 1, selectedIds }),
    actions: r.actions,
  };
}
const find = (layout: ReceiptElement[], type: ReceiptElement['type']) =>
  layout.find((e) => e.type === type);

describe('receipt assistant', () => {
  it('makes the total big or small', () => {
    expect(find(run('make the total small').layout, 'totals')).toMatchObject({ bigTotal: false });
    expect(find(run('Please make the total bigger.').layout, 'totals')).toMatchObject({
      bigTotal: true,
    });
  });

  it('styles text found by its field, several requests at once', () => {
    const { layout, done } = run('make the shop name big and centered, then hide the barcode');
    const name = layout.find((e) => e.type === 'text' && e.text === '{shop_name}');
    expect(name).toMatchObject({ size: 'large', align: 'center' });
    expect(find(layout, 'barcode')).toMatchObject({ hidden: true });
    expect(done).toHaveLength(3);
  });

  it('adds quoted text in the right place, keeping its letters', () => {
    const { layout } = run('Add "Open daily after 9 AM" at the top');
    expect(layout[0]).toMatchObject({ type: 'logo' });
    expect(layout[1]).toMatchObject({ type: 'text', text: 'Open daily after 9 AM' });
    const below = run('add "Thanks!" below the total').layout;
    const at = below.findIndex((e) => e.type === 'totals');
    expect(below[at + 1]).toMatchObject({ type: 'text', text: 'Thanks!' });
  });

  it('adds a WhatsApp QR code with the country code', () => {
    const { layout } = run('add whatsapp 077 123 4567');
    expect(layout.at(-2)).toMatchObject({ type: 'qr', value: 'https://wa.me/94771234567' });
    expect(layout.at(-1)).toMatchObject({ type: 'text', text: 'Chat with us on WhatsApp' });
  });

  it('adds review and Facebook links as QR codes', () => {
    const { layout } = run('add a qr for our facebook page facebook.com/myshop');
    expect(layout.at(-2)).toMatchObject({ type: 'qr', value: 'https://facebook.com/myshop' });
    expect(layout.at(-1)).toMatchObject({ text: 'Follow us on Facebook' });
  });

  it('adds ready-made texts and pieces', () => {
    const { layout } = run('add vat number and add a signature');
    expect(layout.some((e) => e.type === 'text' && e.text === 'VAT No: {vat_no}')).toBe(true);
    expect(find(layout, 'signature')).toBeTruthy();
    expect(find(run('add a double line').layout.slice(-1), 'divider')).toMatchObject({
      style: 'double',
    });
  });

  it('removes, moves and hides pieces', () => {
    expect(find(run('remove the logo').layout, 'logo')).toBeUndefined();
    const moved = run('move the barcode to the top').layout;
    expect(moved[0]!.type).toBe('barcode');
    const below = run('move logo below the total').layout;
    expect(below[below.findIndex((e) => e.type === 'totals') + 1]!.type).toBe('logo');
    expect(find(run('hide the savings').layout, 'savings')).toMatchObject({ hidden: true });
  });

  it('changes the item list', () => {
    expect(find(run('one line items').layout, 'items')).toMatchObject({ layout: 'one-line' });
    expect(find(run('show item codes').layout, 'items')).toMatchObject({ showSku: true });
    expect(find(run('hide warranty').layout, 'items')).toMatchObject({ showWarranty: false });
  });

  it('prints a piece only on some bills', () => {
    const layout = [...classic(), { id: 'sig', type: 'signature' as const, label: 'Sign' }];
    expect(
      find(run('only print the signature on credit sales', layout).layout, 'signature'),
    ).toMatchObject({
      when: 'credit',
    });
    const back = run('always print the signature', [
      { id: 's', type: 'signature', label: 'x', when: 'card' },
    ]);
    expect(back.layout[0]).not.toHaveProperty('when');
  });

  it('replaces words everywhere and switches designs', () => {
    const { layout, done } = run('replace "Thank you!" with "Thanks a lot!"');
    expect(layout.some((e) => e.type === 'text' && e.text.startsWith('Thanks a lot!'))).toBe(true);
    expect(done[0]).toMatch(/1 place/);
    const modern = run('use the modern design').layout;
    expect(modern.some((e) => e.type === 'qr')).toBe(true);
    expect(run('3 copies').copies).toBe(3);
  });

  it('saves paper and asks the editor to check or compare', () => {
    const out = run('save paper');
    expect(find(out.layout, 'items')).toMatchObject({ layout: 'one-line' });
    expect(run('check my receipt').check).toBe(true);
    expect(run('what changed?').compare).toBe(true);
  });

  it('acts on the selected piece', () => {
    const layout = classic();
    const text = layout.find((e) => e.type === 'text')!;
    const out = run('make it bold', layout, [text.id]);
    expect(out.layout.find((e) => e.id === text.id)).toMatchObject({ bold: true });
    const added = run('add a line', layout, [text.id]).layout;
    expect(added[added.findIndex((e) => e.id === text.id) + 1]!.type).toBe('divider');
  });

  it('leaves locked pieces alone and says so', () => {
    const layout = classic().map((e) => (e.type === 'logo' ? { ...e, locked: true } : e));
    const out = run('remove the logo', layout);
    expect(find(out.layout, 'logo')).toBeTruthy();
    expect(out.problems[0]).toMatch(/locked/);
  });

  it('says when it does not understand, without changing anything', () => {
    const r = interpretReceiptCommand('paint it like a sunset over the sea', classic());
    expect(r.understood).toBe(false);
    expect(r.actions).toEqual([]);
    expect(r.reply).toMatch(/did not understand/);
  });

  it('refuses actions that would break the design', () => {
    const layout = classic();
    // A receipt holds at most 80 pieces.
    const out = applyReceiptActions(
      layout,
      Array.from({ length: 80 }, () => ({ op: 'add' as const, piece: 'divider' as const })),
      { copies: 1 },
    );
    expect(out.layout).toEqual(layout);
    expect(out.problems[0]).toMatch(/nothing was changed/);
    const bad = applyReceiptActions(layout, [{ op: 'explode' } as never], { copies: 1 });
    expect(bad.problems[0]).toMatch(/skipped/);
  });

  it('finds pieces by id, type, field or words', () => {
    const layout = classic();
    const items = layout.find((e) => e.type === 'items')!;
    expect(resolveTargets(layout, items.id)).toEqual([items.id]);
    expect(resolveTargets(layout, 'the products')).toEqual([items.id]);
    expect(resolveTargets(layout, 'cashier')).toHaveLength(1);
    expect(resolveTargets(layout, 'come again')).toHaveLength(1);
    expect(resolveTargets(layout, 'all')).toHaveLength(layout.length);
  });
});

describe('settings assistant', () => {
  const ask = (message: string) => {
    const r = interpretSettingsCommand(message, DEFAULT_SETTINGS);
    expect(r.understood, r.reply).toBe(true);
    return applySettingChanges(DEFAULT_SETTINGS, r.actions);
  };

  it('understands common settings', () => {
    expect(ask('Round bill totals to the nearest Rs 10').next.pos.roundingStep).toBe(1000);
    expect(ask('no rounding').next.pos.roundingStep).toBe(1);
    expect(ask('Cashiers can give up to 15% discount').next.approvals.cashierMaxDiscountBp).toBe(
      1500,
    );
    expect(ask('Lock the screen after 7 minutes').next.pos.autoLockMinutes).toBe(5);
    expect(ask("Don't print receipts automatically").next.pos.autoPrintReceipt).toBe(false);
    expect(ask('print 2 copies of every receipt').next.receipt.copies).toBe(2);
    expect(ask('We use 58 mm paper').next.printer.charsPerLine).toBe(32);
    expect(ask('Back up every day at 10 pm').next.backup.dailyAt).toBe('22:00');
    expect(ask('back up at 21:15').next.backup.dailyAt).toBe('21:15');
    expect(ask('new bills start in wholesale').next.pos.defaultPriceMode).toBe('WHOLESALE');
    expect(ask('shop phone is 011 234 5678').next.shop.phone).toBe('011 234 5678');
  });

  it('turns VAT on with the VAT number', () => {
    const out = ask('Our VAT number is 123456789-7000');
    expect(out.next.tax).toMatchObject({ vatRegistered: true, vatNumber: '123456789-7000' });
    expect(out.sections).toEqual(['tax']);
    expect(out.summary).toContain('VAT registered: Off → On');
  });

  it('adds and removes admin approvals', () => {
    const without = ask('cashiers can void bills without admin pin');
    expect(without.next.approvals.requireApprovalFor).not.toContain('VOID_SALE');
    const r = interpretSettingsCommand('ask for admin pin to void bills', without.next);
    expect(
      applySettingChanges(without.next, r.actions).next.approvals.requireApprovalFor,
    ).toContain('VOID_SALE');
  });

  it('handles several changes at once', () => {
    const out = ask('round to nearest 5 and lock the screen after 10 minutes');
    expect(out.next.pos).toMatchObject({ roundingStep: 500, autoLockMinutes: 10 });
    expect(out.summary).toHaveLength(2);
  });

  it('refuses settings it may not change and values that break the rules', () => {
    const out = applySettingChanges(DEFAULT_SETTINGS, [
      { path: 'branding.appName', value: 'Hacked' },
      { path: 'pos.roundingStep', value: 7 },
      { path: 'approvals.cashierMaxDiscountBp', value: 20_000 },
      { path: 'shop.name', value: '' },
    ]);
    expect(out.next).toEqual(DEFAULT_SETTINGS);
    expect(out.sections).toEqual([]);
    expect(out.problems).toHaveLength(4);
  });

  it('says when it does not understand', () => {
    const r = interpretSettingsCommand('make me a coffee', DEFAULT_SETTINGS);
    expect(r.understood).toBe(false);
    expect(r.actions).toEqual([]);
  });
});
