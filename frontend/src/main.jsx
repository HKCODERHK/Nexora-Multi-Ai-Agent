import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import {Provider} from "react-redux"
import { store } from './redux/store.js'

// Free hosting only wakes sleeping services on browser traffic: ping them now and every 5 min.
const wakeUrls = (import.meta.env.VITE_WAKE_URLS || "").split(",").filter(Boolean)
const wakeServices = () => wakeUrls.forEach((url) => fetch(url, { mode: "no-cors", cache: "no-store" }).catch(() => {}))
if (wakeUrls.length) { wakeServices(); setInterval(wakeServices, 5 * 60 * 1000) }

createRoot(document.getElementById('root')).render(
   <Provider store={store}>
     <App />
   </Provider> 
 
)
