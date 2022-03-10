import { readFileSync } from "fs";
import { join }         from "path";
import ts               from "typescript";
import { TextDocument } from "vscode-languageserver-textdocument";

const TYPESCRIPT_LIB_SOURCE = join(__dirname, "../../../node_modules/typescript/lib");
const JQUERY_PATH           = join(__dirname, "../lib/jquery.d.ts");

const COMPILER_OPTIONS: ts.CompilerOptions =
{
    allowJs:                true,
    allowNonTsExtensions:   true,
    experimentalDecorators: false,
    lib:                    ["lib.es6.d.ts"],
    moduleResolution:       ts.ModuleResolutionKind.Classic,
    target:                 ts.ScriptTarget.Latest,
};

export default class JsLanguageServiceHost implements ts.LanguageServiceHost
{
    private readonly contents: Map<string, string> = new Map();
    private readonly languageService: ts.LanguageService = ts.createLanguageService(this);
    private document: TextDocument = TextDocument.create("init", "javascript", 1, "");
    public constructor
    (
        private readonly scriptKind: ts.ScriptKind,
        private readonly compilerOptions: ts.CompilerOptions = COMPILER_OPTIONS,
    )
    { }

    private loadLibrary(name: string): string
    {
        let content = this.contents.get(name);

        if (typeof content != "string")
        {
            let libPath;

            if (name == "jquery")
            {
                libPath = JQUERY_PATH;
            }
            else
            {
                libPath = join(TYPESCRIPT_LIB_SOURCE, name);
            }

            try
            {
                content = readFileSync(libPath).toString();
            }
            catch (e)
            {
                console.log(`Unable to load library ${name} at ${libPath}: ${(e as Error).message}`);

                content = "";
            }

            this.contents.set(name, content);
        }

        return content;
    }

    public getCompilationSettings(): ts.CompilerOptions
    {
        return this.compilerOptions;
    }

    public getScriptFileNames(): string[]
    {
        return [this.document.uri, "jquery"];
    }

    public getScriptKind(fileName: string): ts.ScriptKind
    {
        if (fileName == this.document.uri)
        {
            return this.scriptKind;
        }

        return fileName.endsWith("ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    }

    public getScriptSnapshot(fileName: string): ts.IScriptSnapshot
    {
        let text = "";

        if (fileName == this.document.uri)
        {
            text = this.document.getText();
        }
        else
        {
            text = this.loadLibrary(fileName);
        }

        return {
            getChangeRange: () => undefined,
            getLength:      () => text.length,
            getText:        (start: number, end: number) => text.substring(start, end),
        };
    }

    public getScriptVersion(fileName: string): string
    {
        if (fileName == this.document.uri)
        {
            return String(this.document.version);
        }

        return "1";
    }

    public getCurrentDirectory(): string
    {
        return "";
    }

    public getDefaultLibFileName(_options: ts.CompilerOptions): string
    {
        return "es6";
    }

    public getLanguageService(document: TextDocument): ts.LanguageService
    {
        this.document = document;

        return this.languageService;
    }
}