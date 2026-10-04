// @ts-nocheck
/* eslint-disable */
// Landing kaydırma motoru. Havamania.dc.html içindeki düzeltilmiş sürümden birebir alındı
// (çip çarpışma payı, dinamik küçültme, sahneye özel tema, pil dostu partikül döngüsü).
// Kendi başına bir DOM motorudur; React yalnızca mount/unmount eder.

export class LandingEngine {
  constructor(el, props = {}) {
    this.el = el;
    this.props = props;
  }

  componentDidMount(){
    const root = this.el || document;
    this.root = root;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.atmosOn = this.props.atmosphere ?? true;
    this.atmosVisible = false;
    this.PHONE_MIN_SCALE = 0.5;   // patlama aninda cihazin inebilecegi en kucuk olcek
    document.documentElement.lang = document.documentElement.lang || 'tr';
    this.setupReveal();
    this.setupAtmos();
    this.setupScenes();
    this.onScroll = () => { if(!this._tick){ this._tick = true; requestAnimationFrame(()=>{ this.renderAll(); this._tick=false; }); } };
    this.onResize = () => {
      clearTimeout(this._rz);
      this._rz = setTimeout(()=>{
        this.applySceneHeights(); this.measureAll(); this.sizeCanvas();
        const wasSpring = this.theme==='spring';
        this.buildMeadow();
        if(wasSpring) this.stems.forEach(g=>g.style.transform='scaleY(1)');
        this.renderAll();
      }, 120);
      this.measureAll(); this.sizeCanvas(); this.renderAll();
    };
    addEventListener('scroll', this.onScroll, {passive:true});
    addEventListener('resize', this.onResize);
    addEventListener('orientationchange', this.onResize);
    if(window.visualViewport) visualViewport.addEventListener('resize', this.onResize);
    requestAnimationFrame(()=>{ this.measureAll(); this.renderAll(); });
  }
  componentWillUnmount(){
    removeEventListener('scroll', this.onScroll);
    removeEventListener('resize', this.onResize);
    removeEventListener('orientationchange', this.onResize);
    if(window.visualViewport) visualViewport.removeEventListener('resize', this.onResize);
    if(this.raf) cancelAnimationFrame(this.raf);
    clearTimeout(this._rz);
    if(this.io) this.io.disconnect();
  }
  componentDidUpdate(){
    // Editordeki slider'lar degisince yeniden yuklemeye gerek kalmadan
    // sahne yuksekligini ve partikul sayisini burada tazele.
    if(!this.scenes) return;
    const dens = this.props.particleDensity ?? 1;
    if(this.parts && dens !== this._dens){
      this._dens = dens;
      const n = Math.round(Math.min(220, Math.max(50, (innerWidth<640?110:220) * dens)));
      while(this.parts.length > n) this.parts.pop();
      while(this.parts.length < n) this.parts.push(this.mkP());
    }
    this.applySceneHeights();
    this.measureAll();
    this.renderAll();
  }
  q(sel, ctx){ return (ctx||this.root).querySelector(sel); }
  qa(sel, ctx){ return [...(ctx||this.root).querySelectorAll(sel)]; }

  setupReveal(){
    // Hero CSS ile acilir (LANDING_CSS); motor yalnizca kaydirinca gorunenleri yonetir.
    const els = this.qa('[data-reveal]').filter(el=>!el.closest('header'));
    els.forEach(el=>{
      el.style.transition = 'opacity .8s cubic-bezier(.22,1,.36,1), transform .8s cubic-bezier(.22,1,.36,1)';
      el.style.transitionDelay = (Number(el.dataset.delay||0)*0.08)+'s';
      if(this.reduced){ el.style.opacity=1; return; }
      el.style.opacity = 0;
      el.style.transform = 'translateY(30px)';
    });
    if(this.reduced) return;
    this.io = new IntersectionObserver(es=>es.forEach(e=>{
      if(e.isIntersecting){ e.target.style.opacity=1; e.target.style.transform='none'; this.io.unobserve(e.target); }
    }), {threshold:.14, rootMargin:'0px 0px -8% 0px'});
    els.forEach(el=>this.io.observe(el));
  }

