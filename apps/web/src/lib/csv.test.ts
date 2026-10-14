import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields, commas and line breaks inside quotes', () => {
    const text =
      '\uFEFFName,Price\r\n"Case, black","1,500"\r\n"Say ""hi""",200\n"Two\nlines",3\n\n';
    expect(parseCsv(text)).toEqual([
      ['Name', 'Price'],
      ['Case, black', '1,500'],
      ['Say "hi"', '200'],
      ['Two\nlines', '3'],
    ]);
  });

  it('detects semicolons and tabs', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('writes CSV that reads back the same', () => {
    const rows = [
      ['Name', 'Note'],
      ['Case, black', 'He said "ok"'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
