import type
{
    CancellationToken,
    FormattingOptions,
    DocumentRangeFormattingEditProvider as IDocumentRangeFormattingEditProvider,
    Range,
    TextDocument,
    TextEdit,
} from "vscode";
import { workspace }                                                from "vscode";
import type { CommonLanguageClient, DocumentRangeFormattingParams } from "vscode-languageclient";
import { DocumentRangeFormattingRequest }                           from "vscode-languageclient";

export default class DocumentRangeFormattingEditProvider implements IDocumentRangeFormattingEditProvider
{
    public constructor(private readonly languageClient: CommonLanguageClient)
    { }

    public async provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]>
    {
        const filesConfig = workspace.getConfiguration("files", document);
        const fileFormattingOptions =
        {
            insertFinalNewline:     filesConfig.get<boolean>("insertFinalNewline"),
            trimFinalNewlines:      filesConfig.get<boolean>("trimFinalNewlines"),
            trimTrailingWhitespace: filesConfig.get<boolean>("trimTrailingWhitespace"),
        };

        const params: DocumentRangeFormattingParams =
        {
            options:      this.languageClient.code2ProtocolConverter.asFormattingOptions(options, fileFormattingOptions),
            range:        this.languageClient.code2ProtocolConverter.asRange(range),
            textDocument: this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
        };

        try
        {
            return this.languageClient.protocol2CodeConverter.asTextEdits(await this.languageClient.sendRequest(DocumentRangeFormattingRequest.type, params, token)) ?? [];
        }
        catch (error)
        {
            this.languageClient.handleFailedRequest(DocumentRangeFormattingRequest.type, error, []);

            return [];
        }
    }
}