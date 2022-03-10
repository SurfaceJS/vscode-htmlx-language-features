import type { AutoInsertParams }            from "server/internal/requests/auto-insert-request";
import AutoInsertRequest                    from "server/internal/requests/auto-insert-request.js";
import CustomDataChangedNotificationRequest from "server/internal/requests/custom-data-changed-notification-request.js";
import CustomDataContentRequest             from "server/internal/requests/custom-data-content-request.js";
import SemanticTokenLegendRequest           from "server/internal/requests/semantic-token-legend-request.js";
import
{
    Disposable,
    EventEmitter,
    Position,
    SnippetString,
    TextDocumentChangeReason,
    Uri,
    extensions,
    languages,
    window,
    workspace,
} from "vscode";
import type
{
    Event,
    ExtensionContext,
    TextDocument,
    TextDocumentChangeEvent,
    TextDocumentContentChangeEvent,
} from "vscode";
import type { CommonLanguageClient }       from "vscode-languageclient";
import { Utils }                           from "vscode-uri";
import type IRuntime                       from "./interfaces/runtime.js";
import DocumentRangeFormattingEditProvider from "./providers/document-range-formatting-edit-provider.js";
import SemanticTokensProvider              from "./providers/semantic-tokens-provider.js";
import FsReadDirRequest                    from "./requests/fs-readdir-request.js";
import FsStatRequest                       from "./requests/fs-stat-request.js";
import SettingIds                          from "./setting-ids.js";

function isURI(uriOrPath: string): boolean
{
    return /^(?<scheme>\w[\w\d+.-]*):/.test(uriOrPath);
}

export default class Client
{
    private readonly disposables: Disposable[];
    private readonly documentSelector: string[] = ["htmlx"];

    private rangeFormatting?: Disposable;

    public constructor(context: ExtensionContext, private readonly languageClient: CommonLanguageClient, private readonly runtime: IRuntime)
    {
        this.languageClient = languageClient;
        this.disposables    = context.subscriptions;
    }

    private updateFormatterRegistration(): void
    {
        const formatEnabled = workspace.getConfiguration().get(SettingIds.formatEnable);

        if (!formatEnabled && this.rangeFormatting)
        {
            this.rangeFormatting.dispose();
            this.rangeFormatting = undefined;
        }
        else if (formatEnabled && !this.rangeFormatting)
        {
            this.rangeFormatting = languages.registerDocumentRangeFormattingEditProvider
            (
                this.documentSelector,
                new DocumentRangeFormattingEditProvider(this.languageClient),
            );
        }
    }

    private serveFileSystemRequests(runtime: IRuntime): Disposable
    {
        const disposables = [];
        disposables.push
        (
            this.languageClient.onRequest
            (
                FsReadDirRequest.type,
                (uriString: string) =>
                {
                    const uri = Uri.parse(uriString);

                    if (uri.scheme == "file" && runtime.fileFs)
                    {
                        return runtime.fileFs.readDirectory(uriString);
                    }

                    return workspace.fs.readDirectory(uri);
                },
            ),
        );

        disposables.push
        (
            this.languageClient.onRequest
            (
                FsStatRequest.type,
                (uriString: string) =>
                {
                    const uri = Uri.parse(uriString);

                    if (uri.scheme == "file" && runtime.fileFs)
                    {
                        return runtime.fileFs.stat(uriString);
                    }

                    return workspace.fs.stat(uri);
                },
            ),
        );

        return Disposable.from(...disposables);
    }

    private collectInWorkspaces(workspaceUris: Set<string>): Set<string>
    {
        const workspaceFolders = workspace.workspaceFolders;

        const dataPaths = new Set<string>();

        if (!workspaceFolders)
        {
            return dataPaths;
        }

        const collect = (uriOrPaths: string[] | undefined, rootFolder: Uri): void =>
        {
            if (Array.isArray(uriOrPaths))
            {
                for (const uriOrPath of uriOrPaths)
                {
                    if (typeof uriOrPath == "string")
                    {
                        if (!isURI(uriOrPath))
                        {
                            // path in the workspace
                            workspaceUris.add(Utils.resolvePath(rootFolder, uriOrPath).toString());
                        }
                        else
                        {
                            // external uri
                            workspaceUris.add(uriOrPath);
                        }
                    }
                }
            }
        };

        for (let i = 0; i < workspaceFolders.length; i++)
        {
            const folderUri         = workspaceFolders[i].uri;
            const allHtmlConfig     = workspace.getConfiguration("html", folderUri);
            const customDataInspect = allHtmlConfig.inspect<string[]>("customData");

            if (customDataInspect)
            {
                collect(customDataInspect.workspaceFolderValue, folderUri);

                if (i == 0)
                {
                    if (workspace.workspaceFile)
                    {
                        collect(customDataInspect.workspaceValue, workspace.workspaceFile);
                    }

                    collect(customDataInspect.globalValue, folderUri);
                }
            }

        }
        return dataPaths;
    }

