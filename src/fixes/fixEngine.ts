import * as fs from "fs";
import * as path from "path";
import type { PatchProposal } from "../types/finding";
import type { CommandRunner, RunOutcome } from "../runner/types";

/**
 * A patch is only auto-applicable when an analyzer computed the full
 * resulting file content. Most analyzers only produce a human-readable
 * snippet -- that's expected, and this function is how the Fix Engine
 * tells the two apart before doing anything.
 */
export function isAutoApplicable(
  patch: PatchProposal | undefined,
): patch is PatchProposal & { newContent: string } {
  return Boolean(patch && patch.newContent !== undefined);
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Re-reads the target file right before applying and compares it against
 * what the analyzer saw when it proposed the patch. This is what "Validate
 * target file and expected content" (blueprint section 7, step 2) means in
 * practice: refuse to apply a patch computed against content that no
 * longer matches what's on disk, rather than silently clobbering
 * unrelated edits made in between.
 */
export function validateTarget(patch: PatchProposal): ValidationResult {
  const exists = fs.existsSync(patch.filePath);
  const currentContent = exists
    ? fs.readFileSync(patch.filePath, "utf8")
    : undefined;

  if (patch.beforeContent === undefined) {
    if (exists) {
      return {
        ok: false,
        reason: `${patch.filePath} already exists, but this fix expected to create a new file. Refusing to overwrite it.`,
      };
    }
    return { ok: true };
  }

  if (!exists) {
    return {
      ok: false,
      reason: `${patch.filePath} no longer exists. Refusing to apply a stale patch.`,
    };
  }

  if (currentContent !== patch.beforeContent) {
    return {
      ok: false,
      reason: `${patch.filePath} has changed since this fix was proposed. Refusing to apply a stale patch -- re-run DIAGNO to get an up-to-date diagnosis.`,
    };
  }

  return { ok: true };
}

/**
 * Writes the new content to a temp file in the same directory, then renames
 * it over the target. The rename is atomic on POSIX filesystems (and on
 * Windows for same-volume renames), so a crash mid-write can never leave
 * the target file half-written.
 */
export function applyPatchAtomically(patch: PatchProposal): void {
  if (patch.newContent === undefined) {
    throw new Error(
      `Patch for ${patch.filePath} has no machine-applicable content.`,
    );
  }

  const dir = path.dirname(patch.filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(
    dir,
    `.${path.basename(patch.filePath)}.diagno-tmp-${process.pid}`,
  );

  fs.writeFileSync(tmpPath, patch.newContent, "utf8");
  try {
    fs.renameSync(tmpPath, patch.filePath);
  } catch (err) {
    // Best-effort cleanup of the temp file if the rename itself failed.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore -- the original error is the one worth surfacing.
    }
    throw err;
  }
}

export interface FixOutcome {
  applied: true;
  rerun: RunOutcome;
  resolved: boolean;
}

/**
 * Applies a patch, then reruns the original failing command to check
 * whether the fix actually worked -- DIAGNO never claims success without
 * this execution evidence (blueprint's prompt rules apply just as much to
 * DIAGNO's own output as to an AI provider's).
 */
export async function applyAndRerun(
  patch: PatchProposal,
  runner: CommandRunner,
  command: string[],
  cwd: string,
  options: { stream?: boolean } = {},
): Promise<FixOutcome> {
  applyPatchAtomically(patch);
  const rerun = await runner.run(command, { cwd, stream: options.stream });
  return { applied: true, rerun, resolved: rerun.success };
}
