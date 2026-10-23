import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  applySettingChanges,
  APPROVAL_HELP,
  ASSISTANT_SETTINGS,
  formatSetting,
  interpretReceiptCommand,
  interpretSettingsCommand,
  RECEIPT_CONDITIONS,
  RECEIPT_FIELD_HELP,
  RECEIPT_TEMPLATES,
  receiptActionSchema,
  type ReceiptAction,
  type ReceiptElement,
  type SettingChange,
} from '@shoppos/shared';
import { SettingsService } from '../settings/settings.service';
import { AiError } from './ai-error';
import { AiService } from './ai.service';

/** Where an answer came from: the built-in assistant (instant, offline) or the AI. */
export type AssistantSource = 'built-in' | 'ai';

export interface ReceiptAssistantAnswer {
  reply: string;
  actions: ReceiptAction[];
  source: AssistantSource;
  /** The AI was asked but could not answer (no internet, no key …); the reply says what to do. */
  aiProblem?: string;
}

export interface SettingsAssistantAnswer {
  reply: string;
  changes: SettingChange[];
  problems: string[];
  source: AssistantSource;
  aiProblem?: string;
}

const RECEIPT_ANSWER = z.object({
  reply: z.string().max(600),
  actions: z.array(receiptActionSchema).max(12),
});

const SETTING_PATHS = Object.keys(ASSISTANT_SETTINGS) as [string, ...string[]];
const SETTINGS_ANSWER = z.object({
  reply: z.string().max(600),
  changes: z
    .array(
      z.object({
        path: z.enum(SETTING_PATHS),
        value: z.union([z.string().max(300), z.number(), z.boolean(), z.array(z.string().max(40))]),
      }),
    )
    .max(10),
});

/** One piece of the design in a line the model can read: "3. id=ab12 text text="Hi" bold=true". */
function pieceLine(el: ReceiptElement, i: number): string {
  const opts = Object.entries(el)
    .filter(([k]) => k !== 'id' && k !== 'type')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  return `${i + 1}. id=${el.id} ${el.type}${opts ? ` ${opts}` : ''}`;
}

const RECEIPT_SYSTEM = `You change the receipt design of a small shop's point-of-sale system. Answer only with JSON that matches the schema: "reply" is one or two short, friendly sentences for the shop owner in plain words; "actions" is the list of changes.

The receipt prints top to bottom on a thermal printer and is made of pieces. Kinds of piece: text, pair (two columns: text = left, right = right), logo, divider (a line; style dashed|double|dotted|stars), space (lines 1-5), items (the bought items), totals, payments, itemCount, savings, barcode (bill barcode), qr (value = link or text), signature (text = label).
Text may contain fields filled in from each bill: ${RECEIPT_FIELD_HELP}.

Actions ("op"):
- add: new piece; set "piece" and its options. "position": top | bottom | above | below (with "anchor" = the piece it goes next to).
- update: change options of the "target" pieces: text, right, align (left|center|right), bold, size (normal|tall|wide|large), underline, invert (white on black), style, lines, value, qrSize (small|medium|large), itemLayout (two-line|one-line), showSku, showWarranty, showSerial, showDiscounts, numbered, bigTotal, simple, when, name.
- remove, hide, show, lock, unlock: the "target" pieces.
- move: "target" to "position" top | bottom | up | down | above | below (with "anchor").
- template: replace the whole design with "template" ${Object.keys(RECEIPT_TEMPLATES).join(' | ')}.
- copies: "count" 1-3 copies of every receipt.
- replace: change the words "find" to "replace" in every text.
- savePaper, check (look for mistakes), compare (compare with the saved design).
"target" and "anchor" are a piece id from the list, a kind of piece (e.g. "totals"), or words printed in the piece. "selected" means the selected pieces.
"when" prints a piece only on some bills: ${Object.keys(RECEIPT_CONDITIONS).join(', ')}.

Rules: use as few actions as possible. Never invent prices, totals, names or other bill data; they come from each bill through fields. If the request is not about the receipt, or these actions cannot do it, return no actions and say in "reply" what you can do.`;

function settingsSystem() {
  const lines = Object.entries(ASSISTANT_SETTINGS).map(([path, info]) => {
    const kind =
      info.kind === 'choice'
        ? `one of ${info.options!.join(', ')}`
        : info.kind === 'list'
          ? 'list of action codes'
          : info.kind === 'percent'
            ? 'number, percent (10 = 10%)'
            : info.kind;
    return `- ${path} (${kind}): ${info.hint}`;
  });
  return `You change the settings of a small shop's point-of-sale system. Answer only with JSON that matches the schema: "reply" is one or two short, friendly sentences for the shop owner in plain words; "changes" lists the settings to change with their new value.

Settings you may change:
${lines.join('\n')}
Action codes for approvals.requireApprovalFor: ${APPROVAL_HELP}. Give the full new list.

Rules: change only what was asked. Money amounts are in cents (Rs 10 = 1000). If the request is not about these settings, return no changes and say in "reply" what you can do. The owner checks every change before it is saved.`;
}

