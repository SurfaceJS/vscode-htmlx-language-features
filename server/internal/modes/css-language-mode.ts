import type { LanguageService, Stylesheet } from "vscode-css-languageservice";
import type
{
    Color,
    ColorPresentation,
    Definition,
    Diagnostic,
    DocumentHighlight,
    FoldingRange,
    Hover,
    Location,
    Position,
    SelectionRange,
    SymbolInformation,
} from "vscode-languageserver";
import { CompletionList }           from "vscode-languageserver";
import type { Range, TextDocument } from "vscode-languageserver-textdocument";
import Cache                        from "../cache.js";
import type DocumentContext         from "../document-context.js";
import type HTMLDocumentRegions     from "../html-document-regions.js";
import type ILanguageMode           from "../interfaces/language-mode";
import type Settings                from "../types/settings.js";
import type Workspace               from "../types/workspace.js";

export const CSS_STYLE_RULE = "__";

export default class CssLanguageMode implements ILanguageMode
{
    private readonly embeddedCSSDocuments: Cache<TextDocument>;
    private readonly cssStylesheets: Cache<Stylesheet>;

    public readonly id = "css";

    public constructor
    (
        private readonly languageService: LanguageService,
        private readonly regions: Cache<HTMLDocumentRegions>,
        private readonly workspace: Workspace,
    )
    {
        this.embeddedCSSDocuments = new Cache(document => this.regions.get(document).getEmbeddedDocument("css"));
        this.cssStylesheets       = new Cache(document => this.languageService.parseStylesheet(document));
    }

    public dispose(): void
    {
        this.regions.dispose();
    }

    public async doComplete(document: TextDocument, position: Position, context: DocumentContext, settings: Settings = this.workspace.settings): Promise<CompletionList>
    {
        const embedded   = this.embeddedCSSDocuments.get(document);
        const stylesheet = this.cssStylesheets.get(embedded);

        return this.languageService.doComplete2(embedded, position, stylesheet, context, settings.css?.completion) ?? CompletionList.create();
    }

    public doHover(document: TextDocument, position: Position, settings: Settings = this.workspace.settings): Hover | null
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.doHover(embedded, position, this.cssStylesheets.get(embedded), settings.css?.hover);
    }

    public doValidation?(document: TextDocument, settings: Settings = this.workspace.settings): Diagnostic[]
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.doValidation(embedded, this.cssStylesheets.get(embedded), settings?.css);
    }

    public findDefinition(document: TextDocument, position: Position): Definition | null
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.findDefinition(embedded, position, this.cssStylesheets.get(embedded));
    }

    public findDocumentHighlight(document: TextDocument, position: Position): DocumentHighlight[]
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.findDocumentHighlights(embedded, position, this.cssStylesheets.get(embedded));
    }

    public findDocumentSymbols(document: TextDocument): SymbolInformation[]
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.findDocumentSymbols(embedded, this.cssStylesheets.get(embedded)).filter(s => s.name !== CSS_STYLE_RULE);
    }

    public findReferences(document: TextDocument, position: Position): Location[]
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.findReferences(embedded, position, this.cssStylesheets.get(embedded));
    }

    public getColorPresentations(document: TextDocument, color: Color, range: Range): ColorPresentation[]
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.getColorPresentations(embedded, this.cssStylesheets.get(embedded), color, range);
    }

    public getFoldingRanges(document: TextDocument): FoldingRange[]
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.getFoldingRanges(embedded, { });
    }

    public getSelectionRange(document: TextDocument, position: Position): SelectionRange
    {
        const embedded = this.embeddedCSSDocuments.get(document);

        return this.languageService.getSelectionRanges(embedded, [position], this.cssStylesheets.get(embedded))[0];
    }

    public removeDocument(document: TextDocument): void
    {
        this.regions.delete(document);
    }
}