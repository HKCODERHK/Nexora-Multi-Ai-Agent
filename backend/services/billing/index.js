import express from "express"
import dotenv from "dotenv"
import connectDb from "./config/db.js"
import router from "./routes/billing.route.js"
import { requireInternalKey } from "../../shared/security/internalKey.js"
import dns from "node:dns";

dotenv.config()

dns.setServers([
  "8.8.8.8",
  "8.8.4.4"
]);

const port =process.env.PORT

const app=express()
app.use(express.json())
app.get("/",(req,res)=>{
    res.json({message:"hello from billing"})
})
// everything below is only for the gateway and other Nexora services
app.use(requireInternalKey)
app.use("/",router)

app.listen(port,()=>{
    console.log(`billing started at ${port}`)
    connectDb()
})
