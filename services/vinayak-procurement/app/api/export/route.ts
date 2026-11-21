import { compareQuotes } from '@/lib/domain';
import { identity, readWorkspace, errorResponse, HttpError } from '@/lib/server';
function cell(value: unknown) { let text=String(value??''); if (/^[=+@\-\t\r]/.test(text)) text="'"+text; return '"'+text.replace(/"/g,'""')+'"'; }
export async function GET(request:Request) { try {
 const user=await identity();const ws=await readWorkspace(user.userId);const id=new URL(request.url).searchParams.get('requestId')||ws.activeRequestId;
 const req=ws.requests.find(r=>r.id===id);if(!req)throw new HttpError(404,'Requirement not found.');
 const rows=compareQuotes(ws,id);const data:unknown[][]=[['Vinayak procurement comparative',req.title],['Generated',new Date().toISOString()],['Scope',req.measuredScopeOnly?'Quantified lines only':'Full scope; unresolved quantities remain flagged'],[],['Vendor','Rank','Eligible','Base subtotal INR','GST INR','Freight INR','Landed total INR','Price score','Performance score','Weighted score','Coverage','Payment terms','Delivery days','Reasons','Review flags']];
 rows.forEach(r=>data.push([r.vendorName,r.rank,r.eligible?'Yes':'No',r.baseTotal,r.gstAmount,r.freight,r.landedTotal,r.priceScore,r.performanceScore,r.score,r.coverage,r.paymentTerms,r.deliveryDays,r.reasons.join('; '),r.flags.join('; ')]));
 data.push([],['Line comparison'],['Vendor','BOQ code','Description','Required quantity','Unit','Normalized rate INR','Base amount INR','Flags']);
 rows.forEach(r=>r.lines.forEach(l=>data.push([r.vendorName,l.code,l.description,l.quantity,l.unit,l.normalizedRate,l.amount,l.flags.join('; ')])));
 data.push([],['Item code mapping'],['BOQ code','Description','ERP item code','Provisional']);req.lines.forEach(l=>{const item=ws.items.find(i=>i.id===l.itemId);data.push([l.code,l.description,item?.code||'Unmapped',item?.provisional?'Yes':'No']);});
 return new Response('\ufeff'+data.map(row=>row.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="vinayak-comparative.csv"','Cache-Control':'no-store'}});
 }catch(e){return errorResponse(e);} }
