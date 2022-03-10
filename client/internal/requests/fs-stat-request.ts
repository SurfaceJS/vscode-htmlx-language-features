import type { FileStat } from "vscode";
import { RequestType }   from "vscode-languageclient/node.js";

export default class FsStatRequest
{
    public static readonly type: RequestType<string, FileStat, unknown> = new RequestType("fs/stat");
}
