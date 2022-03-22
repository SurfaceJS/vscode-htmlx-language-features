import type { Range, TextDocumentIdentifier } from "vscode-languageserver/node.js";
import { RequestType }                        from "vscode-languageserver/node.js";

export type SemanticTokenParams =
{
    textDocument: TextDocumentIdentifier,
    ranges?:      Range[],
};

export default class SemanticTokenRequest
{
    public static readonly type: RequestType<SemanticTokenParams, number[] | null, unknown> = new RequestType("html/semanticTokens");
}