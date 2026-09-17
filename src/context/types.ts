export interface DockerFileSnapshot {
  path: string;
  content: string;
}

/**
 * CollectedContext holds the bounded set of file contents analyzers need.
 * Per the blueprint's privacy rules: full .env content is never read here --
 * only key *names*. Docker/tsconfig/jest file contents are capped in size
 * so a single huge generated file can't blow out memory or (in later
 * phases) get shipped to an AI provider wholesale.
 */
export interface CollectedContext {
  tsconfigContent?: string;
  jestConfigContent?: string;
  dockerFiles: DockerFileSnapshot[];
  /** Environment variable *names* declared in .env, values never read. */
  envKeys: string[];
}
