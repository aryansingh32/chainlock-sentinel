import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/devices')({head:()=>({meta:[{title:'Devices — ChainLock'},{name:'description',content:'Device and public-key authority.'},{property:'og:title',content:'Devices — ChainLock'},{property:'og:description',content:'Device and public-key authority.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
