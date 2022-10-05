import { getCSSLanguageService }                                     from "vscode-css-languageservice";
import type { CompletionList, Diagnostic, Hover, IHTMLDataProvider } from "vscode-html-languageservice";
import { getLanguageService as getHTMLLanguageService }              from "vscode-html-languageservice";
import type
{
    Color,
    ColorInformation,
    ColorPresentation,
    CompletionItem,
    Definition,
    Disposable,
    DocumentHighlight,
    DocumentLink,
    FoldingRange,
    FormattingOptions,
    Location,
    SelectionRange,
    SignatureHelp,
    SymbolInformation,
    WorkspaceEdit,
} from "vscode-languageserver";
import
{
    Position,
    Range,
    TextEdit,
} from "vscode-languageserver";
import { TextDocument }         from "vscode-languageserver-textdocument";
import Cache                    from "./cache.js";
import { insideRangeButNotSame } from "./common.js";
import { isEOL }                from "./common/strings.js";
import type DocumentContext     from "./document-context.js";
import EmbeddedDocument         from "./embedded-document.js";
import type ILanguageMode       from "./interfaces/language-mode.js";
import type ILanguageService    from "./interfaces/language-service.js";
import LanguageModes            from "./language-modes.js";
import CssLanguageMode          from "./modes/css-language-mode.js";
import HtmlLanguageMode         from "./modes/html-language-mode.js";
import JsLanguageMode           from "./modes/js-language-mode.js";
import SemanticTokenProvider    from "./semantic-token-provider.js";
import type LanguageModeRange   from "./types/language-mode-range.js";
import type SemanticTokenData   from "./types/semantic-token-data.js";
import type SemanticTokenLegend from "./types/semantic-token-legend.js";
import type Settings            from "./types/settings.js";
import type Workspace           from "./types/workspace.js";

type LS         = Required<ILanguageService>;
type Methods    = { [K in keyof LS]: LS[K] extends Function ? LS[K] : never };
type AsArray<T> = T extends unknown[] ? T : T[];

export default class LanguageService implements ILanguageService, Disposable
{
    private readonly languageModes:         LanguageModes;
    private readonly semanticTokenProvider: SemanticTokenProvider;

    public constructor(workspace: Workspace, private readonly maxRanges: number)
    {
        const htmlLanguageService = getHTMLLanguageService();
        const cssLanguageService  = getCSSLanguageService();

        const handlers: Map<string, ILanguageMode> = new Map();

        const regions = new Cache((document: TextDocument) => EmbeddedDocument.getRegions(htmlLanguageService, document));

        handlers.set("html",       new HtmlLanguageMode(htmlLanguageService, workspace));
        handlers.set("css",        new CssLanguageMode(cssLanguageService, regions, workspace));
        handlers.set("javascript", new JsLanguageMode("javascript", regions, workspace));
        handlers.set("typescript", new JsLanguageMode("typescript", regions, workspace));

        this.languageModes         = new LanguageModes(htmlLanguageService, regions, handlers);
        this.semanticTokenProvider = new SemanticTokenProvider(this.languageModes);
    }

    private isValidationEnabled(languageId: string, settings: Settings): boolean
    {
        const validationSettings = settings?.html?.validate;

        if (validationSettings)
        {
            return languageId == "css" && validationSettings.styles != false || languageId == "javascript" && validationSettings.scripts != false;
        }

        return true;
    }

    private invoke<K extends keyof ILanguageService, M extends Methods[K]>(key: K, ...parameters: Parameters<M>): ReturnType<M> | null;
    private invoke(key: string, ...parameters: unknown[]): unknown
    {
        const [document, position] = parameters as [TextDocument, Position];

        const mode = this.languageModes.getModeAtPosition(document, position);

        const action = mode?.[key as keyof ILanguageMode] as Function;

        if (action)
        {
            return action.call(mode, ...parameters);
        }

        return null;
    }

