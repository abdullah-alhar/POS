import {
  APPROVAL_HEADER,
  type ApiErrorBody,
  type ApprovalAction,
  type ErrorCode,
} from '@shoppos/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;
  /** Reference of an unexpected server error (Settings → Problems). */
  readonly ref?: string;
  /** True when the user closed the admin PIN dialog; no error toast is needed. */
  readonly cancelled: boolean;

  constructor(body: ApiErrorBody, cancelled = false) {
    super(body.message);
    this.status = body.statusCode;
    this.code = body.code;
    this.fields = body.fields;
    this.details = body.details;
    this.ref = body.ref;
    this.cancelled = cancelled;
  }
}

/** Opens the admin PIN dialog. Resolves with an approval token, or null if cancelled. */
type ApprovalHandler = (action: ApprovalAction, message: string) => Promise<string | null>;
let approvalHandler: ApprovalHandler | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setApprovalHandler(handler: ApprovalHandler | null) {
  approvalHandler = handler;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  approvalToken?: string;
  signal?: AbortSignal;
  /** Don't open the admin PIN dialog on APPROVAL_REQUIRED (used by the dialog itself). */
  noApproval?: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(opts.approvalToken && { [APPROVAL_HEADER]: opts.approvalToken }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError({
      statusCode: 0,
      code: 'DB_UNAVAILABLE',
      message: 'Cannot reach the POS server. Check that the POS computer is on and try again.',
    });
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) return data as T;

  const error = new ApiError(
    (data as ApiErrorBody | null) ?? {
      statusCode: res.status,
      code: 'INTERNAL',
      message: `The server answered with an error (${res.status}).`,
    },
  );

  if (error.code === 'APPROVAL_REQUIRED' && approvalHandler && !opts.noApproval) {
    const action = error.details?.action as ApprovalAction;
    const token = await approvalHandler(action, error.message);
    if (!token) {
      throw new ApiError(
        {
          statusCode: 403,
          code: 'APPROVAL_REQUIRED',
          message: 'Cancelled: admin approval was not given.',
        },
        true,
      );
    }
    return request<T>(method, path, body, { ...opts, approvalToken: token });
  }

  if (error.code === 'UNAUTHORIZED' && !path.startsWith('/auth/')) unauthorizedHandler?.();
  throw error;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>('PUT', path, body, opts),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>('PATCH', path, body, opts),
  delete: <T = void>(path: string, opts?: RequestOptions) =>
    request<T>('DELETE', path, undefined, opts),
};

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
