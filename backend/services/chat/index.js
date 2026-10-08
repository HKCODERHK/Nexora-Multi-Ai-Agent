import express from "express"
import dns from "node:dns";
import dotenv from "dotenv"
import connectDb from "./config/db.js"
import router from "./routes/chat.routes.js"

dotenv.config()

 dns.setServers([
   "8.8.8.8",
   "8.8.4.4"
 ]);



const port =process.env.PORT

const app=express()
app.use(express.json())
app.use("/",router)
app.get("/",(req,res)=>{
    res.json({message:"hello from chat"})
})

app.listen(port,()=>{
    
    connectDb();
    console.log(`chat started at ${port}`);
})
