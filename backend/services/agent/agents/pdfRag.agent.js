import fs from "fs"
import {PDFParse} from "pdf-parse"
import { deductCredits } from "../utils/deductCredits.js"
import { checkAgentLimit } from "../config/agentLimit.js"
import { indexDocument, retrieve, answerFromContext, DEFAULT_CHUNKING, DEFAULT_RETRIEVAL } from "../rag/index.js"

export const pdfRag=async (state)=>{
   try {
    await checkAgentLimit(state.userId,"pdf")
      const buffer=fs.readFileSync(state.file.path)
      const pdf=new PDFParse({
        data:buffer
      })

      const result=await pdf.getText()
      const text=result.text

      // same PDF + same chunk settings reuses its Qdrant collection instead of re-embedding
      const { collectionName }=await indexDocument(text,{
        ...DEFAULT_CHUNKING,
        source:state.file.originalname
      })

      const chunks=await retrieve(state.prompt,{ collectionName, ...DEFAULT_RETRIEVAL })

      const answer=await answerFromContext(state.prompt,chunks)
      await deductCredits(state.userId,"pdf")
      return {
        ...state,
        aiResponse:answer
      }



   } catch (error) {
    console.log(error)
         return {
            ...state,
            aiResponse:error?.data?.message || "failed to analyze pdf"
        }
   }finally{
         fs.rmSync(state.file.path,{ force:true })
   }


}
