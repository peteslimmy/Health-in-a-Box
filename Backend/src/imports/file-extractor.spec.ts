import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { childEnvironmentForTests, confinementFlags, extractFile } from './file-extractor';

// These tests start real operating-system processes, exactly as an upload does.
jest.setTimeout(60_000);

const csv = (text: string) => Buffer.from(text, 'utf8');
const node = (script: string, env: NodeJS.ProcessEnv = childEnvironmentForTests()) =>
  spawnSync(process.execPath, [...confinementFlags(), '-e', script], {
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });

describe('extractFile (isolated reading)', () => {
  it('reads a CSV in a separate process and returns plain rows', async () => {
    const result = await extractFile(
      'table',
      csv('S/N,Revenue Department,Cash\n1,Pharmacy,"₦1,000.00"\n'),
      'daily.csv',
    );
    expect(result.pdf).toBeNull();
    expect(result.rows).toEqual([
      ['S/N', 'Revenue Department', 'Cash'],
      ['1', 'Pharmacy', '₦1,000.00'],
    ]);
  });

  it("returns the reader's own message when a file breaks a limit", async () => {
    const wide = Array.from({ length: 101 }, (_, i) => `c${i}`).join(',');
    await expect(extractFile('table', csv(`${wide}\n`), 'wide.csv')).rejects.toThrow(
      'more than 100 columns',
    );
  });

  it('refuses a file that is not a PDF with a readable message', async () => {
    await expect(extractFile('pdf', csv('not a pdf'), 'x.pdf')).rejects.toThrow('not a valid PDF');
  });

  it('reads several files at once without mixing the answers', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => extractFile('table', csv(`a,b\n${n},x\n`), 'f.csv')),
    );
    expect(results.map((r) => r.rows[1][0])).toEqual(['1', '2', '3', '4']);
  });
});

describe('confinement of the reading process', () => {
  const permission = process.allowedNodeEnvironmentFlags.has('--permission');
  const itIfPermission = permission ? it : it.skip;

  itIfPermission('cannot write files', () => {
    const target = join(tmpdir(), `hnb-escape-${Date.now()}.txt`).split(sep).join('/');
    const run = node(
      `try { require('fs').writeFileSync('${target}', 'x'); console.log('WROTE'); } catch (e) { console.log(e.code); }`,
    );
    expect(run.stdout.trim()).toBe('ERR_ACCESS_DENIED');
  });

  itIfPermission('cannot start other processes', () => {
    const run = node(
      `try { require('child_process').execSync('echo hi'); console.log('SPAWNED'); } catch (e) { console.log(e.code); }`,
    );
    expect(run.stdout.trim()).toBe('ERR_ACCESS_DENIED');
  });

  itIfPermission('cannot read files outside the application folder', () => {
    const run = node(
      `try { require('fs').readFileSync(process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/passwd'); console.log('READ'); } catch (e) { console.log(e.code); }`,
    );
    expect(run.stdout.trim()).toBe('ERR_ACCESS_DENIED');
  });

  it("does not inherit the API's secrets", () => {
    const run = node(
      `console.log(JSON.stringify(Object.keys(process.env).filter(k => /SECRET|DATABASE|PASSWORD|JWT/i.test(k))))`,
      { ...childEnvironmentForTests(), PATH: process.env.PATH },
    );
    expect(run.stdout.trim()).toBe('[]');
    expect(
      Object.keys(childEnvironmentForTests()).some((k) => /SECRET|DATABASE|JWT/i.test(k)),
    ).toBe(false);
  });

  it('a runaway allocation ends only the child process', () => {
    const run = node(`const a = []; for (;;) a.push(new Array(1e6).fill('x'.repeat(100)));`);
    expect(run.status).not.toBe(0);
    expect(`${run.stderr}`).toMatch(/heap|memory/i);
  });
});
