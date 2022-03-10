import { Position, Range }       from "vscode-languageserver";
import type { TextDocument }     from "vscode-languageserver-textdocument";
import { beforeOrSame }          from "./common.js";
import type LanguageModes        from "./language-modes.js";
import type SemanticTokenData    from "./types/semantic-token-data.js";
import type SemanticTokenLegend  from "./types/semantic-token-legend.js";
import type SemanticTokenMapping from "./types/semantic-token-mapping.js";

export default class SemanticTokenProvider
{
    private readonly legendMappings: Map<string, SemanticTokenMapping> = new Map();
    public  readonly legend:         SemanticTokenLegend  = { modifiers: [], types: [] };

    public constructor(private readonly languageModes: LanguageModes)
    {
        for (const mode of languageModes.getAllModes())
        {
            if (mode.getSemanticTokenLegend && mode.getSemanticTokens)
            {
                const modeLegend = mode.getSemanticTokenLegend();

                this.legendMappings.set(mode.id, { modifiers: this.createMapping(modeLegend.modifiers, this.legend.modifiers), types: this.createMapping(modeLegend.types, this.legend.types) });
            }
        }
    }

    private createMapping(origLegend: string[], newLegend: string[]): number[] | undefined
    {
        const mapping: number[] = [];

        let needsMapping = false;

        for (let origIndex = 0; origIndex < origLegend.length; origIndex++)
        {
            const entry = origLegend[origIndex];

            let newIndex = newLegend.indexOf(entry);

            if (newIndex == -1)
            {
                newIndex = newLegend.length;
                newLegend.push(entry);
            }

            mapping.push(newIndex);

            needsMapping = needsMapping || newIndex != origIndex;
        }
        return needsMapping ? mapping : undefined;
    }

    private applyTypesMapping(tokens: SemanticTokenData[], typesMapping: number[] | undefined): void
    {
        if (typesMapping)
        {
            for (const token of tokens)
            {
                token.typeIdx = typesMapping[token.typeIdx];
            }
        }
    }

    private applyModifiersMapping(tokens: SemanticTokenData[], modifiersMapping: number[] | undefined): void
    {
        if (modifiersMapping)
        {
            for (const token of tokens)
            {
                let modifierSet = token.modifierSet;
                if (modifierSet)
                {
                    let index = 0;
                    let result = 0;
                    while (modifierSet > 0)
                    {
                        if ((modifierSet & 1) !== 0)
                        {
                            result += 1 << modifiersMapping[index];
                        }
                        index++;
                        modifierSet >>= 1;
                    }
                    token.modifierSet = result;
                }
            }
        }
    }

    private encodeTokens(tokens: SemanticTokenData[], ranges: Range[]): number[]
    {
        let currentRanges = ranges;

        const resultTokens = tokens.sort((d1, d2) => d1.start.line - d2.start.line || d1.start.character - d2.start.character);

        currentRanges = currentRanges.sort((d1, d2) => d1.start.line - d2.start.line || d1.start.character - d2.start.character);

        let rangeIndex = 0;
        let currRange  = currentRanges[rangeIndex++];

        let prefLine = 0;
        let prevChar = 0;

        const encodedResult: number[] = [];

        for (let k = 0; k < resultTokens.length && currRange; k++)
        {
            const curr  = resultTokens[k];
            const start = curr.start;

            while (currRange && beforeOrSame(currRange.end, start))
            {
                currRange = currentRanges[rangeIndex++];
            }
            if (currRange && beforeOrSame(currRange.start, start) && beforeOrSame({ character: start.character + curr.length, line: start.line }, currRange.end))
            {
                // token inside a range

                if (prefLine !== start.line)
                {
                    prevChar = 0;
                }
                encodedResult.push(start.line - prefLine); // line delta
                encodedResult.push(start.character - prevChar); // line delta
                encodedResult.push(curr.length); // length
                encodedResult.push(curr.typeIdx); // tokenType
                encodedResult.push(curr.modifierSet); // tokenModifier

                prefLine = start.line;
                prevChar = start.character;
            }
        }
        return encodedResult;
    }

    public getSemanticTokens(document: TextDocument, ranges: Range[]): number[]
    {
        const allTokens: SemanticTokenData[] = [];

        for (const mode of this.languageModes.getAllModesInDocument(document))
        {
            if (mode.getSemanticTokens)
            {
                const mapping = this.legendMappings.get(mode.id)!;
                const tokens  = mode.getSemanticTokens(document);

                this.applyTypesMapping(tokens, mapping.types);
                this.applyModifiersMapping(tokens, mapping.modifiers);

                for (const token of tokens)
                {
                    allTokens.push(token);
                }
            }
        }

        return this.encodeTokens(allTokens, ranges ?? [Range.create(Position.create(0, 0), Position.create(document.lineCount, 0))]);
    }
}