import { readdir, stat }        from "fs/promises";
import type { FileStat }        from "vscode";
import { FileType }             from "vscode-css-languageservice";
import { URI as Uri }           from "vscode-uri";
import type IFileSystemProvider from "../interfaces/file-system-provider.js";

export default class NodeFileSystemProvider implements IFileSystemProvider
{
    private getScheme(uri: string): string
    {
        return uri.substring(0, uri.indexOf(":"));
    }

    private ensureFileUri(location: string): void
    {
        if (this.getScheme(location) !== "file")
        {
            throw new Error("fileSystemProvider can only handle file URLs");
        }
    }

    public async stat(location: string): Promise<FileStat>
    {
        this.ensureFileUri(location);

        const uri = Uri.parse(location);

        try
        {
            const stats = await stat(uri.fsPath);

            let type = FileType.Unknown;

            if (stats.isFile())
            {
                type = FileType.File;
            }
            else if (stats.isDirectory())
            {
                type = FileType.Directory;
            }
            else if (stats.isSymbolicLink())
            {
                type = FileType.SymbolicLink;
            }

            return {
                ctime: stats.ctime.getTime(),
                mtime: stats.mtime.getTime(),
                size:  stats.size,
                type,
            };
        }
        catch (err)
        {
            if ((err as Error & { code: string }).code == "ENOENT")
            {
                return { ctime: -1, mtime: -1, size: -1, type: FileType.Unknown };
            }

            throw err;
        }
    }

    public async readDirectory(location: string): Promise<[string, FileType][]>
    {
        this.ensureFileUri(location);
        const path = Uri.parse(location).fsPath;

        const children = await readdir(path, { withFileTypes: true });

        return children.map
        (
            stat =>
            {
                if (stat.isSymbolicLink())
                {
                    return [stat.name, FileType.SymbolicLink];
                }
                else if (stat.isDirectory())
                {
                    return [stat.name, FileType.Directory];
                }
                else if (stat.isFile())
                {
                    return [stat.name, FileType.File];
                }
                return [stat.name, FileType.Unknown];
            },
        );
    }
}
