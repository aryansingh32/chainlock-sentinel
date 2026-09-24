import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/soc')({head:()=>({meta:[{title:'Soc — ChainLock'},{name:'description',content:'SENTINEL security operations dashboard.'},{property:'og:title',content:'Soc — ChainLock'},{property:'og:description',content:'SENTINEL security operations dashboard.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