  setupAtmos(){
    this.ATM = {
      clear:  {top:'#7ec8f0',bottom:'#d7f0ff',ambient:'rgba(255,255,255,0)',   cel:{bg:'#fff3b0',sh:'0 0 60px 20px rgba(255,240,150,.6)',top:'12%',right:'14%',op:1},   part:'none'},
      cloudy: {top:'#9db4c4',bottom:'#cdd8de',ambient:'rgba(180,190,200,.25)', cel:{bg:'#fef8d0',sh:'0 0 40px 15px rgba(255,240,150,.3)',top:'12%',right:'14%',op:.5}, part:'none'},
      rain:   {top:'#4a5a6a',bottom:'#7d8a95',ambient:'rgba(60,70,85,.35)',    cel:{bg:'#c8ccd0',sh:'none',top:'12%',right:'14%',op:.2}, part:'rain', dark:true},
      storm:  {top:'#232a35',bottom:'#3d4653',ambient:'rgba(15,20,30,.5)',     cel:{bg:'#8890a0',sh:'none',top:'12%',right:'14%',op:.1}, part:'rain', lightning:true, dark:true},
      spring: {top:'#a9e0f5',bottom:'#fdf3e7',ambient:'rgba(255,225,180,.18)', cel:{bg:'#fff6c8',sh:'0 0 70px 24px rgba(255,244,180,.75)',top:'14%',right:'16%',op:1}, part:'petals', meadow:true}
    };
    this.atmosRoot = this.q('[data-atmos-root]');
    this.skyEl = this.q('[data-sky]');
    this.ambEl = this.q('[data-ambient]');
    this.celEl = this.q('[data-celestial]');
    this.flashEl = this.q('[data-flash]');
    this.meadowEl = this.q('[data-meadow]');
    this.cv = this.q('[data-particles]');
    this.theme = ''; this.particleMode='none'; this.lightning=false;
    this.buildMeadow();
    if(!this.atmosOn){ this.atmosRoot.style.display='none'; return; }
    this.pctx = this.cv.getContext('2d');
    this.petalCols = ['#ffd6e0','#ffb3c6','#ffc8a2','#fff0b3','#ffffff'];
    this.sizeCanvas();
    const dens = this.props.particleDensity ?? 1;
    this._dens = dens;
    const n = Math.round(Math.min(220, Math.max(50, (innerWidth<640?110:220) * dens)));
    this.parts = Array.from({length:n}, ()=>this.mkP());
    this.flashT = 0;
    // Dongu kendiliginden baslamiyor; atmosfer gorunur olunca renderAll baslatir.
  }
  sizeCanvas(){
    if(!this.cv || !this.pctx) return;
    const dpr = Math.min(2, devicePixelRatio||1);
    this.CW = this.cv.clientWidth; this.CH = this.cv.clientHeight;
    this.cv.width = Math.round(this.CW*dpr); this.cv.height = Math.round(this.CH*dpr);
    this.pctx.setTransform(dpr,0,0,dpr,0,0);
  }
  mkP(){ return {x:Math.random()*(this.CW||innerWidth), y:Math.random()*-(this.CH||innerHeight), r:Math.random(), sp:Math.random(),
    rot:Math.random()*6.28, rsp:(Math.random()-.5)*.05, col:this.petalCols[(Math.random()*this.petalCols.length)|0], dr:Math.random()*6.28}; }

