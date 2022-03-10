import ts from "typescript";
import type
{
    CompletionItem,
    CompletionList,
    Definition,
    Diagnostic,
    DocumentHighlight,
    FoldingRange,
    FormattingOptions,
    Hover,
    Location,
    ParameterInformation,
    SignatureHelp,
    SignatureInformation,
    SymbolInformation,
    WorkspaceEdit,
} from "vscode-languageserver";
import
{
    CompletionItemKind,
    DiagnosticSeverity,
    DocumentHighlightKind,
    FoldingRangeKind,
    Position,
    Range,
    SelectionRange,
    SymbolKind,
    TextEdit,
} from "vscode-languageserver";
import type { TextDocument }               from "vscode-languageserver-textdocument";
import Cache                               from "../cache.js";
import { getWordAtText, isWhitespaceOnly } from "../common/strings.js";
import type DocumentContext                from "../document-context.js";
import type HTMLDocumentRegions            from "../html-document-regions.js";
import type ILanguageMode                  from "../interfaces/language-mode";
import type SemanticTokenData              from "../types/semantic-token-data.js";
import type SemanticTokenLegend            from "../types/semantic-token-legend.js";
import type Settings                       from "../types/settings";
import type Workspace                      from "../types/workspace";
import Kind                                from "./enums/kind.js";
import JsLanguageServiceHost               from "./js-language-service-host.js";
import JsSemanticTokenProvider             from "./js-semantic-token-provider.js";

const JS_WORD_REGEX = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;

export default class JsLanguageMode implements ILanguageMode
{
    private readonly jsDocuments: Cache<TextDocument>;
    private readonly host: JsLanguageServiceHost;

    public readonly id: "javascript" | "typescript";

