import { FileDecoration } from "./decorationService";

export function computeBubbleUpFolderDecorations(
  decorations: Map<string, FileDecoration>,
  rootPath: string
): void {
  const folderColorCounts = new Map<string, Map<string, number>>();
  const root = rootPath.replace(/\/$/, '');

  for (const [uri, decoration] of decorations.entries()) {
    if (!decoration.color) {
      continue;
    }

    let currentPath = uri.replace(/\/$/, '');

    while (currentPath.length > root.length && currentPath.startsWith(root)) {
      const lastSlashIdx = currentPath.lastIndexOf('/');
      if (lastSlashIdx <= 0) {
        break;
      }

      const parentPath = currentPath.substring(0, lastSlashIdx);
      if (parentPath.length <= root.length) {
        break;
      }

      if (!folderColorCounts.has(parentPath)) {
        folderColorCounts.set(parentPath, new Map<string, number>());
      }

      const colorMap = folderColorCounts.get(parentPath)!;
      colorMap.set(decoration.color, (colorMap.get(decoration.color) || 0) + 1);

      currentPath = parentPath;
    }
  }

  for (const [folderPath, colorMap] of folderColorCounts.entries()) {
    let winningColor: string | undefined;
    let maxCount: number = 0;

    for (const [color, count] of colorMap.entries()) {
      if (count > maxCount) {
        maxCount = count;
        winningColor = color;
      }
    }

    if (winningColor) {
      const decoration: FileDecoration = {
        color: winningColor
      };

      if (!decorations.has(folderPath)) {
        decorations.set(folderPath, decoration);
      }
      if (!decorations.has(folderPath + '/')) {
        decorations.set(folderPath + '/', decoration);
      }
    }
  }
}