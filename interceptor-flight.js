/* Falcon IR — cinematic arcade paths, not a real guidance or flight model. */
(function (global) {
  'use strict';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = n => Number.isFinite(n);
  const validPoint = p => p && finite(p.x) && finite(p.y) && finite(p.z);
  const length = p => Math.hypot(p.x, p.y, p.z);
  const distance = (a, b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
  const mix = (a, b, t) => a+(b-a)*t;
  const CLEARANCE = 64;
  function ground(height, x, z) {
    try { const h = height ? height(x,z) : 0; return finite(h) ? h : 0; }
    catch (_) { return 0; }
  }
  function randomValue(random) {
    try { const n=(random || Math.random)(); return finite(n) ? clamp(n,0,1) : .5; }
    catch (_) { return .5; }
  }
  function routeCeiling(from, to, terrainHeight, start=0, end=1) {
    let ceiling=-Infinity;
    for(let i=0;i<=20;i++) {
      const t=mix(start,end,i/20);
      ceiling=Math.max(ceiling,ground(terrainHeight,mix(from.x,to.x,t),mix(from.z,to.z,t)));
    }
    return ceiling;
  }
  function controls(m, target) {
    const dx=target.x-m.from.x,dz=target.z-m.from.z;
    const horizontal=Math.hypot(dx,dz)||1,fx=dx/horizontal,fz=dz/horizontal;
    const sideX=-fz,sideZ=fx;
    const handle=clamp(horizontal*.24,100,1650);
    const offset=m.arc==='above'?m.arcHeight:-m.arcHeight;
    return {
      p1:{x:m.from.x+m.departure.x*m.firstLeg+sideX*m.side,
          y:m.arc==='above'?Math.max(m.from.y,target.y,m.routeGround+CLEARANCE)+m.arcHeight*.38:
            Math.min(m.from.y,target.y)-m.arcHeight*1.35,
          z:m.from.z+m.departure.z*m.firstLeg+sideZ*m.side},
      p2:{x:target.x-fx*handle+sideX*m.side*.3,
          y:target.y+offset,
          z:target.z-fz*handle+sideZ*m.side*.3}
    };
  }
  function evaluate(m, target, u) {
    const {p1,p2}=controls(m,target),v=1-u;
    const a=v*v*v,b=3*v*v*u,c=3*v*u*u,d=u*u*u;
    return {x:a*m.from.x+b*p1.x+c*p2.x+d*target.x,
            y:a*m.from.y+b*p1.y+c*p2.y+d*target.y,
            z:a*m.from.z+b*p1.z+c*p2.z+d*target.z};
  }
  function safeAltitude(y, floor) {
    const d=y-floor,blend=30;
    if(d<=0)return floor;
    if(d>=blend)return y;
    // Continuous slope at the terrain floor, so a low route does not chatter.
    return floor+d*d*(2*blend-d)/(blend*blend);
  }
  function create({plane,target,terrainHeight,random}={}) {
    if(!validPoint(plane)||!validPoint(target)||target.alive===false)return null;
    const yaw=finite(plane.yaw)?plane.yaw:0,pitch=finite(plane.pitch)?plane.pitch:0;
    const cp=Math.cos(pitch),sy=Math.sin(yaw),cy=Math.cos(yaw);
    const forward={x:-sy*cp,y:Math.sin(pitch),z:-cy*cp};
    const from={x:plane.x+cy*22+forward.x*30,
                y:plane.y-8+forward.y*30,
                z:plane.z-sy*22+forward.z*30};
    from.y=Math.max(from.y,ground(terrainHeight,from.x,from.z)+CLEARANCE+12);
    const range=distance(from,target),routeGround=routeCeiling(from,target,terrainHeight);
    const terminalGround=routeCeiling(from,target,terrainHeight,.6,1);
    const availableDip=target.y-terminalGround-CLEARANCE;
    const requestedArc=randomValue(random)<.5?'above':'below';
    const arc=requestedArc==='below'&&availableDip>=110?'below':'above';
    const arcHeight=arc==='above'?
      Math.max(clamp(range*.18,300,1050),routeGround-target.y+CLEARANCE+180):
      clamp(availableDip*.7,75,255);
    const duration=clamp(3.8+range/1700+(arc==='above'?.18:.05),4.2,8);
    const m={...from,from,age:0,duration,target:target.id,state:'flying',
      ignited:true,yaw,pitch,scale:.36,trail:[{...from,age:0}],
      arc,requestedArc,arcHeight,routeGround,
      departure:forward,firstLeg:clamp(range*.28,150,1900),
      side:(randomValue(random)*2-1)*clamp(range*.075,45,210),
      vx:forward.x*(plane.speed||220),vy:forward.y*(plane.speed||220),vz:forward.z*(plane.speed||220),
      maxAge:duration+2.4,maxSpeed:clamp(range/duration*2.8+180,700,2900),
      progress:0,_trailTime:0};
    return m;
  }
  function update(m,target,dt,terrainHeight) {
    if(!m||!validPoint(m))return 'expired';
    if(m.state==='hit'||m.state==='expired')return m.state;
    if(!validPoint(target)||target.alive===false||target.id!==m.target) {
      m.state='expired';return m.state;
    }
    const step=finite(dt)?clamp(dt,0,.1):0;
    if(step===0)return 'flying';
    m.age+=step;m.ignited=true;
    for(const point of m.trail)point.age+=step;
    m.trail=m.trail.filter(point=>point.age<3.4);
    const t=clamp(m.age/m.duration,0,1);
    // A gentle acceleration envelope keeps launch moving immediately.
    const u=.55*t+.45*t*t;m.progress=u;
    const desired=evaluate(m,target,u);
    desired.y=safeAltitude(desired.y,ground(terrainHeight,desired.x,desired.z)+CLEARANCE);
    const delta={x:desired.x-m.x,y:desired.y-m.y,z:desired.z-m.z};
    const span=length(delta),travel=Math.min(1,m.maxSpeed*step/(span||1));
    const previous={x:m.x,y:m.y,z:m.z};
    m.x+=delta.x*travel;m.y+=delta.y*travel;m.z+=delta.z*travel;
    m.y=Math.max(m.y,ground(terrainHeight,m.x,m.z)+CLEARANCE);
    m.vx=(m.x-previous.x)/step;m.vy=(m.y-previous.y)/step;m.vz=(m.z-previous.z)/step;
    const horizontal=Math.hypot(m.vx,m.vz);
    if(horizontal+Math.abs(m.vy)>1e-6) {
      m.yaw=Math.atan2(-m.vx,-m.vz);
      m.pitch=Math.atan2(m.vy,horizontal);
    }
    m._trailTime+=step;
    if(m._trailTime>=.04) {
      m._trailTime%=.04;m.trail.push({x:m.x,y:m.y,z:m.z,age:0});
      if(m.trail.length>96)m.trail.splice(0,m.trail.length-96);
    }
    // Contact, rather than a timer, confirms the hit. A moving/teleported target
    // can take longer or expire; terrain never gets ignored to force an impact.
    const reachable=target.y>=ground(terrainHeight,target.x,target.z)+40;
    if(t>.65&&reachable&&distance(m,target)<=24) {
      m.state='hit';return m.state;
    }
    if(m.age>=m.maxAge) {m.state='expired';return m.state;}
    return 'flying';
  }
  global.FalconInterceptorFlight={create,update};
})(typeof window!=='undefined'?window:globalThis);
