import type { DocumentContext as IDocumentContext } from "vscode-html-languageservice";
import type { WorkspaceFolder }                     from "vscode-languageserver";

export default class DocumentContext implements IDocumentContext
{
    public constructor(private readonly uri: string, private readonly workspaceFolders: WorkspaceFolder[])
    { }

    private getRootFolder(): string | undefined
    {
        for (const folder of this.workspaceFolders)
        {
            let folderURI = folder.uri;

            if (!folderURI.endsWith("/"))
            {
                folderURI += "/";
            }

            if (this.uri.startsWith(folderURI))
            {
                return folderURI;
            }
        }

        return undefined;
    }

    public resolveReference(filename: string, context: string): string
    {
        if (filename.startsWith("/"))
        {
            const folderUri = this.getRootFolder();

            if (folderUri)
            {
                return new URL(filename, folderUri).toString();
            }
        }

        return new URL(filename, context).toString();
    }
}