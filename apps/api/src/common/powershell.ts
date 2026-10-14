import { execFile } from 'node:child_process';

/** Error from a PowerShell script, with the first useful line of its message. */
export class PowerShellError extends Error {}

/**
 * Runs a PowerShell script on Windows (the script is passed encoded, so quoting is never a problem).
 * Resolves with what the script printed.
 */
export function runPowerShell(
  script: string,
  env: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const message = (stderr || err.message).split('\n').find((l) => l.trim()) ?? err.message;
          reject(new PowerShellError(message.trim()));
        } else resolve(stdout);
      },
    );
  });
}
