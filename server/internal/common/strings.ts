const CR = "\r".charCodeAt(0);
const NL = "\n".charCodeAt(0);

export function getWordAtText(text: string, offset: number, wordPattern: RegExp): { start: number, length: number }
{
    let lineStart = offset;

    while (lineStart > 0 && !isNewlineCharacter(text.charCodeAt(lineStart - 1)))
    {
        lineStart--;
    }

    const offsetInLine = offset - lineStart;
    const lineText     = text.substring(lineStart);

    const flags = wordPattern.ignoreCase ? "gi" : "g";

    const wordDefinition = new RegExp(wordPattern.source, flags);

    let match = wordDefinition.exec(lineText);

    while (match && match.index + match[0].length < offsetInLine)
    {
        match = wordDefinition.exec(lineText);
    }

    if (match && match.index <= offsetInLine)
    {
        return { length: match[0].length, start: match.index + lineStart };
    }

    return { length: 0, start: offset };
}

export function startsWith(haystack: string, needle: string): boolean
{
    if (haystack.length < needle.length)
    {
        return false;
    }

    for (let i = 0; i < needle.length; i++)
    {
        if (haystack[i] !== needle[i])
        {
            return false;
        }
    }

    return true;
}

export function isWhitespaceOnly(str: string): boolean
{
    return /^\s*$/.test(str);
}

export function isEOL(content: string, offset: number): boolean
{
    return isNewlineCharacter(content.charCodeAt(offset));
}

export function isNewlineCharacter(charCode: number): boolean
{
    return charCode === CR || charCode === NL;
}