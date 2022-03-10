
import { TextDocument } from "vscode-languageserver-textdocument";
import type
{
    ConfigurationParams,
    Connection,
    Disposable,
    WorkspaceFolder,
} from "vscode-languageserver/node.js";
import
{
    ColorPresentationRequest,
    ConfigurationRequest,
    DidChangeWorkspaceFoldersNotification,
    DocumentColorRequest,
    DocumentFormattingRequest,
    DocumentRangeFormattingRequest,
    Position,
    ProposedFeatures,
    Range,
    TextDocumentSyncKind,
    TextDocuments,
    createConnection,
} from "vscode-languageserver/node.js";
import CustomDataRequestService             from "./custom-data-request-service.js";
import { fetchHTMLDataProviders }           from "./custom-data.js";
import DocumentContext                      from "./document-context.js";
import LanguageService                      from "./language-service.js";
import AutoInsertRequest                    from "./requests/auto-insert-request.js";
import CustomDataChangedNotificationRequest from "./requests/custom-data-changed-notification-request.js";
import SemanticTokenLegendRequest           from "./requests/semantic-token-legend-request.js";
import SemanticTokenRequest                 from "./requests/semantic-token-request.js";
import type Settings                        from "./types/settings.js";
import type Workspace                       from "./types/workspace.js";

function getValue(root: object, path: string | string[]): unknown
{
    const [key, ...keys] = typeof path == "string" ? path.split(".") : path;

    if (keys.length > 0)
    {
        if (key in root)
        {
            return getValue((root as Record<string, unknown>)[key] as object, keys);
        }

        const typeName = root instanceof Function ? root.name : root.constructor.name;

        throw new Error(`Property "${key}" does not exists on type ${typeName}`);
    }

    return (root as Record<string, unknown>)[key];
}

function formatError(message: string, error: unknown): string
{
    if (error instanceof Error)
    {
        return `${message}: ${error.message}\n${error.stack}`;
    }
    else if (typeof error == "string")
    {
        return `${message}: ${error}`;
    }
    else if (error)
    {
        return `${message}: ${error}`;
    }

    return message;
}

function getFullRange(document: TextDocument): Range
{
    return Range.create(Position.create(0, 0), document.positionAt(document.getText().length));
}

const VALIDATION_DELAY = 500;

export default class Server
{
    private readonly documentSettings:          Map<string, Promise<Settings>> = new Map();
    private readonly documents:                 TextDocuments<TextDocument> = new TextDocuments(TextDocument);
    private readonly pendingValidationRequests: Map<string, Disposable> = new Map();
    private readonly scopedSettingsSupport:     boolean = false;

    private connection!:                  Connection;
    private dynamicFormatterRegistration: boolean = false;
    private formatterRegistrations:       Promise<Disposable>[] | null = null;
    private globalSettings!:              Settings;
    private languageService!:             LanguageService;
    private workspaceFolders!:            WorkspaceFolder[];
    private workspaceFoldersSupport:      boolean = false;
    private foldingRangeLimit:            number = Number.MAX_VALUE;

    private cleanPendingValidation(textDocument: TextDocument): void
    {
        const request = this.pendingValidationRequests.get(textDocument.uri);

        if (request)
        {
            request.dispose();

            this.pendingValidationRequests.delete(textDocument.uri);
        }
    }

    private triggerValidation(textDocument: TextDocument): void
    {
        this.cleanPendingValidation(textDocument);

        const action = (): void =>
        {
            this.pendingValidationRequests.delete(textDocument.uri);

            void this.validateTextDocument(textDocument);
        };

        const timer = setTimeout(action, VALIDATION_DELAY);

        this.pendingValidationRequests.set(textDocument.uri, { dispose: () => clearTimeout(timer) });
    }

    private getDocumentSettings(document: TextDocument, needsDocumentSettings: () => boolean): Thenable<Settings | undefined>
    {
        if (this.scopedSettingsSupport && needsDocumentSettings())
        {
            let promise = this.documentSettings.get(document.uri);

            if (!promise)
            {
                const scopeUri = document.uri;

                const configRequestParam: ConfigurationParams =
                {
                    items:
                    [
                        { scopeUri, section: "css" },
                        { scopeUri, section: "html" },
                        { scopeUri, section: "javascript" },
                    ],
                };

                promise = this.connection.sendRequest(ConfigurationRequest.type, configRequestParam)
                    .then(s => ({ css: s[0], html: s[1], javascript: s[2] }));

                this.documentSettings.set(document.uri, promise);
            }

            return promise;
        }
        return Promise.resolve(undefined);
    }

