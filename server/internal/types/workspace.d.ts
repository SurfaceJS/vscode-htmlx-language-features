import type { WorkspaceFolder } from "vscode-languageserver";
import type Settings            from "./settings";

type Workspace =
{
    readonly settings: Settings,
    readonly folders:  WorkspaceFolder[],
};

export default Workspace;
