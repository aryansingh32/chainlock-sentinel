import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/compare')({head:()=>({meta:[{title:'Compare — ChainLock'},{name:'description',content:'Forensic controlled-copy comparison.'},{property:'og:title',content:'Compare — ChainLock'},{property:'og:description',content:'Forensic controlled-copy comparison.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
