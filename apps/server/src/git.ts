import { basename } from 'node:path';
import { run } from './util.js';

export interface GitContext {
  branch?: string;
  worktree?: string;
  project?: string;
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  const r = await run('git', args, { cwd, timeout: 4000 });
  if (r.code !== 0) return undefined;
  const out = r.stdout.trim();
  return out || undefined;
}

/** Best-effort discovery of git branch + worktree root for a directory. */
export async function discoverGit(cwd: string): Promise<GitContext> {
  if (!cwd) return {};
  try {
    const [branch, root] = await Promise.all([
      git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(cwd, ['rev-parse', '--show-toplevel']),
    ]);
    if (root && !branch) {
      const r = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
      return { branch: r, worktree: root, project: basename(root) };
    }
    return {
      branch,
      worktree: root,
      project: root ? basename(root) : undefined,
    };
  } catch {
    return {};
  }
}
