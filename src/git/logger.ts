import { Color } from "../base/colors";

const terminal = acode.require('terminal');

enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG'
}

interface OutputChannelOptions {
  maxBufferSize?: number
}

export class LogOutputChannel {
  private name: string;
  private terminal: Acode.TerminalInstance | null;
  private buffer: string[];
  private maxBufferSize: number;

  constructor(name: string, options: OutputChannelOptions = {}) {
    this.name = name;
    this.terminal = null;
    this.buffer = [];
    this.maxBufferSize = options.maxBufferSize ?? 1000;
  }

  private _getTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  private _getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.INFO:
        return Color.cyan;
      case LogLevel.WARN:
        return Color.orange;
      case LogLevel.ERROR:
        return Color.red;
      case LogLevel.DEBUG:
        return Color.magenta;
      default:
        return Color.default;
    }
  }

  private _formatMessage(message: string, level: LogLevel): string {
    const timestamp = this._getTimestamp();
    const levelColor = this._getLevelColor(level);
    return `${Color.green}[${timestamp}]${Color.reset} ${levelColor}[${level}]${Color.reset} ${Color.default}${message}${Color.reset}`;
  }

  private _writeToTerminal(message: string): void {
    try {
      if (this.terminal && terminal.get(this.terminal.id) !== null) {
        terminal.write(this.terminal.id, message += '\r\n');
      } else {
        this.buffer.push(message);
        if (this.buffer.length > this.maxBufferSize) {
          this.buffer.shift();
        }
      }
    } catch (err) {
      this.buffer.push(message);
      if (this.buffer.length > this.maxBufferSize) {
        this.buffer.shift();
      }
    }
  }

  private _flushBuffer(): void {
    if (this.terminal && this.buffer.length > 0) {
      this.buffer.forEach(msg => {
        terminal.write(this.terminal!.id, msg += '\r\n');
      });
      this.buffer = [];
    }
  }

  isVisible(): boolean {
    if (!this.terminal) {
      return false;
    }

    if (!terminal.get(this.terminal.id)) {
      return false;
    }

    return true;
  }

  async show(): Promise<void> {
    if (!this.terminal || !terminal.get(this.terminal.id)) {
      this.terminal = await terminal.createLocal({ name: this.name, scrollback: this.maxBufferSize });
    }
    this._flushBuffer();
    this.terminal.file.makeActive();
  }

  hide(): void {
    if (this.terminal) {
      if (terminal.get(this.terminal.id) !== null) {
        terminal.close(this.terminal.id);
        this.terminal.file.remove(true);
        this.terminal = null;
      }
    }
  }

  clear(): void {
    if (this.terminal) {
      if (terminal.get(this.terminal.id) !== null) {
        terminal.clear(this.terminal.id);
      }
    }
    this.buffer = [];
  }

  info(message: string): void {
    this._writeToTerminal(this._formatMessage(message, LogLevel.INFO));
  }

  warn(message: string): void {
    this._writeToTerminal(this._formatMessage(message, LogLevel.WARN));
  }

  error(message: string): void {
    this._writeToTerminal(this._formatMessage(message, LogLevel.ERROR));
  }

  debug(message: string): void {
    this._writeToTerminal(this._formatMessage(message, LogLevel.DEBUG));
  }

  dispose(): void {
    if (this.terminal) {
      if (terminal.get(this.terminal.id) !== null) {
        terminal.close(this.terminal.id);
      }
      this.terminal.file.remove(true);
      this.terminal = null;
    }
    this.buffer = [];
  }
}