    private async validateTextDocument(textDocument: TextDocument): Promise<void>
    {
        try
        {
            const version = textDocument.version;

            if (textDocument.languageId === "htmlx")
            {
                const settings = await this.getDocumentSettings(textDocument, () => this.languageService.needsValidation());

                const latestTextDocument = this.documents.get(textDocument.uri);

                if (latestTextDocument && latestTextDocument.version === version)
                {
                    const diagnostics = this.languageService.doValidation(latestTextDocument, settings ?? this.globalSettings);

                    this.connection.sendDiagnostics({ diagnostics, uri: latestTextDocument.uri });
                }
            }
        }
        catch (e)
        {
            this.connection.console.error(formatError(`Error while validating ${textDocument.uri}`, e));
        }
    }

    // eslint-disable-next-line max-lines-per-function
    public start(): void
    {
        const customDataRequestService = new CustomDataRequestService(this.connection);

        this.documents.onDidChangeContent(change => this.triggerValidation(change.document));

        this.documents.onDidClose
        (
            event =>
            {
                this.cleanPendingValidation(event.document);
                this.connection.sendDiagnostics({ diagnostics: [], uri: event.document.uri });
            },
        );

        this.connection = createConnection(ProposedFeatures.all);

        this.connection.onCompletion
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    const context = new DocumentContext(document.uri, this.workspaceFolders);

                    return this.languageService.doComplete(document, params.position, context);
                }

