import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import type { PdfReportData } from './pdf-report-reader';
import type { WorkerKind } from './extract-worker';

export type ExtractedFile = { rows: unknown[][]; pdf: PdfReportData | null };

/** The whole read, including start-up, must finish inside this time or the process is killed. */
export const EXTRACT_TIMEOUT_MS = 30_000;
/** V8 heap ceiling for the reading process; a file that needs more is refused, the API is not affected. */
export const EXTRACT_MAX_HEAP_MB = 512;
/** Largest answer accepted from the reading process. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Files read at the same time; the rest wait their turn so a burst of uploads cannot exhaust the host. */
const MAX_CONCURRENT = 2;

const BACKEND_ROOT = resolve(__dirname, '..', '..');
const COMPILED_WORKER = join(__dirname, 'extract-worker.js');

let running = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return;
  }
  await new Promise<void>((resolveTurn) => waiting.push(resolveTurn));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

/** Environment for the child: no database URL, no signing secrets, nothing from the API's settings. */
function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

/** Node options that confine the reading process (also used by the tests to prove the confinement). */
export function confinementFlags(): string[] {
  const flags = [`--max-old-space-size=${EXTRACT_MAX_HEAP_MB}`];
  // Node's permission model: the process can read the application folder but cannot write files,
  // start other processes or create workers. Skipped on a Node version that does not have it.
  if (process.allowedNodeEnvironmentFlags.has('--permission')) {
    flags.push('--permission', `--allow-fs-read=${BACKEND_ROOT}`);
  }
  return flags;
}

export function childEnvironmentForTests(): NodeJS.ProcessEnv {
  return childEnvironment();
}

function childArguments(kind: WorkerKind, filename: string): string[] {
  const args = confinementFlags();
  if (existsSync(COMPILED_WORKER)) {
    args.push(COMPILED_WORKER);
  } else {
    // Running from TypeScript source (development and tests).
    args.push('-r', 'ts-node/register/transpile-only', join(__dirname, 'extract-worker.ts'));
  }
  args.push(kind, filename);
  return args;
}

type WorkerAnswer =
  | { ok: true; pdf?: PdfReportData; rows?: unknown[][] }
  | { ok: false; message: string };

function runWorker(kind: WorkerKind, filename: string, buffer: Buffer): Promise<WorkerAnswer> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, childArguments(kind, filename), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(),
      cwd: BACKEND_ROOT,
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = '';
    let failure: string | null = null;
    let settled = false;

    const fail = (message: string) => {
      failure ??= message;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => fail('The file took too long to read'), EXTRACT_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_OUTPUT_BYTES) fail('The file produced too much data to read');
      else out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8');
    });
    child.stdin.on('error', () => undefined); // the child may exit before reading everything
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failure) return rejectRun(new Error(failure));
      if (code !== 0) {
        const message = /out of memory|heap/i.test(stderr)
          ? 'The file is too large or complex to read'
          : 'The file could not be read; export it again from the source system';
        return rejectRun(new Error(message));
      }
      try {
        resolveRun(JSON.parse(Buffer.concat(out).toString('utf8')) as WorkerAnswer);
      } catch {
        rejectRun(new Error('The file could not be read; export it again from the source system'));
      }
    });
    child.stdin.end(buffer);
  });
}

/**
 * Reads an uploaded file into rows inside a separate, resource-limited operating-system process.
 * A crafted file can crash, hang or exhaust only that process, which is killed on timeout; the API
 * keeps serving. Throws a plain Error with a user-safe message when the file cannot be read.
 */
export async function extractFile(
  kind: WorkerKind,
  buffer: Buffer,
  filename: string,
): Promise<ExtractedFile> {
  await acquire();
  try {
    const answer = await runWorker(kind, filename, buffer);
    if (!answer.ok) throw new Error(answer.message);
    if (kind === 'pdf' && answer.pdf) return { rows: answer.pdf.rows, pdf: answer.pdf };
    if (kind === 'table' && answer.rows) return { rows: answer.rows, pdf: null };
    throw new Error('The file could not be read; export it again from the source system');
  } finally {
    release();
  }
}