  buildMeadow(){
    const pal=[{p:'#ff8fab',c:'#ffd166'},{p:'#ffd6e0',c:'#ff8fab'},{p:'#c8a2ff',c:'#fff3b0'},
               {p:'#ffe066',c:'#ff9f1c'},{p:'#ffffff',c:'#ffd166'},{p:'#a0e7a0',c:'#ffe066'}];
    // viewBox genişliğini kapsayıcı oranına göre üret → hiçbir ekranda kırpılma yok
    const box=this.meadowEl.getBoundingClientRect();
    const H=320, W=Math.max(600, Math.round(H*(box.width/Math.max(1,box.height))));
    this.meadowEl.setAttribute('viewBox','0 0 '+W+' '+H);
    let s='', N=Math.max(7, Math.round(W/120));
    for(let i=0;i<N;i++){
      const x=W/(N)*(i+.5)+(Math.random()*40-20), gY=320;
      const h=150+Math.random()*80, tY=gY-h, bend=Math.random()*36-18;
      const c=pal[i%pal.length], sc=.8+Math.random()*.5, r=16*sc;
      s+='<g data-stem style="transform-box:fill-box;transform-origin:bottom center;transform:scaleY(0);transition:transform 1.3s cubic-bezier(.34,1.4,.5,1) '+(Math.random()*.4).toFixed(2)+'s">';
      s+='<path d="M '+x+' '+gY+' Q '+(x+bend)+' '+((gY+tY)/2)+' '+(x+bend)+' '+tY+'" stroke="#4c9a54" stroke-width="'+(3.2*sc)+'" fill="none" stroke-linecap="round"/>';
      s+='<path d="M '+(x+bend*.5)+' '+(tY+h*.45)+' q '+(18*sc)+' -'+(8*sc)+' '+(26*sc)+' '+(6*sc)+' q -'+(14*sc)+' '+(10*sc)+' -'+(26*sc)+' -'+(6*sc)+' z" fill="#5cb35f"/>';
      const cx=x+bend, cy=tY; let pet='';
      for(let k=0;k<8;k++){ const a=k/8*Math.PI*2, px=cx+Math.cos(a)*r*.9, py=cy+Math.sin(a)*r*.9;
        pet+='<ellipse cx="'+px+'" cy="'+py+'" rx="'+(r*.55)+'" ry="'+(r*.28)+'" transform="rotate('+(a*180/Math.PI)+' '+px+' '+py+')" fill="'+c.p+'"/>'; }
      s+='<g style="transform-box:fill-box;transform-origin:bottom center;animation:breeze '+(4.5+Math.random()*1.4).toFixed(1)+'s ease-in-out infinite">'+pet+'<circle cx="'+cx+'" cy="'+cy+'" r="'+(r*.5)+'" fill="'+c.c+'"/></g></g>';
    }
    s+='<path d="M0 320 L0 292 Q '+(W*.25)+' 268 '+(W*.5)+' 288 T '+W+' 284 L'+W+' 320 Z" fill="#5cb35f" opacity=".95"/>';
    this.meadowEl.innerHTML=s;
    this.stems=[...this.meadowEl.querySelectorAll('[data-stem]')];
  }

  applyTheme(name, sceneEl){
    const t=this.ATM[name];
    if(!t) return;
    // Ayni tema baska bir sahnede de gecerli olabilir. Metin renkleri sahneye
    // ozel yazildigi icin sahne degistiyse yeniden uygulamak gerekir.
    if(name===this.theme && sceneEl===this.themeScene) return;
    this.theme=name; this.themeScene=sceneEl;
    this.skyEl.style.background='linear-gradient(to bottom,'+t.top+','+t.bottom+')';
    this.ambEl.style.background=t.ambient;
    Object.assign(this.celEl.style,{background:t.cel.bg,boxShadow:t.cel.sh,top:t.cel.top,right:t.cel.right,opacity:t.cel.op});
    const show=!!t.meadow;
    this.meadowEl.style.opacity=show?1:0;
    this.meadowEl.style.transform=show?'translateY(0)':'translateY(40px)';
    this.stems.forEach(g=>g.style.transform='scaleY('+(show?1:0)+')');
    this.particleMode=t.part; this.lightning=!!t.lightning;
    const dark=!!t.dark;
    this.qa('[data-capt]', sceneEl).forEach(el=>{ el.style.color=dark?'#fff':'#1d1d1f'; el.style.textShadow=dark?'0 2px 18px rgba(0,0,0,.45)':'none'; });
    // Ust baslik sahne vurgusu renginde yazili; koyu temada okunmuyordu, acik tona gecer.
    this.qa('[data-ey]', sceneEl).forEach(el=>{ el.dataset.accent=el.dataset.accent||el.style.color; el.style.color=dark?'rgba(255,255,255,.82)':el.dataset.accent; el.style.textShadow=dark?'0 1px 10px rgba(0,0,0,.45)':'none'; });
    this.qa('[data-caps]', sceneEl).forEach(el=>{ el.style.color=dark?'rgba(255,255,255,.86)':'#5c5c61'; el.style.textShadow=dark?'0 1px 10px rgba(0,0,0,.45)':'none'; });
    if(sceneEl) sceneEl.__dark = dark;
    this.dark=dark;
  }

