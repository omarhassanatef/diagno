import * as fs from "fs";
import * as path from "path";
import type { ProjectContext } from "../types/project";
import type { CollectedContext, DockerFileSnapshot } from "./types";

/** Hard cap on any single file we read into memory. Config files are small;
 * anything larger is almost certainly not a hand-written config we should
 * be reasoning about, so we truncate defensively. */
const MAX_FILE_BYTES = 64 * 1024;

function readBounded(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, "r");
    const length = Math.min(stat.size, MAX_FILE_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    fs.closeSync(fd);
    return buffer.toString("utf8");
  } catch {
    return undefined;
  }
}

/** Extracts only the left-hand-side variable *names* from a .env file,
 * never the values on the right of `=`. This mirrors the blueprint's rule:
 * "Never send by default: ... complete .env files". */
function extractEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

const DOCKER_FILE_NAMES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

export class ContextCollector {
  collect(project: ProjectContext): CollectedContext {
    const tsconfigContent = project.tsconfigPath
      ? readBounded(project.tsconfigPath)
      : undefined;

    const jestConfigContent = project.jestConfigPath
      ? readBounded(project.jestConfigPath)
      : undefined;

    const dockerFiles: DockerFileSnapshot[] = [];
    if (project.hasDocker) {
      for (const name of DOCKER_FILE_NAMES) {
        const filePath = path.join(project.root, name);
        if (fs.existsSync(filePath)) {
          const content = readBounded(filePath);
          if (content !== undefined) {
            dockerFiles.push({ path: filePath, content });
          }
        }
      }
    }

    let envKeys: string[] = [];
    if (project.hasEnvFile) {
      const envContent = readBounded(path.join(project.root, ".env"));
      if (envContent !== undefined) {
        envKeys = extractEnvKeys(envContent);
      }
    }

    return { tsconfigContent, jestConfigContent, dockerFiles, envKeys };
  }

  /**
   * Checks whether a package appears to be installed on disk, without
   * requiring the full node_modules tree to be loaded into memory.
   */
  isInstalled(project: ProjectContext, packageName: string): boolean {
    return fs.existsSync(
      path.join(project.root, "node_modules", packageName)
    );
  }
}
