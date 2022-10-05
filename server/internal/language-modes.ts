import type { IHTMLDataProvider, LanguageService, Position } from "vscode-html-languageservice";
import type { Disposable }                                   from "vscode-languageserver";
import type { Range, TextDocument }                          from "vscode-languageserver-textdocument";
import type HTMLDocumentRegions                              from "./html-document-regions.js";
import type ILanguageMode                                    from "./interfaces/language-mode.js";
import type LanguageModeRange                             from "./types/language-mode-range.js";

export default class LanguageModes implements Disposable
{
    public constructor
    (
        private readonly htmlLanguageService: LanguageService,
        private readonly regions: { get: (document: TextDocument) => HTMLDocumentRegions },
        private readonly modes: Map<string, ILanguageMode>,
    ) { }

    public updateDataProviders(dataProviders: IHTMLDataProvider[]): void
    {
        this.htmlLanguageService.setDataProviders(true, dataProviders);
    }

    public getModeAtPosition(document: TextDocument, position: Position): ILanguageMode | undefined
    {
        const languageId = this.regions.get(document).getLanguageAtPosition(position);

        if (languageId)
        {
            return this.modes.get(languageId);
        }

        return undefined;
    }

    public getModesInRange(document: TextDocument, range: Range): LanguageModeRange[]
    {
        return this.regions
            .get(document)
            .getLanguageRanges(range)
            .map
            (
                range =>
                    ({
                        attributeValue: range.attributeValue,
                        end:            range.end,
                        mode:           this.modes.get(range.languageId!),
                        start:          range.start,
                    }),
            );
    }

    public getAllModesInDocument(document: TextDocument): ILanguageMode[]
    {
        const result = [];

        for (const languageId of this.regions.get(document).getLanguagesInDocument())
        {
            const mode = this.modes.get(languageId);

            if (mode)
            {
                result.push(mode);
            }
        }

        return result;
    }

    public getAllModes(): ILanguageMode[]
    {
        return Array.from(this.modes.values());
    }

    public getMode(languageId: string): ILanguageMode
    {
        return this.modes.get(languageId)!;
    }

    public removeDocument(document: TextDocument): void
    {
        this.modes.forEach(x => x.removeDocument(document));
    }

    public dispose(): void
    {
        this.modes.forEach(x => x.dispose());

        this.modes.clear();
    }
}