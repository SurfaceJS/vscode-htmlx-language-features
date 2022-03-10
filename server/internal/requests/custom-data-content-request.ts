import { RequestType } from "vscode-languageserver";

export default class CustomDataContentRequest
{
    public static readonly type: RequestType<string, string, unknown> = new RequestType("html/customDataContent");
}