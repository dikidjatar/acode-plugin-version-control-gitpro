import { foldGutter } from "@codemirror/language";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import * as Diff from "diff";
import "./diff.scss";
import { fromGitUri, isGitUri } from "./uri";

const EditorFile = acode.require("EditorFile");
const fsOperation = acode.require("fsOperation");
const settings = acode.require("settings");
const editorThemes = acode.require("editorThemes");
const editorLanguages = acode.require("editorLanguages");

export interface DiffOptions {
  oldUri: string;
  newUri: string;
  title: string;
}

function toFileUri(uri: string) {
  if (!isGitUri(uri)) {
    return uri;
  }

  return fromGitUri(uri).path;
}

export class UnifiedDiff {
  private readonly oldUri: string;
  private readonly newUri: string;
  private readonly title: string;

  private additions: number = 0;
  private deletions: number = 0;

  constructor(options: DiffOptions) {
    this.oldUri = options.oldUri;
    this.newUri = options.newUri;
    this.title = options.title;
  }

  public async show(): Promise<void> {
    const oldText = await fsOperation(this.oldUri).readFile("utf-8");
    const newText = await fsOperation(this.newUri).readFile("utf-8");

    await this.showDiff(oldText, newText);
  }

  private async showDiff(
    oldText: string,
    newText: string,
  ): Promise<void> {
    const container = document.createElement("div");
    container.className = "codemirror-merge-view-container";

    // Calculate additions and deletions for stats
    const diffs = Diff.diffLines(oldText, newText, { newlineIsToken: false });
    this.additions = 0;
    this.deletions = 0;
    diffs.forEach((diff) => {
      if (diff.added) this.additions += diff.count || 0;
      if (diff.removed) this.deletions += diff.count || 0;
    });

    const settingsValue = settings.value as any;
    const activeThemeId = settingsValue.editorTheme;
    const themeEntry = editorThemes?.get(activeThemeId);
    const themeExtensions =
      themeEntry && typeof (themeEntry as any).getExtension === "function"
        ? (themeEntry as any).getExtension()
        : [];

    const getFontSettingsExtension = () => {
      const fontSize = settingsValue.fontSize || "12px";
      const lineHeight = settingsValue.lineHeight || 1.5;
      const font = settingsValue.editorFont || "Roboto Mono";
      const fontFamily = `${font}, Noto Mono, Monaco, monospace`;
      return EditorView.theme({
        "&": { fontSize, lineHeight: String(lineHeight) },
        ".cm-scroller": {
          fontFamily,
        },
      });
    };

    const wrapExtension = settingsValue.textWrap
      ? [EditorView.lineWrapping]
      : [];

    const showLineNumbers = settingsValue.linenumbers !== false;
    const lineNumberExtensions = showLineNumbers
      ? [lineNumbers(), highlightActiveLineGutter()]
      : [];

    const showFolding = settingsValue.codeFolding !== false;
    const foldingExtensions = showFolding ? [foldGutter()] : [];

    const showActiveLine = settingsValue.highlightActiveLine !== false;
    const activeLineExtensions = showActiveLine ? [highlightActiveLine()] : [];

    // Resolve language support for syntax highlighting
    let languageExt: any = [];
    const mode = (editorLanguages as any)?.getForPath(toFileUri(this.oldUri));
    if (mode && typeof mode.languageExtension === "function") {
      try {
        languageExt = await Promise.resolve(mode.languageExtension());
      } catch (e) {
        console.error("Failed to resolve language extension for diff:", e);
      }
    }

    const editorExtensions = [
      ...(themeExtensions as any),
      getFontSettingsExtension(),
      ...wrapExtension,
      ...lineNumberExtensions,
      ...foldingExtensions,
      ...activeLineExtensions,
      drawSelection(),
      ...(Array.isArray(languageExt) ? languageExt : [languageExt]),
      unifiedMergeView({
        original: oldText,
        mergeControls: false,
        collapseUnchanged: {
          margin: 3,
          minSize: 4,
        },
      }),
      EditorState.readOnly.of(true),
      EditorView.contentAttributes.of({
        inputmode: "none"
      })
    ];

    const editorView = new EditorView({
      state: EditorState.create({
        doc: newText,
        extensions: editorExtensions,
      }),
      parent: container,
    });

    const diffEditorFile = new EditorFile(this.title, {
      type: "terminal",
      content: container,
      render: true,
      isUnsaved: false,
      editable: false,
      hideQuickTools: true
    });

    this.updateStats();

    const onSwitchFile = (file: any) => {
      if (file === diffEditorFile) {
        setTimeout(() => this.updateStats(), 0);
      }
    };

    const onClose = () => {
      editorView.destroy();
      editorManager.off("switch-file", onSwitchFile);
      diffEditorFile.off("close", onClose);
    };

    editorManager.on("switch-file", onSwitchFile);
    diffEditorFile.on("close", onClose);
  }

  private updateStats(): void {
    const header = editorManager.header as HTMLElement & { subText: string };
    header.subText = `+${this.additions} additions, -${this.deletions} deletions`;
  }
}