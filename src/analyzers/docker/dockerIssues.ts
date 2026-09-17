import type { Analyzer, AnalyzerContext } from "../types";
import type { Finding } from "../../types/finding";

interface DockerPattern {
  id: string;
  pattern: RegExp;
  title: string;
  explanation: string;
  actions: string[];
}

const DOCKER_PATTERNS: DockerPattern[] = [
  {
    id: "daemon-not-running",
    pattern: /Cannot connect to the Docker daemon/i,
    title: "Docker daemon is not running",
    explanation:
      "The Docker CLI can't reach the Docker daemon. This almost always means Docker Desktop (or the docker service) isn't running, or the current user lacks permission to talk to it.",
    actions: [
      "Start Docker Desktop (or `sudo systemctl start docker` on Linux).",
      "If this is a permissions error, confirm your user is in the `docker` group.",
    ],
  },
  {
    id: "port-already-allocated",
    pattern: /port is already allocated|Bind for .* failed: port is already allocated/i,
    title: "A container port is already allocated",
    explanation:
      "Another container (or host process) is already bound to the port this container is trying to publish. Docker refuses to double-bind a port.",
    actions: [
      "Run `docker ps` to see what's already using the port, and stop it if it's stale.",
      "Or change the host port mapping in your compose file / `docker run -p` flag.",
    ],
  },
  {
    id: "network-not-found",
    pattern: /network .* not found/i,
    title: "A Docker network referenced by the project doesn't exist",
    explanation:
      "docker compose (or docker run) referenced a network that hasn't been created, often because it's an external network expected to already exist.",
    actions: [
      "Create the missing network: `docker network create <name>`.",
      "Or remove the `external: true` flag if the network should be created automatically.",
    ],
  },
  {
    id: "image-pull-denied",
    pattern: /pull access denied|manifest unknown|repository does not exist/i,
    title: "Docker image could not be pulled",
    explanation:
      "The image name/tag couldn't be found or you're not authenticated to pull it. This is common with private images, typos in the image name, or an image that hasn't been pushed yet.",
    actions: [
      "Double-check the image name and tag for typos.",
      "If it's a private image, confirm you're logged in: `docker login`.",
    ],
  },
  {
    id: "no-space-left",
    pattern: /no space left on device/i,
    title: "Docker host is out of disk space",
    explanation:
      "The Docker daemon's storage (images, containers, volumes, build cache) has filled the available disk space.",
    actions: [
      "Free up space with `docker system prune` (review what it removes first).",
    ],
  },
];

export const dockerIssuesAnalyzer: Analyzer = {
  id: "docker-common-issues",

  canAnalyze(context: AnalyzerContext): boolean {
    if (!context.project.hasDocker) return false;
    const output = context.failure.stderr + context.failure.stdout;
    return DOCKER_PATTERNS.some((p) => p.pattern.test(output));
  },

  async analyze(context: AnalyzerContext): Promise<Finding[]> {
    const output = context.failure.stderr + context.failure.stdout;
    const findings: Finding[] = [];

    for (const p of DOCKER_PATTERNS) {
      const match = output.match(p.pattern);
      if (!match) continue;

      findings.push({
        id: `docker-${p.id}`,
        analyzerId: this.id,
        title: p.title,
        severity: "error",
        confidence: 0.8,
        explanation: p.explanation,
        evidence: [
          {
            description: `output matched: "${match[0]}"`,
            source: "stderr/stdout",
            passed: true,
          },
        ],
        suggestedActions: p.actions.map((description) => ({ description })),
      });
    }

    return findings;
  },
};
