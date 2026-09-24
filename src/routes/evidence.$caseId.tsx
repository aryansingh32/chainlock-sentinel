import { createFileRoute } from '@tanstack/react-router'
import { CommandApp } from '@/components/chainlock-app'
export const Route=createFileRoute('/evidence/$caseId')({head:({params})=>({meta:[{title:`${params.caseId} Evidence — ChainLock`},{name:'description',content:'Offline-verifiable forensic evidence bundle.'},{property:'og:title',content:`${params.caseId} Evidence — ChainLock`},{property:'og:description',content:'Offline-verifiable forensic evidence bundle.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:CommandApp})
