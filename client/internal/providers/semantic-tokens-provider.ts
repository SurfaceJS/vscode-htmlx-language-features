import SemanticTokenRequest                                                                                                                 from "server/internal/requests/semantic-token-request.js";
import type
{
    CancellationToken,
    DocumentRangeSemanticTokensProvider,
    DocumentSemanticTokensProvider,
    Range,
    TextDocument,
} from "vscode";
import { SemanticTokens }                                                                                                                   from "vscode";
import type { CommonLanguageClient }                                                                                                        from "vscode-languageclient";
import type SemanticTokenParams                                                                                                             from "../types/semantic-token-params.js";

export default class SemanticTokensProvider implements DocumentSemanticTokensProvider, DocumentRangeSemanticTokensProvider
{
    public constructor(private readonly languageClient: CommonLanguageClient)
    { }

    public async provideDocumentRangeSemanticTokens(document: TextDocument, range: Range, _token: CancellationToken): Promise<SemanticTokens | null>
    {
        const params: SemanticTokenParams =
        {
            ranges:       [this.languageClient.code2ProtocolConverter.asRange(range)],
            textDocument: this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
        };

        const data = await this.languageClient.sendRequest(SemanticTokenRequest.type, params);

        return data && new SemanticTokens(new Uint32Array(data));
    }

    public async provideDocumentSemanticTokens(document: TextDocument, _token: CancellationToken): Promise<SemanticTokens | null>
    {
        const params: SemanticTokenParams =
        {
            textDocument: this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
        };

        const data = await this.languageClient.sendRequest(SemanticTokenRequest.type, params);

        return data && new SemanticTokens(new Uint32Array(data));
    }
}