    private invokeAll<K extends keyof ILanguageService, M extends Methods[K]>(key: K, parameters: Parameters<M>, condition?: (mode: ILanguageMode) => boolean): AsArray<ReturnType<M>>;
    private invokeAll(key: string, parameters: unknown[], condition?: (mode: ILanguageMode) => boolean): unknown
    {
        const result: unknown[] = [];

        for (const mode of this.languageModes.getAllModes())
        {
            const action = mode[key as keyof ILanguageService] as Function;

            if (action && (condition?.(mode) ?? true))
            {
                result.push(...action.call(mode, ...parameters));
            }
        }

        return result;
    }

    private limitRanges(ranges: FoldingRange[], maxRanges: number): FoldingRange[]
    {
        const currentRanges = ranges.sort
        (
            (r1, r2) =>
            {
                let diff = r1.startLine - r2.startLine;

                if (diff == 0)
                {
                    diff = r1.endLine - r2.endLine;
                }

                return diff;
            },
        );

        // compute each range's nesting level in 'nestingLevels'.
        // count the number of ranges for each level in 'nestingLevelCounts'
        const previous:           FoldingRange[] = [];
        const nestingLevels:      number[]       = [];
        const nestingLevelCounts: number[]       = [];

        let top: FoldingRange | undefined;

        const setNestingLevel = (index: number, level: number): void =>
        {
            nestingLevels[index] = level;
            if (level < 30)
            {
                nestingLevelCounts[level] = (nestingLevelCounts[level] || 0) + 1;
            }
        };

        // compute nesting levels and sanitize
        for (let i = 0; i < currentRanges.length; i++)
        {
            const entry = currentRanges[i];
            if (!top)
            {
                top = entry;
                setNestingLevel(i, 0);
            }
            else
            if (entry.startLine > top.startLine)
            {
                if (entry.endLine <= top.endLine)
                {
                    previous.push(top);
                    top = entry;
                    setNestingLevel(i, previous.length);
                }
                else if (entry.startLine > top.endLine)
                {
                    do
                    {
                        top = previous.pop();
                    } while (top && entry.startLine > top.endLine);

                    if (top)
                    {
                        previous.push(top);
                    }

                    top = entry;
                    setNestingLevel(i, previous.length);
                }
            }
        }

        let entries  = 0;
        let maxLevel = 0;

        for (let i = 0; i < nestingLevelCounts.length; i++)
        {
            const count = nestingLevelCounts[i];
            if (count)
            {
                if (count + entries > maxRanges)
                {
                    maxLevel = i;

                    break;
                }

                entries += count;
            }
        }

        const result = [];

        for (let i = 0; i < currentRanges.length; i++)
        {
            const level = nestingLevels[i];

            if (typeof level == "number")
            {
                if (level < maxLevel || level == maxLevel && entries++ < maxRanges)
                {
                    result.push(currentRanges[i]);
                }
            }
        }

        return result;
    }

    public needsValidation(): boolean
    {
        return this.languageModes.getAllModes().some(x => x.doValidation);
    }

    public dispose(): void
    {
        this.languageModes.dispose();
    }

    public doAutoInsert(document: TextDocument, position: Position, kind: "autoClose" | "autoQuote"): string | null
    {
        return this.invoke("doAutoInsert", document, position, kind);
    }

    public async doComplete(document: TextDocument, position: Position, context: DocumentContext): Promise<CompletionList>
    {
        return this.invoke("doComplete", document, position, context) ?? { isIncomplete: false, items: [] };
    }

    public doHover(document: TextDocument, position: Position): Hover | null
    {
        return this.invoke("doHover", document, position);
    }

    public doLinkedEditing(document: TextDocument, position: Position): Range[] | null
    {
        const mode = this.languageModes.getModeAtPosition(document, Position.create(position.line, position.character - 1));

        if (mode?.doLinkedEditing)
        {
            return mode.doLinkedEditing(document, position);
        }

        return null;
    }

    public doRename(document: TextDocument, position: Position, newName: string): WorkspaceEdit | null
    {
        return this.invoke("doRename", document, position, newName);
    }

    public doResolve(document: TextDocument, item: CompletionItem): CompletionItem
    {
        return this.invoke("doResolve", document, item) ?? item;
    }

