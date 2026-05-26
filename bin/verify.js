#!/usr/bin/env node
'use strict';
/**
 * hermes-mastery validator CLI
 *
 * Usage: node bin/verify.js <module-number>
 *
 * Reads no LLM input. Executes each check for the given module and outputs
 * ONE JSON object on stdout, exits 0. All external calls go through argv-style
 * execFile (no shell) or native fetch — no `bash -lc` and no shell-injection
 * surface. The SKILL.md wrapper invokes this CLI and returns its stdout verbatim
 * — no agent discretion in the path.
 */

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  readFileSync, writeFileSync, statSync, lstatSync,
  existsSync, realpathSync, mkdirSync,
} = require('node:fs');
const { homedir, platform: osPlatform } = require('node:os');
const { dirname, join } = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = join(__dirname, '..');

const PLATFORM = osPlatform() === 'darwin' ? 'macos' : 'linux';
const SCHEMA_VERSION = 1;

// ── Helpers ──────────────────────────────────────────────────────────────

function expandHome(p) {
  // path.join can mishandle leading `/` on the second argument.
  // Plain string concat is unambiguous.
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

/** Run a binary with argv (no shell), return { stdout, stderr, status }. Never throws. */
function runCmd(cmd, args, opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout: stdout.trim(), stderr: '', status: 0 };
  } catch (e) {
    return {
      stdout: ((e.stdout ?? '') + '').trim(),
      stderr: ((e.stderr ?? e.message ?? '') + '').trim(),
      status: typeof e.status === 'number' ? e.status : -1,
    };
  }
}

/** HTTP probe via native fetch with timeout. Never throws. */
async function httpProbe(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: true, status: res.status, error: null };
  } catch (e) {
    return { ok: false, status: null, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Read a file, expanding ~. Returns string or null (never throws). */
function readFileSafe(filePath) {
  const expanded = expandHome(filePath);
  if (!existsSync(expanded)) return null;
  try {
    return readFileSync(expanded, 'utf8');
  } catch {
    return null;
  }
}

/** True if the file exists after ~ expansion. */
function fileExists(filePath) {
  return existsSync(expandHome(filePath));
}

/**
 * Read a file and test it against a regex. Returns
 * { exists, matched, matchCount, firstMatch }. Never throws.
 */
function grepFile(filePath, regex) {
  const text = readFileSafe(filePath);
  if (text === null) return { exists: false, matched: false, matchCount: 0, firstMatch: null };
  const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  const matches = text.match(global);
  return {
    exists: true,
    matched: !!matches,
    matchCount: matches ? matches.length : 0,
    firstMatch: matches ? matches[0] : null,
    sizeBytes: text.length,
  };
}

/** Count lines in a file matching a regex. Never throws, never returns content. */
function countMatchingLines(filePath, regex) {
  const text = readFileSafe(filePath);
  if (text === null) return { exists: false, count: 0 };
  const re = new RegExp(regex.source, regex.flags.replace('g', ''));
  const count = text.split(/\r?\n/).filter(l => re.test(l)).length;
  return { exists: true, count };
}

/**
 * Run a `hermes … --json` command and JSON.parse stdout.
 * Returns { ok, data } on success or { ok:false, reason, raw } on failure.
 * reason ∈ 'not_found' | 'exec_failed' | 'parse_failed'. Never throws.
 */
function hermesJson(args) {
  const r = runCmd('hermes', args);
  if (!r.stdout) {
    if (/command not found|no such file|enoent/i.test(r.stderr)) {
      return { ok: false, reason: 'not_found', raw: r.stderr.slice(0, 200) };
    }
    return { ok: false, reason: 'exec_failed', raw: (r.stderr || '').slice(0, 200) };
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout) };
  } catch (e) {
    return { ok: false, reason: 'parse_failed', raw: r.stdout.slice(0, 200) };
  }
}

/** Permissions probe that handles both files and directories on Linux + macOS. */
function statMode(filePath) {
  const expanded = expandHome(filePath);
  if (!existsSync(expanded)) return { exists: false };
  const st = statSync(expanded);
  return {
    exists: true,
    isDirectory: st.isDirectory(),
    mode: (st.mode & 0o777).toString(8).padStart(3, '0'),
  };
}

/**
 * Walk upward from startDir looking for an `.obsidian/` directory (the
 * canonical Obsidian vault marker). Returns the vault root path on hit, or
 * null if no ancestor is a vault. Never throws (existsSync swallows errors).
 */
