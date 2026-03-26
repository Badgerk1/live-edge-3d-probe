let __edgeProbeTimer = null;
export async function onLoad(ctx){
  try{ ctx.log('3D Live Edge Mesh Combined v2.1.0 plugin loaded'); }catch(e){}
}
export async function onUnload(ctx){
  try{ if(__edgeProbeTimer) clearInterval(__edgeProbeTimer); }catch(e){}
  __edgeProbeTimer = null;
  try{ ctx.log('3D Live Edge Mesh Combined v2.1.0 plugin unloaded'); }catch(e){}
}