    private collectInExtensions(localExtensionUris: Set<string>, externalUris: Set<string>): void
    {
        for (const extension of extensions.all)
        {
            const customData = extension.packageJSON?.contributes?.html?.customData;
            if (Array.isArray(customData))
            {
                for (const uriOrPath of customData)
                {
                    if (!isURI(uriOrPath))
                    {
                        // relative path in an extension
                        localExtensionUris.add(Uri.joinPath(extension.extensionUri, uriOrPath).toString());
                    }
                    else
                    {
                        // external uri
                        externalUris.add(uriOrPath);
                    }

                }
            }
        }
    }

    private hasChanges(s1: Set<string>, s2: Set<string>): boolean
    {
        if (s1.size != s2.size)
        {
            return true;
        }
        for (const uri of s1)
        {
            if (!s2.has(uri))
            {
                return true;
            }
        }
        return false;
    }

    private getCustomDataSource(): { getContent(uriString: string): Promise<string>, readonly onDidChange: Event<void>, readonly uris: string[] }
    {
        let localExtensionUris    = new Set<string>();
        let externalExtensionUris = new Set<string>();
        const workspaceUris       = new Set<string>();

        this.collectInWorkspaces(workspaceUris);
        this.collectInExtensions(localExtensionUris, externalExtensionUris);

        const onChange = new EventEmitter<void>();

        this.disposables.push
        (
            extensions.onDidChange
            (
                () =>
                {
                    const newLocalExtensionUris    = new Set<string>();
                    const newExternalExtensionUris = new Set<string>();

                    this.collectInExtensions(newLocalExtensionUris, newExternalExtensionUris);

                    if (this.hasChanges(newLocalExtensionUris, localExtensionUris) || this.hasChanges(newExternalExtensionUris, externalExtensionUris))
                    {
                        localExtensionUris    = newLocalExtensionUris;
                        externalExtensionUris = newExternalExtensionUris;

                        onChange.fire();
                    }
                },
            ),
        );

        this.disposables.push
        (
            workspace.onDidChangeConfiguration
            (
                event =>
                {
                    if (event.affectsConfiguration("html.customData"))
                    {
                        workspaceUris.clear();

                        this.collectInWorkspaces(workspaceUris);

                        onChange.fire();
                    }
                },
            ),
        );

        this.disposables.push
        (
            workspace.onDidChangeTextDocument
            (
                event =>
                {
                    const path = event.document.uri.toString();

                    if (externalExtensionUris.has(path) || workspaceUris.has(path))
                    {
                        onChange.fire();
                    }
                },
            ),
        );

        const runtime = this.runtime;

        return {
            async getContent(uriString: string): Promise<string>
            {
                const uri = Uri.parse(uriString);

                if (localExtensionUris.has(uriString))
                {
                    const buffer = await workspace.fs.readFile(uri);

                    return new runtime.TextDecoder().decode(buffer);
                }

                return (await workspace.openTextDocument(uri)).getText();
            },
            get onDidChange()
            {
                return onChange.event;
            },
            get uris()
            {
                return [...localExtensionUris, ...externalExtensionUris, ...workspaceUris];
            },
        };
    }

    private async onReady(): Promise<void>
    {
        this.disposables.push(this.serveFileSystemRequests(this.runtime));

        const customDataSource = this.getCustomDataSource();

        this.languageClient.sendNotification(CustomDataChangedNotificationRequest.type, customDataSource.uris);

        customDataSource.onDidChange(() => this.languageClient.sendNotification(CustomDataChangedNotificationRequest.type, customDataSource.uris));

        this.languageClient.onRequest(CustomDataContentRequest.type, customDataSource.getContent);

        const insertRequestor = async (kind: "autoQuote" | "autoClose", document: TextDocument, position: Position): Promise<string> =>
        {
            const param: AutoInsertParams =
            {
                kind,
                position:     this.languageClient.code2ProtocolConverter.asPosition(position),
                textDocument: this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
            };

            return this.languageClient.sendRequest(AutoInsertRequest.type, param);
        };

        const disposable = this.activateAutoInsertion(insertRequestor, { handlebars: true, html: true }, this.runtime);

        this.disposables.push(disposable);

        // manually register / deregister format provider based on the `html.format.enable` setting avoiding issues with late registration. See #71652.
        this.updateFormatterRegistration();

        this.disposables.push({ dispose: () => this.rangeFormatting?.dispose() });
        this.disposables.push(workspace.onDidChangeConfiguration(e => e.affectsConfiguration(SettingIds.formatEnable) && this.updateFormatterRegistration()));

        const legend = await this.languageClient.sendRequest(SemanticTokenLegendRequest.type);

        if (legend)
        {
            const provider = new SemanticTokensProvider(this.languageClient);

            this.disposables.push(languages.registerDocumentSemanticTokensProvider(this.documentSelector, provider, { tokenModifiers: legend.modifiers, tokenTypes: legend.types }));
        }
    }