    public constructor
    (
        language: "javascript" | "typescript",
        private readonly regions: Cache<HTMLDocumentRegions>,
        private readonly workspace: Workspace,
    )
    {
        this.id          = language;
        this.jsDocuments = new Cache(document => regions.get(document).getEmbeddedDocument(language));
        this.host        = new JsLanguageServiceHost(language == "javascript" ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    }

    private convertKind(kind: string): CompletionItemKind
    {
        switch (kind)
        {
            case Kind.PrimitiveType:
            case Kind.Keyword:
                return CompletionItemKind.Keyword;

            case Kind.Const:
            case Kind.Let:
            case Kind.Variable:
            case Kind.LocalVariable:
            case Kind.Alias:
            case Kind.Parameter:
                return CompletionItemKind.Variable;

            case Kind.MemberVariable:
            case Kind.MemberGetAccessor:
            case Kind.MemberSetAccessor:
                return CompletionItemKind.Field;

            case Kind.Function:
            case Kind.LocalFunction:
                return CompletionItemKind.Function;

            case Kind.Method:
            case Kind.ConstructSignature:
            case Kind.CallSignature:
            case Kind.IndexSignature:
                return CompletionItemKind.Method;

            case Kind.Enum:
                return CompletionItemKind.Enum;

            case Kind.EnumMember:
                return CompletionItemKind.EnumMember;

            case Kind.Module:
            case Kind.ExternalModuleName:
                return CompletionItemKind.Module;

            case Kind.Class:
            case Kind.Type:
                return CompletionItemKind.Class;

            case Kind.Interface:
                return CompletionItemKind.Interface;

            case Kind.Warning:
                return CompletionItemKind.Text;

            case Kind.Script:
                return CompletionItemKind.File;

            case Kind.Directory:
                return CompletionItemKind.Folder;

            case Kind.String:
                return CompletionItemKind.Constant;

            default:
                return CompletionItemKind.Property;
        }
    }

    private convertRange(document: TextDocument, span: { start: number | undefined, length: number | undefined }): Range
    {
        if (typeof span.start == "undefined")
        {
            const pos = document.positionAt(0);

            return Range.create(pos, pos);
        }

        const startPosition = document.positionAt(span.start);
        const endPosition   = document.positionAt(span.start + (span.length ?? 0));

        return Range.create(startPosition, endPosition);
    }

    private convertSymbolKind(kind: string): SymbolKind
    {
        switch (kind)
        {
            case Kind.Module:
                return SymbolKind.Module;
            case Kind.Class:
                return SymbolKind.Class;
            case Kind.Enum:
                return SymbolKind.Enum;
            case Kind.EnumMember:
                return SymbolKind.EnumMember;
            case Kind.Interface:
                return SymbolKind.Interface;
            case Kind.IndexSignature:
                return SymbolKind.Method;
            case Kind.CallSignature:
                return SymbolKind.Method;
            case Kind.Method:
                return SymbolKind.Method;
            case Kind.MemberVariable:
                return SymbolKind.Property;
            case Kind.MemberGetAccessor:
                return SymbolKind.Property;
            case Kind.MemberSetAccessor:
                return SymbolKind.Property;
            case Kind.Variable:
                return SymbolKind.Variable;
            case Kind.Let:
                return SymbolKind.Variable;
            case Kind.Const:
                return SymbolKind.Variable;
            case Kind.LocalVariable:
                return SymbolKind.Variable;
            case Kind.Alias:
                return SymbolKind.Variable;
            case Kind.Function:
                return SymbolKind.Function;
            case Kind.LocalFunction:
                return SymbolKind.Function;
            case Kind.ConstructSignature:
                return SymbolKind.Constructor;
            case Kind.ConstructorImplementation:
                return SymbolKind.Constructor;
            case Kind.TypeParameter:
                return SymbolKind.TypeParameter;
            case Kind.String:
                return SymbolKind.String;
            default:
                return SymbolKind.Variable;
        }
    }

    private computeInitialIndent(document: TextDocument, range: Range, options: FormattingOptions): number
    {
        const lineStart = document.offsetAt(Position.create(range.start.line, 0));
        const content   = document.getText();
        const tabSize   = options.tabSize ?? 4;

        let i       = lineStart;
        let nChars  = 0;

        while (i < content.length)
        {
            const ch = content.charAt(i);

            if (ch == " ")
            {
                nChars++;
            }
            else if (ch == "\t")
            {
                nChars += tabSize;
            }
            else
            {
                break;
            }

            i++;
        }

        return Math.floor(nChars / tabSize);
    }

    private convertOptions(options: FormattingOptions, formatSettings: Required<Settings>["javascript"]["format"], initialIndentLevel: number): ts.FormatCodeSettings
    {
        return {
            baseIndentSize:                                              options.tabSize * initialIndentLevel,
            convertTabsToSpaces:                                         options.insertSpaces,
            indentSize:                                                  options.tabSize,
            indentStyle:                                                 ts.IndentStyle.Smart,
            insertSpaceAfterCommaDelimiter:                              Boolean(!formatSettings?.insertSpaceAfterCommaDelimiter),
            insertSpaceAfterConstructor:                                 Boolean(formatSettings?.insertSpaceAfterConstructor),
            insertSpaceAfterFunctionKeywordForAnonymousFunctions:        Boolean(!formatSettings?.insertSpaceAfterFunctionKeywordForAnonymousFunctions),
            insertSpaceAfterKeywordsInControlFlowStatements:             Boolean(!formatSettings?.insertSpaceAfterKeywordsInControlFlowStatements),
            insertSpaceAfterOpeningAndBeforeClosingEmptyBraces:          Boolean(!formatSettings?.insertSpaceAfterOpeningAndBeforeClosingEmptyBraces),
            insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces:  Boolean(formatSettings?.insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces),
            insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces:       Boolean(formatSettings?.insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces),
            insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets:     Boolean(formatSettings?.insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets),
            insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis:  Boolean(formatSettings?.insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis),
            insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: Boolean(formatSettings?.insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces),
            insertSpaceAfterSemicolonInForStatements:                    Boolean(!formatSettings?.insertSpaceAfterSemicolonInForStatements),
            insertSpaceAfterTypeAssertion:                               Boolean(formatSettings?.insertSpaceAfterTypeAssertion),
            insertSpaceBeforeAndAfterBinaryOperators:                    Boolean(!formatSettings?.insertSpaceBeforeAndAfterBinaryOperators),
            insertSpaceBeforeFunctionParenthesis:                        Boolean(formatSettings?.insertSpaceBeforeFunctionParenthesis),
            newLineCharacter:                                            "\n",
            placeOpenBraceOnNewLineForControlBlocks:                     Boolean(formatSettings?.placeOpenBraceOnNewLineForFunctions),
            placeOpenBraceOnNewLineForFunctions:                         Boolean(formatSettings?.placeOpenBraceOnNewLineForControlBlocks),
            semicolons:                                                  formatSettings?.semicolons as ts.SemicolonPreference | undefined,
            tabSize:                                                     options.tabSize,
        };
    }

    public dispose(): void
    {
        this.jsDocuments.dispose();
    }

    public async doComplete(document: TextDocument, position: Position, _context: DocumentContext): Promise<CompletionList>
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);
        const offset            = jsDocument.offsetAt(position);
        const completions       = jsLanguageService.getCompletionsAtPosition(jsDocument.uri, offset, { includeExternalModuleExports: false, includeInsertTextCompletions: false });

