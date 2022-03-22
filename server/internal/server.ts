
import { TextDocument } from "vscode-languageserver-textdocument";
import type {
    CancellationToken,
    ColorInformation,
    ColorPresentation,
    ColorPresentationParams,
    CompletionItem,
    CompletionList,
    CompletionParams,
    ConfigurationParams,
    Connection,
    Definition,
    DefinitionParams,
    DidChangeConfigurationParams,
    DidChangeWorkspaceFoldersParams,
    Disposable,
    DocumentColorParams,
    DocumentFormattingParams,
    DocumentHighlight,
    DocumentHighlightParams,
    DocumentLink,
    DocumentLinkParams,
    DocumentRangeFormattingParams,
    DocumentSymbolParams,
    FoldingRange,
    FoldingRangeParams,
    Hover,
    HoverParams,
    InitializeParams,
    InitializeResult,
    LinkedEditingRangeParams,
    Location,
    ReferenceParams,
    RenameParams,
    SelectionRange,
    SelectionRangeParams,
    SignatureHelp,
    SignatureHelpParams,
    SymbolInformation,
    TextEdit,
    WorkspaceEdit,
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
    LSPErrorCodes,
    Position,
    ProposedFeatures,
    Range,
    ResponseError,
    TextDocumentSyncKind,
    TextDocuments,
    createConnection,
} from "vscode-languageserver/node.js";

