import fs from "node:fs";
import path from "node:path";
import {parseCsv} from "../config.mjs";

// Only these named business tables are read here. Blank spreadsheet cells
// are unknown; a recorded zero is a real observation.
const specs={
  projects:[["project_id","project_name","address"],["project_id"]],
  materials:[["material_code","material_name","category","unit","specification"],["material_code"]],
  stock:[["project_id","material_code","qty_available","unit","last_updated"],["project_id","material_code"]],
  sample_vendor_replies:[["vendor_id","material_code","rate","unit","gst_included","freight","delivery_days","payment_terms","raw_message"],[]],
};
export class MasterDataError extends Error {}
export function businessTable(root,key){
  if(!Object.hasOwn(specs,key))throw new Error("Unknown business table.");
  const [columns,unique]=specs[key],filename=`${key}.csv`,target=path.join(root,"data",filename);
  const bad=()=>new MasterDataError(`Cannot verify ${filename}. Check its header, rows and identifiers.`);
  let header,rows;
  try{
    const st=fs.lstatSync(target);
    if(!st.isFile()||st.size>4*1024*1024)throw bad();
    [header,...rows]=parseCsv(fs.readFileSync(target,"utf8"));
  }catch{throw bad();}
  if(!header||new Set(header).size!==header.length||!columns.every(k=>header.includes(k)))throw bad();
  const seen=new Set();
  return rows.map(fields=>{
    if(fields.length!==header.length)throw bad();
    const row=Object.fromEntries(columns.map(k=>[k,fields[header.indexOf(k)]||null]));
    if(unique.length){
      const k=JSON.stringify(unique.map(col=>row[col]));
      if(unique.some(col=>!row[col])||seen.has(k))throw bad();
      seen.add(k);
    }
    if(key==="stock"){
      const qty=row.qty_available;
      row.qty_available=qty!==null&&/^\d+(?:\.\d+)?$/.test(qty)&&Number.isFinite(Number(qty))?Number(qty):null;
    }
    return row;
  });
}
export function verifiedQuantity(row,material){
  return material?.unit&&row?.unit===material.unit&&Number.isFinite(row?.qty_available)?row.qty_available:null;
}
