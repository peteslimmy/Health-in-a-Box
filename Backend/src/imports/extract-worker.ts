/**
 * Child-process entry point that reads one untrusted upload (PDF, CSV or XLSX) into plain rows.
 * It is started by `file-extractor.ts`, receives the file on stdin and answers with one JSON
 * document on stdout. It never touches the database, the network or the application's secrets.
 */
import { readPdfReport } from './pdf-report-reader';
import { readRows } from './table-reader';

export type WorkerKind = 'pdf' | 'table';

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const kind = process.argv[2] as WorkerKind;
  const filename = process.argv[3] ?? '';
  let output: unknown;
  try {
    const buffer = await readStdin();
    if (kind === 'pdf') {
      output = { ok: true, pdf: await readPdfReport(buffer) };
    } else {
      output = { ok: true, rows: readRows(buffer, filename) };
    }
  } catch (error) {
    output = { ok: false, message: (error as Error).message ?? 'The file could not be read' };
  }
  process.stdout.write(JSON.stringify(output), () => process.exit(0));
}

if (require.main === module) {
  void main();
}
