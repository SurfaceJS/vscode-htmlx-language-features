/* eslint-disable @typescript-eslint/switch-exhaustiveness-check */
/* eslint-disable default-case */

import { Position }        from "vscode-languageserver";
import { TextDocument }    from "vscode-languageserver-textdocument";
import type { Range }      from "vscode-languageserver-textdocument";
import type EmbeddedRegion from "./types/embedded-region.js";
import type LanguageRange  from "./types/language-range.js";

export const CSS_STYLE_RULE = "__";

export default class HTMLDocumentRegions
{
    public constructor
    (
        private readonly document:        TextDocument,
        private readonly regions:         EmbeddedRegion[],
        private readonly importedScripts: string[],
    ) { }

    private getPrefix(region: EmbeddedRegion): string
    {
        if (region.attributeValue)
        {
            switch (region.languageId)
            {
                case "css": return `${CSS_STYLE_RULE}{`;
            }
        }

        return "";
    }

    private getSuffix(region: EmbeddedRegion): string
    {
        if (region.attributeValue)
        {
            switch (region.languageId)
            {
                case "css":
                    return "}";
                case "javascript":
                    return ";";
            }
        }
        return "";
    }

    private substituteWithWhitespace(source: string, start: number, end: number, oldContent: string, before: string, after: string): string
    {
        let accumulatedWS = 0;
        let result = source + before;

        for (let i = start + before.length; i < end; i++)
        {
            const char = oldContent[i];

            if (char === "\n" || char === "\r")
            {
                // only write new lines, skip the whitespace
                accumulatedWS = 0;
                result += char;
            }
            else
            {
                accumulatedWS++;
            }
        }
        result += " ".repeat(accumulatedWS - after.length);
        result += after;

        return result;
    }

    public getEmbeddedDocument(languageId: string, ignoreAttributeValues?: boolean): TextDocument
    {
        const oldContent = this.document.getText();

        let currentPos = 0;
        let result     = "";
        let lastSuffix = "";

        for (const region of this.regions)
        {
            if (region.languageId === languageId && (!ignoreAttributeValues || !region.attributeValue))
            {
                result = this.substituteWithWhitespace(result, currentPos, region.start, oldContent, lastSuffix, this.getPrefix(region));
                result += oldContent.substring(region.start, region.end);
                currentPos = region.end;
                lastSuffix = this.getSuffix(region);
            }
        }

        result = this.substituteWithWhitespace(result, currentPos, oldContent.length, oldContent, lastSuffix, "");

        return TextDocument.create(this.document.uri, languageId, this.document.version, result);
    }

    public getLanguageRanges(range: Range): LanguageRange[]
    {
        const result: LanguageRange[] = [];
        const endOffset = range ? this.document.offsetAt(range.end) : this.document.getText().length;

        let currentPos    = range ? range.start : Position.create(0, 0);
        let currentOffset = range ? this.document.offsetAt(range.start) : 0;

        for (const region of this.regions)
        {
            if (region.end > currentOffset && region.start < endOffset)
            {
                const start = Math.max(region.start, currentOffset);
                const startPos = this.document.positionAt(start);

                if (currentOffset < region.start)
                {
                    result.push
                    ({
                        end:        startPos,
                        languageId: "html",
                        start:      currentPos,
                    });
                }

                const end    = Math.min(region.end, endOffset);
                const endPos = this.document.positionAt(end);

                if (end > region.start)
                {
                    result.push
                    ({
                        attributeValue: region.attributeValue,
                        end:            endPos,
                        languageId:     region.languageId,
                        start:          startPos,
                    });
                }

                currentOffset = end;
                currentPos    = endPos;
            }
        }
        if (currentOffset < endOffset)
        {
            const endPos = range ? range.end : this.document.positionAt(endOffset);

            result.push
            ({
                end:        endPos,
                languageId: "html",
                start:      currentPos,
            });
        }
        return result;
    }

    public getLanguageAtPosition(position: Position): string | undefined
    {
        const offset = this.document.offsetAt(position);

        for (const region of this.regions)
        {
            if (region.start <= offset)
            {
                if (offset <= region.end)
                {
                    return region.languageId;
                }
            }
            else
            {
                break;
            }
        }

        return "html";
    }

    public getLanguagesInDocument(): string[]
    {
        const result: string[] = [];

        for (const region of this.regions)
        {
            if (region.languageId && !result.includes(region.languageId))
            {
                result.push(region.languageId);

                if (result.length === 3)
                {
                    return result;
                }
            }
        }

        result.push("html");

        return result;
    }

    public getImportedScripts(): string[]
    {
        return this.importedScripts;
    }
}