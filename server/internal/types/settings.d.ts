import type { CompletionSettings, HoverSettings as CssHoverSettings }       from "vscode-css-languageservice";
import type { CompletionConfiguration, HoverSettings as HtmlHoverSettings } from "vscode-html-languageservice";

type Settings =
{
    css?:
    {
        completion?: CompletionSettings,
        hover?:      CssHoverSettings,
    },
    html?:
    {
        format?:
        {
            enable: boolean,
            unformatted: string,
        },
        completion?: CompletionConfiguration,
        hover?:      HtmlHoverSettings,
        suggest?:
        {
            attributeDefaultValue?: "empty" | "singlequotes" | "doublequotes",
        },
        validate?:
        {
            scripts?: boolean,
            styles?:  boolean,
        },
    },
    javascript?:
    {
        format?:
        {
            insertSpaceAfterCommaDelimiter?:                              boolean,
            insertSpaceAfterConstructor?:                                 boolean,
            insertSpaceAfterFunctionKeywordForAnonymousFunctions?:        boolean,
            insertSpaceAfterKeywordsInControlFlowStatements?:             boolean,
            insertSpaceAfterOpeningAndBeforeClosingEmptyBraces?:          boolean,
            insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces?:  boolean,
            insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces?:       boolean,
            insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets?:     boolean,
            insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis?:  boolean,
            insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces?: boolean,
            insertSpaceAfterSemicolonInForStatements?:                    boolean,
            insertSpaceAfterTypeAssertion?:                               boolean,
            insertSpaceBeforeAndAfterBinaryOperators?:                    boolean,
            insertSpaceBeforeFunctionParenthesis?:                        boolean,
            placeOpenBraceOnNewLineForControlBlocks?:                     boolean,
            placeOpenBraceOnNewLineForFunctions?:                         boolean,
            semicolons?:                                                  "ignore" | "insert" | "remove",
        },
        implicitProjectConfig?:
        {
            experimentalDecorators?: boolean,
        },
    },
};

export default Settings;
