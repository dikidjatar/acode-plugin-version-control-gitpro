interface CommitLike {
  readonly hash: string;
  readonly message: string;
  readonly parents: readonly string[];
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly commitDate?: Date;
  readonly refNames?: readonly string[];
  readonly shortStat?: {
    readonly files: number;
    readonly insertions: number;
    readonly deletions: number;
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

export function formatCommitDetails(commit: CommitLike): string {
  const shortStat = commit.shortStat
    ? `${commit.shortStat.files} files changed, ${commit.shortStat.insertions} insertions(+), ${commit.shortStat.deletions} deletions(-)`
    : 'No file change statistics available';
  const parents = commit.parents.length > 0 ? commit.parents.join(', ') : 'None';
  const refs = commit.refNames?.filter(Boolean).join(', ') || 'None';
  const commitAuthor = commit.authorName ? `${commit.authorName} <${commit.authorEmail}>` : 'Unknown Author';
  const commitDate = commit.commitDate ? commit.commitDate.toLocaleString() : 'Unknown Date';

  return [
    `<strong>Commit</strong><br>${escapeHtml(commit.hash)}`,
    `<strong>Author</strong><br>${escapeHtml(commitAuthor)}`,
    `<strong>Date</strong><br>${escapeHtml(commitDate)}`,
    `<strong>Parents</strong><br>${escapeHtml(parents)}`,
    `<strong>Refs</strong><br>${escapeHtml(refs)}`,
    `<strong>Stats</strong><br>${escapeHtml(shortStat)}`,
    `<strong>Message</strong><br><pre style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(commit.message)}</pre>`
  ].join('<br><br>');
}