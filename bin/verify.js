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
const fs = require('node:fs');
const {
  readFileSync, writeFileSync, statSync, lstatSync,
  existsSync, realpathSync, mkdirSync,
} = require('node:fs');
const { homedir, platform: osPlatform } = require('node:os');
const path = require('node:path');
const { dirname, join } = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = join(__dirname, '..');

const PLATFORM = osPlatform() === 'darwin' ? 'macos' : 'linux';
const SCHEMA_VERSION = 1;

let VALIDATOR_VERSION = 'unknown';
try {
  VALIDATOR_VERSION = fs
    .readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8')
    .trim();
} catch {}

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
 * Tamper-evidence via MANIFEST.sha256 (spec §7.2 v4). Installed skills ship
 * a pre-computed manifest; this function rehashes each listed file and detects
 * drift. The attack defended against: an agent with write access editing
 * bin/verify.js to fake check results. We can't tamper-PROOF (a determined
 * agent could edit this check too) but we make casual fakery self-revealing in
 * the JSON the user/web app receives. Never throws.
 *
 * Returns { source, status, modified_files?, note? }:
 *   source: 'local-manifest' | 'none'
 *   status: 'DRIFT_OK' | 'DRIFT_MODIFIED' | 'UNKNOWN'
 */
function checkIntegrity() {
  const crypto = require('node:crypto');
  const manifestPath = path.join(REPO_ROOT, 'MANIFEST.sha256');

  if (!fs.existsSync(manifestPath)) {
    return {
      source: 'none',
      status: 'UNKNOWN',
      note: 'MANIFEST.sha256 not found — install the skill via `hermes skills install s1dd4rth/hermes-mastery-validator` to enable drift-evidence.',
    };
  }

  const lines = fs.readFileSync(manifestPath, 'utf8').trim().split('\n');
  const modified = [];
  for (const line of lines) {
    const m = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (!m) continue;
    const [, expected, relPath] = m;
    const filePath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(filePath)) {
      modified.push(`${relPath} (missing)`);
      continue;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (actual !== expected) modified.push(relPath);
  }

  if (modified.length === 0) {
    return { source: 'local-manifest', status: 'DRIFT_OK' };
  }
  return { source: 'local-manifest', status: 'DRIFT_MODIFIED', modified_files: modified };
}

// ── Schema envelope emitter ───────────────────────────────────────────────

