import type { HTMLDataV1, IHTMLDataProvider } from "vscode-html-languageservice";
import { newHTMLDataProvider }                from "vscode-html-languageservice";
import type CustomDataRequestService          from "./custom-data-request-service";

function parseHTMLData(id: string, source: string): IHTMLDataProvider
{
    let rawData: Partial<HTMLDataV1>;

    try
    {
        rawData = JSON.parse(source);
    }
    catch (err)
    {
        return newHTMLDataProvider(id, { version: 1 });
    }

    return newHTMLDataProvider
    (
        id,
        {
            globalAttributes: rawData.globalAttributes ?? [],
            tags:             rawData.tags             ?? [],
            valueSets:        rawData.valueSets        ?? [],
            version:          rawData.version          ?? 1,
        },
    );
}

// eslint-disable-next-line import/prefer-default-export
export async function fetchHTMLDataProviders(dataPaths: string[], requestService: CustomDataRequestService): Promise<IHTMLDataProvider[]>
{
    const providers = dataPaths
        .map
        (
            async path =>
            {
                try
                {
                    const content = await requestService.getContent(path);

                    return parseHTMLData(path, content);
                }
                catch (e)
                {
                    return newHTMLDataProvider(path, { version: 1 });
                }
            },
        );

    return Promise.all(providers);
}