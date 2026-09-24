import { createFileRoute } from '@tanstack/react-router'
import { RolePage } from '@/components/chainlock-app'
export const Route=createFileRoute('/')({head:()=>({meta:[{title:'ChainLock — Secure Device Unlock'},{name:'description',content:'Offline role selection and device-bound access for ChainLock.'},{property:'og:title',content:'ChainLock — Secure Device Unlock'},{property:'og:description',content:'Offline role selection and device-bound access for ChainLock.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:RolePage})
