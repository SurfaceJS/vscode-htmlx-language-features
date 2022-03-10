import type { FileStat, FileType } from "vscode";

export default interface IFileSystemProvider
{
    stat(uri: string): Promise<FileStat>;
    readDirectory(uri: string): Promise<[string, FileType][]>;
}