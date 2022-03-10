import type { Connection }      from "vscode-languageserver";
import CustomDataContentRequest from "./requests/custom-data-content-request.js";

export default class CustomDataRequestService
{
    public constructor(private readonly connection: Connection) { }

    public async getContent(uri: string): Promise<string>
    {
        return this.connection.sendRequest(CustomDataContentRequest.type, uri);
    }
}

