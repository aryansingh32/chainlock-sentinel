import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/distributions')({head:()=>({meta:[{title:'Distributions — ChainLock'},{name:'description',content:'Secure distribution audit.'},{property:'og:title',content:'Distributions — ChainLock'},{property:'og:description',content:'Secure distribution audit.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
