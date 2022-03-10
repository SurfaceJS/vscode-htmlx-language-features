import type { Range } from "vscode-languageserver-textdocument";

type LanguageRange = Range &
{
    languageId:      string | undefined,
    attributeValue?: boolean,
};

export default LanguageRange;
