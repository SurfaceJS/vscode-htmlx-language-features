import type { WorkspaceFolder } from "vscode-languageserver";
import type Settings            from "./settings.js";

type Workspace =
{
    readonly settings: Settings,
    readonly folders:  WorkspaceFolder[],
};

export default Workspace;