import CustomDataRequestService             from "./custom-data-request-service.js";
import { fetchHTMLDataProviders }           from "./custom-data.js";
import DocumentContext                      from "./document-context.js";
import LanguageService                      from "./language-service.js";
import AutoInsertRequest                    from "./requests/auto-insert-request.js";
import type { AutoInsertParams }            from "./requests/auto-insert-request.js";
import CustomDataChangedNotificationRequest from "./requests/custom-data-changed-notification-request.js";
import SemanticTokenLegendRequest           from "./requests/semantic-token-legend-request.js";
import SemanticTokenRequest                 from "./requests/semantic-token-request.js";
import type { SemanticTokenParams }         from "./requests/semantic-token-request.js";
import type SemanticTokenLegend             from "./types/semantic-token-legend.js";
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
    private customDataRequestService!:    CustomDataRequestService;
    private dynamicFormatterRegistration: boolean = false;
    private foldingRangeLimit:            number = Number.MAX_VALUE;
    private formatterRegistrations:       Promise<Disposable>[] | null = null;
    private globalSettings!:              Settings;
    private languageService!:             LanguageService;
    private workspaceFolders!:            WorkspaceFolder[];
    private workspaceFoldersSupport:      boolean = false;

    private cleanPendingValidation(textDocument: TextDocument): void
    {
        const request = this.pendingValidationRequests.get(textDocument.uri);

        if (request)
        {
            request.dispose();

            this.pendingValidationRequests.delete(textDocument.uri);
        }
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async runSafe<F extends (...args: any[]) => any, E>(fn: F, params: Parameters<F>[0], token: CancellationToken, fallback: Awaited<ReturnType<F>>): Promise<Awaited<ReturnType<F>> | ResponseError<E>>
    {
        return new Promise<Awaited<ReturnType<F>> | ResponseError<E>>
        (
            resolve =>
            {
                setImmediate
                (
                    () =>
                    {
                        if (token.isCancellationRequested)
                        {
                            resolve(new ResponseError(LSPErrorCodes.RequestCancelled, "Request cancelled"));
                        }

                        const onSuccess = (value: Awaited<ReturnType<F>>): void =>
                            resolve(token.isCancellationRequested ? new ResponseError(LSPErrorCodes.RequestCancelled, "Request cancelled") : value);

                        const onFailure = (error: Error): void =>
                        {
                            console.error(formatError(`Error while calling ${fn.name} for ${params.textDocument.uri}`, error));

                            resolve(fallback);
                        };

                        try
                        {
                            const result = fn.call(this, params);

                            if (result instanceof Promise)
                            {
                                result.then(onSuccess).catch(onFailure);
                            }
                            else
                            {
                                onSuccess(result);
                            }
                        }
                        catch (error)
                        {
                            onFailure(error as Error);
                        }
                    },
                );
            },
        );
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
        this.customDataRequestService = new CustomDataRequestService(this.connection);

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

        this.connection.languages.onLinkedEditingRange(async (params, token) => this.runSafe(this.onLanguagesLinkedEditingRange, params, token, null));
        this.connection.onCompletion(async (params, token) => this.runSafe(this.onCompletion, params, token, null));
        this.connection.onCompletionResolve(async (params, token) => this.runSafe(this.onCompletionResolve, params, token, params));
        this.connection.onDefinition(async (params, token) => this.runSafe(this.onDefinition, params, token, null));
        this.connection.onDidChangeConfiguration(params => this.onDidChangeConfiguration(params));
        this.connection.onDocumentFormatting(async (params, token) => this.runSafe(this.onDocumentFormatting, params, token, []));
        this.connection.onDocumentHighlight(async (params, token) => this.runSafe(this.onDocumentHighlight, params, token, []));
        this.connection.onDocumentLinks(async (params, token) => this.runSafe(this.onDocumentLinks, params, token, []));
        this.connection.onDocumentRangeFormatting(async (params, token) => this.runSafe(this.onDocumentRangeFormatting, params, token, []));
        this.connection.onDocumentSymbol(async (params, token) => this.runSafe(this.onDocumentSymbol, params, token, []));
        this.connection.onFoldingRanges(async (params, token) => this.runSafe(this.onFoldingRanges, params, token, []));
        this.connection.onHover(async (params, token) => this.runSafe(this.onHover, params, token, null));
        this.connection.onInitialize(async (params, token) => this.runSafe(this.onInitialize, params, token, { capabilities: { } }));
        this.connection.onInitialized(() => this.onInitialized());
        this.connection.onNotification(CustomDataChangedNotificationRequest.type, async params => this.onNotificationCustomDataChanged(params));
        this.connection.onReferences(async (params, token) => this.runSafe(this.onReferences, params, token, []));
        this.connection.onRenameRequest(async (params, token) => this.runSafe(this.onRenameRequest, params, token, null));
        this.connection.onRequest(AutoInsertRequest.type, async (params, token) => this.runSafe(this.onRequestAutoInsert, params, token, null));
        this.connection.onRequest(ColorPresentationRequest.type, async (params, token) => this.runSafe(this.onRequestColorPresentation, params, token, []));
        this.connection.onRequest(DocumentColorRequest.type, async (params, token) => this.runSafe(this.onRequestDocumentColor, params, token, []));
        this.connection.onRequest(SemanticTokenLegendRequest.type, () => this.onRequestSemanticTokenLegend());
        this.connection.onRequest(SemanticTokenRequest.type, async (params, token) => this.runSafe(this.onRequestSemanticToken, params, token, []));
        this.connection.onSelectionRanges(async (params, token) => this.runSafe(this.onSelectionRanges, params, token, []));
        this.connection.onShutdown(() => this.onShutdown());
        this.connection.onSignatureHelp(async (params, token) => this.runSafe(this.onSignatureHelp, params, token, null));

        this.documents.listen(this.connection);
        this.connection.listen();
    }

    public async onCompletion(params: CompletionParams): Promise<CompletionList | null>
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            const context = new DocumentContext(document.uri, this.workspaceFolders);

            return this.languageService.doComplete(document, params.position, context);
        }

        return null;
    }

    public onCompletionResolve(item: CompletionItem): CompletionItem
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
    }

    public onDefinition(params: DefinitionParams): Definition | null
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.findDefinition(document, params.position);
        }

        return null;
    }

    public onDidChangeConfiguration(change: DidChangeConfigurationParams): void
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
    }

    public async onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]>
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            const settings = await this.getDocumentSettings(document, () => true) ?? this.globalSettings;

            return this.languageService.format(document, getFullRange(document), params.options, settings);
        }

        return [];
    }

    public onDocumentHighlight(params: DocumentHighlightParams): DocumentHighlight[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.findDocumentHighlight(document, params.position);
        }

        return [];
    }

    public onDocumentLinks(params: DocumentLinkParams): DocumentLink[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            const context = new DocumentContext(document.uri, this.workspaceFolders);

            return this.languageService.findDocumentLinks(document, context);
        }

        return [];
    }

    public async onDocumentRangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[]>
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            const settings = await this.getDocumentSettings(document, () => true) ?? this.globalSettings;

            return this.languageService.format(document, params.range, params.options, settings);
        }

        return [];
    }

    public onDocumentSymbol(params: DocumentSymbolParams): SymbolInformation[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.findDocumentSymbols(document);
        }

        return [];
    }

    public onFoldingRanges(params: FoldingRangeParams): FoldingRange[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.getFoldingRanges(document);
        }

        return [];
    }

    public onHover(params: HoverParams): Hover | null
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.doHover(document, params.position);
        }

        return null;
    }

    public onInitialize(params: InitializeParams): InitializeResult
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
    }

    public onInitialized(): void
    {
        if (this.workspaceFoldersSupport)
        {
            void this.connection.client.register(DidChangeWorkspaceFoldersNotification.type);

            this.connection.onNotification(DidChangeWorkspaceFoldersNotification.type, params => this.onNotificationDidChangeWorkspaceFolders(params));
        }
    }

    public onLanguagesLinkedEditingRange(params: LinkedEditingRangeParams): { ranges: Range[] } | null
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
    }

    public async onNotificationCustomDataChanged(dataPaths: string[]): Promise<void>
    {
        const dataProviders = await fetchHTMLDataProviders(dataPaths, this.customDataRequestService);

        this.languageService.updateDataProviders(dataProviders);
    }

    public onNotificationDidChangeWorkspaceFolders(params: DidChangeWorkspaceFoldersParams): void
    {
        const toAdd          = params.event.added;
        const toRemove       = params.event.removed;
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
    }

    public onReferences(params: ReferenceParams): Location[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.findReferences(document, params.position);
        }

        return [];
    }

    public onRenameRequest(params: RenameParams): WorkspaceEdit | null
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.doRename(document, params.position, params.newName);
        }

        return null;
    }

    public onRequestAutoInsert(params: AutoInsertParams): string | null
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
    }

    public onRequestColorPresentation(params: ColorPresentationParams): ColorPresentation[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.getColorPresentations(document, params.color, params.range);
        }

        return [];
    }

    public onRequestDocumentColor(params: DocumentColorParams): ColorInformation[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.findDocumentColors(document);
        }

        return [];
    }

    public onRequestSemanticTokenLegend(): SemanticTokenLegend
    {
        return this.languageService.getSemanticTokenLegend();
    }

    public onRequestSemanticToken(params: SemanticTokenParams): number[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.getSemanticTokens(document, params.ranges);
        }

        return [];
    }

    public onSelectionRanges(params: SelectionRangeParams): SelectionRange[]
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.getSelectionRanges(document, params.positions);
        }

        return [];
    }

    public onShutdown(): void
    {
        this.languageService.dispose();
    }

    public onSignatureHelp(params: SignatureHelpParams): SignatureHelp | null
    {
        const document = this.documents.get(params.textDocument.uri);

        if (document)
        {
            return this.languageService.doSignatureHelp(document, params.position);
        }

        return null;
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