function findVaultRoot(startDir) {
  let dir = startDir;
  let prev = null;
  while (dir !== prev) {
    if (existsSync(join(dir, '.obsidian'))) return dir;
    prev = dir;
    dir = dirname(dir);
  }
  return null;
}

// ── YAML config reader ────────────────────────────────────────────────────

let _yamlCache = null;
function readYamlValue(yamlPath, dottedKey) {
  if (_yamlCache === null) {
    try {
      _yamlCache = yaml.load(readFileSync(expandHome(yamlPath), 'utf8')) || {};
    } catch (e) {
      _yamlCache = {};
    }
  }
  return dottedKey.split('.').reduce((acc, seg) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return acc[seg];
  }, _yamlCache);
}

// ── Check result builders ─────────────────────────────────────────────────

function pass(id, detail, evidence) {
  return { id, pass: true, detail, evidence: evidence ?? null, fix_prompt: null };
}
function fail(id, detail, evidence, fix) {
  return { id, pass: false, detail, evidence: evidence ?? null, fix_prompt: fix ?? null };
}
function manual(id, detail) {
  return { id, pass: null, detail, evidence: null, fix_prompt: null, manual: true };
}

// ── Integrity self-check ──────────────────────────────────────────────────

/**
 * Tamper-evidence. A clean install of this skill is a pristine `git clone`
 * + `git pull` — every tracked file matches HEAD. The attack this defends
 * against: an agent with write access editing bin/verify.js to FAKE check
 * results ("make module N pass"). If any tracked source differs from HEAD,
 * a `pass` cannot be trusted — the verifier itself was modified. We can't
 * tamper-PROOF (a determined agent could delete this check too) but we can
 * make casual fakery self-revealing in the JSON the user/web app receives.
 * Never throws.
 *
 * Returns { source, status, modified_files?, note? }:
 *   source: 'local-manifest' | 'none'
 *   status: 'DRIFT_OK' | 'DRIFT_MODIFIED' | 'UNKNOWN'
 */
function checkIntegrity() {
  try {
    const r = runCmd('git', ['-C', REPO_ROOT, 'diff', '--name-only', 'HEAD']);
    if (r.status !== 0) {
      return {
        source: 'none',
        status: 'UNKNOWN',
        modified_files: [],
        note: 'Could not verify validator source against git (skill is not a git checkout, or git is unavailable). Results cannot be integrity-checked — treat with caution.',
      };
    }
    const files = r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    if (files.length === 0) {
      return { source: 'local-manifest', status: 'DRIFT_OK', modified_files: [], note: null };
    }
    return {
      source: 'local-manifest',
      status: 'DRIFT_MODIFIED',
      modified_files: files,
      note: 'VALIDATOR SOURCE WAS MODIFIED vs git HEAD. A check reporting "pass" CANNOT be trusted while the validator itself is edited — this is exactly how a faked verification looks. Inspect with `git -C <skill-dir> diff`, restore the honest validator with `git -C <skill-dir> checkout -- .`, then re-run.',
    };
  } catch {
    return {
      source: 'none',
      status: 'UNKNOWN',
      modified_files: [],
      note: 'Integrity self-check errored; results cannot be integrity-verified — treat with caution.',
    };
  }
}

// ── Schema envelope emitter ───────────────────────────────────────────────

function emitResult(module, checks, integrity) {
  const fs = require('fs');
  const path = require('path');
  const result = {
    tool: 'hermes-mastery.verify_module',
    schema_version: 1,
    module,
    checked_at: new Date().toISOString(),
    validator_version: fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(),
    platform: 'hermes',
    checks,
    integrity,
  };
  console.log(JSON.stringify(result, null, 2));
  // Agent-proof file
  const proofPath = expandHome('~/.hermes/hermes-mastery-last.json');
  fs.mkdirSync(path.dirname(proofPath), { recursive: true });
  fs.writeFileSync(proofPath, JSON.stringify(result, null, 2));
}

// ── Module runners ────────────────────────────────────────────────────────

const MODULE_RUNNERS = {}; // Populated by per-module tasks

function runAll() {
  console.error('runAll() will be implemented in Task 4.2');
}

function main() {
  const arg = process.argv[2];
  if (arg === 'all') return runAll();
  const n = parseInt(arg, 10);
  if (!Number.isFinite(n) || n < 1 || n > 10) {
    console.error('Usage: verify.js <1..10> | all');
    process.exit(2);
  }
  const runner = MODULE_RUNNERS[n];
  if (!runner) {
    console.error(`No runner defined for module ${n}`);
    process.exit(2);
  }
  runner();
}

main();
