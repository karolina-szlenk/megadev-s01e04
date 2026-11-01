// Plan morning-digest, section 1: the run log reader.
// Parses runs/<night>.jsonl at the edge; everything after works on typed LogLines.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, LogLine, NightResult, ReadNight, RunStatus, StatusCounts } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
// ISO 8601 date-time with an explicit offset (or Z). Kept as written, never converted.
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(v: unknown): v is RunStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

// One raw line -> LogLine, or null when it doesn't parse or has the wrong shape.
export function parseLine(raw: string): LogLine | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || !AT.test(o.at)) return null;
  if (typeof o.job !== 'string' || o.job.trim() === '') return null;
  if (!isStatus(o.status)) return null;
  if (!('owner' in o) || (o.owner !== null && typeof o.owner !== 'string')) return null;
  if (o.error !== undefined && typeof o.error !== 'string') return null;
  const line: LogLine = { at: o.at, job: o.job, status: o.status, owner: o.owner };
  if (o.error !== undefined) line.error = o.error;
  return line;
}

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

// Lines within a job are taken in file order: the log is written in time order,
// so the first line is the job's first run and the last line its last.
export const readNight: ReadNight = (runsDir, night): NightResult => {
  if (!NIGHT.test(night)) return { found: false };
  const text = readFile(join(runsDir, `${night}.jsonl`));
  if (text === null) return { found: false };

  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  const rows = new Map<string, DigestRow>();
  let badLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue; // blank lines (incl. the trailing newline) are not lines
    const line = parseLine(raw);
    if (line === null) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const row = rows.get(line.job);
    if (row === undefined) {
      rows.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        fails: line.status === 'fail' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error ?? null,
        firstAt: line.at,
        lastAt: line.at,
      });
      continue;
    }
    row.owner = line.owner;
    row.runs++;
    if (line.status === 'retry') row.retries++;
    if (line.status === 'fail') row.fails++;
    row.lastStatus = line.status;
    if (line.error !== undefined) row.lastError = line.error;
    row.lastAt = line.at;
  }

  const sorted = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { found: true, rows: sorted, badLines, counts };
};
