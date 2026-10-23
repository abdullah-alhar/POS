import type { RefObject } from 'react';
import {
  applyReceiptActions,
  RECEIPT_ASSISTANT_EXAMPLES,
  type ReceiptAction,
} from '@shoppos/shared';
import { api } from '@/lib/api';
import { AssistantChat, type AssistantTurn } from '../assistant/assistant-chat';
import { currentDesign, useStudio } from './store';

interface Answer {
  reply: string;
  actions: ReceiptAction[];
  source: 'built-in' | 'ai';
}

/** Ask for changes in plain words; each answer is one history step (and can be undone). */
export function AssistantPanel({ inputRef }: { inputRef?: RefObject<HTMLTextAreaElement | null> }) {
  async function send(message: string): Promise<AssistantTurn> {
    const design = currentDesign();
    const { selected } = useStudio.getState();
    const answer = await api.post<Answer>('/assistant/receipt', {
      message,
      layout: design.layout,
      selectedIds: selected,
      copies: design.copies,
    });
    // The answer is applied to the design as it is now (it may have changed while waiting).
    const now = currentDesign();
    const result = applyReceiptActions(now.layout, answer.actions, {
      copies: now.copies,
      selectedIds: useStudio.getState().selected,
    });
    const studio = useStudio.getState();
    let undo: (() => void) | undefined;
    const changed = result.layout !== now.layout && result.done.length > 0;
    if (changed || result.copies !== now.copies) {
      const before = studio.index;
      studio.commit(
        `Assistant: ${message.length > 40 ? `${message.slice(0, 39)}…` : message}`,
        { layout: result.layout, copies: result.copies },
        { select: result.select },
      );
      undo = () => useStudio.getState().jump(before);
    }
    if (result.check) studio.setDock('checks');
    if (result.compare) studio.setCompare(true);
    if (result.undo) studio.undo();

    const reply =
      answer.reply ||
      (result.check
        ? 'I opened the design check.'
        : result.compare
          ? 'Showing the saved receipt next to this one. Changes are outlined: green added, amber changed, blue moved, red removed.'
          : result.undo
            ? 'Undone.'
            : result.done.length
              ? 'Done.'
              : '');
    return { reply, done: result.done, problems: result.problems, source: answer.source, undo };
  }

  return (
    <AssistantChat
      intro="Tell me how the receipt should look."
      examples={RECEIPT_ASSISTANT_EXAMPLES}
      send={send}
      placeholder="e.g. make the total big and add our WhatsApp 0771234567"
      inputRef={inputRef}
    />
  );
}