  startLoop(){ if(!this.raf && !this.reduced && this.atmosOn) this.loop(); }
  loop(){
    const c=this.pctx;
    // Atmosfer gorunmuyorsa ya da cizilecek bir sey yoksa donguyu tamamen
    // durdur (mobilde bosuna pil yakmasin); renderAll gerektiginde uyandirir.
    if(!c || !this.atmosVisible || (this.particleMode==='none' && !this.lightning)){
      this.raf=null;
      if(c) c.clearRect(0,0,this.CW,this.CH);
      return;
    }
    this.raf=requestAnimationFrame(()=>this.loop());
    c.clearRect(0,0,this.CW,this.CH);
    const P=this.parts, m=this.particleMode;
    if(m==='rain'){
      c.strokeStyle='rgba(174,194,224,.6)'; c.lineWidth=1.5;
      P.forEach(p=>{ const l=15+p.sp*15, s=12+p.sp*10;
        c.beginPath(); c.moveTo(p.x,p.y); c.lineTo(p.x-2,p.y+l); c.stroke();
        p.y+=s; p.x-=1.5; if(p.y>this.CH){p.y=-20;p.x=Math.random()*this.CW;} });
    } else if(m==='petals'){
      P.forEach(p=>{ const sz=5+p.r*6; p.rot+=p.rsp; p.dr+=.02;
        c.save(); c.translate(p.x,p.y); c.rotate(p.rot); c.scale(1,.55+Math.abs(Math.sin(p.dr))*.45);
        c.fillStyle=p.col; c.globalAlpha=.9; c.beginPath();
        c.moveTo(0,-sz); c.bezierCurveTo(sz*.9,-sz*.4,sz*.9,sz*.4,0,sz);
        c.bezierCurveTo(-sz*.9,sz*.4,-sz*.9,-sz*.4,0,-sz); c.fill(); c.restore();
        p.y+=.6+p.sp*.9; p.x+=Math.sin(p.dr)*1.1; if(p.y>this.CH+10){p.y=-15;p.x=Math.random()*this.CW;} });
      c.globalAlpha=1;
    }
    if(this.lightning){ this.flashT--;
      if(this.flashT<=0 && Math.random()<.012){
        const f=this.flashEl; f.style.opacity=.85;
        setTimeout(()=>f.style.opacity=0,80);
        setTimeout(()=>{f.style.opacity=.6; setTimeout(()=>f.style.opacity=0,60);},160);
        this.flashT=120;
      } }
  }

  applySceneHeights(){
    const stretch = this.props.scrollLength ?? 1;
    const narrow = innerWidth < 760;
    this.qa('[data-scene]').forEach(scene=>{
      const base = Number(scene.dataset.baseVh||420);
      scene.style.height = Math.round(base * (narrow?0.72:1) * stretch)+'vh';
    });
  }
  setupScenes(){
    this.applySceneHeights();
    this.scenes = this.qa('[data-scene]').map(scene=>{
      const o = {
        el: scene,
        caps: this.qa('[data-layer]', scene),
        dots: this.qa('[data-dots] i', scene),
        chips: this.qa('[data-chip]', scene),
        slots: this.qa('[data-slot]', scene),
        reel: this.q('[data-reel]', scene),
        pin: this.q('[data-pin]', scene),
        stage: this.q('[data-stage]', scene),
        phone: this.q('[data-phone]', scene),
        accent: scene.dataset.accent||'#0071e3',
        atm: (scene.dataset.atmos||'').split(',').filter(Boolean),
        targets: []
      };
      o.screens = Math.max(2, o.reel ? o.reel.children.length : 3);
      if(o.atm.length && this.atmosOn){
        // atmosfer açıkken sahnenin kendi degradesi şeffaf olur ki arka plan görünsün
        o.pin.style.background='transparent';
        scene.style.background='transparent';
      }
      return o;
    });
    this.burst = [
      {x:-.36,y:-.34,r:-12,s:1.15},{x:.36,y:-.37,r:10,s:1.10},
      {x:-.42,y:.04,r:-6,s:1.05}, {x:.42,y:.07,r:8,s:1.12},
      {x:-.32,y:.38,r:14,s:1.00}, {x:.34,y:.40,r:-10,s:1.08}
    ];
    this.measureAll();
  }

