// Both checks are read-only. The pairing listener may be connected before
// the separate send/download server has finished binding its port.
export async function staffBridgeReady(fetcher=fetch){
  try{
    const options={redirect:"error",signal:AbortSignal.timeout(1500)};
    const status=await fetcher("http://127.0.0.1:8766/status",options);
    if(!status.ok)return false;
    const p=await status.json();
    if(p.phase!=="connected"||!p.outboundEnabled||p.sendScope!=="configured_staff_only")return false;
    const rest=await fetcher("http://127.0.0.1:8080/api/send",{...options,method:"HEAD"});
    return rest.status===405;
  }catch{return false;}
}
