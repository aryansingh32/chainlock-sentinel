import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/inbox')({head:()=>({meta:[{title:'Inbox — ChainLock'},{name:'description',content:'Controlled document inbox.'},{property:'og:title',content:'Inbox — ChainLock'},{property:'og:description',content:'Controlled document inbox.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
