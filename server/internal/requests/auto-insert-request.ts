import type { Position, TextDocumentIdentifier } from "vscode-languageserver/node.js";
import { RequestType }                           from "vscode-languageserver/node.js";

export type AutoInsertParams =
{
    kind:         "autoQuote" | "autoClose",
    position:     Position,
    textDocument: TextDocumentIdentifier,
};

export default class AutoInsertRequest
{
    public static readonly type: RequestType<AutoInsertParams, string | null, unknown> = new RequestType("html/autoInsert");
}
