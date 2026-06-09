/**
 * Resolve a daemon runtime asset path: the `env[key]` override (trimmed) if set
 * and non-blank, else the source-relative `fallback`. The override lets a bundled
 * launcher (the macOS shell) point a `bun --compile`d daemon at bundled copies of
 * its assets, whose location `import.meta.url` can no longer derive.
 */
export function resolveAssetPath(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  const override = env[key]?.trim();
  return override ? override : fallback;
}