  /* chip hedefleri: telefon içindeki gerçek hücre merkezlerinden ölçülür → her ekran boyutunda doğru */
  measureAll(){
    if(!this.scenes) return;
    this.scenes.forEach(o=>{
      const st=o.stage.getBoundingClientRect();
      const cx=st.left+st.width/2, cy=st.top+st.height/2;
      o.stageW=st.width; o.stageH=st.height;
      o.targets=o.slots.map(s=>{ const r=s.getBoundingClientRect();
        return {x:r.left+r.width/2-cx, y:r.top+r.height/2-cy}; });
      // Patlama aninda cipe scale(1..1.15) + rotate uygulaniyor; ekranda kapladigi
      // alan layout kutusundan buyuk. Guvenli payi dondurulmus ve olceklenmis
      // sinirlayici kutudan hesapla, ikon rozetinin tasmasini da ekle.
      o.chipW=o.chips.reduce((m,c)=>Math.max(m,c.offsetWidth),0);
      o.chipH=o.chips.reduce((m,c)=>Math.max(m,c.offsetHeight),0);
      const maxS=this.burst.reduce((m,b)=>Math.max(m,b.s),1);
      const maxR=this.burst.reduce((m,b)=>Math.max(m,Math.abs(b.r)),0)*Math.PI/180;
      const co=Math.abs(Math.cos(maxR)), si=Math.abs(Math.sin(maxR));
      const OVER=10, GAP=8;               // ikon rozeti tasmasi + nefes payi
      o.hitW=(o.chipW*co + o.chipH*si)*maxS + OVER*2;
      o.hitH=(o.chipH*co + o.chipW*si)*maxS + OVER*2;
      o.rx=Math.max(0, st.width/2  - o.hitW/2);
      o.ry=Math.max(0, st.height/2 - o.hitH/2);
      // telefonu kapatmasinlar. offsetWidth/Height kullan; getBoundingClientRect
      // o an uygulanmis scale'i icerir ve olcumu bozar.
      o.phoneHalfW=o.phone.offsetWidth/2; o.phoneHalfH=o.phone.offsetHeight/2;
      // Cihaz sahnenin tam ortasinda DEGIL: ustunde baslik blogu, altinda nokta
      // gostergesi var. Cipler sahne merkezine gore konumlandigi icin bu kaymayi
      // hesaba katmazsak dikey pay yanlis tarafa harcanir.
      o.phoneCX=(o.phone.offsetLeft + o.phone.offsetWidth/2)  - o.stage.offsetWidth/2;
      o.phoneCY=(o.phone.offsetTop  + o.phone.offsetHeight/2) - o.stage.offsetHeight/2;
      const BURST_POP=1.035;              // patlama aninda cihazin normal buyumesi
      const need=sw=>({x:o.phoneHalfW*sw + o.hitW/2 + GAP, y:o.phoneHalfH*sw + o.hitH/2 + GAP});
      const fits=()=>{ o.clearX = o.rx >= o.minX + Math.abs(o.phoneCX);
                       o.clearY = o.ry >= o.minY + Math.abs(o.phoneCY); };
      o.phoneScale=BURST_POP;
      let need0=need(o.phoneScale);
      o.minX=need0.x; o.minY=need0.y; fits();
      if(!o.clearX && !o.clearY){
        // Hic yer yok: sabit bir oranla degil, tam gerektigi kadar kucult.
        // Iki eksen icin gereken olcegi coz, daha az kucultme isteyeni sec.
        const swX=(o.rx - o.hitW/2 - GAP - Math.abs(o.phoneCX))/Math.max(1,o.phoneHalfW);
        const swY=(o.ry - o.hitH/2 - GAP - Math.abs(o.phoneCY))/Math.max(1,o.phoneHalfH);
        o.phoneScale=Math.max(this.PHONE_MIN_SCALE, Math.min(BURST_POP, Math.max(swX,swY)));
        need0=need(o.phoneScale);
        o.minX=need0.x; o.minY=need0.y; fits();
      }
      o.shrinkPhone = o.phoneScale < BURST_POP;
    });
  }