        if (!completions)
        {
            return { isIncomplete: false, items: [] };
        }

        const replaceRange = this.convertRange(jsDocument, getWordAtText(jsDocument.getText(), offset, JS_WORD_REGEX));

        const completionList: CompletionList =
        {
            isIncomplete: false,
            items:        completions.entries.map
            (
                entry =>
                    ({
                        data:
                        {
                            languageId: this.id,
                            offset,
                            uri:        document.uri,
                        },
                        kind:     this.convertKind(entry.kind),
                        label:    entry.name,
                        position,
                        sortText: entry.sortText,
                        textEdit: TextEdit.replace(replaceRange, entry.name),
                        uri:      document.uri,
                    }),
            ),
        };

        return Promise.resolve(completionList);
    }

    public doHover(document: TextDocument, position: Position): Hover | null
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);
        const info              = jsLanguageService.getQuickInfoAtPosition(jsDocument.uri, jsDocument.offsetAt(position));

        if (info)
        {
            const contents = ts.displayPartsToString(info.displayParts);

            return {
                contents: ["```typescript", contents, "```"].join("\n"),
                range:    this.convertRange(jsDocument, info.textSpan),
            };
        }

        return null;
    }

    public doRename(document: TextDocument, position: Position, newName: string): WorkspaceEdit | null
    {
        const jsDocument         = this.jsDocuments.get(document);
        const jsLanguageService  = this.host.getLanguageService(jsDocument);
        const jsDocumentPosition = jsDocument.offsetAt(position);
        const { canRename }      = jsLanguageService.getRenameInfo(jsDocument.uri, jsDocumentPosition);

        if (!canRename)
        {
            return null;
        }

        const renameInfos       = jsLanguageService.findRenameLocations(jsDocument.uri, jsDocumentPosition, false, false);
        const edits: TextEdit[] = [];

        if (renameInfos)
        {
            for (const info of renameInfos)
            {
                edits.push({ newText: newName, range: this.convertRange(jsDocument, info.textSpan) });
            }
        }

        return { changes: { [document.uri]: edits } };
    }

    public doResolve(document: TextDocument, item: CompletionItem): CompletionItem
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);
        const details           = jsLanguageService.getCompletionEntryDetails(jsDocument.uri, item.data.offset, item.label, undefined, undefined, undefined, undefined);

        if (details)
        {
            item.detail        = ts.displayPartsToString(details.displayParts);
            item.documentation = ts.displayPartsToString(details.documentation);

            delete item.data;
        }

        return item;
    }

    public doValidation(document: TextDocument, settings = this.workspace.settings): Diagnostic[]
    {
        this.host.getCompilationSettings().experimentalDecorators = settings?.javascript?.implicitProjectConfig?.experimentalDecorators;

        const jsDocument                         = this.jsDocuments.get(document);
        const languageService                    = this.host.getLanguageService(jsDocument);
        const syntaxDiagnostics: ts.Diagnostic[] = languageService.getSyntacticDiagnostics(jsDocument.uri);
        const semanticDiagnostics                = languageService.getSemanticDiagnostics(jsDocument.uri);

        return syntaxDiagnostics.concat(semanticDiagnostics)
            .map
            (
                (diag: ts.Diagnostic): Diagnostic =>
                    ({
                        message:  ts.flattenDiagnosticMessageText(diag.messageText, "\n"),
                        range:    this.convertRange(jsDocument, diag),
                        severity: DiagnosticSeverity.Error,
                        source:   this.id,
                    }),
            );
    }

    public doSignatureHelp(document: TextDocument, position: Position): SignatureHelp | null
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);

        const signHelp = jsLanguageService.getSignatureHelpItems(jsDocument.uri, jsDocument.offsetAt(position), undefined);

        if (signHelp)
        {
            const ret: SignatureHelp =
            {
                activeParameter: signHelp.argumentIndex,
                activeSignature: signHelp.selectedItemIndex,
                signatures:      [],
            };

            for (const item of signHelp.items)
            {
                const signature: SignatureInformation =
                {
                    documentation: undefined,
                    label:         "",
                    parameters:    [],
                };

                signature.label += ts.displayPartsToString(item.prefixDisplayParts);

                let i = 0;

                for (const parameter of item.parameters)
                {
                    const label = ts.displayPartsToString(parameter.displayParts);

                    const parameterInformation: ParameterInformation =
                    {
                        documentation: ts.displayPartsToString(parameter.documentation),
                        label,
                    };

                    signature.label += label;
                    signature.parameters!.push(parameterInformation);

                    if (i < item.parameters.length - 1)
                    {
                        signature.label += ts.displayPartsToString(item.separatorDisplayParts);
                    }

                    i++;
                }

                signature.label += ts.displayPartsToString(item.suffixDisplayParts);
                ret.signatures.push(signature);
            }

            return ret;
        }

        return null;
    }

    public findDefinition(document: TextDocument, position: Position): Definition | null
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);
        const definition        = jsLanguageService.getDefinitionAtPosition(jsDocument.uri, jsDocument.offsetAt(position));

        if (definition)
        {
            return definition
                .filter(x => x.fileName == jsDocument.uri)
                .map(x => ({ range: this.convertRange(jsDocument, x.textSpan), uri: document.uri  }));
        }

        return null;
    }

    public findDocumentHighlight(document: TextDocument, position: Position): DocumentHighlight[]
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);
        const highlights        = jsLanguageService.getDocumentHighlights(jsDocument.uri, jsDocument.offsetAt(position), [jsDocument.uri]);

        const result: DocumentHighlight[] = [];

        for (const entry of highlights ?? [])
        {
            for (const highlight of entry.highlightSpans)
            {
                result.push
                ({
                    kind:  highlight.kind == "writtenReference" ? DocumentHighlightKind.Write : DocumentHighlightKind.Text,
                    range: this.convertRange(jsDocument, highlight.textSpan),
                });
            }
        }

        return result;
    }

    public findDocumentSymbols(document: TextDocument): SymbolInformation[]
    {
        const jsDocument                  = this.jsDocuments.get(document);
        const jsLanguageService           = this.host.getLanguageService(jsDocument);
        const items                       = jsLanguageService.getNavigationBarItems(jsDocument.uri);
        const result: SymbolInformation[] = [];
        const existing                    = new Map<string, boolean>();

        const collectSymbols = (item: ts.NavigationBarItem, containerLabel?: string): void =>
        {
            const signature = item.text + item.kind + item.spans[0].start;

            let label = containerLabel;

            if (item.kind != "script" && !existing.has(signature))
            {
                const symbol: SymbolInformation =
                {
                    containerName: label,
                    kind:          this.convertSymbolKind(item.kind),
                    location:
                    {
                        range: this.convertRange(jsDocument, item.spans[0]),
                        uri:   document.uri,
                    },
                    name:          item.text,
                };

                existing.set(signature, true);
                result.push(symbol);

                label = item.text;
            }

            if (item.childItems && item.childItems.length > 0)
            {
                for (const child of item.childItems)
                {
                    collectSymbols(child, label);
                }
            }
        };

        items.forEach(item => collectSymbols(item));

        return result;
    }

    public findReferences(document: TextDocument, position: Position): Location[]
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);
        const references        = jsLanguageService.getReferencesAtPosition(jsDocument.uri, jsDocument.offsetAt(position));

        if (references)
        {
            return references
                .filter(d => d.fileName == jsDocument.uri)
                .map
                (
                    entry =>
                        ({
                            range: this.convertRange(jsDocument, entry.textSpan),
                            uri:   document.uri,
                        }),
                );
        }

        return [];
    }

    public format(document: TextDocument, range: Range, options: FormattingOptions, settings?: Settings): TextEdit[]
    {
        const jsDocument         = this.regions.get(document).getEmbeddedDocument("javascript", true);
        const jsLanguageService  = this.host.getLanguageService(jsDocument);
        const formatterSettings  = settings?.javascript?.format;
        const initialIndentLevel = this.computeInitialIndent(document, range, options);
        const formatSettings     = this.convertOptions(options, formatterSettings, initialIndentLevel + 1);
        const start              = jsDocument.offsetAt(range.start);

        let end           = jsDocument.offsetAt(range.end);
        let lastLineRange = null;

        if (range.end.line > range.start.line && (range.end.character == 0 || isWhitespaceOnly(jsDocument.getText().substring(end - range.end.character, range.end.character))))
        {
            end          -= range.end.character;
            lastLineRange = Range.create(Position.create(range.end.line, 0), range.end);
        }

        const edits = jsLanguageService.getFormattingEditsForRange(jsDocument.uri, start, end, formatSettings);

        if (edits)
        {
            const result = [];

            for (const edit of edits)
            {
                if (edit.span.start >= start && edit.span.start + edit.span.length <= end)
                {
                    result.push
                    ({
                        newText: edit.newText,
                        range:   this.convertRange(jsDocument, edit.span),
                    });
                }
            }

            if (lastLineRange)
            {
                result.push
                ({
                    newText: options.insertSpaces
                        ? " ".repeat(initialIndentLevel * options.tabSize)
                        : "\t".repeat(initialIndentLevel),
                    range: lastLineRange,
                });
            }

            return result;
        }

        return [];
    }

    public getFoldingRanges(document: TextDocument): FoldingRange[]
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);

        const spans                  = jsLanguageService.getOutliningSpans(jsDocument.uri);
        const ranges: FoldingRange[] = [];

        for (const span of spans)
        {
            const curr      = this.convertRange(jsDocument, span.textSpan);
            const startLine = curr.start.line;
            const endLine   = curr.end.line;

            if (startLine < endLine)
            {
                const foldingRange: FoldingRange = { endLine, startLine };
                const match                      = /^\s*\/(?:(\/\s*#(?:end)?region\b)|(\*|\/))/.exec(document.getText(curr));

                if (match)
                {
                    foldingRange.kind = match[1] ? FoldingRangeKind.Region : FoldingRangeKind.Comment;
                }

                ranges.push(foldingRange);
            }
        }

        return ranges;
    }

    public getSelectionRange(document: TextDocument, position: Position): SelectionRange
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);

        const mode = this;

        function convertSelectionRange(selectionRange: ts.SelectionRange): SelectionRange
        {
            const parent = selectionRange.parent ? convertSelectionRange(selectionRange.parent) : undefined;

            return SelectionRange.create(mode.convertRange(jsDocument, selectionRange.textSpan), parent);
        }

        const range = jsLanguageService.getSmartSelectionRange(jsDocument.uri, jsDocument.offsetAt(position));

        return convertSelectionRange(range);
    }

    public getSemanticTokens(document: TextDocument): SemanticTokenData[]
    {
        const jsDocument        = this.jsDocuments.get(document);
        const jsLanguageService = this.host.getLanguageService(jsDocument);

        return new JsSemanticTokenProvider(jsLanguageService).getSemanticTokens(jsDocument, jsDocument.uri);
    }

    public getSemanticTokenLegend(): SemanticTokenLegend
    {
        return JsSemanticTokenProvider.getSemanticTokenLegend();
    }

    public removeDocument(document: TextDocument): void
    {
        this.jsDocuments.delete(document);
    }
}
