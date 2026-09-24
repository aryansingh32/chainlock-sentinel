import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/trace')({head:()=>({meta:[{title:'Trace — ChainLock'},{name:'description',content:'Leak attribution workspace.'},{property:'og:title',content:'Trace — ChainLock'},{property:'og:description',content:'Leak attribution workspace.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
