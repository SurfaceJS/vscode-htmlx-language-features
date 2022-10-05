import type { Disposable }   from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type ILanguageService from "./language-service.js";

export default interface ILanguageMode extends ILanguageService, Disposable
{
    id: string;

    removeDocument(document: TextDocument): void;
}