  renderAll(){
    const lerp=(a,b,t)=>a+(b-a)*t;
    const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
    const easeOut=t=>1-Math.pow(1-t,3);
    const easeInOut=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    const vh=innerHeight;
    let pinnedAny=false;
    this.scenes.forEach(o=>{
      const r=o.el.getBoundingClientRect();
      const total=Math.max(1,o.el.offsetHeight-vh);
      const p=clamp((-r.top)/total);
      const visible = r.bottom>0 && r.top<vh;
      if(!visible) return;
      const pinned = r.top<=1 && r.bottom>=vh-1;
      if(o.atm.length && this.atmosOn && pinned){
        pinnedAny=true;
        this.atmosRoot.style.opacity=1;
        this.atmosVisible=true;
        this.applyTheme(o.atm[Math.min(o.atm.length-1, Math.floor(p*o.atm.length))], o.el);
        this.startLoop();
      }
      let assemble;
      if(p<0.10) assemble=easeOut(clamp(p/0.10));
      else if(p<0.34) assemble=1-easeInOut(clamp((p-0.10)/0.24));
      else assemble=0;

      o.chips.forEach((chip,i)=>{
        const b=this.burst[i], t=o.targets[i]||{x:0,y:0};
        const sx=b.x<0?-1:1, sy=b.y<0?-1:1;
        // fraksiyonlar TAM sahne genişliğine göre; sonra güvenli yarıçapa kırpılır
        let ax=Math.min(Math.abs(b.x)*o.stageW, o.rx);
        let ay=Math.min(Math.abs(b.y)*o.stageH, o.ry);
        // Cihazin merkez kaymasi yonune gore farkli pay gerektirir.
        if(o.clearX) ax=Math.max(ax, o.minX + sx*o.phoneCX);  // cihazın yanından geç
        else if(o.clearY) ay=Math.max(ay, o.minY + sy*o.phoneCY); // yer yoksa üstünden/altından
        const bx=sx*ax, by=sy*ay;
        const cxp=lerp(t.x, bx, assemble), cyp=lerp(t.y, by, assemble);
        const rot=lerp(0,b.r,assemble), sc=lerp(0.34,b.s,assemble);
        chip.style.transform='translate(-50%,-50%) translate('+cxp+'px,'+cyp+'px) rotate('+rot+'deg) scale('+sc+')';
        chip.style.opacity = assemble<0.06 ? 0 : 1;
        const slot=o.slots[i];
        if(slot){
          const lit = assemble<0.4 && assemble>0.02 && p>0.10;
          slot.style.background = lit?'rgba(255,255,255,.32)':'rgba(255,255,255,.14)';
          slot.style.boxShadow = lit?'0 0 0 1px rgba(255,255,255,.55)':'none';
        }
      });

      const n=o.screens;
      let reelPct=0;
      if(p>0.34){
        const seg=(p-0.34)/0.66, pos=seg*(n-1);
        const idx=Math.min(n-2,Math.floor(pos)), fr=clamp(pos-idx);
        reelPct=-(idx*100 + easeInOut(fr)*100);
      }
      o.reel.style.transform='translateY('+reelPct+'%)';
      const active=Math.min(n-1, Math.round(-reelPct/100));
      // dar/kısa ekranda çiplere yer açmak için cihaz patlama anında küçülür
      const ps = lerp(1, o.phoneScale, assemble);
      o.phone.style.transform='scale('+ps+')';

      const capIdx = p<0.10 ? 0 : (p<0.34 ? 1 : Math.min(o.caps.length-1, 1+active));
      o.caps.forEach((c,i)=>{
        const on=i===capIdx;
        c.style.opacity=on?1:0;
        c.style.visibility=on?'visible':'hidden';
        c.style.transform=on?'translateY(0)':'translateY(8px)';
        c.style.transitionDelay=on?'0s':'0s';
      });
      const dk=!!o.el.__dark;
      o.dots.forEach((d,i)=>{
        const on=i===active;
        d.style.width=on?'22px':'7px';
        d.style.borderRadius=on?'4px':'50%';
        d.style.background=on?(dk?'#fff':o.accent):(dk?'rgba(255,255,255,.35)':'#d2d2d7');
      });
    });
    if(!pinnedAny && this.atmosOn){ this.atmosRoot.style.opacity=0; this.atmosVisible=false; }
  }
}
