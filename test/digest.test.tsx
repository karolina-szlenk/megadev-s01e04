import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const base = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify(error === undefined ? { at, job, status, owner } : { at, job, status, owner, error });

const NORMAL = [
  line('2026-10-29T01:00:00+01:00', 'zeta/job', 'ok', 'rook'),
  line('2026-10-29T01:10:00+01:00', 'alpha/job', 'retry', 'lane-07', 'boom'),
  line('2026-10-29T01:20:00+01:00', 'alpha/job', 'ok', null),
].join('\n');

let tmp: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  process.env.LANE_MARKER = 'TEST-MARKER';
  tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(tmp, '2026-11-01.jsonl'), NORMAL + '\n');
  writeFileSync(join(tmp, '2026-11-02.jsonl'), '');
  writeFileSync(join(tmp, '2026-11-03.jsonl'), NORMAL + '\nnot json\n');
  app = createApp({ ...base, runsDir: tmp });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

type Api = { night: string; rows: { job: string }[]; badLines: number };

describe('GET /digest/:night', () => {
  it('200 with the rows sorted by job and the lane banner', async () => {
    const res = await app.request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('alpha/job');
    expect(html).toContain('zeta/job');
    expect(html.indexOf('alpha/job')).toBeLessThan(html.indexOf('zeta/job'));
    expect(html).not.toContain('nothing ran');
  });

  it('404 for a night with no file', async () => {
    const res = await app.request('/digest/2026-12-31');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for 2026-12-31');
  });

  it('empty night: 200 and "nothing ran"', async () => {
    const res = await app.request('/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('bad line: still 200, rows shown, "didn\'t parse" note', async () => {
    const res = await app.request('/digest/2026-11-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line didn&#39;t parse');
    expect(html).toContain('alpha/job');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with the rows', async () => {
    const res = await app.request('/api/digest/2026-11-01');
    const body = (await res.json()) as Api;
    expect(res.status).toBe(200);
    expect(body.night).toBe('2026-11-01');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/job', 'zeta/job']);
  });

  it('404 for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-12-31');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2026-12-31' });
  });

  it('empty night: 200 with no rows', async () => {
    const res = await app.request('/api/digest/2026-11-02');
    const body = (await res.json()) as Api;
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('bad line: still 200, badLines 1, rows kept', async () => {
    const res = await app.request('/api/digest/2026-11-03');
    const body = (await res.json()) as Api;
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows).toHaveLength(2);
  });
});

describe('page and JSON agree (ADR 0001)', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app.request('/digest/2026-11-03')).text();
    const body = (await (await app.request('/api/digest/2026-11-03')).json()) as Api;
    const fromPage = [...html.matchAll(/<tr[^>]*><td>([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(fromPage).toEqual(body.rows.map((r) => r.job));
    expect(fromPage.length).toBeGreaterThan(0);
  });
});
