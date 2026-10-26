import axios from "axios"
import { internalHeaders } from "../../../shared/security/internalKey.js"

export const getMessages=async (conversationId)=>{
    try {
       const {data}=await axios.get(`${process.env.CHAT_SERVICE}/get-messages/${conversationId}`,{headers:internalHeaders()})
       return data
    } catch (error) {
        console.log(error)
        return null
    }
}