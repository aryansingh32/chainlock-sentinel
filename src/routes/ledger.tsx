import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/ledger')({head:()=>({meta:[{title:'Ledger — ChainLock'},{name:'description',content:'Hash-chained audit explorer.'},{property:'og:title',content:'Ledger — ChainLock'},{property:'og:description',content:'Hash-chained audit explorer.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
