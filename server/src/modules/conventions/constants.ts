export const TOP_CODE_SAMPLES = 12;

export const CONFIG_SAMPLE_PATHS = [
  'package.json',
  'tsconfig.json',
  'eslint.config.mjs',
  'eslint.config.js',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.prettierrc',
  '.prettierrc.json',
  '.editorconfig',
  'biome.json',
  'CONTRIBUTING.md',
  'CLAUDE.md',
  'AGENTS.md',
] as const;

export const MAX_FILE_LINES = 220;
export const MAX_FILE_CHARS = 12_000;
export const MAX_SAMPLE_CHARS = 90_000;
export const MAX_CANDIDATES = 12;
export const MIN_SNIPPET_CHARS = 8;
export const MAX_SNIPPET_LINES = 8;
export const EXTRACT_TEMPERATURE = 0.1;
export const EXTRACT_MAX_TOKENS = 4_000;
export const EXTRACT_TIMEOUT_MS = 120_000;
