import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from './read.js';
import type { NightResult } from './types.js';

const RUNS = join(import.meta.dirname, '..', '..', 'runs'); // read-only fixtures

function found(r: NightResult) {
  if (!r.found) throw new Error('expected the night to be found');
  return r;
}

const temps: string[] = [];
function tempRuns(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  temps.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = found(readNight(RUNS, '2026-10-28'));
  const row = (job: string) => night.rows.find((r) => r.job === job);

  it('has 5 jobs sorted by job and 1 bad line', () => {
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.badLines).toBe(1);
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('counts retries and keeps the last error', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps a row whose owner is null', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, runs: 1, fails: 0, lastStatus: 'ok', lastError: null });
  });

  it('marks a failed job', () => {
    expect(row('notes/backup')).toMatchObject({
      owner: 'lane-07',
      fails: 1,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });

  it('keeps the offset from the log, no UTC conversion', () => {
    expect(row('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      fails: 0,
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    for (const r of night.rows) {
      expect(r.firstAt).toMatch(/\+01:00$/);
      expect(r.lastAt).toMatch(/\+01:00$/);
    }
  });
});

describe('readNight edge cases (temp runs dir)', () => {
  it('no file: not found', () => {
    expect(readNight(tempRuns(), '2026-10-30')).toEqual({ found: false });
  });

  it('missing runs dir: not found', () => {
    expect(readNight(join(tempRuns(), 'nope'), '2026-10-30')).toEqual({ found: false });
  });

  it('a night that is not a date is not found (no path escape)', () => {
    expect(readNight(tempRuns({ 'x.jsonl': '' }), '../x')).toEqual({ found: false });
  });

  it('empty file: found, nothing ran', () => {
    expect(readNight(tempRuns({ '2026-10-30.jsonl': '' }), '2026-10-30')).toEqual({
      found: true,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips blank lines; counts wrong-shaped JSON as bad', () => {
    const ok = '{"at":"2026-10-30T01:00:00-05:00","job":"a","status":"ok","owner":"x"}';
    const body = [
      '',
      ok,
      '   ',
      '{"at":"2026-10-30T01:00:00-05:00","status":"ok","owner":"x"}', // no job
      '{"at":"2026-10-30T01:00:00-05:00","job":"a","status":"done","owner":"x"}', // unknown status
      '{"at":"2026-10-30T01:00:00-05:00","job":"a","status":"ok"}', // no owner key
      '{"at":"yesterday","job":"a","status":"ok","owner":"x"}', // bad time
      '{"at":"2026-10-30T01:00:00-05:00","job":"a","status":"ok","owner":"x","error":5}', // bad error
      '[1,2]',
      'null',
      'not json',
      '',
    ].join('\r\n');
    const r = found(readNight(tempRuns({ '2026-10-30.jsonl': body }), '2026-10-30'));
    expect(r.badLines).toBe(8);
    expect(r.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(r.rows).toEqual([
      {
        job: 'a',
        owner: 'x',
        runs: 1,
        retries: 0,
        fails: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-30T01:00:00-05:00',
        lastAt: '2026-10-30T01:00:00-05:00',
      },
    ]);
  });

  it('takes owner and status from the last line in file order', () => {
    const body = [
      '{"at":"2026-10-30T01:00:00+02:00","job":"b","status":"fail","owner":"x","error":"boom"}',
      '{"at":"2026-10-30T02:00:00+02:00","job":"a","status":"ok","owner":"y"}',
      '{"at":"2026-10-30T03:00:00+02:00","job":"b","status":"ok","owner":null}',
    ].join('\n');
    const r = found(readNight(tempRuns({ '2026-10-30.jsonl': body }), '2026-10-30'));
    expect(r.rows.map((x) => x.job)).toEqual(['a', 'b']);
    expect(r.rows[1]).toEqual({
      job: 'b',
      owner: null,
      runs: 2,
      retries: 0,
      fails: 1,
      lastStatus: 'ok',
      lastError: 'boom',
      firstAt: '2026-10-30T01:00:00+02:00',
      lastAt: '2026-10-30T03:00:00+02:00',
    });
  });
});
