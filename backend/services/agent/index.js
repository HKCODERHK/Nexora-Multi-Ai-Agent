import express from "express"
import dns from "node:dns";
import dotenv from "dotenv"
import connectDb from "./config/db.js"
import router from "./routes/agent.route.js"
import { errorHandler } from "./utils/errorHandler.js"
import { requireInternalKey } from "../../shared/security/internalKey.js"
dotenv.config()


dns.setServers([
  "8.8.8.8",
  "8.8.4.4"
]);

const port =process.env.PORT

const app=express()

app.use(express.json())
app.get("/",(req,res)=>{
    res.json({message:"hello from agent"})
})
// everything below is only for the gateway and other Nexora services
app.use(requireInternalKey)
app.use("/",router)

app.use(errorHandler)



app.listen(port,()=>{
    console.log(`agent started at ${port}`)
    connectDb()
})
