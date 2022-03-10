import type { FileType } from "vscode";
import { RequestType }   from "vscode-languageclient/node.js";

export default class FsReadDirRequest
{
    public static readonly type: RequestType<string, [string, FileType][], unknown> = new RequestType("fs/readDir");
}
