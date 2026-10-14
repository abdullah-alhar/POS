import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from './app-exception';

export function zodIssuesToFields(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Validates and converts a body / query with a shared Zod schema. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const fields = zodIssuesToFields(result.error.issues);
    const first = Object.values(fields)[0] ?? 'Invalid input';
    throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', first, { fields });
  }
}
