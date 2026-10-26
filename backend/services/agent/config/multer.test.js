import { describe, expect, it } from "vitest"
import { uploadFileName } from "./multer.js"

describe("upload file names", () => {
    it("start with a numeric timestamp, not the source of Date.now", () => {
        const name = uploadFileName({ originalname: "report.pdf" })
        expect(name).toMatch(/^\d+-report\.pdf$/)
    })
})
