import type
{
    HTMLDocument,
    HTMLFormatConfiguration,
    LanguageService,
} from "vscode-html-languageservice";
import type
{
    CompletionList,
    DocumentHighlight,
    DocumentLink,
    FoldingRange,
    FormattingOptions,
    Hover,
    Position,
    Range,
    SelectionRange,
    SymbolInformation,
    TextEdit,
    WorkspaceEdit,
} from "vscode-languageserver";
import type { TextDocument }   from "vscode-languageserver-textdocument";
import Cache              from "../cache.js";
import type DocumentContext    from "../document-context.js";
import type ILanguageMode from "../interfaces/language-mode";
import type Settings      from "../types/settings.js";
import type Workspace     from "../types/workspace.js";

export default class HtmlLanguageMode implements ILanguageMode
{
    private readonly htmlDocuments: Cache<HTMLDocument>;

    public readonly id = "html";

    public constructor(private readonly languageService: LanguageService, private readonly workspace: Workspace)
    {
        this.htmlDocuments = new Cache(document => languageService.parseHTMLDocument(document));
    }

    public dispose(): void
    {
        this.htmlDocuments.dispose();
    }

    public doAutoInsert(document: TextDocument, position: Position, kind: "autoClose" | "autoQuote"): string | null
    {
        const offset = document.offsetAt(position);
        const text   = document.getText();

        if (kind == "autoQuote")
        {
            if (offset > 0 && text.charAt(offset - 1) === "=")
            {
                const htmlSettings = this.workspace.settings?.html;
                const options      = { ...htmlSettings?.suggest };

                options.attributeDefaultValue = htmlSettings?.completion?.attributeDefaultValue ?? "doublequotes";

                return this.languageService.doQuoteComplete(document, position, this.htmlDocuments.get(document), options);
            }
        }
        else if (kind == "autoClose")
        {
            if (offset > 0 && text.charAt(offset - 1).match(/[>\/]/g))
            {
                return this.languageService.doTagComplete(document, position, this.htmlDocuments.get(document));
            }
        }

        return null;
    }

    public async doComplete(document: TextDocument, position: Position, context: DocumentContext, settings: Settings = this.workspace.settings): Promise<CompletionList>
    {
        const htmlDocument = this.htmlDocuments.get(document);

        return this.languageService.doComplete2(document, position, htmlDocument, context, settings?.html?.completion);
    }

    public doHover(document: TextDocument, position: Position, settings: Settings = this.workspace.settings): Hover | null
    {
        return this.languageService.doHover(document, position, this.htmlDocuments.get(document), settings?.html?.hover);
    }

    public doLinkedEditing(document: TextDocument, position: Position): Range[] | null
    {
        const htmlDocument = this.htmlDocuments.get(document);

        return this.languageService.findLinkedEditingRanges(document, position, htmlDocument);
    }

    public doRename(document: TextDocument, position: Position, newName: string): WorkspaceEdit | null
    {
        const htmlDocument = this.htmlDocuments.get(document);

        return this.languageService.doRename(document, position, newName, htmlDocument);
    }

    public findDocumentHighlight(document: TextDocument, position: Position): DocumentHighlight[]
    {
        return this.languageService.findDocumentHighlights(document, position, this.htmlDocuments.get(document));
    }

    public findDocumentLinks(document: TextDocument, documentContext: DocumentContext): DocumentLink[]
    {
        return this.languageService.findDocumentLinks(document, documentContext);
    }

    public findDocumentSymbols(document: TextDocument): SymbolInformation[]
    {
        return this.languageService.findDocumentSymbols(document, this.htmlDocuments.get(document));
    }

    public format(document: TextDocument, range: Range, options: FormattingOptions, settings?: Settings): TextEdit[]
    {
        const formatSettings: HTMLFormatConfiguration = { ...settings?.html?.format };

        if (formatSettings.contentUnformatted)
        {
            formatSettings.contentUnformatted += ",script";
        }
        else
        {
            formatSettings.contentUnformatted = "script";
        }

        Object.assign(formatSettings, options);

        return this.languageService.format(document, range, formatSettings);
    }

    public getFoldingRanges(document: TextDocument): FoldingRange[]
    {
        return this.languageService.getFoldingRanges(document);
    }

    public getSelectionRange(document: TextDocument, position: Position): SelectionRange
    {
        return this.languageService.getSelectionRanges(document, [position])[0];
    }

    public removeDocument(document: TextDocument): void
    {
        this.htmlDocuments.delete(document);
    }

}