    public doSignatureHelp(document: TextDocument, position: Position): SignatureHelp | null
    {
        return this.invoke("doSignatureHelp", document, position);
    }

    public doValidation(document: TextDocument, settings: Settings): Diagnostic[]
    {
        return this.invokeAll("doValidation", [document, settings], mode => this.isValidationEnabled(mode.id, settings));
    }

    public findDefinition(document: TextDocument, position: Position): Definition | null
    {
        return this.invoke("findDefinition", document, position);
    }

    public findDocumentHighlight(document: TextDocument, position: Position): DocumentHighlight[]
    {
        return this.invoke("findDocumentHighlight", document, position) ?? [];
    }

    public findDocumentSymbols(document: TextDocument): SymbolInformation[]
    {
        return this.invokeAll("findDocumentSymbols", [document]);
    }

    public findDocumentColors(document: TextDocument): ColorInformation[]
    {
        return this.invokeAll("findDocumentColors", [document]);
    }

    public findDocumentLinks(document: TextDocument, documentContext: DocumentContext): DocumentLink[]
    {
        return this.invokeAll("findDocumentLinks", [document, documentContext]);
    }

    public findReferences(document: TextDocument, position: Position): Location[]
    {
        return this.invoke("findReferences", document, position) ?? [];
    }

    public format(document: TextDocument, range: Range, options: FormattingOptions, settings?: Settings): TextEdit[]
    {
        let formatRange = range;

        const isHTML = (range: LanguageModeRange): boolean => range.mode?.id == "html";

        const result: TextEdit[] = [];

        const endPos  = formatRange.end;
        const content = document.getText();

        const unformattedTags: string = settings?.html?.format?.unformatted ?? "";

        const enabledModes: Record<string, boolean> =
        {
            css: !/\bstyle\b/.exec(unformattedTags), javascript: !/\bscript\b/.exec(unformattedTags),
        };

        let endOffset = document.offsetAt(endPos);

        if (endPos.character == 0 && endPos.line > 0 && endOffset != content.length)
        {
            // if selection ends after a new line, exclude that new line
            const prevLineStart = document.offsetAt(Position.create(endPos.line - 1, 0));

            while (isEOL(content, endOffset - 1) && endOffset > prevLineStart)
            {
                endOffset--;
            }

            formatRange = Range.create(formatRange.start, document.positionAt(endOffset));
        }

        // run the html formatter on the full range and pass the result content to the embedded formatters.
        // from the final content create a single edit
        // advantages of this approach are
        //  - correct indents in the html document
        //  - correct initial indent for embedded formatters
        //  - no worrying of overlapping edits

        // make sure we start in html
        const allRanges = this.languageModes.getModesInRange(document, formatRange);

        let i = 0;
        let startPos = formatRange.start;

        while (i < allRanges.length && !isHTML(allRanges[i]))
        {
            const range = allRanges[i];

            if (!range.attributeValue && range.mode && range.mode.format)
            {
                const edits = range.mode.format(document, Range.create(startPos, range.end), options, settings);

                result.push(...edits);
            }

            startPos = range.end;

            i++;
        }

        if (i == allRanges.length)
        {
            return result;
        }

        // modify the range
        formatRange = Range.create(startPos, formatRange.end);

        // perform a html format and apply changes to a new document
        const htmlMode             = this.languageModes.getMode("html")!;
        const htmlEdits            = htmlMode.format!(document, formatRange, options, settings);
        const htmlFormattedContent = TextDocument.applyEdits(document, htmlEdits);
        const newDocument          = TextDocument.create(`${document.uri}.tmp`, document.languageId, document.version, htmlFormattedContent);

        try
        {
            // run embedded formatters on html formatted content: - formatters see correct initial indent
            const afterFormatRangeLength = document.getText().length - document.offsetAt(formatRange.end); // length of unchanged content after replace range
            const newFormatRange         = Range.create(formatRange.start, newDocument.positionAt(htmlFormattedContent.length - afterFormatRangeLength));
            const embeddedRanges         = this.languageModes.getModesInRange(newDocument, newFormatRange);

            const embeddedEdits: TextEdit[] = [];

            for (const range of embeddedRanges)
            {
                const mode = range.mode;

                if (mode?.format && enabledModes[mode.id] && !range.attributeValue)
                {
                    const edits = mode.format(newDocument, range, options, settings);

                    for (const edit of edits)
                    {
                        embeddedEdits.push(edit);
                    }
                }
            }

            if (embeddedEdits.length == 0)
            {
                result.push(...htmlEdits);

                return result;
            }

            // apply all embedded format edits and create a single edit for all changes
            const resultContent     = TextDocument.applyEdits(newDocument, embeddedEdits);
            const resultReplaceText = resultContent.substring(document.offsetAt(formatRange.start), resultContent.length - afterFormatRangeLength);

            result.push(TextEdit.replace(formatRange, resultReplaceText));

            return result;
        }
        finally
        {
            this.languageModes.removeDocument(newDocument);
        }
    }