                return null;
            },
        );

        this.connection.onCompletionResolve
        (
            item =>
            {
                const data = item.data;

                if (data?.languageId && data?.uri)
                {
                    const document = this.documents.get(data.uri);

                    if (document)
                    {
                        return this.languageService.doResolve(document, item);
                    }
                }

                return item;
            },
        );

        this.connection.onDefinition
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.findDefinition(document, params.position);
                }

                return [];
            },
        );

        this.connection.onDidChangeConfiguration
        (
            change =>
            {
                this.globalSettings = change.settings as Settings;

                this.documentSettings.clear();
                this.documents.all().forEach(x => this.triggerValidation(x));

                // dynamically enable & disable the formatter
                if (this.dynamicFormatterRegistration)
                {
                    const enableFormatter = this.globalSettings?.html?.format?.enable ?? false;

                    if (enableFormatter)
                    {
                        if (!this.formatterRegistrations)
                        {
                            const documentSelector = [{ language: "html" }, { language: "handlebars" }];

                            this.formatterRegistrations =
                            [
                                this.connection.client.register(DocumentRangeFormattingRequest.type, { documentSelector }),
                                this.connection.client.register(DocumentFormattingRequest.type, { documentSelector }),
                            ];
                        }
                    }
                    else if (this.formatterRegistrations)
                    {
                        this.formatterRegistrations.forEach(async x => x.then(y => y.dispose()));
                        this.formatterRegistrations = null;
                    }
                }
            },
        );

        this.connection.onDocumentFormatting
        (
            async params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    const settings = await this.getDocumentSettings(document, () => true) ?? this.globalSettings;

                    return this.languageService.format(document, getFullRange(document), params.options, settings);
                }

                return [];
            },
        );

        this.connection.onDocumentRangeFormatting
        (
            async params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    const settings = await this.getDocumentSettings(document, () => true) ?? this.globalSettings;

                    return this.languageService.format(document, params.range, params.options, settings);
                }

                return [];
            },
        );

        this.connection.onDocumentHighlight
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.findDocumentHighlight(document, params.position);
                }

                return [];
            },
        );

        this.connection.onDocumentLinks
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    const context = new DocumentContext(document.uri, this.workspaceFolders);

                    return this.languageService.findDocumentLinks(document, context);
                }

                return [];
            },
        ),

        this.connection.onDocumentSymbol
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.findDocumentSymbols(document);
                }

                return [];
            },
        );

        this.connection.onFoldingRanges
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.getFoldingRanges(document);
                }

                return [];
            },
        );

        this.connection.onInitialize
        (
            (params) =>
            {
                const server = this;

                const workspace: Workspace =
                {
                    get folders()  { return server.workspaceFolders ?? []; },
                    get settings() { return server.globalSettings; },
                };

                this.workspaceFolders             = params.workspaceFolders ?? [];
                this.workspaceFoldersSupport      = getValue(params.capabilities, "workspace.workspaceFolders") as boolean | undefined ?? false;
                this.dynamicFormatterRegistration = (getValue(params.capabilities, "textDocument.rangeFormatting.dynamicRegistration") as boolean | undefined ?? false) && typeof params.initializationOptions?.provideFormatter != "boolean";
                this.foldingRangeLimit            = getValue(params.capabilities, "textDocument.foldingRange.rangeLimit") as number | undefined ?? Number.MAX_VALUE;

                this.languageService = new LanguageService(workspace, this.foldingRangeLimit);

                const clientSnippetSupport = getValue(params.capabilities, "textDocument.completion.completionItem.snippetSupport") as boolean | undefined ?? false;

                return {
                    capabilities:
                    {
                        colorProvider:                   { },
                        completionProvider:              clientSnippetSupport ? { resolveProvider: true, triggerCharacters: [".", ":", "<", "\"", "=", "/"] } : undefined,
                        definitionProvider:              true,
                        documentFormattingProvider:      params.initializationOptions?.provideFormatter == true,
                        documentHighlightProvider:       true,
                        documentLinkProvider:            { resolveProvider: false },
                        documentRangeFormattingProvider: params.initializationOptions?.provideFormatter == true,
                        documentSymbolProvider:          true,
                        foldingRangeProvider:            true,
                        hoverProvider:                   true,
                        linkedEditingRangeProvider:      true,
                        referencesProvider:              true,
                        renameProvider:                  true,
                        selectionRangeProvider:          true,
                        signatureHelpProvider:           { triggerCharacters: ["("] },
                        textDocumentSync:                TextDocumentSyncKind.Incremental,
                    },
                };
            },
        );

        this.connection.onInitialized
        (
            () =>
            {
                if (this.workspaceFoldersSupport)
                {
                    void this.connection.client.register(DidChangeWorkspaceFoldersNotification.type);

                    this.connection.onNotification
                    (
                        DidChangeWorkspaceFoldersNotification.type,
                        e =>
                        {
                            const toAdd          = e.event.added;
                            const toRemove       = e.event.removed;
                            const updatedFolders = [];

                            for (const folder of this.workspaceFolders)
                            {
                                if (!toRemove.some(r => r.uri == folder.uri) && !toAdd.some(r => r.uri == folder.uri))
                                {
                                    updatedFolders.push(folder);
                                }
                            }

                            this.workspaceFolders = updatedFolders.concat(toAdd);
                            this.documents.all().forEach(x => this.triggerValidation(x));
                        });
                }
            },
        );

        this.connection.onHover
        (
            (params) =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.doHover(document, params.position);
                }

                return null;
            },
        );

        this.connection.onNotification
        (
            CustomDataChangedNotificationRequest.type,
            async dataPaths =>
            {
                const dataProviders = await fetchHTMLDataProviders(dataPaths, customDataRequestService);
                this.languageService.updateDataProviders(dataProviders);
            },
        );

        this.connection.onReferences
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.findReferences(document, params.position);
                }

                return [];
            },
        );

        this.connection.onRenameRequest
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.doRename(document, params.position, params.newName);
                }

                return null;
            },
        );

        this.connection.onRequest
        (
            ColorPresentationRequest.type,
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.getColorPresentations(document, params.color, params.range);
                }

                return [];
            },
        );

        this.connection.onRequest
        (
            DocumentColorRequest.type,
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.findDocumentColors(document);
                }

                return [];
            },
        );

        this.connection.onRequest
        (
            AutoInsertRequest.type,
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    if (params.position.character > 0)
                    {
                        return this.languageService.doAutoInsert(document, params.position, params.kind);
                    }
                }
                return null;
            },
        );

        this.connection.onRequest
        (
            SemanticTokenRequest.type,
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.getSemanticTokens(document, params.ranges);
                }

                return [];
            },
        );

        this.connection.onRequest
        (
            SemanticTokenLegendRequest.type,
            () => this.languageService.getSemanticTokenLegend(),
        );

        this.connection.onSelectionRanges
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.getSelectionRanges(document, params.positions);
                }

                return [];
            },
        );

        this.connection.languages.onLinkedEditingRange
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    const pos = params.position;

                    if (pos.character > 0)
                    {
                        const ranges = this.languageService.doLinkedEditing(document, params.position);

                        if (ranges)
                        {
                            return { ranges };
                        }
                    }
                }
                return null;
            },
        );

        this.connection.onShutdown(() => this.languageService.dispose());

        this.connection.onSignatureHelp
        (
            params =>
            {
                const document = this.documents.get(params.textDocument.uri);

                if (document)
                {
                    return this.languageService.doSignatureHelp(document, params.position);
                }

                return null;
            },
        );

        this.documents.listen(this.connection);
        this.connection.listen();
    }
}

/*
✔️connection.onCompletion
✔️connection.onCompletionResolve
✔️connection.onDefinition
✔️connection.onDidChangeConfiguration
✔️connection.onDocumentFormatting
✔️connection.onDocumentHighlight
✔️connection.onDocumentLinks
✔️connection.onDocumentRangeFormatting
✔️connection.onDocumentSymbol
✔️connection.onFoldingRanges
✔️connection.onHover
✔️connection.onInitialize
✔️connection.onInitialized
✔️connection.onNotification - CustomDataChangedNotification
✔️connection.onNotification - DidChangeWorkspaceFoldersNotification
✔️connection.onReferences
✔️connection.onRenameRequest
✔️connection.onRequest - AutoInsertRequest
✔️connection.onRequest - ColorPresentationRequest
✔️connection.onRequest - DocumentColorRequest
✔️connection.onRequest - SemanticTokenLegendRequest
✔️connection.onRequest - SemanticTokenRequest
✔️connection.onSelectionRanges
✔️connection.onShutdown
✔️connection.onSignatureHelp
✔️connection.languages.onLinkedEditingRange
*/