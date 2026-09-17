import { createTwoFilesPatch } from "diff";

/**
 * Renders a standard unified diff (the same format `git diff` produces)
 * between a file's current content and its proposed new content, so the
 * developer sees exactly what will change before approving anything.
 * `oldContent` of `undefined` means the file doesn't exist yet (a create).
 */
export function renderUnifiedDiff(
  filePath: string,
  oldContent: string | undefined,
  newContent: string
): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    oldContent ?? "",
    newContent,
    oldContent === undefined ? "(new file)" : "before",
    "after"
  );
}
