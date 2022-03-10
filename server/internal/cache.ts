import type { Disposable }   from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

type Entry<T> =
{
    languageId: string,
    timestamp:  number,
    value:      T,
    version:    number,
};

export default class Cache<T> implements Disposable
{
    private readonly entries: Map<string, Entry<T>> = new Map();
    private readonly timer: NodeJS.Timer;

    public constructor
    (
        private readonly parse: (document: TextDocument) => T,
        private readonly maxEntries: number = 10,
        private readonly cleanupInterval: number = 60,
    )
    {
        this.timer = setInterval(this.cleanup, cleanupInterval * 1000);
    }

    private readonly cleanup = (): void =>
    {
        const cutoffTime = Date.now() - this.cleanupInterval * 1000;

        for (const [key, entry] of Array.from(this.entries))
        {
            if (entry.timestamp > cutoffTime)
            {
                this.entries.delete(key);
            }
        }
    };

    public delete(document: TextDocument): void
    {
        this.entries.delete(document.uri);
    }

    public dispose(): void
    {
        clearInterval(this.timer);
    }

    public get(document: TextDocument): T
    {
        let entry = this.entries.get(document.uri);

        if (!entry || entry.version != document.version || document.languageId != entry.languageId)
        {
            entry =
            {
                languageId: document.languageId,
                timestamp:  Date.now(),
                value:      this.parse(document),
                version:    document.version,
            };

            this.entries.set(document.uri, entry);

            if (this.entries.size > this.maxEntries)
            {
                const oldest = { key: "", timestamp: Number.MAX_VALUE };

                for (const [key, entry] of this.entries)
                {
                    if (entry.timestamp < oldest.timestamp)
                    {
                        oldest.key       = key;
                        oldest.timestamp = entry.timestamp;
                    }
                }

                if (oldest.key)
                {
                    this.entries.delete(oldest.key);
                }
            }
        }

        return entry.value;
    }
}