    public getColorPresentations(document: TextDocument, color: Color, range: Range): ColorPresentation[]
    {
        return this.invoke("getColorPresentations", document, color, range) ?? [];
    }

    public getFoldingRanges(document: TextDocument): FoldingRange[]
    {
        const htmlMode = this.languageModes.getMode("html");
        const range    = Range.create(Position.create(0, 0), Position.create(document.lineCount, 0));

        let result: FoldingRange[] = [];

        if (htmlMode?.getFoldingRanges)
        {
            result.push(...htmlMode.getFoldingRanges(document));
        }

        // cache folding ranges per mode
        const rangesPerMode = new Map<string, FoldingRange[]>();

        const getRangesForMode = (mode: ILanguageMode): FoldingRange[] =>
        {
            if (mode.getFoldingRanges)
            {
                let ranges = rangesPerMode.get(mode.id);

                if (ranges)
                {
                    ranges = mode.getFoldingRanges(document);

                    rangesPerMode.set(mode.id, ranges);
                }

                return ranges ?? [];
            }

            return [];
        };

        const modeRanges = this.languageModes.getModesInRange(document, range);

        for (const modeRange of modeRanges)
        {
            const mode = modeRange.mode;

            if (mode && mode != htmlMode && !modeRange.attributeValue)
            {
                const ranges = getRangesForMode(mode);

                result.push(...ranges.filter(r => r.startLine >= modeRange.start.line && r.endLine < modeRange.end.line));
            }
        }

        if (this.maxRanges && result.length > this.maxRanges)
        {
            result = this.limitRanges(result, this.maxRanges);
        }

        return result;
    }

    public getSemanticTokens(document: TextDocument): SemanticTokenData[];
    public getSemanticTokens(document: TextDocument, ranges?: Range[]): number[];
    public getSemanticTokens(...args: [TextDocument] | [TextDocument, Range[]]): SemanticTokenData[] | number[]
    {
        if (args.length == 1)
        {
            return [];
        }

        return this.semanticTokenProvider.getSemanticTokens(...args);
    }

    public getSemanticTokenLegend(): SemanticTokenLegend
    {
        return this.semanticTokenProvider.legend;
    }

    public getSelectionRange(document: TextDocument, position: Position): SelectionRange
    {
        return this.invoke("getSelectionRange", document, position)!;
    }

    public getSelectionRanges(document: TextDocument, positions: Position[]): SelectionRange[]
    {
        const htmlMode = this.languageModes.getMode("html");

        return positions.map
        (
            position =>
            {
                const htmlRange = htmlMode!.getSelectionRange!(document, position);
                const mode      = this.languageModes.getModeAtPosition(document, position);

                if (mode?.getSelectionRange)
                {
                    const range = mode.getSelectionRange(document, position);

                    let top = range;

                    while (top.parent && insideRangeButNotSame(htmlRange.range, top.parent.range))
                    {
                        top = top.parent;
                    }

                    top.parent = htmlRange;

                    return range;
                }

                return htmlRange;
            },
        );
    }

    public updateDataProviders(dataProviders: IHTMLDataProvider[]): void
    {
        this.languageModes.updateDataProviders(dataProviders);
    }
}