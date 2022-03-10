import type { Range, TextDocumentIdentifier } from "vscode-languageclient";

type SemanticTokenParams =
{
    textDocument: TextDocumentIdentifier,
    ranges?:      Range[],
};

export default SemanticTokenParams;