import { PDFParse } from "pdf-parse"

// PDF bytes → plain text (the same parser the PDF agent uses).
export const extractPdfText = async (buffer) => {
    const pdf = new PDFParse({ data: buffer })
    try {
        return (await pdf.getText()).text
    } finally {
        await pdf.destroy?.()
    }
}
