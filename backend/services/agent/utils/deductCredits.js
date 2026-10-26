import axios from "axios"
import { internalHeaders } from "../../../shared/security/internalKey.js"

export const deductCredits=async (userId,agent)=>{
    try {
       const {data}=await axios.post(`${process.env.AUTH_SERVICE}/deduct-credits`,{userId,agent},{headers:internalHeaders()})
       return data
    } catch (error) {
        console.log(error)
        return null
    }
}