import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/mesh')({head:()=>({meta:[{title:'Mesh — ChainLock'},{name:'description',content:'Authenticated relay mesh control.'},{property:'og:title',content:'Mesh — ChainLock'},{property:'og:description',content:'Authenticated relay mesh control.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
