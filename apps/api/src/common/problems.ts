import { randomBytes } from 'node:crypto';
import type { ProblemDto } from '@shoppos/shared';

/** The last unexpected errors, newest first (Settings → Problems). Kept in memory and in the log. */
const MAX = 100;
const problems: ProblemDto[] = [];

/** A short reference people can read out on the phone: 6 letters and digits, no 0/O or 1/I. */
export function newRef(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('');
}

export function recordProblem(p: ProblemDto) {
  problems.unshift(p);
  problems.length = Math.min(problems.length, MAX);
}

export function recentProblems(): ProblemDto[] {
  return [...problems];
}
