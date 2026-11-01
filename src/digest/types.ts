// Plan morning-digest, section 1. The contract every part of section 2 codes against.
// Types only; the reader lives next to this file.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once it has parsed.
export type LogLine = {
  at: string; // ISO 8601 with the log's own offset, kept as written
  job: string;
  status: RunStatus;
  owner: string | null; // null = owner unknown; the row stays, shown as `—`
  error?: string; // only on lines that carry one
};

// One row per job for the night.
export type DigestRow = {
  job: string;
  owner: string | null; // from the job's last line; null = unknown
  runs: number; // lines for this job, any status
  retries: number; // lines with status `retry`
  lastStatus: RunStatus; // status of the job's last line
  lastError: string | null; // last `error` seen for the job; null when none
  firstAt: string; // `at` of the first line, log's offset kept
  lastAt: string; // `at` of the last line, log's offset kept
};

// Line counts by status for the night (status board, section 2c).
export type StatusCounts = Record<RunStatus, number>;

// `found: false`: no runs/<night>.jsonl (page answers 404).
// `found` with no rows: the file is there but nothing ran.
export type NightResult =
  | { found: false }
  | {
      found: true;
      rows: DigestRow[]; // sorted by job; the page and the JSON use this order
      badLines: number; // lines that didn't parse; counted, never thrown
      counts: StatusCounts;
    };

// Reads runs/<night>.jsonl from runsDir. Never throws on bad lines.
export type ReadNight = (runsDir: string, night: string) => NightResult;
