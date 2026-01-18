import * as Diff from 'diff';
import './diff.scss';
import { getModeForFile } from './utils';

const EditorFile = acode.require('EditorFile');
const Url = acode.require('Url');
const fsOperation = acode.require('fsOperation');
const Range = ace.require('ace/range').Range;

type DiffEditorFile = Acode.EditorFile & { diff: { additions: number, deletions: number }; };

interface Marker {
  start: number;
  end: number;
  type: 'added' | 'deleted';
}

interface Line {
  oldLine: string | number;
  newLine: string | number;
}

export interface DiffOptions {
  oldUri: string;
  newUri: string;
  title: string;
}

function createDiffEditorFile(name: string, options: Acode.FileOptions): DiffEditorFile {
  return new EditorFile(name, options) as DiffEditorFile;
}

function isDiffEditorFile(file: unknown): file is DiffEditorFile {
  if (!(file instanceof EditorFile)) {
    return false;
  }

  return typeof (<DiffEditorFile>file).diff === 'object' &&
    typeof (<DiffEditorFile>file).diff.additions === 'number' &&
    typeof (<DiffEditorFile>file).diff.deletions === 'number'
}

export class UnifiedDiff {

  private readonly oldUri: string;
  private readonly newUri: string;
  private readonly title: string;

  private markers: Marker[] = [];
  private lines: Line[] = [];
  private content: string = '';
  private additions: number = 0;
  private deletions: number = 0;

  constructor(options: DiffOptions) {
    this.oldUri = options.oldUri;
    this.newUri = options.newUri;
    this.title = options.title;
  }

  public async show(): Promise<void> {
    const oldText = await fsOperation(this.oldUri).readFile('utf-8');
    const newText = await fsOperation(this.newUri).readFile('utf-8');
    this.generateDiff(oldText, newText);
    this.renderEditor();
    this.updateStats();
  }

  private renderEditor(): void {
    const diffEditorFile = createDiffEditorFile(this.title, {
      text: this.content,
      cursorPos: { row: -1, column: 0 },
      render: true,
      isUnsaved: false,
      editable: false
    });

    diffEditorFile.diff = { additions: this.additions, deletions: this.deletions };
    diffEditorFile.setMode(getModeForFile(Url.basename(this.oldUri)!));

    const session = diffEditorFile.session;
    session.gutterRenderer = {
      getWidth: () => 50,
      getText: (session: any, row: any) => {
        const map = this.lines[row];
        if (!map) { return ''; }
        const oldNum = map.oldLine.toString().padStart(2);
        const newNum = map.newLine.toString().padStart(2);
        return oldNum + ' ' + newNum;
      }
    };

    removeMarkers(session);
    this.markers.forEach(marker => addMarker(session, marker));

    const editor = editorManager.editor as any;
    editor.setOption('highlightActiveLine', false);

    const onSwitchFile = (file: DiffEditorFile) => {
      if (isDiffEditorFile(file)) {
        editor.setOption('highlightActiveLine', false);
        if (diffEditorFile.editable) {
          diffEditorFile.editable = false;
        }

        if (file === diffEditorFile) {
          setTimeout(() => this.updateStats(), 0);
        }
      } else {
        editor.setOption('highlightActiveLine', true);
      }
    }

    const onFocus = () => {
      const activeFile = editorManager.activeFile;
      if (isDiffEditorFile(activeFile) && activeFile === diffEditorFile) {
        editor.blur();
      }
    }

    const onClose = () => {
      editor.setOption('highlightActiveLine', true);
      this.markers = [];
      this.lines = [];
      editorManager.off('switch-file', onSwitchFile);
      editor.off('focus', onFocus);
      diffEditorFile.off('close', onClose);
    }

    editorManager.on('switch-file', onSwitchFile);
    editor.on('focus', onFocus);
    diffEditorFile.on('close', onClose);
  }

  private generateDiff(oldText: string, newText: string): void {
    const diffs = Diff.diffLines(oldText, newText, { newlineIsToken: false });

    let currentLine: number = 0;
    let oldLineCounter: number = 1;
    let newLineCounter: number = 1;

    diffs.forEach(diff => {
      const lines = diff.value.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }

      if (diff.removed) {
        this.deletions += diff.count;

        lines.forEach(line => {
          this.content += line + "\n";
          this.markers.push({ start: currentLine, end: currentLine + 1, type: 'deleted' });
          this.lines.push({ oldLine: oldLineCounter, newLine: '' });

          oldLineCounter++;
          currentLine++;
        });
      } else if (diff.added) {
        this.additions += diff.count;

        lines.forEach(line => {
          this.content += line + "\n";
          this.markers.push({ start: currentLine, end: currentLine + 1, type: 'added' });
          this.lines.push({ newLine: newLineCounter, oldLine: '' });

          newLineCounter++;
          currentLine++;
        });
      } else {
        lines.forEach(line => {
          this.content += line + "\n";
          this.lines.push({ oldLine: oldLineCounter, newLine: newLineCounter });

          oldLineCounter++;
          newLineCounter++;
          currentLine++;
        });
      }
    });
  }

  private updateStats(): void {
    const header = editorManager.header as HTMLElement & { subText: string };
    header.subText = `+${this.additions} additions, -${this.deletions} deletions`;
  }
}

function removeMarkers(session: Ace.EditSession): void {
  const markers = session.getMarkers();
  for (let id in markers) {
    if (markers[id].clazz.indexOf('gh-') > -1) {
      session.removeMarker(Number(id));
    };
  }
  const len = session.getLength();
  for (let i = 0; i < len; i++) {
    session.removeGutterDecoration(i, 'gh-added-gutter');
    session.removeGutterDecoration(i, 'gh-deleted-gutter');
  }
}

function addMarker(session: Ace.EditSession, marker: Marker): void {
  const className = marker.type === 'added' ? 'gh-added-line' : 'gh-deleted-line';
  const gutterName = marker.type === 'added' ? 'gh-added-gutter' : 'gh-deleted-gutter';
  for (let i = marker.start; i < marker.end; i++) {
    const range = new Range(i, 0, i, 20000);
    session.addMarker(range, className, 'fullLine');
    session.addGutterDecoration(i, gutterName);
  }
}