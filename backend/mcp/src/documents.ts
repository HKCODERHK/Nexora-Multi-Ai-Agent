import fs from "node:fs"
import path from "node:path"

// The agent service's RAG code (plain JS) is loaded at runtime, so this package
// reuses exactly the same indexDocument() / retrieve() as the PDF agent.
const RAG_URL = new URL("../../services/agent/rag/index.js", import.meta.url)

export type RetrievalMode = "dense" | "hybrid"

export interface Chunk {
    id: number | string
    text: string
    score: number
    rank: number
    chunkIndex?: number
    source?: string
}

export interface RagModule {
    indexDocument(text: string, options: { chunkSize?: number; chunkOverlap?: number; source?: string }): Promise<{ collectionName: string; chunkCount: number; reused: boolean }>
    retrieve(query: string, options: { collectionName: string; k?: number; mode?: RetrievalMode }): Promise<Chunk[]>
    extractPdfText(buffer: Buffer): Promise<string>
    DEFAULT_CHUNKING: { chunkSize: number; chunkOverlap: number }
}

export const loadRag = async (): Promise<RagModule> => (await import(RAG_URL.href)) as RagModule

export const SUPPORTED = [".md", ".txt", ".pdf"]

export interface IndexedDocument {
    name: string
    collectionName: string
    chunkCount: number
    characters: number
}

export interface SearchHit {
    source: string
    score: number
    rank: number
    chunkIndex?: number
    text: string
}

export interface DocumentLibraryOptions {
    docsDir: string
    mode?: RetrievalMode
    rag?: () => Promise<RagModule> // injectable for tests
}

// Indexes every supported file in docsDir once (collections are reused across restarts)
// and searches all of them.
export class DocumentLibrary {
    private ready?: Promise<IndexedDocument[]>
    readonly docsDir: string
    readonly mode: RetrievalMode
    private readonly loadRag: () => Promise<RagModule>

    constructor({ docsDir, mode = "hybrid", rag = loadRag }: DocumentLibraryOptions) {
        this.docsDir = docsDir
        this.mode = mode
        this.loadRag = rag
    }

    private async readText(rag: RagModule, file: string): Promise<string> {
        const full = path.join(this.docsDir, file)
        if (file.toLowerCase().endsWith(".pdf")) return rag.extractPdfText(fs.readFileSync(full))
        return fs.readFileSync(full, "utf8")
    }

    private async indexAll(): Promise<IndexedDocument[]> {
        if (!fs.existsSync(this.docsDir)) throw new Error(`Documents folder not found: ${this.docsDir}`)
        const rag = await this.loadRag()
        const files = fs.readdirSync(this.docsDir).filter((f) => SUPPORTED.includes(path.extname(f).toLowerCase())).sort()
        const docs: IndexedDocument[] = []
        for (const name of files) {
            const text = await this.readText(rag, name)
            if (!text.trim()) continue
            const { collectionName, chunkCount } = await rag.indexDocument(text, { ...rag.DEFAULT_CHUNKING, source: name })
            docs.push({ name, collectionName, chunkCount, characters: text.length })
        }
        return docs
    }

    documents(): Promise<IndexedDocument[]> {
        this.ready ??= this.indexAll().catch((error) => {
            this.ready = undefined // allow a retry, e.g. once Qdrant is up
            throw error
        })
        return this.ready
    }

    // Top k chunks across all documents. RRF / cosine scores are compared directly,
    // which is fair because every document is searched with the same method.
    async search(query: string, k = 5): Promise<SearchHit[]> {
        const rag = await this.loadRag()
        const docs = await this.documents()
        const perDoc = await Promise.all(
            docs.map((d) => rag.retrieve(query, { collectionName: d.collectionName, k, mode: this.mode }))
        )
        return perDoc
            .flat()
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .map((c, i) => ({ source: c.source ?? "document", score: c.score, rank: i + 1, chunkIndex: c.chunkIndex, text: c.text }))
    }
}
