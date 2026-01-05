const _empty = '';
const _regexp = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

function parseUriPath(value: string): string {
  const match = _regexp.exec(value);
  if (!match) {
    return '';
  }

  return percentDecode(match[5] || _empty);
}

export function uriToPath(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid uri: ${value}`);
  }

  const uriPath = parseUriPath(value);
  const path = parsePath().replace(/\/+$/, '');

  if (path.startsWith('primary:')) {
    return path.replace('primary:', '/sdcard/');
  } else if (path.startsWith('/storage/emulated/0')) {
    return path.replace('/storage/emulated/0', '/sdcard');
  }

  return path;

  function parsePath() {
    if (uriPath.startsWith('/tree/')) {
      const pathPart = uriPath.substring(uriPath.indexOf('/tree/') + 6);

      if (pathPart.includes('::')) {
        const parts = pathPart.split('::');
        return parts[1];
      }

      return pathPart;
    }

    return uriPath;
  }
}

export function toFileUrl(url: string): string {
  const path = uriToPath(url);
  return `file://${path}`;
}

function percentDecode(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}