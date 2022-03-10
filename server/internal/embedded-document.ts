/* eslint-disable sort-keys */
/* eslint-disable default-case */
import type { LanguageService, TextDocument } from "vscode-html-languageservice";
import { TokenType }                          from "vscode-html-languageservice";
import HTMLDocumentRegions                    from "./html-document-regions.js";
import type EmbeddedRegion                    from "./types/embedded-region";

export default class EmbeddedDocument
{
    private static getAttributeLanguage(attributeName: string): string | null
    {
        const match = /^(style)$|^(on\w+)$/i.exec(attributeName);

        if (!match)
        {
            return null;
        }

        return match[1] ? "css" : "javascript";
    }

    public static getRegions(languageService: LanguageService, document: TextDocument): HTMLDocumentRegions
    {
        const regions: EmbeddedRegion[] = [];
        const scanner = languageService.createScanner(document.getText());

        let lastTagName = "";
        let lastAttributeName: string | null = null;
        let languageIdFromType: string | undefined;
        const importedScripts: string[] = [];

        let token = scanner.scan();
        while (token !== TokenType.EOS)
        {
            // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
            switch (token)
            {
                case TokenType.StartTag:
                    lastTagName = scanner.getTokenText();
                    lastAttributeName = null;
                    languageIdFromType = "javascript";
                    break;
                case TokenType.Styles:
                    regions.push({ languageId: "css", start: scanner.getTokenOffset(), end: scanner.getTokenEnd() });
                    break;
                case TokenType.Script:
                    regions.push({ languageId: languageIdFromType, start: scanner.getTokenOffset(), end: scanner.getTokenEnd() });
                    break;
                case TokenType.AttributeName:
                    lastAttributeName = scanner.getTokenText();
                    break;
                case TokenType.AttributeValue:
                    if (lastAttributeName === "src" && lastTagName.toLowerCase() === "script")
                    {
                        let value = scanner.getTokenText();
                        if (value.startsWith("'") || value.startsWith("\""))
                        {
                            value = value.substr(1, value.length - 1);
                        }
                        importedScripts.push(value);
                    }
                    else if (lastAttributeName === "type" && lastTagName.toLowerCase() === "script")
                    {
                        if (/["'](module|(text|application)\/(java|ecma)script|text\/babel)["']/.test(scanner.getTokenText()))
                        {
                            languageIdFromType = "javascript";
                        }
                        else if (/["']text\/typescript["']/.test(scanner.getTokenText()))
                        {
                            languageIdFromType = "typescript";
                        }
                        else
                        {
                            languageIdFromType = undefined;
                        }
                    }
                    else
                    {
                        const attributeLanguageId = this.getAttributeLanguage(lastAttributeName!);

                        if (attributeLanguageId)
                        {
                            let start = scanner.getTokenOffset();
                            let end   = scanner.getTokenEnd();

                            const firstChar = document.getText()[start];

                            if (firstChar === "'" || firstChar === "\"")
                            {
                                start++;
                                end--;
                            }

                            regions.push({ attributeValue: true, end, languageId: attributeLanguageId, start });
                        }
                    }
                    lastAttributeName = null;
                    break;
            }
            token = scanner.scan();
        }

        return new HTMLDocumentRegions(document, regions, importedScripts);
    }
}