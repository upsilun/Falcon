/* FALCON / IR — a fictional, offline arcade experience. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const scope = $('scope'), hud = $('hud'), ctx = hud.getContext('2d');
  const radar = $('radar'), rctx = radar.getContext('2d');
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const angle = n => Math.atan2(Math.sin(n), Math.cos(n));
  const pad = (n, len = 2) => String(Math.floor(n)).padStart(len, '0');
  const lerp = (a, b, t) => a + (b - a) * t;
  // Arcade aim tolerance: a wider area than the mesh, with a deliberate hold.
  const aimRadius = () => clamp(height * .12, 62, 105);
  const inputKey = e => /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : e.code === 'Space' ? ' ' : e.code === 'Equal' ? '+' : e.code === 'Minus' ? '-' : e.key.toLowerCase();
  let world;
  try { world = new IRWorld($('world')); } catch (err) {
    console.error('3D initialization failed:', err);
    $('start-screen').hidden = true; $('error-screen').hidden = false; return;
  }
  const audio = new FalconAudio();
  const keys = new Set();
  const game = {
    phase:'ready', time:0, renderTime:0, score:0, breaches:0, shots:0,spawned:0,
    plane:{x:0,y:1550,z:2500,yaw:0,bank:0,pitch:0,rollRate:0,pitchRate:0,speed:245,throttle:.78,g:1,climb:0},
    gimbal:{yaw:-0.05,pitch:-0.29}, camera:{x:0,y:1800,z:2500,yaw:-0.05,pitch:-0.29},
    mode:'ir',polarity:'white',zoom:0, fovs:[38,24,14,7],
    contacts:[],explosions:[],interceptors:[],debris:[],projected:[],
    target:null,acquiring:null,lock:0,cue:null,cooldown:0,spawnIn:0,
    muted:false,quality:'high',noticeUntil:0,hasStarted:false,
    view:'pod',look:{yaw:0,pitch:0},seekerStrength:0,terrainWarning:0,
    candidate:null,aimHeld:false,lostTrack:0
  };
  let width=1,height=1,last=performance.now(),hudClock=0, uid=0, pointer=null,dialogWasPlaying=false;
  function safeHeight(x,z) { return world.terrainHeight ? world.terrainHeight(x,z) : 180; }
  function spawnContact() {
    const p=game.plane,bearing=p.yaw+(Math.random()-.5)*1.7,distance=3600+Math.random()*3300;
    const x=p.x-Math.sin(bearing)*distance,z=p.z-Math.cos(bearing)*distance;
    const clearance=260+Math.random()*340,y=Math.max(540,safeHeight(x,z)+clearance);
    const contact={id:++uid,x,y,z,yaw:angle(p.yaw+(Math.random()-.5)*1.8),alive:true,
      ttl:78+Math.random()*47,phase:Math.random()*TAU,speed:145+Math.random()*65,originY:y,clearance};
    game.contacts.push(contact);game.spawned++;
    return contact;
  }
  function reset() {
    Object.assign(game,{time:0,score:0,breaches:0,shots:0,spawned:0,target:null,acquiring:null,lock:0,cue:null,cooldown:0,spawnIn:4+Math.random()*5});
    Object.assign(game.plane,{x:0,y:1550,z:2500,yaw:0,bank:0,pitch:0,rollRate:0,pitchRate:0,speed:245,throttle:.78,g:1,climb:0});
    game.view='pod';game.look={yaw:0,pitch:0};game.seekerStrength=0;game.terrainWarning=0;game.candidate=null;game.aimHeld=false;game.lostTrack=0;
    Object.assign(game.gimbal,{yaw:-.05,pitch:-.29});
    game.contacts=[];game.explosions=[];game.interceptors=[];game.zoom=0;
    const first=spawnContact();spawnContact();aimAt(first,true);keys.clear();updateUI();
  }
  function begin() {
    reset();game.phase='playing';game.hasStarted=true;
    $('start-screen').hidden=true;$('end-screen').hidden=true;$('pause-screen').hidden=true;
    $('pause-btn').innerHTML='Ⅱ <span>إيقاف مؤقت</span>';
    audio.start();captureMouse();notice('لاحق الهدف واضغط مطوّلًا زر الماوس الأيمن للقفل',4);scope.focus({preventScroll:true});
  }
  function notice(message,seconds=2.5) {
    $('notice').textContent=message;game.noticeUntil=performance.now()+seconds*1000;
  }
  function pause(force) {
    if(game.phase==='ready'||game.phase==='ended')return;
    game.phase=force===true?'paused':force===false?'playing':game.phase==='playing'?'paused':'playing';
    $('pause-screen').hidden=game.phase!=='paused';keys.clear();game.aimHeld=false;
    $('pause-btn').innerHTML=game.phase==='paused'?'▷ <span>متابعة</span>':'Ⅱ <span>إيقاف مؤقت</span>';
    if(game.phase==='playing'){audio.start();captureMouse();scope.focus({preventScroll:true});}
    else if(document.pointerLockElement===scope)document.exitPointerLock?.();
  }
  function aimAt(c,instant=false) {
    const p=game.plane,dx=c.x-p.x,dy=c.y-p.y,dz=c.z-p.z;
    const yaw=angle(Math.atan2(-dx,-dz)-p.yaw),pitch=Math.atan2(dy,Math.hypot(dx,dz));
    if(instant){game.gimbal.yaw=yaw;game.gimbal.pitch=pitch;}
    return {yaw,pitch};
  }
  function nearest() {
    const p=game.plane;
    return game.contacts.filter(c=>c.alive&&!game.interceptors.some(s=>s.target===c.id)).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
  }
  function release(silent=false) {
    game.target=null;game.acquiring=null;game.lock=0;game.cue=null;
    if(!silent)notice('أُلغي القفل · ابحث عن هدف',1.5);
  }
  function cueContact() {
    if(game.phase!=='playing')return;
    release(true);game.gimbal.yaw=0;game.gimbal.pitch=-.27;game.look={yaw:0,pitch:0};
    notice('التصويب في المنتصف',1.2);
  }
  function acquire() {
    if(game.phase!=='playing')return;
    game.aimHeld=true;
  }
  function fire() {
    if(game.phase!=='playing')return;
    if(!game.target||!game.target.alive){notice('ثبّت التصويب واضغط مطوّلًا زر الماوس الأيمن',2);return;}
    if(game.interceptors.some(s=>s.target===game.target.id)){notice('الصاروخ في طريقه إلى هذا الهدف',1.5);return;}
    if(game.cooldown>0){notice('تجهيز الإطلاق · '+game.cooldown.toFixed(1)+' ث',1.2);return;}
    const missile=FalconInterceptorFlight.create({plane:game.plane,target:game.target,terrainHeight:safeHeight,random:Math.random});
    if(!missile){notice('تعذّر الإطلاق · أعد تثبيت الهدف',2);return;}
    game.interceptors.push(missile);
    game.shots++;game.cooldown=3;audio.cue('launch');notice('الصاروخ انطلق!',1.5);
  }
  function setSpectrum(mode) {
    game.view='pod';
    game.mode=mode==='tv'?'tv':'ir';game.polarity=mode==='black'?'black':'white';
    ['white','black','tv'].forEach(m=>{const b=$(m+'-btn');b.classList.toggle('selected',m===mode);b.setAttribute('aria-pressed',m===mode);});
    $('sensor-label').textContent=mode==='tv'?'رؤية نهارية':mode==='black'?'حراري أسود':'حراري أبيض';
    $('feed-mode').textContent=mode==='tv'?'رؤية نهارية':mode==='black'?'حراري أسود':'حراري أبيض';
    audio.cue('click');
  }
  function zoomBy(n) {game.view='pod';game.zoom=clamp(game.zoom+n,0,game.fovs.length-1);audio.cue('click');updateUI();}
  function toggleView() {game.view=game.view==='pod'?'cockpit':'pod';game.look={yaw:0,pitch:0};audio.cue('click');updateUI();}
  function toggleSound() {game.muted=!game.muted;if(!game.muted)audio.start();audio.setMuted(game.muted);$('sound-btn').innerHTML=game.muted?'♪ <span>الصوت مكتوم</span>':'♫ <span>الصوت مفعّل</span>';$('sound-btn').setAttribute('aria-label',game.muted?'تشغيل الصوت':'كتم الصوت');}
  function toggleFull() {try {if(document.fullscreenElement)document.exitFullscreen()?.catch(()=>{});else document.documentElement.requestFullscreen()?.catch(()=>notice('استخدم ملء الشاشة من قائمة المتصفح',2));}catch(_){notice('استخدم ملء الشاشة من قائمة المتصفح',2);}}
  function openHelp() {dialogWasPlaying=game.phase==='playing';if(dialogWasPlaying)pause(true);$('help-dialog').showModal();}
  function closeHelp() {$('help-dialog').close();}
  $('help-dialog').addEventListener('close',()=>{if(dialogWasPlaying)pause(false);dialogWasPlaying=false;});
  $('start-btn').onclick=begin;$('again-btn').onclick=begin;$('restart-btn').onclick=begin;
  $('pause-btn').onclick=()=>pause();$('resume-btn').onclick=()=>pause(false);
  $('cue-btn').onclick=cueContact;$('fire-btn').onclick=fire;
  $('track-btn').addEventListener('pointerdown',acquire);
  for(const event of ['pointerup','pointercancel','pointerleave'])$('track-btn').addEventListener(event,()=>game.aimHeld=false);
  $('white-btn').onclick=()=>setSpectrum('white');$('black-btn').onclick=()=>setSpectrum('black');$('tv-btn').onclick=()=>setSpectrum('tv');
  $('zoom-in').onclick=()=>zoomBy(1);$('zoom-out').onclick=()=>zoomBy(-1);
  $('sound-btn').onclick=toggleSound;$('full-btn').onclick=toggleFull;
  $('view-btn').onclick=toggleView;$('release-btn').onclick=()=>release();
  $('throttle-up').onclick=()=>{game.plane.throttle=clamp(game.plane.throttle+.1,.3,1.2);};
  $('throttle-down').onclick=()=>{game.plane.throttle=clamp(game.plane.throttle-.1,.3,1.2);};
  $('help-btn').onclick=openHelp;$('close-help').onclick=closeHelp;$('help-done').onclick=closeHelp;
  function captureMouse() {
    if(document.pointerLockElement===scope)return;
    try {const promise=scope.requestPointerLock?.();promise?.catch?.(()=>notice('انقر داخل اللعبة لإخفاء المؤشر · Esc للقائمة',3));}
    catch(_){notice('انقر داخل اللعبة للتصويب · يمكنك استخدام الأسهم',3);}
  }
  function moveAim(dx,dy) {
    if(game.phase!=='playing')return;
    if(game.view==='cockpit'){
      game.look.yaw=clamp(game.look.yaw-dx*.0018,-1.55,1.55);game.look.pitch=clamp(game.look.pitch-dy*.0018,-.9,.8);
    }else{
      const sensitivity=game.fovs[game.zoom]*DEG*.0022;
      game.gimbal.yaw=angle(game.gimbal.yaw-dx*sensitivity);
      game.gimbal.pitch=clamp(game.gimbal.pitch-dy*sensitivity,-1.5,.7);
    }
  }
  document.addEventListener('mousemove',e=>{if(document.pointerLockElement===scope)moveAim(e.movementX||0,e.movementY||0);});
  document.addEventListener('mousedown',e=>{if(document.pointerLockElement===scope&&game.phase==='playing'&&e.button===2)game.aimHeld=true;});
  document.addEventListener('mouseup',e=>{if(e.button===2)game.aimHeld=false;});
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==scope&&game.phase==='playing')pause(true);});
  scope.addEventListener('pointerdown',e=>{
    if(game.phase!=='playing'||e.target.closest('button'))return;
    if(document.pointerLockElement===scope)return;
    if(e.pointerType!=='touch'){captureMouse();if(e.button===2)game.aimHeld=true;return;}
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};
    scope.setPointerCapture(e.pointerId);scope.focus({preventScroll:true});
  });
  scope.addEventListener('pointermove',e=>{
    if(!pointer||game.phase!=='playing')return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    if(Math.hypot(e.clientX-pointer.startX,e.clientY-pointer.startY)>4)pointer.moved=true;
    if(pointer.moved)moveAim(dx,dy);
    pointer.x=e.clientX;pointer.y=e.clientY;
  });
  scope.addEventListener('pointerup',()=>{pointer=null;});
  scope.addEventListener('pointercancel',()=>pointer=null);
  scope.addEventListener('wheel',e=>{e.preventDefault();zoomBy(e.deltaY>0?-1:1);},{passive:false});
  scope.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('keydown',e=>{
    if($('help-dialog').open)return;
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const k=inputKey(e);
    if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();
    keys.add(k);if(e.repeat)return;
    if(k===' '){if(game.phase==='ready')begin();else fire();}
    else if(k==='c')cueContact();
    else if(k==='b')toggleView();else if(k==='x')release();
    else if(k==='v')setSpectrum(game.mode==='tv'?'white':game.polarity==='white'?'black':'tv');
    else if(k==='='||k==='+')zoomBy(1);else if(k==='-'||k==='_')zoomBy(-1);
    else if(k==='p')pause();else if(k==='escape'){if(game.phase==='playing')pause(true);}else if(k==='h')openHelp();
    else if(k==='m')toggleSound();else if(k==='f')toggleFull();
  });
  window.addEventListener('keyup',e=>keys.delete(inputKey(e)));
  window.addEventListener('blur',()=>{keys.clear();pointer=null;if(game.phase==='playing')pause(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&game.phase==='playing')pause(true);});
  function update(dt) {
    game.time+=dt;game.cooldown=Math.max(0,game.cooldown-dt);
    const p=game.plane;
    const turn=(keys.has('d')?1:0)-(keys.has('a')?1:0),pitchInput=(keys.has('w')?1:0)-(keys.has('s')?1:0);
    // Damped controls, pitch-driven climb, speed/energy changes and bank-driven turns.
    // Tuned for an accessible flight game; these are not real aircraft parameters.
    const rollTarget=turn*1.05;
    p.rollRate=lerp(p.rollRate,(rollTarget-p.bank)*(turn?3.3:1.7),1-Math.exp(-dt*3.5));
    p.bank=clamp(p.bank+p.rollRate*dt,-1.15,1.15);
    p.pitchRate=lerp(p.pitchRate,pitchInput*.29-p.pitch*(pitchInput ? .14 : .65),1-Math.exp(-dt*2.7));
    p.pitch=clamp(p.pitch+p.pitchRate*dt,-.55,.62);
    p.throttle=clamp(p.throttle+((keys.has('e')?1:0)-(keys.has('q')?1:0))*dt*.28,.3,1.2);
    const targetSpeed=140+p.throttle*145-Math.abs(p.bank)*10;
    p.speed=clamp(p.speed+((targetSpeed-p.speed)*.16-Math.sin(p.pitch)*18)*dt,125,370);
    p.yaw=angle(p.yaw-9.81*Math.tan(p.bank)/Math.max(p.speed,125)*1.65*dt);
    const horizontalSpeed=p.speed*Math.cos(p.pitch);
    p.x-=Math.sin(p.yaw)*horizontalSpeed*dt;p.z-=Math.cos(p.yaw)*horizontalSpeed*dt;
    p.climb=lerp(p.climb,p.speed*Math.sin(p.pitch),1-Math.exp(-dt*2));
    p.y=clamp(p.y+p.climb*dt,350,7500);
    p.g=lerp(p.g,clamp(1/Math.cos(p.bank)+p.pitchRate*p.speed/30,.4,4.8),1-Math.exp(-dt*2));
    const floor=safeHeight(p.x,p.z)+230;
    if(p.y<floor){p.y=floor;p.pitch=Math.max(p.pitch,.15);p.climb=Math.max(p.climb,25);if(game.time>game.terrainWarning){notice('انتبه للأرض! مساعدة الطيران مفعّلة',2);game.terrainWarning=game.time+5;}}
    const sx=(keys.has('arrowright')?1:0)-(keys.has('arrowleft')?1:0),sy=(keys.has('arrowup')?1:0)-(keys.has('arrowdown')?1:0);
    if(sx||sy){game.view='pod';game.gimbal.yaw=angle(game.gimbal.yaw-sx*dt*.35/(game.zoom+1));game.gimbal.pitch=clamp(game.gimbal.pitch+sy*dt*.3/(game.zoom+1),-1.5,.7);}
    for(const c of game.contacts){
      if(!c.alive)continue;
      c.yaw+=Math.sin(game.time*.13+c.phase)*dt*.015;
      c.x-=Math.sin(c.yaw)*c.speed*dt;c.z-=Math.cos(c.yaw)*c.speed*dt;
      c.y=lerp(c.y,Math.max(c.originY+Math.sin(game.time*.35+c.phase)*35,safeHeight(c.x,c.z)+c.clearance),Math.min(1,dt*2));
      c.ttl-=dt;
      if(c.ttl<=0&&!game.interceptors.some(s=>s.target===c.id)){c.alive=false;game.breaches++;if(game.target===c||game.acquiring===c)release(true);audio.cue('escape');notice('هدف أفلت · واصل البحث',2);}
    }
    const radius=aimRadius(),holding=game.aimHeld||keys.has('l');
    const eligible=game.projected.filter(v=>v.visible&&Math.hypot(v.x-width/2,v.y-height/2)<radius&&game.contacts.some(c=>c.id===v.id&&c.alive)&&!game.interceptors.some(s=>s.target===v.id));
    eligible.sort((a,b)=>Math.hypot(a.x-width/2,a.y-height/2)-Math.hypot(b.x-width/2,b.y-height/2));
    game.candidate=game.contacts.find(c=>c.id===eligible[0]?.id)||null;
    if(game.target){
      const t=game.projected.find(v=>v.id===game.target.id);
      const inZone=t?.visible&&Math.hypot(t.x-width/2,t.y-height/2)<radius*1.25;
      game.lostTrack=inZone?0:game.lostTrack+dt;
      if(!game.target.alive||(game.lostTrack>.35&&!game.interceptors.some(s=>s.target===game.target.id))){release(true);notice('فُقد القفل · لاحق الهدف',1.5);}
    }else if(holding&&game.candidate){
      if(game.acquiring!==game.candidate){game.acquiring=game.candidate;game.lock=0;audio.cue('acquire');}
      const offset=Math.hypot(eligible[0].x-width/2,eligible[0].y-height/2)/radius;
      game.lock+=dt/(1.4+offset*.35);
      if(game.lock>=1){game.lock=1;game.target=game.acquiring;game.acquiring=null;game.lostTrack=0;audio.cue('lock');notice('تم القفل! اضغط مسافة للإطلاق',1.5);}
    }else{
      game.lock=Math.max(0,game.lock-dt*1.8);if(game.lock===0)game.acquiring=null;
    }
    for(let i=game.interceptors.length-1;i>=0;i--){
      const s=game.interceptors[i],c=game.contacts.find(c=>c.id===s.target);
      const result=FalconInterceptorFlight.update(s,c,dt,safeHeight);
      if(result==='expired'){game.interceptors.splice(i,1);notice('لم يُصب الصاروخ · حاول مجددًا',2);continue;}
      if(result==='hit'&&c?.alive){
        c.alive=false;game.score++;game.explosions.push({x:c.x,y:c.y,z:c.z,age:0});game.interceptors.splice(i,1);audio.cue('hit');notice('إصابة مؤكدة!',3);
        if(game.target===c)game.target=null;
        if(game.acquiring===c)game.acquiring=null;
        if(game.cue===c)game.cue=null;
        if(!game.target&&!game.acquiring)game.lock=0;
      }
    }
    for(const e of game.explosions)e.age+=dt;
    game.explosions=game.explosions.filter(e=>e.age<5.5);
    game.contacts=game.contacts.filter(c=>c.alive||game.interceptors.some(s=>s.target===c.id));
    if(game.candidate&&!game.candidate.alive)game.candidate=null;
    game.spawnIn-=dt;
    if(game.spawnIn<=0){
      if(game.contacts.filter(c=>c.alive).length<5){spawnContact();if(!game.target&&!game.acquiring)notice('رصد هدف جديد',1.8);}
      game.spawnIn=4+Math.random()*5;
    }
  }
  function updateUI() {
    const alive=game.contacts.filter(c=>c.alive), t=game.target||game.acquiring||game.candidate, dist=t?Math.hypot(t.x-game.plane.x,t.y-game.plane.y,t.z-game.plane.z):0;
    const clock=pad(game.time/3600)+':'+pad((game.time/60)%60)+':'+pad(game.time%60);
    $('mission-clock').textContent=game.time>=3600?clock:clock.slice(3);
    $('rec-time').textContent=clock;
    $('score').textContent=pad(game.score);$('contacts-count').textContent=pad(alive.length);$('breaches').textContent=String(game.breaches);
    $('mission-status').textContent=game.phase==='playing'?'دورية بلا نهاية':game.phase==='paused'?'توقف مؤقت':'جاهز للإقلاع';
    const cockpit=game.view==='cockpit',p=game.plane;
    $('app').classList.toggle('in-play',game.phase==='playing');
    $('scope').classList.toggle('cockpit',cockpit);
    $('station-label').textContent=cockpit?'قمرة القيادة':'المنظار الحراري';
    $('view-btn').innerHTML=(cockpit?'المنظار الحراري':'قمرة القيادة')+' <kbd>B</kbd>';
    $('feed-mode').textContent=cockpit?'قمرة القيادة':game.mode==='tv'?'رؤية نهارية':game.polarity==='black'?'حراري أسود':'حراري أبيض';
    $('sensor-label').textContent=cockpit?'قمرة القيادة':game.mode==='tv'?'رؤية نهارية':game.polarity==='black'?'حراري أسود':'حراري أبيض';
    $('zoom-label').textContent=(38/game.fovs[game.zoom]).toFixed(1)+'×';$('fov-label').textContent=cockpit?'':(38/game.fovs[game.zoom]).toFixed(1)+'×';
    $('zoom-in').disabled=game.zoom===3;$('zoom-out').disabled=game.zoom===0;
    $('speed-value').innerHTML=Math.round(p.speed*1.94384)+' <small>عقدة</small>';
    $('alt-value').innerHTML=Math.round(game.plane.y*3.28084).toLocaleString('en-US')+' <small>قدم</small>';
    const hdg=(((-game.plane.yaw/DEG)%360)+360)%360;
    $('heading-value').innerHTML=pad(hdg,3)+' <small>درجة</small>';
    $('throttle-value').textContent=Math.round(p.throttle*100)+'%';
    $('flight-info').textContent=p.g.toFixed(1)+' ج · ميل '+Math.round(Math.abs(p.bank)/DEG)+'° · صعود '+(p.climb>=0?'+':'')+Math.round(p.climb*196.85);
    const az=-game.gimbal.yaw/DEG,el=game.gimbal.pitch/DEG;
    $('coord-label').textContent='سمت '+(az>=0?'+':'−')+pad(Math.abs(az),3)+'° / ارتفاع '+(el>=0?'+':'−')+pad(Math.abs(el))+'°';
    $('range-label').textContent=dist?(dist/1000).toFixed(2)+' كم':'—.— كم';
    $('gps-lat').textContent=formatCoordinate(24+(2500-p.z)/111320,'N','S');
    $('gps-lon').textContent=formatCoordinate(45+p.x/(111320*Math.cos(24*DEG)),'E','W');
    $('sensor-az').textContent=(az>=0?'+':'−')+Math.abs(az).toFixed(1)+'°';
    $('sensor-el').textContent=(el>=0?'+':'−')+Math.abs(el).toFixed(1)+'°';
    const vx=-Math.sin(p.yaw)*p.speed*Math.cos(p.pitch),vz=-Math.cos(p.yaw)*p.speed*Math.cos(p.pitch);
    const closure=dist?((vx+Math.sin(t.yaw)*t.speed)*(t.x-p.x)+(vz+Math.cos(t.yaw)*t.speed)*(t.z-p.z)+p.climb*(t.y-p.y))/dist:0;
    $('closure-value').textContent=dist?(closure>=0?'+':'−')+Math.round(Math.abs(closure))+' م/ث':'— م/ث';
    $('target-speed').textContent=t?Math.round(t.speed*1.94384)+' عقدة':'— عقدة';
    $('track-label').textContent=game.target?'متابعة الهدف':game.acquiring?'جارٍ القفل':'ابحث عن هدف';
    $('track-status').textContent=game.interceptors.length?'الصاروخ انطلق!':game.target?'مقفل':game.acquiring?'ثبّت التصويب':game.candidate?'هدف حراري':'ابحث عن هدف';
    $('track-fill').style.width=(clamp(game.lock,0,1)*100)+'%';
    $('track-detail').textContent=game.interceptors.length?'ترقّب الإصابة':game.target?'واصل المتابعة · مسافة للإطلاق':game.acquiring?'ابقَ فوق الهدف حتى يكتمل القفل':game.candidate?'اضغط مطوّلًا زر الماوس الأيمن أو L':'حرّك المنظار وابحث عن صاروخ';
    const canFire=!!game.target&&game.cooldown===0&&game.phase==='playing'&&!game.interceptors.some(s=>s.target===game.target.id);
    $('fire-btn').disabled=!canFire;$('fire-btn').classList.toggle('ready',canFire);
    $('track-btn').innerHTML=(game.target?'مقفل':'اضغط مطوّلًا للقفل')+' <kbd>L</kbd>';
    $('release-btn').disabled=!game.target&&!game.acquiring;
    $('scope-hint').textContent='الماوس: تصويب  ·  زر أيمن مطوّل: قفل  ·  مسافة: إطلاق  ·  Esc: القائمة';
    $('scope-hint').style.opacity=game.phase==='playing'?'.9':'0';
    $('notice').style.opacity=performance.now()<game.noticeUntil&&game.phase==='playing'?'1':'0';
  }
  function formatCoordinate(degrees,positive,negative) {
    // Display-only coordinates for the fictional map; no geolocation is used.
    const ticks=Math.round(Math.abs(degrees)*36000),d=Math.floor(ticks/36000),m=Math.floor(ticks%36000/600),s=(ticks%600/10).toFixed(1).padStart(4,'0');
    return pad(d,2)+'° '+pad(m)+'′ '+s+'″ '+(degrees>=0?positive:negative);
  }
  function line(x1,y1,x2,y2) {ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}
  function drawCockpit() {
    const p=game.plane,cx=width/2,cy=height/2,green='#baf6a5',panelH=clamp(height*.19,86,120),base=height-panelH;
    ctx.save();
    // Canopy bows and instrument coaming give a fixed airframe reference.
    ctx.strokeStyle='#101913';ctx.lineWidth=24;ctx.beginPath();
    ctx.moveTo(-8,height*.9);ctx.quadraticCurveTo(20,height*.21,width*.13,-12);
    ctx.moveTo(width+8,height*.9);ctx.quadraticCurveTo(width-20,height*.21,width*.87,-12);ctx.stroke();
    ctx.strokeStyle='#4b574548';ctx.lineWidth=2;ctx.stroke();
    const shade=ctx.createLinearGradient(0,base,0,height);shade.addColorStop(0,'#283127');shade.addColorStop(.17,'#101710');shade.addColorStop(1,'#080e0b');
    ctx.fillStyle=shade;ctx.beginPath();ctx.moveTo(0,height);ctx.lineTo(0,base+26);ctx.lineTo(width*.23,base+12);ctx.lineTo(width*.36,base-11);ctx.lineTo(width*.64,base-11);ctx.lineTo(width*.77,base+12);ctx.lineTo(width,base+26);ctx.lineTo(width,height);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#68725a66';ctx.lineWidth=1;ctx.stroke();
    const displayW=Math.min(width*.24,190),displayH=panelH-28;
    for(const side of [-1,1]){
      const dx=cx+side*width*.27-displayW/2,dy=base+21;
      ctx.fillStyle='#060d08';ctx.fillRect(dx,dy,displayW,displayH);ctx.strokeStyle='#3a4b33';ctx.strokeRect(dx,dy,displayW,displayH);
      ctx.fillStyle='#8ca17c';ctx.font='bold 11px Tahoma, Arial';ctx.textAlign='left';ctx.fillText(side<0?'المحركان':'الطيران',dx+10,dy+15);
      ctx.fillStyle=green;ctx.font='bold 18px Tahoma, Arial';ctx.fillText(side<0?Math.round(p.throttle*100)+' %':p.g.toFixed(1)+' ج',dx+10,dy+39);
      ctx.font='bold 10px Tahoma, Arial';ctx.fillStyle='#6c9c5c';ctx.fillText(side<0?(p.throttle>1?'دفع إضافي':'دفع عادي'):(p.climb>=0?'صعود ':'هبوط ')+Math.abs(Math.round(p.climb*196.85))+' قدم/د',dx+10,dy+54);
    }
    ctx.textAlign='center';ctx.fillStyle='#8d9c80';ctx.font='bold 11px Tahoma, Arial';ctx.fillText('صقر ١',cx,base+20);ctx.fillStyle=green;ctx.font='bold 16px Tahoma, Arial';ctx.fillText(pad(((-p.yaw/DEG)%360+360)%360,3)+'°',cx,base+43);ctx.font='bold 10px Tahoma, Arial';ctx.fillStyle='#7e906d';ctx.fillText('مساعدة الطيران',cx,base+60);
    // A restrained transparent HUD combiner, with an earth-referenced pitch ladder.
    const half=Math.min(width*.28,240),top=Math.max(65,height*.15),bottom=base-20;
    ctx.fillStyle='#b4e18c06';ctx.strokeStyle='#b4e18c22';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(cx-half,top+25);ctx.lineTo(cx-half+25,top);ctx.lineTo(cx+half-25,top);ctx.lineTo(cx+half,top+25);ctx.lineTo(cx+half,bottom);ctx.lineTo(cx-half,bottom);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.save();ctx.beginPath();ctx.rect(cx-half+8,top+10,half*2-16,Math.max(1,bottom-top-20));ctx.clip();
    ctx.translate(cx,cy);ctx.rotate(-game.camera.roll);ctx.strokeStyle='#baf6a5aa';ctx.fillStyle='#baf6a5aa';ctx.font='9px Consolas,monospace';ctx.lineWidth=1;
    const focal=height/(2*Math.tan(36*DEG));
    for(let deg=-30;deg<=30;deg+=10){const ly=Math.tan(game.camera.pitch-deg*DEG)*focal;if(Math.abs(ly)>height*.42)continue;ctx.setLineDash(deg<0?[5,4]:[]);ctx.beginPath();const length=deg===0?110:65;line(-length,ly,-22,ly);line(22,ly,length,ly);ctx.stroke();ctx.setLineDash([]);if(deg!==0){ctx.fillText(String(Math.abs(deg)),-82,ly+3);ctx.fillText(String(Math.abs(deg)),82,ly+3);}}
    ctx.restore();
    ctx.strokeStyle=green;ctx.fillStyle=green;ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(cx,cy,6,0,TAU);line(cx-24,cy,cx-6,cy);line(cx+6,cy,cx+24,cy);line(cx,cy-6,cx,cy-15);ctx.stroke();
    ctx.font='13px Consolas,monospace';ctx.textAlign='right';ctx.fillText(Math.round(p.speed*1.94384),cx-half+42,cy+4);ctx.textAlign='left';ctx.fillText(Math.round(p.y*3.28084),cx+half-54,cy+4);
    ctx.font='bold 11px Tahoma, Arial';ctx.fillText(p.g.toFixed(1)+' ج',cx-half+10,cy+47);
    ctx.restore();
  }
  function drawAttitude() {
    const p=game.plane,x=58,y=height-118,r=23;
    ctx.save();ctx.translate(x,y);ctx.strokeStyle='#edf5d07a';ctx.fillStyle='#0c160d45';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.fill();ctx.stroke();ctx.save();ctx.beginPath();ctx.arc(0,0,r-2,0,TAU);ctx.clip();ctx.rotate(-p.bank);ctx.beginPath();line(-30,p.pitch*35,30,p.pitch*35);ctx.stroke();ctx.restore();ctx.strokeStyle='#e9f1d4';ctx.beginPath();line(-14,0,-5,0);line(5,0,14,0);line(0,-4,0,4);ctx.stroke();ctx.font='bold 10px Tahoma, Arial';ctx.fillStyle='#e0e8d0b0';ctx.textAlign='center';ctx.fillText('وضع الطائرة',0,36);ctx.restore();
  }
  function drawHUD() {
    ctx.clearRect(0,0,width,height);
    if(game.view==='cockpit')drawCockpit();
    if(game.phase==='ready')return;
    const cx=width/2,cy=height/2,target=game.target||game.candidate;
    const projected=target?game.projected.find(c=>c.id===target.id):null;
    const visible=target?.alive&&projected?.visible,x=visible?projected.x:cx,y=visible?projected.y:cy;
    const half=visible?clamp(projected.size?projected.size*.95:28,26,65):23;
    const blink=Math.floor(game.renderTime*2.5)%2===0;
    const light=game.view==='pod'&&game.mode==='ir'&&game.polarity==='white';
    const ink=visible?'#000000':(light?'#080b08':'#f5f8e7'),edge=visible?'#000000':light?'#f3f6e8':'#070b07';
    const zone=aimRadius();
    // Idle square/cross never disappear. On a contact, the box follows it and
    // the surrounding cross flashes; the center pip remains the player's aim.
    ctx.save();ctx.lineJoin='miter';ctx.lineCap='square';
    if(!game.target){
      ctx.beginPath();
      for(const sx of [-1,1])for(const sy of [-1,1]){const qx=cx+sx*zone,qy=cy+sy*zone;line(qx-sx*15,qy,qx,qy);line(qx,qy,qx,qy-sy*15);}
      ctx.strokeStyle='#080e0866';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#f0f5e399';ctx.lineWidth=1.7;ctx.stroke();
    }
    ctx.beginPath();
    ctx.rect(x-half,y-half*.72,half*2,half*1.44);
    if(!visible||blink){const gap=half+11,length=visible?64:32;line(x-gap-length,y,x-gap,y);line(x+gap,y,x+gap+length,y);line(x,y-gap-length*.7,x,y-gap);line(x,y+gap,x,y+gap+length*.7);}
    ctx.strokeStyle=edge;ctx.lineWidth=8;ctx.stroke();ctx.strokeStyle=ink;ctx.lineWidth=4;ctx.stroke();
    ctx.fillStyle='#091008';ctx.fillRect(cx-3,cy-3,6,6);ctx.fillStyle='#f1f7e7';ctx.fillRect(cx-1.5,cy-1.5,3,3);
    if(visible&&!game.target&&game.acquiring===target){ctx.fillStyle='#0b100bdd';ctx.fillRect(x-35,y+half*.72+37,70,7);ctx.fillStyle='#ffe08a';ctx.fillRect(x-35,y+half*.72+37,70*clamp(game.lock,0,1),7);}
    if(game.phase==='playing'){
      const contact=target||nearest(),p=contact&&game.projected.find(v=>v.id===contact.id);
      if(contact&&(!p?.visible||p.x<25||p.x>width-25||p.y<130||p.y>height-130)){
        const a=aimAt(contact),dx=p?p.x-cx:-angle(a.yaw-angle(game.camera.yaw-game.plane.yaw)),dy=p?p.y-cy:-(a.pitch-game.camera.pitch),ang=Math.atan2(dy,dx);
        const ex=cx+Math.cos(ang)*width*.36,ey=cy+Math.sin(ang)*height*.27;
        ctx.save();ctx.translate(ex,ey);ctx.rotate(ang);ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(-9,-8);ctx.lineTo(-9,8);ctx.closePath();ctx.strokeStyle='#091008';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#e8f5cf';ctx.fill();ctx.restore();
        ctx.font='bold 16px Tahoma, Arial';ctx.textAlign='center';ctx.direction='rtl';ctx.strokeStyle='#091008';ctx.lineWidth=4;ctx.strokeText('هدف',ex,ey+28);ctx.fillStyle='#e8f5cf';ctx.fillText('هدف',ex,ey+28);
      }
    }
    const flash=game.explosions.find(e=>e.age<.22);if(flash){ctx.fillStyle='rgba(255,255,241,'+((.22-flash.age)*1.4)+')';ctx.fillRect(0,0,width,height);}
    ctx.restore();
  }
  function drawRadar() {
    const w=radar.width,h=radar.height,cx=w/2,cy=h/2+3,r=78,p=game.plane;
    rctx.clearRect(0,0,w,h);rctx.lineWidth=1;rctx.strokeStyle='#3e4b324d';
    for(let i=1;i<=3;i++){rctx.beginPath();rctx.arc(cx,cy,r*i/3,0,TAU);rctx.stroke();}
    rctx.beginPath();rctx.moveTo(cx-r,cy);rctx.lineTo(cx+r,cy);rctx.moveTo(cx,cy-r);rctx.lineTo(cx,cy+r);rctx.stroke();
    const sweep=game.renderTime*.5;
    rctx.save();rctx.translate(cx,cy);rctx.rotate(sweep);const grad=rctx.createLinearGradient(0,0,r,0);grad.addColorStop(0,'#c7e19700');grad.addColorStop(1,'#c7e1975a');rctx.strokeStyle=grad;rctx.beginPath();rctx.moveTo(0,0);rctx.lineTo(r,0);rctx.stroke();rctx.restore();
    const cone=game.view==='cockpit'?-game.look.yaw:-game.gimbal.yaw,fov=(game.view==='cockpit'?72:game.fovs[game.zoom])*DEG;rctx.beginPath();rctx.moveTo(cx,cy);rctx.arc(cx,cy,r,-Math.PI/2+cone-fov/2,-Math.PI/2+cone+fov/2);rctx.closePath();rctx.fillStyle='#c7e1970b';rctx.fill();rctx.strokeStyle='#a6c17a30';rctx.stroke();
    for(const c of game.contacts){if(!c.alive)continue;const dx=c.x-p.x,dz=c.z-p.z;let x=(dx*Math.cos(p.yaw)-dz*Math.sin(p.yaw))/8000*r,y=(dx*Math.sin(p.yaw)+dz*Math.cos(p.yaw))/8000*r;const d=Math.hypot(x,y);if(d>r){x*=r/d;y*=r/d;}const tracked=game.target===c||game.acquiring===c;rctx.strokeStyle=tracked?'#e0efb7':c.ttl<20?'#d39a7d':'#8c9f75';rctx.lineWidth=tracked?1.8:1;rctx.beginPath();rctx.moveTo(cx+x,cy+y-4);rctx.lineTo(cx+x+4,cy+y);rctx.lineTo(cx+x,cy+y+4);rctx.lineTo(cx+x-4,cy+y);rctx.closePath();rctx.stroke();}
    rctx.fillStyle='#d3e5a6';rctx.beginPath();rctx.moveTo(cx,cy-6);rctx.lineTo(cx+4,cy+4);rctx.lineTo(cx,cy+2);rctx.lineTo(cx-4,cy+4);rctx.closePath();rctx.fill();
    rctx.fillStyle='#81936c';rctx.font='bold 11px Tahoma, Arial';rctx.textAlign='center';rctx.fillText('شمال',cx,12);rctx.fillText('٨ كم',cx,h-3);
  }
  function resize() {
    const rect=scope.getBoundingClientRect();width=rect.width;height=rect.height;
    const dpr=Math.min(devicePixelRatio||1,2);hud.width=Math.round(width*dpr);hud.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);world.resize();
  }
  new ResizeObserver(resize).observe(scope);
  function frame(now) {
    const dt=Math.min((now-last)/1000,.05);last=now;
    if(game.phase==='playing')update(dt);
    if(game.phase==='playing'||game.phase==='ready')game.renderTime+=dt;
    const p=game.plane,cockpit=game.view==='cockpit';
    const vibration=game.phase==='playing'&&!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?(Math.sin(game.renderTime*49)+Math.sin(game.renderTime*71)*.4)*(.00025+p.throttle*.0004+Math.abs(p.g-1)*.0002):0;
    Object.assign(game.camera,{x:p.x,y:p.y,z:p.z,
      yaw:p.yaw+(cockpit?game.look.yaw:game.gimbal.yaw),
      pitch:(cockpit?p.pitch+game.look.pitch-.03:game.gimbal.pitch)+vibration,
      roll:cockpit?p.bank:p.bank*.08});
    try {
      const result=world.render({time:game.renderTime,dt,camera:game.camera,view:game.view,fov:cockpit?72:game.fovs[game.zoom],polarity:cockpit?'white':game.polarity,mode:cockpit?'tv':game.mode,quality:game.quality,contacts:game.contacts,explosions:game.explosions,interceptors:game.interceptors,paused:game.phase==='paused'});
      game.projected=result?.contacts||[];
    } catch(err) { console.error('Render error:',err);$('error-screen').hidden=false;return; }
    drawHUD();drawRadar();hudClock+=dt;if(hudClock>.08){updateUI();hudClock=0;}
    const signal=game.projected.filter(c=>c.visible&&game.contacts.some(t=>t.id===c.id&&t.alive)&&!game.interceptors.some(s=>s.target===c.id)).reduce((strength,c)=>Math.max(strength,clamp(1-Math.hypot(c.x-width/2,c.y-height/2)/(height*.55),0,1)),0);
    game.seekerStrength=signal;
    audio.update({speed:clamp(p.speed/370,0,1),throttle:p.throttle,load:p.g,seekerStrength:game.seekerStrength,tracking:!!game.target,acquiring:!!game.acquiring,paused:game.phase!=='playing'});
    requestAnimationFrame(frame);
  }
  reset();resize();requestAnimationFrame(frame);
})();
