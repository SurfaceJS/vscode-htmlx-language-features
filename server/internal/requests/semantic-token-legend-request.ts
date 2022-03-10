import { RequestType0 } from "vscode-languageserver";

export default class SemanticTokenLegendRequest
{
    public static readonly type: RequestType0<{ types: string[], modifiers: string[] } | null, unknown> = new RequestType0("html/semanticTokenLegend");
}