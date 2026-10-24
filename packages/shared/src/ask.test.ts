import { describe, expect, it } from 'vitest';
import { ASK_EXAMPLES, interpretAsk, periodRange, smallTalk } from './ask';

describe('interpretAsk', () => {
  it('understands every example question', () => {
    for (const q of ASK_EXAMPLES) expect(interpretAsk(q), q).not.toBeNull();
  });

  it('understands sales questions with periods', () => {
    expect(interpretAsk('How are sales today?')).toEqual({ skill: 'sales', period: 'today' });
    expect(interpretAsk('what was our profit last month')).toEqual({
      skill: 'sales',
      period: 'last_month',
    });
    expect(interpretAsk('how much did we sell yesterday')).toEqual({
      skill: 'sales',
      period: 'yesterday',
    });
  });

  it('compares two periods, or with the one before', () => {
    expect(interpretAsk('Compare this month with last month')).toEqual({
      skill: 'compare',
      period: 'this_month',
      period2: 'last_month',
    });
    expect(interpretAsk('is today better than yesterday?')).toMatchObject({
      period: 'today',
      period2: 'yesterday',
    });
    expect(interpretAsk('compare this week')).toMatchObject({
      period: 'this_week',
      period2: 'last_week',
    });
  });

  it('finds item, stock and customer questions', () => {
    expect(interpretAsk('Best sellers this week')).toEqual({ skill: 'best', period: 'this_week' });
    expect(interpretAsk('top 5 products last month')).toEqual({
      skill: 'best',
      period: 'last_month',
      limit: 5,
    });
    expect(interpretAsk('what is not selling')).toEqual({ skill: 'slow', period: 'last_30_days' });
    expect(interpretAsk('What is running low?')).toEqual({ skill: 'lowStock' });
    expect(interpretAsk('how many anker chargers left')).toEqual({
      skill: 'item',
      query: 'anker chargers',
    });
    expect(interpretAsk('price of usb cable')).toEqual({ skill: 'item', query: 'usb cable' });
    expect(interpretAsk('how much does Nimal Perera owe?')).toEqual({
      skill: 'customer',
      query: 'nimal perera',
    });
    expect(interpretAsk('Who owes us money?')).toEqual({ skill: 'owed' });
    expect(interpretAsk('How much cash is in the drawer?')).toEqual({ skill: 'cash' });
    expect(interpretAsk('expenses this month')).toEqual({
      skill: 'expenses',
      period: 'this_month',
    });
  });

  it('opens pages and answers how-to questions', () => {
    expect(interpretAsk('Open reports')).toEqual({ skill: 'goto', page: 'reports' });
    expect(interpretAsk('take me to the receipt design')).toEqual({
      skill: 'goto',
      page: 'receipt',
    });
    expect(interpretAsk('stock')).toEqual({ skill: 'goto', page: 'stock' });
    expect(interpretAsk('How do I close the day?')).toEqual({ skill: 'help', topic: 'closeDay' });
    expect(interpretAsk('how can I take a return')).toEqual({ skill: 'help', topic: 'returns' });
    expect(interpretAsk('how to add a cashier')).toEqual({ skill: 'help', topic: 'users' });
  });

  it('says when it does not understand', () => {
    expect(interpretAsk('write me a poem about tea')).toBeNull();
    // Advice is for the AI, not a sales report.
    expect(interpretAsk('ideas to sell more chargers?')).toBeNull();
  });
});

describe('periodRange', () => {
  it('works out the dates', () => {
    expect(periodRange('this_month', '2026-10-23')).toEqual({
      from: '2026-10-01',
      to: '2026-10-23',
    });
    expect(periodRange('last_month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    // 2026-10-23 is a Friday; weeks start on Monday.
    expect(periodRange('this_week', '2026-10-23')).toEqual({
      from: '2026-10-19',
      to: '2026-10-23',
    });
    expect(periodRange('last_week', '2026-10-23')).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
    expect(periodRange('last_7_days', '2026-10-23')).toEqual({
      from: '2026-10-17',
      to: '2026-10-23',
    });
  });
});

describe('smallTalk', () => {
  it('knows greetings, thanks and "what can you do"', () => {
    for (const hi of [
      'hi',
      'Hello!',
      'hey there',
      'Good morning',
      'ayubowan',
      'vanakkam',
      'how are you',
    ])
      expect(smallTalk(hi), hi).toBe('greeting');
    for (const ty of ['thanks', 'Thank you so much', 'ok thanks', 'great'])
      expect(smallTalk(ty), ty).toBe('thanks');
    expect(smallTalk('what can you do?')).toBe('about');
    expect(smallTalk('help')).toBe('about');
    expect(smallTalk('hide the logo')).toBeNull();
    expect(smallTalk('how are sales today')).toBeNull();
    expect(interpretAsk('hi')).toEqual({ skill: 'hello' });
  });

  it('answers the question after a greeting', () => {
    expect(interpretAsk('hi, how are sales today?')).toEqual({ skill: 'sales', period: 'today' });
    expect(interpretAsk('Hello what is running low')).toEqual({ skill: 'lowStock' });
  });
});
