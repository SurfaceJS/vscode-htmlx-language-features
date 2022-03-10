/* eslint-disable @typescript-eslint/indent */
enum Kind
{
    Alias                     = "alias",
    CallSignature             = "call",
    Class                     = "class",
    Const                     = "const",
    ConstructorImplementation = "constructor",
    ConstructSignature        = "construct",
    Directory                 = "directory",
    Enum                      = "enum",
    EnumMember                = "enum member",
    ExternalModuleName        = "external module name",
    Function                  = "function",
    IndexSignature            = "index",
    Interface                 = "interface",
    Keyword                   = "keyword",
    Let                       = "let",
    LocalFunction             = "local function",
    LocalVariable             = "local var",
    MemberGetAccessor         = "getter",
    MemberSetAccessor         = "setter",
    MemberVariable            = "property",
    Method                    = "method",
    Module                    = "module",
    Parameter                 = "parameter",
    PrimitiveType             = "primitive type",
    Script                    = "script",
    String                    = "string",
    Type                      = "type",
    TypeParameter             = "type parameter",
    Variable                  = "var",
    Warning                   = "warning"
}

export default Kind;