import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/distribute/new')({head:()=>({meta:[{title:'New Secure Distribution — ChainLock'},{name:'description',content:'Build and register recipient-bound document packages.'},{property:'og:title',content:'New Secure Distribution — ChainLock'},{property:'og:description',content:'Build and register recipient-bound document packages.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
