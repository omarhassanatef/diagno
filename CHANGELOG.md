# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows its own phased build plan rather than strict semver
until a 1.0 release.

## [0.4.0] - Configuration

### Added
- `sift config set/get/unset/list/path` for managing settings locally at
  `~/.sift/config.json` (owner-only file permissions).
- API key and model resolution now checks `ANTHROPIC_API_KEY` /
  `SIFT_AI_MODEL` first, falling back to the stored config.
- Secret values are masked by default in `config get`/`config list`, with a
  `--reveal` flag to show them in full.

## [0.3.0] - Fix Engine (Phase 3)

### Added
- `--fix` flag: proposes a patch for the top finding, shows a unified diff,
  and asks for explicit confirmation before writing anything.
- `--yes` flag to auto-confirm (for CI/non-interactive use).
- Atomic patch application with a staleness check (refuses to apply if the
  target file changed since the patch was proposed).
- After a fix is applied, SIFT automatically reruns the original command and
  reports whether the failure is actually resolved.
- `--json` output now includes the fix outcome as structured data.

## [0.2.0] - AI Orchestrator (Phase 2)

### Added
- AI-assisted fallback analysis for failures that deterministic analyzers
  can't confidently explain (below a 70% confidence threshold).
- Secret redaction pass (API keys, tokens, private keys, JWTs, `.env`-style
  secrets) applied to everything before it can reach an AI provider.
- Strict, Zod-validated structured schema for both the AI request and
  response — malformed or unparseable model output is never trusted.
- `LLMProvider` interface with an `AnthropicProvider` implementation, so
  other providers can be added without touching the orchestrator.
- `--no-ai` flag to skip AI analysis entirely.
- AI explanations are rendered in a visually distinct section that keeps
  confirmed "Evidence" separate from inferred "Assumptions", and are always
  labeled as AI-generated and unverified.

## [0.1.0] - Deterministic Diagnostics (Phase 1)

### Added
- `ProjectDetector`: finds the project root and detects package manager,
  TypeScript/Jest/Vitest/Docker presence, lockfiles, and `.env` existence.
- `ContextCollector`: bounded, privacy-aware reads of `tsconfig.json`, Jest
  config, and Docker files. `.env` values are never read — only key names.
- Eight deterministic analyzers: missing dependency, TypeScript/Jest path
  alias mismatch, missing environment variable, Node version mismatch, port
  already in use, TypeScript config conflict, lockfile/package-manager
  mismatch, and common Docker issues.
- Structured `Finding` model (evidence, confidence, suggested actions) and
  an orchestrator that runs all applicable analyzers and sorts by
  confidence, isolating any analyzer that throws.
- Terminal renderer matching the "WHY IT FAILED / EVIDENCE / LIKELY FIX /
  Confidence" format.
- `--json` flag for machine-readable output.

## [0.0.1] - CLI Foundation (Phase 0)

### Added
- `sift <command...>`: runs a command, streams its output live while
  capturing it, and reports a clean success/failure summary — no opaque
  stack traces, even for command-not-found or signal termination.
- Cross-platform `CommandRunner` interface backed by Node's `child_process`.
- `--help` / `--version`.
