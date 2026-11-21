import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Vinayak Procurement",description:"Site requirements, vendor quotations and procurement approvals in one workspace.",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