/**
 * The assistant of the receipt editor and Settings. Requests are first given to the built-in
 * assistant (instant, no AI needed). What it does not understand goes to the free local AI model
 * when the shop has turned it on. The model can only choose from the same fixed actions, and
 * every answer is checked before it is passed on.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly settings: SettingsService,
    private readonly ai: AiService,
  ) {}

  async receipt(input: {
    message: string;
    layout: ReceiptElement[];
    selectedIds: string[];
    copies: number;
  }): Promise<ReceiptAssistantAnswer> {
    const builtIn = interpretReceiptCommand(input.message, input.layout, input.selectedIds);
    if (builtIn.understood) return { ...builtIn, source: 'built-in' };
    if (!(await this.ai.available()))
      return {
        reply: `${builtIn.reply} ${await this.ai.unavailableReason()}`,
        actions: [],
        source: 'built-in',
      };

    const pieces = input.layout.map(pieceLine).join('\n') || '(empty)';
    const selected = input.selectedIds.length ? input.selectedIds.join(', ') : 'none';
    const user = `Receipt now, top to bottom (${input.copies} copy per bill):\n${pieces}\nSelected pieces: ${selected}\n\nRequest: ${input.message}`;
    let raw: unknown;
    try {
      raw = await this.ai.json(RECEIPT_SYSTEM, user, RECEIPT_ANSWER);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      return {
        reply: `${builtIn.reply} (${err.message})`,
        actions: [],
        source: 'built-in',
        aiProblem: err.message,
      };
    }
    // Keep each valid action; anything else the model made up is dropped.
    const parsed = raw as { reply?: unknown; actions?: unknown };
    const actions = (Array.isArray(parsed.actions) ? parsed.actions : [])
      .map((a) => receiptActionSchema.safeParse(a))
      .filter((r) => r.success)
      .map((r) => r.data)
      .slice(0, 12);
    return { reply: replyText(parsed.reply, actions.length), actions, source: 'ai' };
  }

  async settingsChange(message: string): Promise<SettingsAssistantAnswer> {
    const current = this.settings.all();
    const builtIn = interpretSettingsCommand(message, current);
    if (builtIn.understood) {
      const checked = applySettingChanges(current, builtIn.actions);
      return {
        reply: builtIn.reply,
        changes: builtIn.actions,
        problems: checked.problems,
        source: 'built-in',
      };
    }
    if (!(await this.ai.available()))
      return {
        reply: `${builtIn.reply} ${await this.ai.unavailableReason()}`,
        changes: [],
        problems: [],
        source: 'built-in',
      };

    const now = Object.keys(ASSISTANT_SETTINGS)
      .map((path) => {
        const [section, key] = path.split('.') as [keyof typeof current, string];
        const value = (current[section] as Record<string, unknown>)[key];
        return `${path} = ${JSON.stringify(value)} (${formatSetting(path, value)})`;
      })
      .join('\n');
    let raw: unknown;
    try {
      raw = await this.ai.json(
        settingsSystem(),
        `Settings now:\n${now}\n\nRequest: ${message}`,
        SETTINGS_ANSWER,
      );
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      return {
        reply: `${builtIn.reply} (${err.message})`,
        changes: [],
        problems: [],
        source: 'built-in',
        aiProblem: err.message,
      };
    }
    const parsed = raw as { reply?: unknown; changes?: unknown };
    const proposed: SettingChange[] = [];
    for (const c of Array.isArray(parsed.changes) ? parsed.changes : []) {
      const path = (c as { path?: unknown }).path;
      const info = typeof path === 'string' ? ASSISTANT_SETTINGS[path] : undefined;
      if (!info) continue;
      let value = (c as { value?: unknown }).value;
      // The model gives percentages as percent; they are stored as basis points.
      if (info.kind === 'percent') value = Math.round(Number(value) * 100);
      proposed.push({ path: path as string, value: value as SettingChange['value'] });
    }
    const checked = applySettingChanges(current, proposed);
    const changes = proposed.filter((c) =>
      checked.sections.includes(c.path.split('.')[0] as never),
    );
    return {
      reply: replyText(parsed.reply, changes.length),
      changes,
      problems: checked.problems,
      source: 'ai',
    };
  }
}

/** The AI's own words, or a plain sentence when it gave none. */
export function replyText(reply: unknown, count: number) {
  const text = typeof reply === 'string' ? reply.trim() : '';
  if (text) return text.slice(0, 600);
  return count ? 'Here is what I would change.' : 'I could not do that with the tools I have.';
}
