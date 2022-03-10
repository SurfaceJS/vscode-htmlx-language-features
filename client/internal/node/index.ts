/* eslint-disable import/prefer-default-export */
import { join }                                      from "path";
import { TextDecoder }                               from "util";
import type { Disposable, ExtensionContext }         from "vscode";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { LanguageClient, TransportKind }             from "vscode-languageclient/node.js";
import Client                                        from "../client.js";
import type IRuntime                                 from "../interfaces/runtime.js";
import NodeFileSystemProvider                        from "./file-system-provider.js";

// this method is called when vs code is activated
export function activate(context: ExtensionContext): void
{
    try
    {
        const serverModule = context.asAbsolutePath(join("server", "index.js"));
        const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

        const serverOptions: ServerOptions =
        {
            debug:
            {
                module:    serverModule,
                options:   debugOptions,
                transport: TransportKind.ipc,
            },
            run:   { module: serverModule, transport: TransportKind.ipc },
        };

        const embeddedLanguages = { css: true, javascript: true };

        const clientOptions: LanguageClientOptions =
        {
            documentSelector:      [{ language: "htmlx", scheme: "file" }],
            initializationOptions:
            {
                embeddedLanguages,
                handledSchemas:   ["file"],
                provideFormatter: true,
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
            serverOptions,
            clientOptions,
        );

        const timer =
        {
            setTimeout(callback: (...args: unknown[]) => void, ms: number, ...args: unknown[]): Disposable
            {
                const handle = setTimeout(callback, ms, ...args);
                return { dispose: () => clearTimeout(handle) };
            },
        };

        const runtime: IRuntime =
        {
            TextDecoder,
            fileFs: new NodeFileSystemProvider(),
            timer,
        };

        void new Client(context, languageClient, runtime).activate();

    }
    catch (e)
    {
        console.log(e);
    }
}
