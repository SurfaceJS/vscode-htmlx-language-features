import type { Range }    from "vscode-languageserver-textdocument";
import type LanguageMode from "../interfaces/language-mode";

type LanguageModeRange = Range &
{
    mode:            LanguageMode | undefined,
    attributeValue?: boolean,
};

export default LanguageModeRange;
