import chai                                 from "chai";
import { suite, test }                      from "test-decorators";
import { TextDocument, getLanguageService } from "vscode-html-languageservice";
import EmbeddedDocument                     from "../internal/embedded-document.js";

@suite
export default class EmbeddedDocumentSpec
{
    @test
    public empty(): void
    {
        const document = TextDocument.create("", "html", 1, "");

        const regions = EmbeddedDocument.getRegions(getLanguageService(), document);

        chai.assert.deepEqual(regions.getLanguagesInDocument(), ["html"]);
    }

    @test
    public doSomething(): void
    {
        const content =
        [
            "<a style='color: blue' onclick='noop'></a>",
            "<style>",
            "   h1 { color: red; }",
            "</style>",
            "<script>",
            "   alert('don't use alert');",
            "</script>",
        ].join("\n");

        const document = TextDocument.create("", "html", 1, content);

        const regions = EmbeddedDocument.getRegions(getLanguageService(), document);

        chai.assert.deepEqual(regions.getLanguagesInDocument(), ["css", "javascript", "html"]);
    }
}
