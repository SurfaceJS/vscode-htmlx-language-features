/* eslint-disable import/prefer-default-export */
import type { Disposable, ExtensionContext } from "vscode";
import { Uri }                               from "vscode";
import type { LanguageClientOptions }        from "vscode-languageclient/browser.js";
import { LanguageClient }                    from "vscode-languageclient/browser.js";
import Client                                from "../client.js";
import type IRuntime                         from "../interfaces/runtime.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Worker:      new(stringUrl: string) => any;
declare const TextDecoder: new(encoding?: string) => { decode(buffer: ArrayBuffer): string };

// this method is called when vs code is activated
export function activate(context: ExtensionContext): void
{
    const serverMain = Uri.joinPath(context.extensionUri, "server/browser/index.js");

    try
    {
        const worker = new Worker(serverMain.toString());

        const timer =
        {
            setTimeout(callback: (...args: unknown[]) => void, ms: number, ...args: unknown[]): Disposable
            {
                const handle = setTimeout(callback, ms, ...args);
                return { dispose: () => clearTimeout(handle) };
            },
        };

        const clientOptions: LanguageClientOptions =
        {
            documentSelector:      ["html", "handlebars"],
            initializationOptions:
            {
                embeddedLanguages: { css: true, javascript: true },
                handledSchemas:    ["file"],
                provideFormatter:  false, // tell the server to not provide formatting capability and ignore the `html.format.enable` setting.
            },
            synchronize:
            {
                configurationSection: ["html", "css", "javascript"], // the settings to synchronize
            },
        };

        const languageClient = new LanguageClient
        (
            "surface.htmlx",
            "Htmlx Language Server",
            clientOptions,
            worker,
        );

        const runtime: IRuntime = { TextDecoder, timer };

        void new Client(context, languageClient, runtime).activate();

    }
    catch (e)
    {
        console.log(e);
    }
}
