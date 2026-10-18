import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrinterSettings } from '@shoppos/shared';
import { runPowerShell } from '../../common/powershell';

/**
 * Sends raw ESC/POS bytes to the receipt printer.
 * - windows: through the Windows print spooler in RAW mode (works with the USB printer's driver).
 * - network: straight to a network printer on port 9100.
 * - file:    saved to disk (for testing without a printer).
 */

export class PrinterError extends Error {}

const RAW_PRINTER_CS = `
using System;
using System.Runtime.InteropServices;
namespace ShopPos {
  public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO {
      [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
      [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
      [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

    public static void Send(string printer, byte[] data) {
      IntPtr h;
      if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Printer not found: " + printer);
      try {
        DOCINFO info = new DOCINFO();
        info.pDocName = "ShopPOS receipt";
        info.pDataType = "RAW";
        if (StartDocPrinter(h, 1, info) == 0) throw new Exception("The printer did not accept the job");
        StartPagePrinter(h);
        int written;
        bool ok = WritePrinter(h, data, data.Length, out written);
        EndPagePrinter(h);
        EndDocPrinter(h);
        if (!ok || written != data.Length) throw new Exception("Could not send the receipt to the printer");
      } finally {
        ClosePrinter(h);
      }
    }
  }
}`;

/** Compiles the helper once (cached as a DLL), then sends the file to the printer. */
const SEND_SCRIPT = `
$ErrorActionPreference = 'Stop'
$dll = $env:POS_RAW_DLL
if (-not (Test-Path $dll)) {
  $source = [IO.File]::ReadAllText($env:POS_RAW_CS)
  Add-Type -TypeDefinition $source -OutputAssembly $dll -OutputType Library
}
Add-Type -Path $dll
[ShopPos.RawPrinter]::Send($env:POS_PRINTER, [IO.File]::ReadAllBytes($env:POS_FILE))
`;

const LIST_SCRIPT = `
$ErrorActionPreference = 'Stop'
try { Get-Printer | ForEach-Object { $_.Name } }
catch { Get-CimInstance Win32_Printer | ForEach-Object { $_.Name } }
`;

async function powershell(
  script: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  try {
    return await runPowerShell(script, env, timeoutMs);
  } catch (err) {
    const message = (err as Error).message;
    throw new PrinterError(
      message
        .replace(/^.*Exception calling "Send".*?: "/, '')
        .replace(/"$/, '')
        .trim(),
    );
  }
}

async function sendWindows(
  bytes: Buffer,
  printerName: string,
  storageDir: string,
): Promise<string> {
  if (process.platform !== 'win32') {
    throw new PrinterError(
      'Windows printing only works on the shop computer. Use "file" mode to test here.',
    );
  }
  if (!printerName) throw new PrinterError('Choose the receipt printer in Settings → Printer.');
  const dir = path.join(storageDir, 'printing');
  await mkdir(dir, { recursive: true });
  const csFile = path.join(dir, 'RawPrinter.cs');
  await writeFile(csFile, RAW_PRINTER_CS);
  const jobFile = path.join(tmpdir(), `shoppos-${process.pid}-${Date.now()}.bin`);
  await writeFile(jobFile, bytes);
  try {
    await powershell(
      SEND_SCRIPT,
      {
        POS_RAW_DLL: path.join(dir, 'ShopPosRawPrinter.dll'),
        POS_RAW_CS: csFile,
        POS_PRINTER: printerName,
        POS_FILE: jobFile,
      },
      30_000,
    );
  } finally {
    await rm(jobFile, { force: true });
  }
  return printerName;
}

function sendNetwork(bytes: Buffer, host: string, port: number): Promise<string> {
  if (!host)
    return Promise.reject(new PrinterError('Enter the printer address in Settings → Printer.'));
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(8_000);
    socket.on('connect', () => socket.end(bytes));
    socket.on('close', (hadError) => !hadError && resolve(`${host}:${port}`));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new PrinterError(`The printer at ${host}:${port} did not answer`));
    });
    socket.on('error', (err) =>
      reject(new PrinterError(`Could not reach the printer at ${host}:${port} (${err.message})`)),
    );
  });
}

async function sendFile(
  bytes: Buffer,
  preview: string,
  storageDir: string,
  label: string,
): Promise<string> {
  const dir = path.join(storageDir, 'prints');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(dir, `${stamp}-${label.replace(/[^\w-]/g, '_')}`);
  await writeFile(`${base}.bin`, bytes);
  await writeFile(`${base}.txt`, preview);
  return `${base}.txt`;
}

export async function sendToPrinter(
  bytes: Buffer,
  settings: PrinterSettings,
  ctx: { storageDir: string; preview: string; label: string },
): Promise<string> {
  switch (settings.mode) {
    case 'windows':
      return sendWindows(bytes, settings.windowsPrinterName, ctx.storageDir);
    case 'network':
      return sendNetwork(bytes, settings.networkHost, settings.networkPort);
    case 'file':
      return sendFile(bytes, ctx.preview, ctx.storageDir, ctx.label);
    case 'browser':
      throw new PrinterError('Receipts are printed by the browser (Settings → Printer).');
  }
}

/** Printers installed in Windows (empty on other systems). */
export async function listWindowsPrinters(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const out = await powershell(LIST_SCRIPT, {}, 20_000);
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
