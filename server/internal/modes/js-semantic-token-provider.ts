import ts                       from "typescript";
import type { TextDocument }    from "vscode-languageserver-textdocument";
import type SemanticTokenData   from "../types/semantic-token-data.js";
import type SemanticTokenLegend from "../types/semantic-token-legend.js";
import TokenModifier            from "./enums/token-modifier.js";
import TokenType                from "./enums/token-type.js";

const TOKEN_DECLARARION_MAP: Record<string, TokenType> =
{
    [ts.SyntaxKind.VariableDeclaration]:  TokenType.Variable,
    [ts.SyntaxKind.Parameter]:            TokenType.Parameter,
    [ts.SyntaxKind.PropertyDeclaration]:  TokenType.Property,
    [ts.SyntaxKind.ModuleDeclaration]:    TokenType.Namespace,
    [ts.SyntaxKind.EnumDeclaration]:      TokenType.Enum,
    [ts.SyntaxKind.EnumMember]:           TokenType.Property,
    [ts.SyntaxKind.ClassDeclaration]:     TokenType.Class,
    [ts.SyntaxKind.MethodDeclaration]:    TokenType.Method,
    [ts.SyntaxKind.FunctionDeclaration]:  TokenType.Function,
    [ts.SyntaxKind.MethodSignature]:      TokenType.Method,
    [ts.SyntaxKind.GetAccessor]:          TokenType.Property,
    [ts.SyntaxKind.PropertySignature]:    TokenType.Property,
    [ts.SyntaxKind.InterfaceDeclaration]: TokenType.Interface,
    [ts.SyntaxKind.TypeAliasDeclaration]: TokenType.Type,
    [ts.SyntaxKind.TypeParameter]:        TokenType.TypeParameter,
};

const TOKE_TYPES =
{
    [TokenType.Class]:         "class",
    [TokenType.Enum]:          "enum",
    [TokenType.Interface]:     "interface",
    [TokenType.Namespace]:     "namespace",
    [TokenType.TypeParameter]: "typeParameter",
    [TokenType.Type]:          "type",
    [TokenType.Parameter]:     "parameter",
    [TokenType.Variable]:      "variable",
    [TokenType.Property]:      "property",
    [TokenType.Function]:      "function",
    [TokenType.Method]:        "method",
};

const TOKE_MODIFIERS =
{
    [TokenModifier.Async]:       "async",
    [TokenModifier.Declaration]: "declaration",
    [TokenModifier.Readonly]:    "readonly",
    [TokenModifier.Static]:      "static",
};

export default class JsSemanticTokenProvider
{
    public constructor(private readonly languangeService: ts.LanguageService)
    { }

    public static getSemanticTokenLegend(): SemanticTokenLegend
    {
        const tokenTypes     = Object.values(TOKE_TYPES);
        const tokenModifiers = Object.values(TOKE_MODIFIERS);

        if (tokenTypes.length != TokenType._)
        {
            console.warn("TokenType has added new entries.");
        }

        if (tokenModifiers.length != TokenModifier._)
        {
            console.warn("TokenModifier has added new entries.");
        }

        return { modifiers: tokenModifiers, types: tokenTypes };
    }

    private classifySymbol(symbol: ts.Symbol): TokenType | undefined
    {
        const flags = symbol.getFlags();

        if (flags & ts.SymbolFlags.Class)
        {
            return TokenType.Class;
        }
        else if (flags & ts.SymbolFlags.Enum)
        {
            return TokenType.Enum;
        }
        else if (flags & ts.SymbolFlags.TypeAlias)
        {
            return TokenType.Type;
        }
        else if (flags & ts.SymbolFlags.Type)
        {
            if (flags & ts.SymbolFlags.Interface)
            {
                return TokenType.Interface;
            }

            if (flags & ts.SymbolFlags.TypeParameter)
            {
                return TokenType.TypeParameter;
            }
        }

        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];

        return declaration && TOKEN_DECLARARION_MAP?.[declaration.kind];
    }

    private collectTokens(fileName: string, span: ts.TextSpan, collector: (node: ts.Node, tokenType: number, tokenModifier: number) => void): void
    {
        const program = this.languangeService.getProgram();

        if (program)
        {
            const typeChecker = program.getTypeChecker();

            const provider = this;

            function visit(node: ts.Node): void
            {
                if (!node || !ts.textSpanIntersectsWith(span, node.pos, node.getFullWidth()))
                {
                    return;
                }
                if (ts.isIdentifier(node))
                {
                    let symbol = typeChecker.getSymbolAtLocation(node);

                    if (symbol)
                    {
                        if (symbol.flags & ts.SymbolFlags.Alias)
                        {
                            symbol = typeChecker.getAliasedSymbol(symbol);
                        }

                        const typeIdx = provider.classifySymbol(symbol);

                        if (typeIdx !== undefined)
                        {
                            let modifierSet = 0;

                            if (node.parent)
                            {
                                const parentTypeIdx = TOKEN_DECLARARION_MAP[node.parent.kind];

                                if (parentTypeIdx == typeIdx && (node.parent as ts.NamedDeclaration).name == node)
                                {
                                    modifierSet = 1 << TokenModifier.Declaration;
                                }
                            }
                            const decl      = symbol.valueDeclaration;
                            const modifiers = decl ? ts.getCombinedModifierFlags(decl) : 0;
                            const nodeFlags = decl ? ts.getCombinedNodeFlags(decl) : 0;

                            if (modifiers & ts.ModifierFlags.Static)
                            {
                                modifierSet |= 1 << TokenModifier.Static;
                            }

                            if (modifiers & ts.ModifierFlags.Async)
                            {
                                modifierSet |= 1 << TokenModifier.Async;
                            }

                            if (modifiers & ts.ModifierFlags.Readonly || nodeFlags & ts.NodeFlags.Const || symbol.getFlags() & ts.SymbolFlags.EnumMember)
                            {
                                modifierSet |= 1 << TokenModifier.Readonly;
                            }

                            collector(node, typeIdx, modifierSet);
                        }
                    }
                }

                ts.forEachChild(node, visit);
            }

            const sourceFile = program.getSourceFile(fileName);

            if (sourceFile)
            {
                visit(sourceFile);
            }
        }
    }

    public getSemanticTokens(document: TextDocument, fileName: string): SemanticTokenData[]
    {
        const resultTokens: SemanticTokenData[] = [];
        const collector = (node: ts.Node, typeIdx: number, modifierSet: number): void =>
        {
            resultTokens.push({ length: node.getWidth(), modifierSet, start: document.positionAt(node.getStart()), typeIdx });
        };

        this.collectTokens(fileName, { length: document.getText().length, start: 0 }, collector);

        return resultTokens;
    }
}