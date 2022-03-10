import type { Disposable }      from "vscode";
import type IFileSystemProvider from "./file-system-provider.js";

export default interface IRuntime
{
    TextDecoder: new(encoding?: string) => { decode(buffer: ArrayBuffer): string };
    fileFs?: IFileSystemProvider;

    readonly timer:
    {
        setTimeout(callback: (...args: unknown[]) => void, ms: number, ...args: unknown[]): Disposable,
    };
}