    private activateAutoInsertion(provider: (kind: "autoQuote" | "autoClose", document: TextDocument, position: Position) => Thenable<string>, supportedLanguages: { [id: string]: boolean }, runtime: IRuntime): Disposable
    {
        const disposables: Disposable[] = [];
        workspace.onDidChangeTextDocument(onDidChangeTextDocument, null, disposables);

        let anyIsEnabled = false;
        const isEnabled =
        {
            "autoClose": false,
            "autoQuote": false,
        };

        updateEnabledState();

        window.onDidChangeActiveTextEditor(updateEnabledState, null, disposables);

        let timeout: Disposable | undefined;

        disposables.push({
            dispose: () =>
            {
                timeout?.dispose();
            },
        });

        function updateEnabledState(): void
        {
            anyIsEnabled = false;
            const editor = window.activeTextEditor;

            if (!editor)
            {
                return;
            }

            const document = editor.document;

            if (!supportedLanguages[document.languageId])
            {
                return;
            }

            const configurations = workspace.getConfiguration(undefined, document.uri);

            isEnabled.autoQuote = configurations.get<boolean>("html.autoCreateQuotes") ?? false;
            isEnabled.autoClose = configurations.get<boolean>("html.autoClosingTags") ?? false;

            anyIsEnabled = isEnabled.autoQuote || isEnabled.autoClose;
        }

        function onDidChangeTextDocument({ document, contentChanges, reason }: TextDocumentChangeEvent): void
        {
            if (!anyIsEnabled || contentChanges.length == 0 || reason == TextDocumentChangeReason.Undo || reason == TextDocumentChangeReason.Redo)
            {
                return;
            }

            const activeDocument = window.activeTextEditor?.document;

            if (document !== activeDocument)
            {
                return;
            }
            if (timeout)
            {
                timeout.dispose();
            }

            const lastChange    = contentChanges[contentChanges.length - 1];
            const lastCharacter = lastChange.text[lastChange.text.length - 1];

            if (isEnabled.autoQuote && lastChange.rangeLength == 0 && lastCharacter == "=")
            {
                doAutoInsert("autoQuote", document, lastChange);
            }
            else if (isEnabled.autoClose && lastChange.rangeLength == 0 && (lastCharacter == ">" || lastCharacter == "/"))
            {
                doAutoInsert("autoClose", document, lastChange);
            }
        }

        function doAutoInsert(kind: "autoQuote" | "autoClose", document: TextDocument, lastChange: TextDocumentContentChangeEvent): void
        {
            const rangeStart = lastChange.range.start;
            const version    = document.version;

            timeout = runtime.timer.setTimeout
            (
                () =>
                {
                    const position = new Position(rangeStart.line, rangeStart.character + lastChange.text.length);

                    void provider(kind, document, position)
                        .then
                        (
                            text =>
                            {
                                if (text && isEnabled[kind])
                                {
                                    const activeEditor = window.activeTextEditor;

                                    if (activeEditor)
                                    {
                                        const activeDocument = activeEditor.document;

                                        if (document == activeDocument && activeDocument.version == version)
                                        {
                                            const selections = activeEditor.selections;

                                            if (selections.length && selections.some(s => s.active.isEqual(position)))
                                            {
                                                void activeEditor.insertSnippet(new SnippetString(text), selections.map(s => s.active));
                                            }
                                            else
                                            {
                                                void activeEditor.insertSnippet(new SnippetString(text), position);
                                            }
                                        }
                                    }
                                }
                            },
                        );
                    timeout = undefined;
                },
                100,
            );
        }
        return Disposable.from(...disposables);
    }

    public async activate(): Promise<void>
    {
        this.languageClient.start();

        await this.languageClient.onReady();

        await this.onReady();
    }

    public async deactivate(): Promise<void>
    {
        return this.languageClient.stop();
    }
}