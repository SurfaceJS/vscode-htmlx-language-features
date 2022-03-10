import type { DocumentContext } from "vscode-html-languageservice";
import type
{
    Color,
    ColorInformation,
    ColorPresentation,
    CompletionItem,
    CompletionList,
    Definition,
    Diagnostic,
    DocumentHighlight,
    DocumentLink,
    FoldingRange,
    FormattingOptions,
    Hover,
    Location,
    SelectionRange,
    SignatureHelp,
    SymbolInformation,
    WorkspaceEdit,
} from "vscode-languageserver";
import type { Position, Range, TextDocument, TextEdit } from "vscode-languageserver-textdocument";
import type SemanticTokenData                           from "../types/semantic-token-data.js";
import type SemanticTokenLegend                         from "../types/semantic-token-legend.js";
import type Settings                                    from "../types/settings.js";

export default interface ILanguageService
{
    doAutoInsert?(document: TextDocument, position: Position, kind: "autoClose" | "autoQuote"): string | null;
    doComplete?(document: TextDocument, position: Position, documentContext: DocumentContext, settings?: Settings): Promise<CompletionList>;
    doHover?(document: TextDocument, position: Position, settings?: Settings): Hover | null;
    doLinkedEditing?(document: TextDocument, position: Position): Range[] | null;
    doRename?(document: TextDocument, position: Position, newName: string): WorkspaceEdit | null;
    doResolve?(document: TextDocument, item: CompletionItem): CompletionItem;
    doSignatureHelp?(document: TextDocument, position: Position): SignatureHelp | null;
    doValidation?(document: TextDocument, settings?: Settings): Diagnostic[];
    findDefinition?(document: TextDocument, position: Position): Definition | null;
    findDocumentColors?(document: TextDocument): ColorInformation[];
    findDocumentHighlight?(document: TextDocument, position: Position): DocumentHighlight[];
    findDocumentLinks?(document: TextDocument, documentContext: DocumentContext): DocumentLink[];
    findDocumentSymbols?(document: TextDocument): SymbolInformation[];
    findMatchingTagPosition?(document: TextDocument, position: Position): Position | null;
    findReferences?(document: TextDocument, position: Position): Location[];
    format?(document: TextDocument, range: Range, options: FormattingOptions, settings?: Settings): TextEdit[];
    getColorPresentations?(document: TextDocument, color: Color, range: Range): ColorPresentation[];
    getFoldingRanges?(document: TextDocument): FoldingRange[];
    getSelectionRange?(document: TextDocument, position: Position): SelectionRange;
    getSemanticTokenLegend?(): SemanticTokenLegend;
    getSemanticTokens?(document: TextDocument): SemanticTokenData[];
}