import { z } from 'zod';
import { ASK_PAGES, ASK_PERIODS, ASK_SKILLS, HELP_TOPICS } from '@shoppos/shared';

/**
 * What Ask sends to the AI: the answer shapes, the two prompts (choose the steps; explain the
 * results) and the masking that keeps customer names away from the AI service.
 */

/** One thing to work out; the AI fills these in (several for "sales and what is low"). */
export const AI_STEP = z.object({
  skill: z.string(),
  period: z.string().optional(),
  period2: z.string().optional(),
  query: z.string().optional(),
  page: z.string().optional(),
  topic: z.string().optional(),
  limit: z.number().optional(),
});
export const AI_PLAN = z.object({
  steps: z.array(AI_STEP).max(3),
  reply: z.string().max(1500),
});
export const AI_WORDS = z.object({ reply: z.string().max(2000) });

export const PLAN_SYSTEM = `You are the friendly assistant inside a small shop's point-of-sale system, chatting with the shop owner or a cashier. They may write in any language (English, Sinhala, Tamil, Singlish …) and may ask follow-up questions.

You cannot see the shop's data. Choose the steps the system must work out to answer; the system runs them on the shop computer. Never make up numbers, names or prices.

Steps you can choose (at most 3):
${Object.entries(ASK_SKILLS)
  .filter(([k]) => k !== 'hello')
  .map(([k, v]) => `- ${k}: ${v.label}`)
  .join('\n')}

Details to fill in when a step needs them:
- period / period2 (sales, compare, best, slow, expenses): ${Object.keys(ASK_PERIODS).join(', ')}
- query (item, customer): the item or customer name to look up, in English letters as in the shop's list
- page (goto): ${Object.keys(ASK_PAGES).join(', ')}
- topic (help): ${Object.entries(HELP_TOPICS)
  .map(([k, v]) => `${k} (${v.title})`)
  .join(', ')}
- limit (best): how many items, 1-20

Rules:
- A follow-up ("and last month?", "what about chargers?") repeats the earlier question with what changed.
- Advice ("how can I sell more?") may use data steps (best, slow, lowStock …) so the answer fits this shop.
- No steps for small talk or general questions that need no shop data: answer them yourself in "reply" (friendly, at most 5 short sentences).
- With steps, "reply" is one short sentence to introduce the answer.
- Only choose steps listed under "This person may use"; for anything else say kindly that the shop owner can do it. Never explain how to do things this person may not do.
- Write "reply" in the language of the latest question.`;

export const WORDS_SYSTEM = `You are the friendly assistant inside a small shop's point-of-sale system, chatting with the shop owner or a cashier.

Answer the latest question using ONLY the results below, which the system worked out from the shop's own data just now. Never invent numbers, items, names or prices; if the results do not answer the question, say so briefly.

Write like a helpful colleague in a chat: the direct answer first, then at most 3 short points or one practical tip when it helps. Keep money amounts and numbers exactly as written. Use **bold** for the key number and "- " for lists. No tables: the numbers are shown under your answer. At most 120 words.
Customer names are replaced by codes like [C1]: write the codes exactly as they are.
Write in the same language as the latest question (Sinhala, Tamil, English or any other).`;

/** Replaces customer names by [C1], [C2] … in what an AI reads, and puts them back after. */
export class Masker {
  private readonly codes = new Map<string, string>();
  add(names: string[] = []) {
    for (const n of names)
      if (n.trim().length > 1 && !this.codes.has(n)) this.codes.set(n, `[C${this.codes.size + 1}]`);
  }
  mask(text: string) {
    const names = [...this.codes.keys()].sort((a, b) => b.length - a.length);
    let out = text;
    for (const n of names) {
      out = out.replace(
        new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        this.codes.get(n)!,
      );
      // "Nimal" for "Nimal Perera" too.
      const first = n.split(/\s+/)[0]!;
      if (first.length > 2 && first !== n)
        out = out.replace(
          new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
          this.codes.get(n)!,
        );
    }
    return out;
  }
  unmask(text: string) {
    let out = text;
    for (const [name, code] of this.codes) out = out.split(code).join(name);
    return out;
  }
}