function emitResult(module, checks, integrity) {
  const result = {
    tool: 'hermes-mastery.verify_module',
    schema_version: 1,
    module,
    checked_at: new Date().toISOString(),
    validator_version: VALIDATOR_VERSION,
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

// MODULE_RUNNERS is populated by per-module tasks. Each runner is a function
// that takes no args, builds a `checks` array, and calls
// `emitResult(N, checks, checkIntegrity())`. Registration pattern:
//   MODULE_RUNNERS[N] = async function runModuleN() { ... }
const MODULE_RUNNERS = {};

async function runModule1() {
  const checks = [];

  // Check 1: hermes-installed
  try {
    const r = runCmd('hermes', ['--version']);
    if (r.status === 0 && r.stdout.trim()) {
      checks.push(pass('hermes-installed', { version: r.stdout.trim().split('\n')[0] }));
    } else {
      checks.push(fail('hermes-installed', '`hermes --version` exited non-zero or empty'));
    }
  } catch (e) {
    checks.push(fail('hermes-installed', '`hermes --version` failed: ' + e.message));
  }

  // Check 2: gateway-running
  // Phase 0 probe (2026-05-23) found no Hermes gateway process listening on
  // any port. Port 1919 (spec assumption) did not respond. Config has a
  // `dashboard:` section but no port key — only `server_actions: ''`.
  // The check detects the live state honestly: PASS if any HTTP response is
  // received, FAIL if the port is not reachable.
  const dashboardPort = 1919;
  const url = `http://127.0.0.1:${dashboardPort}`;
  try {
    const res = await httpProbe(url);
    if (res && res.status > 0 && res.status < 500) {
      checks.push(pass('gateway-running', { url, status: res.status }));
    } else {
      checks.push(fail('gateway-running', `Dashboard not reachable at ${url}`, { res }));
    }
  } catch (err) {
    checks.push(fail('gateway-running', `Dashboard probe failed: ${err.message}`));
  }

  // Check 3: model-configured (via readYamlValue per spec §7.1 v4)
  // Phase 0 probe confirmed model.provider = "gemini" in ~/.hermes/config.yaml.
  // `hermes config get` does not exist in v0.12.0; js-yaml direct parse is the
  // only supported read method.
  const provider = readYamlValue('~/.hermes/config.yaml', 'model.provider');
  if (provider && typeof provider === 'string' && provider.length > 0) {
    checks.push(pass('model-configured', { key: 'model.provider', provider }));
  } else {
    checks.push(fail('model-configured', 'Config key model.provider is missing or empty in ~/.hermes/config.yaml'));
  }

  // Check 4: validator-skill-installed (canonical slug per spec §4)
  // Phase 0 probe confirmed install target: ~/.hermes/skills/hermes-mastery-validator/
  // Dev workflow: ln -sfn $(pwd) ~/.hermes/skills/hermes-mastery-validator
  // Learner workflow: hermes skills install s1dd4rth/hermes-mastery-validator
  const skillPath = expandHome('~/.hermes/skills/hermes-mastery-validator/SKILL.md');
  if (fileExists(skillPath)) {
    checks.push(pass('validator-skill-installed', { path: skillPath }));
  } else {
    checks.push(fail(
      'validator-skill-installed',
      `Validator skill not installed at ${skillPath}. For dev: symlink via \`ln -sfn $(pwd) ~/.hermes/skills/hermes-mastery-validator\`. For learners: \`hermes skills install s1dd4rth/hermes-mastery-validator\`.`,
      { expected_path: skillPath }
    ));
  }

  emitResult(1, checks, checkIntegrity());
}

MODULE_RUNNERS[1] = runModule1;

function runModule2() {
  const checks = [];

  // ── user-md-exists ─────────────────────────────────────────────────────
  // Checks: file present, non-empty, has a real name/identity field.
  // NOTE: these are formatting checks, not memory-loop checks. A learner
  // could hand-write placeholder-shaped content and pass. The conversational
  // round-trip in the manual is what proves the memory pillar works.
  const userPath = expandHome('~/.hermes/memories/USER.md');
  if (!fileExists(userPath)) {
    checks.push(fail('user-md-exists', 'USER.md not found at ' + userPath));
  } else {
    const content = readFileSafe(userPath) || '';
    if (content.trim().length === 0) {
      checks.push(fail('user-md-exists', 'USER.md is empty'));
    } else {
      // Accept multiple real-world identity field formats:
      //   "Name: Alice"  /  "**Name**: Alice"  (structured YAML-ish)
      //   "System username is alice"  /  "username is alice"  (Hermes-generated header)
      //   "I am Alice" / "My name is Alice"  (prose)
      const hasName =
        /^\s*(?:\*\*)?Name(?:\*\*)?:\s*\S+/m.test(content) ||
        /^name:\s*\S+/mi.test(content) ||
        /(?:System\s+)?username\s+is\s+\S+/i.test(content) ||
        /(?:I am|My name is)\s+[A-Z]\w+/.test(content);
      const isPlaceholder = /\[your[_ ]?name\]|\bTBD\b|<placeholder>/i.test(content);
      if (!hasName || isPlaceholder) {
        checks.push(fail(
          'user-md-exists',
          'USER.md present but no real identity/name field detected (or placeholder found). ' +
          'Accepted patterns: "Name: Alice", "username is alice", "I am Alice", "My name is Alice".'
        ));
      } else {
        const overLimit = content.length > 1375;
        checks.push(pass(
          'user-md-exists',
          'USER.md present with real identity field',
          {
            length: content.length,
            char_limit_warning: overLimit
              ? 'over 1375 (informational only — Hermes docs limit may shift)'
              : 'within docs limit',
          }
        ));
      }
    }
  }

  // ── memory-md-exists ───────────────────────────────────────────────────
  // Checks: file present, non-empty, contains at least one project/context entry.
  // "Project/context entry" is interpreted broadly per spec: a bullet item OR
  // prose mentioning tools in use ("uses `X`"), active work ("working on"),
  // explicit project markers ("project:"), installed tools ("installed at"),
  // or named workflow tools (backtick-quoted identifiers).
  // Rationale for breadth: Hermes writes natural sentences, not just bullets.
  const memPath = expandHome('~/.hermes/memories/MEMORY.md');
  if (!fileExists(memPath)) {
    checks.push(fail('memory-md-exists', 'MEMORY.md not found at ' + memPath));
  } else {
    const content = readFileSafe(memPath) || '';
    if (content.trim().length === 0) {
      checks.push(fail('memory-md-exists', 'MEMORY.md is empty'));
    } else {
      // Match bullet entries OR common Hermes prose patterns for tool/project context.
      const hasEntry =
        /^[-*]\s+\S+/m.test(content) ||             // bullet item
        /working on/i.test(content) ||               // "working on X"
        /project:/i.test(content) ||                 // "project: X"
        /uses\s+`\S+`/i.test(content) ||             // "uses `toolname`" — Hermes standard
        /installed at\s+\S+/i.test(content) ||       // "installed at /path"
        /`[a-z][a-z0-9_-]{1,}[a-z0-9]`/.test(content); // backtick-quoted identifier (tool names)
      if (!hasEntry) {
        checks.push(fail(
          'memory-md-exists',
          'MEMORY.md present but no project/context entry detected. ' +
          'Expected a bullet item, "working on X", "project: X", a tool reference like "uses `toolname`", ' +
          '"installed at /path", or a backtick-quoted identifier.'
        ));
      } else {
        const overLimit = content.length > 2200;
        checks.push(pass(
          'memory-md-exists',
          'MEMORY.md present with project/context entry',
          {
            length: content.length,
            char_limit_warning: overLimit
              ? 'over 2200 (informational only — Hermes docs limit may shift)'
              : 'within docs limit',
          }
        ));
      }
    }
  }

  // ── memory-conversational (manual) ────────────────────────────────────
  // This is the load-bearing M2 check. The deterministic checks above only
  // confirm files exist with the right shape — a learner could hand-write
  // placeholder content and pass. The conversational round-trip below is what
  // proves Hermes's memory pillar actually works.
  checks.push(manual(
    'memory-conversational',
    'Tell your Claw a new fact about yourself in chat (e.g., "remember that I prefer terse responses" or "chuck that in memory: I drink oat milk"). Then read USER.md or MEMORY.md and confirm the agent wrote it. This is the load-bearing check for M2; the file-presence checks above just confirm the surface exists.'
  ));

  emitResult(2, checks, checkIntegrity());
}

MODULE_RUNNERS[2] = runModule2;

async function runAll() {
  const integrity = checkIntegrity();
  console.log('INTEGRITY:', JSON.stringify(integrity));
  // Phase 4 Task 4.2 will iterate MODULE_RUNNERS and await each — kept async-ready now.
}

async function main() {
  const arg = process.argv[2];
  if (arg === 'all') { await runAll(); return; }
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
  await runner();
}

main();
