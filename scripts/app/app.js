// Custom prompt dialog for Electron (native prompt() may not work)
function customPrompt(msg, defaultVal) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('customPromptOverlay');
    const input = document.getElementById('customPromptInput');
    const msgEl = document.getElementById('customPromptMsg');
    if (!overlay || !input || !msgEl) { resolve(prompt(msg, defaultVal)); return; }
    msgEl.textContent = msg;
    input.value = defaultVal || '';
    overlay.style.display = 'flex';
    input.focus();
    input.select();
    function cleanup() { overlay.style.display = 'none'; input.removeEventListener('keydown', onKey); }
    function onKey(e) {
      if (e.key === 'Enter') { cleanup(); resolve(input.value); }
      else if (e.key === 'Escape') { cleanup(); resolve(null); }
    }
    input.addEventListener('keydown', onKey);
    document.getElementById('customPromptOk').onclick = () => { cleanup(); resolve(input.value); };
    document.getElementById('customPromptCancel').onclick = () => { cleanup(); resolve(null); };
  });
}

const SIZES = {
  "50mm × 25mm":  [50, 25],
  "75mm × 37mm":  [75, 37],
  "100mm × 50mm": [100, 50],
  "Custom…":      null,
};
const UNITS = { "mm": 1, "in": 25.4 };
const FONTS = { "Helvetica": "helvetica", "Times": "times", "Courier": "courier" };
const ALIGNS = { "Center": "center", "Left": "left", "Right": "right" };
const PREVIEW_FONTS = { "Helvetica":"Arial, Helvetica, sans-serif", "Times":"Georgia, 'Times New Roman', serif", "Courier":"'Courier New', Courier, monospace" };

let state = {
  bulkMode: false,
  dataSourceMode: 'excel',
  format: null,
  size:   Object.keys(SIZES)[0],
  file:   null,
  fileName: null,
  manualRows: [],
  previewRows: [],
  qrField: null,
  codeType: 'qr',
  qrErrorCorrection: 'M',
  layout: 'One label per page',
  unit: 'mm',
  customW: 50,
  customH: 25,
  customLines: 2,
  customCols: 2,
  customRows: 2,
  customGap: 2,
  design: {
    font: 'Helvetica',
    align: 'Center',
    bold: true,
    italic: false,
    underline: false,
    color: '#000000',
    border: false,
    borderColor: '#666666',
    radius: 0,
    rotate: false,
    useCanvas: true,
    fontSize: 0,
    barcodeDisplayValue: false,
  },
  canvasElements: null,
  serialize: { enabled:false, fieldIdx:null, start:1, step:1, pad:4, prefix:'', suffix:'' },
  exportFormat: 'PDF (sheet)',
  dpi: '203 dpi (standard)',
  exportMargin: 10,
  showCutMarks: true,
  usageOptIn: localStorage.getItem('sticker_usage_optin') === 'true',
};

// ponytail: moved up from below dsgUpdateHistoryButtons() - updateLock()/checkLegibility() call
// syncCanvasElements() near line 1040, which read dsgSizeMm before its old `let` declaration
// executed (TDZ ReferenceError). These have zero dependency on anything else in the file besides
// the DOM, which is already parsed since this script runs at end of body - safe to init this early.
const designerOverlay = document.getElementById('designerOverlay');
const designerStage    = document.getElementById('designerStage');
let dsgScale = 6;
let dsgFitScale = 6;
let dsgSizeMm = [50,25];
let dsgSelectedIdx = null;
let dsgSelectedIdxs = new Set();
let dsgClipboard = null;
let dsgDragSrcIdx = null;

const curveCtrl = (function(){
  const canvas=document.getElementById('curveCanvas');
  const ctx=canvas.getContext('2d');
  let t=0,pct=0,target=0,running=true;
  const DPR=window.devicePixelRatio||1;
  function resize(){
    canvas.width=canvas.offsetWidth*DPR;canvas.height=canvas.offsetHeight*DPR;
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  resize();window.addEventListener('resize',resize);

  function wave(tOff,amp,phase){
    const pts=[],W=canvas.offsetWidth,H=canvas.offsetHeight;
    for(let i=0;i<=120;i++){
      const xf=i/120,x=xf*W;
      const y=H/2+amp*Math.sin(xf*Math.PI*3+tOff+phase)
        +amp*.4*Math.sin(xf*Math.PI*5.5-tOff*1.3+phase)
        +amp*.2*Math.sin(xf*Math.PI*9+tOff*.7+phase);
      pts.push([x,y]);
    }
    return pts;
  }
  function draw(){
    const W=canvas.offsetWidth,H=canvas.offsetHeight;
    ctx.clearRect(0,0,W,H);
    pct+=(target-pct)*.05;
    const fillX=pct*W;
    const track=wave(t,4,0);
    const filled=track.filter(([x])=>x<=fillX);
    const ripple=wave(t*1.4,7,1.2).filter(([x])=>x<=fillX);
    ctx.beginPath();track.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.strokeStyle='rgba(74,64,50,.2)';ctx.lineWidth=1.5;ctx.stroke();
    if(filled.length>1){
      const g=ctx.createLinearGradient(0,0,fillX,0);
      g.addColorStop(0,'rgba(74,64,50,.5)');g.addColorStop(.6,'rgba(74,64,50,.8)');g.addColorStop(1,'#4A4032');
      ctx.beginPath();filled.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
      ctx.strokeStyle=g;ctx.lineWidth=2.5;ctx.stroke();
      ctx.beginPath();filled.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
      ctx.strokeStyle='rgba(74,64,50,.3)';ctx.lineWidth=6;ctx.stroke();
    }
    if(ripple.length>1){
      ctx.beginPath();ripple.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
      ctx.strokeStyle='rgba(74,64,50,.4)';ctx.lineWidth=1;ctx.stroke();
    }
    if(filled.length>0){
      const[ex,ey]=filled[filled.length-1];
      const h=ctx.createRadialGradient(ex,ey,0,ex,ey,18);
      h.addColorStop(0,'rgba(74,64,50,.7)');h.addColorStop(.5,'rgba(74,64,50,.35)');h.addColorStop(1,'transparent');
      ctx.fillStyle=h;ctx.beginPath();ctx.arc(ex,ey,18,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#4A4032';ctx.beginPath();ctx.arc(ex,ey,4.5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#4A4032';ctx.beginPath();ctx.arc(ex,ey,1.8,0,Math.PI*2);ctx.fill();
    }
    t+=.04;requestAnimationFrame(draw);
  }
  draw();
  return { setTarget:(v)=>{target=Math.max(0,Math.min(1,v));}, resize };
})();

document.getElementById('curveWrap').addEventListener('transitionend', (e)=>{
  if(e.propertyName === 'max-height') curveCtrl.resize();
});

function buildDropdown(selectEl, optionsEl, labelEl, optionsMap, stateKey){
  const rowEl = selectEl.closest('.form-row');
  function render(){
    optionsEl.innerHTML='';
    Object.keys(optionsMap).forEach(key=>{
      const opt=document.createElement('div');
      opt.className='g-opt'+(key===state[stateKey]?' active':'');
      opt.textContent=key;
      opt.addEventListener('click',(e)=>{
        e.stopPropagation();
        state[stateKey]=key;
        labelEl.textContent=key;
        labelEl.classList.remove('ph');
        selectEl.classList.add('filled');
        closeAll();
        render();
        if(stateKey==='size'){
          const row=document.getElementById('customSizeRow');
          if(row) row.style.display = (key==='Custom…') ? 'flex' : 'none';
          syncExportFormatUI();
        }
        checkLegibility();
      });
      optionsEl.appendChild(opt);
    });
  }
  render();
  selectEl.addEventListener('click',(e)=>{
    e.stopPropagation();
    const isOpen=selectEl.classList.contains('open');
    closeAll();
    if(!isOpen){
      selectEl.classList.add('open');
      optionsEl.classList.add('open');
      if(rowEl) rowEl.classList.add('row-active');
      positionOpenDropdowns();
    }
  });
}
function positionOpenDropdowns(){
  document.querySelectorAll('.g-options.open').forEach(opt=>{
    const sel=opt.closest('.g-select');
    if(!sel) return;
    const r=sel.getBoundingClientRect();
    opt.style.position='fixed';
    opt.style.left=r.left+'px';
    opt.style.top=(r.bottom+4)+'px';
    opt.style.width=r.width+'px';
    opt.style.zIndex='9999';
  });
}
function closeAll(){
  document.querySelectorAll('.g-select').forEach(s=>s.classList.remove('open'));
  document.querySelectorAll('.g-options').forEach(o=>{o.classList.remove('open');o.style.position='';o.style.left='';o.style.top='';o.style.width='';o.style.zIndex='';});
  document.querySelectorAll('.form-row').forEach(r=>r.classList.remove('row-active'));
}
document.addEventListener('click', closeAll);
document.querySelector('.sidebar-col').addEventListener('scroll', positionOpenDropdowns);

buildDropdown(
  document.getElementById('sizeSelect'), document.getElementById('sizeOptions'),
  document.getElementById('sizeLabel'), SIZES, 'size'
);

function updateLock(){
  const locked = state.previewRows.length===0;
  ['qrRow','layoutRow','serializeRow'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.classList.toggle('locked', locked);
  });
  const hint = document.getElementById('lockHint');
  if(hint) hint.classList.toggle('show', locked);
  const n = currentFormat().lines;
  const mt = document.getElementById('manualText');
  if(mt) mt.placeholder = `${Array.from({length:n},(_,i)=>'TEXT '+(i+1)).join(', ')}\nOne sticker per line`;
}
updateLock();
checkLegibility();

const presetSelect = document.getElementById('presetSelect');
const presetOptions = document.getElementById('presetOptions');
const presetLabel = document.getElementById('presetLabel');
const presetSaveBtn = document.getElementById('presetSaveBtn');

function loadPresets(){
  try{ return JSON.parse(localStorage.getItem('sticker_presets')||'{}'); }
  catch(e){ return {}; }
}
function savePresets(p){
  localStorage.setItem('sticker_presets', JSON.stringify(p));
}
function renderPresets(){
  const presets = loadPresets();
  presetOptions.innerHTML='';
  const names = Object.keys(presets);
  if(names.length===0){
    const empty=document.createElement('div');
    empty.className='g-opt';
    empty.style.color='var(--text-muted)';
    empty.style.cursor='default';
    empty.textContent='No presets saved yet';
    presetOptions.appendChild(empty);
    return;
  }
  names.forEach(name=>{
    const opt=document.createElement('div');
    opt.className='g-opt';
    opt.style.display='flex';
    opt.style.justifyContent='space-between';
    opt.style.alignItems='center';
    const label=document.createElement('span');
    label.textContent=name;
    const del=document.createElement('span');
    del.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    del.style.cssText='display:inline-flex;align-items:center;color:var(--red-ink);padding-left:10px;flex-shrink:0;cursor:pointer';
    del.addEventListener('click',(e)=>{
      e.stopPropagation();
      const p=loadPresets();
      delete p[name];
      savePresets(p);
      renderPresets();
    });
    opt.appendChild(label);
    opt.appendChild(del);
    opt.addEventListener('click',()=>{
      const p=loadPresets()[name];
      if(!p) return;
      state.size=p.size;
      document.getElementById('sizeLabel').textContent=p.size;
      document.querySelectorAll('#sizeOptions .g-opt').forEach(o=>
        o.classList.toggle('active', o.textContent===p.size));
      if(p.unit) state.unit = p.unit;
      if(p.customW!=null){ state.customW = p.customW; document.getElementById('customW').value = p.customW; }
      if(p.customH!=null){ state.customH = p.customH; document.getElementById('customH').value = p.customH; }
      document.getElementById('customSizeRow').style.display = (p.size==='Custom…') ? 'flex' : 'none';
      if(p.layout){
        state.layout = p.layout;
        document.getElementById('layoutLabel').textContent = p.layout;
        document.querySelectorAll('#layoutOptions .g-opt').forEach(o=>
          o.classList.toggle('active', o.textContent===p.layout));
        document.getElementById('customLayoutRow').style.display = (p.layout==='Custom…') ? 'flex' : 'none';
      }
      if(p.customCols!=null){ state.customCols=p.customCols; document.getElementById('customCols').value=p.customCols; }
      if(p.customRows!=null){ state.customRows=p.customRows; document.getElementById('customRows').value=p.customRows; }
      if(p.customGap!=null){ state.customGap=p.customGap; document.getElementById('customGap').value=p.customGap; }
      if(p.design){
        Object.assign(state.design, p.design);
        document.getElementById('fontLabel').textContent = state.design.font;
        document.querySelectorAll('#alignGroup .align-btn').forEach(b=>b.classList.toggle('active', b.dataset.align===state.design.align));
        document.getElementById('boldBtn').classList.toggle('active', !!state.design.bold);
        document.getElementById('italicBtn').classList.toggle('active', !!state.design.italic);
        document.getElementById('underlineBtn').classList.toggle('active', !!state.design.underline);
        document.getElementById('textColor').value = state.design.color || '#000000';
        document.getElementById('textColorHex').value = state.design.color || '#000000';
        document.getElementById('borderToggle').checked = !!state.design.border;
        document.getElementById('borderColor').value = state.design.borderColor;
        document.getElementById('radiusInput').value = state.design.radius;
        document.getElementById('fontSizeInput').value = state.design.fontSize > 0 ? state.design.fontSize : '';
        document.getElementById('rotateToggle').checked = !!state.design.rotate;
      }
      if(p.canvasElements) state.canvasElements = JSON.parse(JSON.stringify(p.canvasElements));
      state.qrField = (p.qrField!==undefined && p.qrField!==null) ? p.qrField : null;
      state.codeType = p.codeType || 'qr';
      state.qrErrorCorrection = p.qrErrorCorrection || 'M';
      state.exportMargin = (p.exportMargin!==undefined && p.exportMargin!==null) ? p.exportMargin : 10;
      state.showCutMarks = (p.showCutMarks!==undefined) ? !!p.showCutMarks : true;
      document.getElementById('exportMarginInput').value = state.exportMargin;
      document.getElementById('showCutMarksToggle').checked = state.showCutMarks;
      qrLabel.textContent = (state.qrField!==null && currentFormat().cols[state.qrField]!==undefined)
        ? `Field ${state.qrField+1}  —  ${currentFormat().cols[state.qrField]}` : 'None';
      codeTypeLabel.textContent = (CODE_TYPES[state.codeType] || CODE_TYPES.qr).label;
      qrEccLabel.textContent = QR_ECC_LEVELS[state.qrErrorCorrection] || QR_ECC_LEVELS.M;
      syncExportFormatUI();
      document.getElementById('displayValueToggle').checked = !!state.design.barcodeDisplayValue;
      if(p.serialize){
        state.serialize = { enabled:false, fieldIdx:null, start:1, step:1, pad:4, prefix:'', suffix:'', ...p.serialize };
        const fieldCount = currentFormat().cols.length;
        if(state.serialize.fieldIdx!==null && state.serialize.fieldIdx>=fieldCount) state.serialize.fieldIdx = null;
        if(state.serialize.fieldIdx===null) state.serialize.enabled = false;
      } else {
        state.serialize = { enabled:false, fieldIdx:null, start:1, step:1, pad:4, prefix:'', suffix:'' };
      }
      document.getElementById('serializeToggle').checked = state.serialize.enabled;
      document.getElementById('serializePanel').style.display = state.serialize.enabled ? 'flex' : 'none';
      document.getElementById('serializeStart').value = state.serialize.start;
      document.getElementById('serializeStep').value = state.serialize.step;
      document.getElementById('serializePad').value = state.serialize.pad;
      document.getElementById('serializePrefix').value = state.serialize.prefix;
      document.getElementById('serializeSuffix').value = state.serialize.suffix;
      serializeFieldLabel.textContent = (state.serialize.fieldIdx!==null)
        ? `Field ${state.serialize.fieldIdx+1}  —  ${currentFormat().cols[state.serialize.fieldIdx]}` : 'Field 1';
      presetLabel.textContent=name; presetLabel.classList.remove('ph');
      updateLock();
      setTimeout(()=>{
        if(typeof buildQrOptions==='function') buildQrOptions();
        if(typeof buildCodeTypeOptions==='function') buildCodeTypeOptions();
        if(typeof buildSerializeFieldOptions==='function') buildSerializeFieldOptions();
        syncCodeTypeRowVisibility();
        updateSerializeSample();
        checkLegibility();
        renderPreview();
      },0);
      closeAll();
      setStatus(`Loaded preset: ${name}`, '#4A4032');
    });
    presetOptions.appendChild(opt);
  });
}
renderPresets();

const presetRowEl = presetSelect.closest('.form-row');
presetSelect.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen=presetSelect.classList.contains('open');
  closeAll();
  if(!isOpen){
    presetSelect.classList.add('open');
    presetOptions.classList.add('open');
    if(presetRowEl) presetRowEl.classList.add('row-active');
  }
});

presetSaveBtn.addEventListener('click', async ()=>{
  const name = await customPrompt('Name this preset (e.g. "School ID Tags"):');
  if(!name || !name.trim()) return;
  const p = loadPresets();
  p[name.trim()] = {
    format: state.format, size: state.size,
    unit: state.unit, customW: state.customW, customH: state.customH, customLines: state.customLines,
    layout: state.layout, customCols: state.customCols, customRows: state.customRows, customGap: state.customGap,
    qrField: state.qrField, codeType: state.codeType, qrErrorCorrection: state.qrErrorCorrection,
    exportMargin: state.exportMargin, showCutMarks: state.showCutMarks,
    serialize: { ...state.serialize },
    design: { ...state.design },
    canvasElements: state.canvasElements ? JSON.parse(JSON.stringify(state.canvasElements)) : null,
  };
  savePresets(p);
  presetLabel.textContent = name.trim(); presetLabel.classList.remove('ph');
  renderPresets();
  setStatus(`Saved preset: ${name.trim()}`, '#4A4032');
});

document.getElementById('presetExportBtn').addEventListener('click', ()=>{
  const presets = loadPresets();
  const names = Object.keys(presets);
  if(!names.length){ setStatus('No presets to export', '#A83232'); return; }
  const blob = new Blob([JSON.stringify(presets, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sticker_presets_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${names.length} preset${names.length===1?'':'s'}`, '#4A4032');
});

document.getElementById('presetImportBtn').addEventListener('click', ()=>{
  document.getElementById('presetImportInput').click();
});

document.getElementById('presetImportInput').addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  try{
    const text = await f.text();
    const imported = JSON.parse(text);
    if(typeof imported !== 'object' || imported === null) throw new Error('Invalid format');
    const existing = loadPresets();
    let count = 0;
    for(const key of Object.keys(imported)){
      if(!existing[key]){ existing[key] = imported[key]; count++; }
    }
    savePresets(existing);
    renderPresets();
    setStatus(`Imported ${count} new preset${count===1?'':'s'} (duplicates skipped)`, '#4A4032');
  }catch(err){
    setStatus(`Import failed: ${err.message||err}`, '#A83232');
  }
  e.target.value = '';
});

const qrSelect  = document.getElementById('qrSelect');
const qrOptions = document.getElementById('qrOptions');
const qrLabel   = document.getElementById('qrLabel');
const qrRowEl   = qrSelect.closest('.form-row');

const CODE_TYPES = {
  qr:      { label:'QR Code', family:'square', bcFormat:null },
  code128: { label:'Code128 (Barcode)', family:'linear', bcFormat:'CODE128' },
  code39:  { label:'Code39 (Barcode)',  family:'linear', bcFormat:'CODE39' },
  ean13:   { label:'EAN-13 (Barcode)',  family:'linear', bcFormat:'EAN13' },
  upc:     { label:'UPC-A (Barcode)',   family:'linear', bcFormat:'UPC' },
};
const codeTypeRowEl = document.getElementById('codeTypeRow');
const displayValueRowEl = document.getElementById('displayValueRow');
function syncCodeTypeRowVisibility(){
  const hasQR = state.qrField!==null;
  codeTypeRowEl.style.display = hasQR ? 'flex' : 'none';
  const family = (CODE_TYPES[state.codeType] || CODE_TYPES.qr).family;
  displayValueRowEl.style.display = (hasQR && family==='linear') ? 'flex' : 'none';
  const eccRow = document.getElementById('qrEccRow');
  if(eccRow) eccRow.style.display = (hasQR && family==='square') ? 'flex' : 'none';
}

function buildQrOptions(){
  qrOptions.innerHTML='';
  const none = document.createElement('div');
  none.className='g-opt'+(state.qrField===null?' active':'');
  none.textContent='None';
  none.addEventListener('click',(e)=>{
    e.stopPropagation();
    state.qrField=null;
    qrLabel.textContent='None';
    syncCodeTypeRowVisibility();
    closeAll();
    buildQrOptions();
    renderPreview();
  });
  qrOptions.appendChild(none);
  currentFormat().cols.forEach((col,i)=>{
    const opt=document.createElement('div');
      opt.className='g-opt'+(state.qrField===i?' active':'');
      opt.textContent=`Field ${i+1}  —  ${col}`;
      opt.addEventListener('click',(e)=>{
        e.stopPropagation();
        state.qrField=i;
        qrLabel.textContent=`Field ${i+1}  —  ${col}`;
        syncCodeTypeRowVisibility();
        closeAll();
        buildQrOptions();
        renderPreview();
      });
      qrOptions.appendChild(opt);
    });
}
buildQrOptions();
syncCodeTypeRowVisibility();
qrSelect.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen=qrSelect.classList.contains('open');
  closeAll();
  if(!isOpen){
    qrSelect.classList.add('open');
    qrOptions.classList.add('open');
    if(qrRowEl) qrRowEl.classList.add('row-active');
  }
});

const codeTypeSelect  = document.getElementById('codeTypeSelect');
const codeTypeOptions = document.getElementById('codeTypeOptions');
const codeTypeLabel   = document.getElementById('codeTypeLabel');
const codeTypeRowEl2  = codeTypeSelect.closest('.form-row');
function buildCodeTypeOptions(){
  codeTypeOptions.innerHTML='';
  Object.keys(CODE_TYPES).forEach(key=>{
    const opt=document.createElement('div');
    opt.className='g-opt'+(state.codeType===key?' active':'');
    opt.textContent=CODE_TYPES[key].label;
    opt.addEventListener('click',(e)=>{
      e.stopPropagation();
      state.codeType=key;
      codeTypeLabel.textContent=CODE_TYPES[key].label;
      closeAll();
      buildCodeTypeOptions();
      syncCodeTypeRowVisibility();
      renderPreview();
    });
    codeTypeOptions.appendChild(opt);
  });
}
buildCodeTypeOptions();
codeTypeSelect.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen=codeTypeSelect.classList.contains('open');
  closeAll();
  if(!isOpen){
    codeTypeSelect.classList.add('open');
    codeTypeOptions.classList.add('open');
    if(codeTypeRowEl2) codeTypeRowEl2.classList.add('row-active');
  }
});

const QR_ECC_LEVELS = { L:'Low (7%)', M:'Medium (15%)', Q:'Quartile (25%)', H:'High (30%)' };
const qrEccSelect  = document.getElementById('qrEccSelect');
const qrEccOptions = document.getElementById('qrEccOptions');
const qrEccLabel   = document.getElementById('qrEccLabel');
const qrEccRowEl2  = qrEccSelect.closest('.form-row');
function buildQrEccOptions(){
  qrEccOptions.innerHTML='';
  Object.keys(QR_ECC_LEVELS).forEach(key=>{
    const opt=document.createElement('div');
    opt.className='g-opt'+(state.qrErrorCorrection===key?' active':'');
    opt.textContent=QR_ECC_LEVELS[key];
    opt.addEventListener('click',(e)=>{
      e.stopPropagation();
      state.qrErrorCorrection=key;
      qrEccLabel.textContent=QR_ECC_LEVELS[key];
      closeAll();
      buildQrEccOptions();
      renderPreview();
    });
    qrEccOptions.appendChild(opt);
  });
}
buildQrEccOptions();
qrEccSelect.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen=qrEccSelect.classList.contains('open');
  closeAll();
  if(!isOpen){
    qrEccSelect.classList.add('open');
    qrEccOptions.classList.add('open');
    if(qrEccRowEl2) qrEccRowEl2.classList.add('row-active');
  }
});

function serialValue(i){
  const s = state.serialize;
  const n = s.start + i*s.step;
  const sign = n<0 ? '-' : '';
  const digits = s.pad>0 ? String(Math.abs(n)).padStart(s.pad,'0') : String(Math.abs(n));
  return `${s.prefix}${sign}${digits}${s.suffix}`;
}
function withSerials(rows){
  const s = state.serialize;
  if(!s.enabled || s.fieldIdx===null || s.fieldIdx===undefined) return rows;
  return rows.map((row,i)=>{
    const copy = row.slice();
    copy[s.fieldIdx] = serialValue(i);
    return copy;
  });
}
const serializeToggleEl   = document.getElementById('serializeToggle');
const serializePanelEl    = document.getElementById('serializePanel');
const serializeFieldSelect= document.getElementById('serializeFieldSelect');
const serializeFieldOptions=document.getElementById('serializeFieldOptions');
const serializeFieldLabel = document.getElementById('serializeFieldLabel');
const serializeSampleEl   = document.getElementById('serializeSample');

function updateSerializeSample(){
  if(!state.serialize.enabled){ serializeSampleEl.textContent=''; return; }
  serializeSampleEl.textContent = `preview: row 1 â†’ ${serialValue(0)} Â· row 2 â†’ ${serialValue(1)} Â· row 3 â†’ ${serialValue(2)}`;
}
function buildSerializeFieldOptions(){
  serializeFieldOptions.innerHTML='';
  currentFormat().cols.forEach((col,i)=>{
    const opt=document.createElement('div');
    opt.className='g-opt'+(state.serialize.fieldIdx===i?' active':'');
    opt.textContent=`Field ${i+1}  —  ${col}`;
    opt.addEventListener('click',(e)=>{
      e.stopPropagation();
      state.serialize.fieldIdx=i;
      serializeFieldLabel.textContent=`Field ${i+1}  —  ${col}`;
      closeAll();
      buildSerializeFieldOptions();
      renderPreview();
    });
    serializeFieldOptions.appendChild(opt);
  });
}
buildSerializeFieldOptions();
serializeFieldSelect.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen=serializeFieldSelect.classList.contains('open');
  closeAll();
  if(!isOpen){
    serializeFieldSelect.classList.add('open');
    serializeFieldOptions.classList.add('open');
    const row = serializeFieldSelect.closest('.form-row');
    if(row) row.classList.add('row-active');
  }
});
serializeToggleEl.addEventListener('change', e=>{
  state.serialize.enabled = e.target.checked;
  serializePanelEl.style.display = state.serialize.enabled ? 'flex' : 'none';
  if(state.serialize.enabled && state.serialize.fieldIdx===null){
    state.serialize.fieldIdx = 0;
    serializeFieldLabel.textContent = `Field 1  —  ${currentFormat().cols[0]}`;
    buildSerializeFieldOptions();
  }
  updateSerializeSample();
  renderPreview();
});
document.getElementById('serializeStart').addEventListener('input', e=>{ state.serialize.start = parseInt(e.target.value)||0; updateSerializeSample(); renderPreview(); });
document.getElementById('serializeStep').addEventListener('input',  e=>{ state.serialize.step  = parseInt(e.target.value)||1; updateSerializeSample(); renderPreview(); });
document.getElementById('serializePad').addEventListener('input',   e=>{ state.serialize.pad   = Math.max(0, parseInt(e.target.value)||0); updateSerializeSample(); renderPreview(); });
document.getElementById('serializePrefix').addEventListener('input',e=>{ state.serialize.prefix= e.target.value; updateSerializeSample(); renderPreview(); });
document.getElementById('serializeSuffix').addEventListener('input',e=>{ state.serialize.suffix= e.target.value; updateSerializeSample(); renderPreview(); });
document.getElementById('serializeAddRowsBtn').addEventListener('click', async ()=>{
  const n = parseInt(await customPrompt('How many blank rows to add for serialization?','50'))||0;
  if(n<=0) return;
  const w = state.previewRows[0]?.length || 1;
  for(let i=0;i<n;i++) state.previewRows.push(new Array(w).fill(''));
  renderPreview();
  setStatus(`Added ${n} blank rows  —  serial numbers fill in on generate`, '#4A4032');
});

const LAYOUTS = {
  'One label per page':  { cols:1, rows:1 },
  '2 × 1 (2 per page)': { cols:2, rows:1 },
  '2 × 2 (4 per page)': { cols:2, rows:2 },
  '3 × 2 (6 per page)': { cols:3, rows:2 },
  '4 × 2 (8 per page)': { cols:4, rows:2 },
  'Custom…': null,
};

const layoutSelect  = document.getElementById('layoutSelect');
const layoutOptions = document.getElementById('layoutOptions');
const layoutLabel   = document.getElementById('layoutLabel');
const layoutRowEl   = layoutSelect.closest('.form-row');

Object.keys(LAYOUTS).forEach(key=>{
  const opt=document.createElement('div');
  opt.className='g-opt'+(key===state.layout?' active':'');
  opt.textContent=key;
  opt.addEventListener('click',(e)=>{
    e.stopPropagation();
    state.layout=key;
    layoutLabel.textContent=key;
    closeAll();
    document.querySelectorAll('#layoutOptions .g-opt').forEach(o=>o.classList.remove('active'));
    opt.classList.add('active');
    const clRow=document.getElementById('customLayoutRow');
    if(clRow) clRow.style.display = (key==='Custom…') ? 'flex' : 'none';
    syncExportFormatUI();
  });
  layoutOptions.appendChild(opt);
});
layoutSelect.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen=layoutSelect.classList.contains('open');
  closeAll();
  if(!isOpen){
    layoutSelect.classList.add('open');
    layoutOptions.classList.add('open');
    if(layoutRowEl) layoutRowEl.classList.add('row-active');
  }
});


buildDropdown(
  document.getElementById('unitSelect'), document.getElementById('unitOptions'),
  document.getElementById('unitLabel'), UNITS, 'unit'
);
buildDropdown(
  document.getElementById('fontSelect'), document.getElementById('fontOptions'),
  document.getElementById('fontLabel'), FONTS, '__font'
);
document.querySelectorAll('#alignGroup .align-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.design.align = btn.dataset.align;
    document.querySelectorAll('#alignGroup .align-btn').forEach(b=>b.classList.toggle('active', b===btn));
    renderDesignerStage();
    checkLegibility();
  });
});
[['boldBtn','bold'],['italicBtn','italic'],['underlineBtn','underline']].forEach(([id,key])=>{
  const btn = document.getElementById(id);
  btn.addEventListener('click', ()=>{
    state.design[key] = !state.design[key];
    btn.classList.toggle('active', state.design[key]);
    renderDesignerStage();
    checkLegibility();
  });
});
const textColorInput = document.getElementById('textColor');
const textColorHexInput = document.getElementById('textColorHex');
textColorInput.addEventListener('input', ()=>{
  state.design.color = textColorInput.value;
  textColorHexInput.value = textColorInput.value;
  renderDesignerStage();
  checkLegibility();
});
textColorHexInput.addEventListener('input', ()=>{
  const v = textColorHexInput.value.trim();
  if(/^#?[0-9a-fA-F]{6}$/.test(v)){
    const hex = v.startsWith('#') ? v : '#'+v;
    state.design.color = hex;
    textColorInput.value = hex;
    renderDesignerStage();
    checkLegibility();
  }
});
Object.defineProperty(state, '__font',  { set(v){ state.design.font = v; },  get(){ return state.design.font; } });
Object.defineProperty(state, '__align', { set(v){ state.design.align = v; }, get(){ return state.design.align; } });

document.getElementById('customW').value = state.customW;
document.getElementById('customH').value = state.customH;
document.getElementById('customW').addEventListener('input', e=>{ state.customW = parseFloat(e.target.value)||0; });
document.getElementById('customH').addEventListener('input', e=>{ state.customH = parseFloat(e.target.value)||0; checkLegibility(); });

document.getElementById('customCols').value = state.customCols;
document.getElementById('customRows').value = state.customRows;
document.getElementById('customGap').value  = state.customGap;
document.getElementById('customCols').addEventListener('input', e=>{ state.customCols = Math.max(1, parseInt(e.target.value)||1); syncExportFormatUI(); });
document.getElementById('customRows').addEventListener('input', e=>{ state.customRows = Math.max(1, parseInt(e.target.value)||1); syncExportFormatUI(); });
document.getElementById('customGap').addEventListener('input',  e=>{ state.customGap  = Math.max(0, parseFloat(e.target.value)||0); });

document.getElementById('borderToggle').addEventListener('change', e=>{ state.design.border = e.target.checked; });
document.getElementById('borderColor').addEventListener('input',  e=>{ state.design.borderColor = e.target.value; });
document.getElementById('radiusInput').addEventListener('input',  e=>{ state.design.radius = Math.max(0, parseFloat(e.target.value)||0); });
document.querySelectorAll('.num-stepper button[data-step]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const inp = btn.parentElement.querySelector('input');
    const step = parseFloat(btn.dataset.step);
    const min = parseFloat(inp.min), max = parseFloat(inp.max);
    let v = (parseFloat(inp.value) || (step>0 ? min : 8)) + step;
    v = Math.min(max, Math.max(min, v));
    inp.value = v;
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    renderDesignerStage();
  });
});
document.getElementById('fontSizeInput').addEventListener('input', e=>{
  const v = parseFloat(e.target.value);
  state.design.fontSize = (e.target.value==='' || isNaN(v)) ? 0 : Math.max(4, v);
  checkLegibility();
});
document.getElementById('rotateToggle').addEventListener('change', e=>{ state.design.rotate = e.target.checked; checkLegibility(); });
document.getElementById('displayValueToggle').addEventListener('change', e=>{ state.design.barcodeDisplayValue = e.target.checked; });
document.getElementById('exportMarginInput').value = state.exportMargin;
document.getElementById('exportMarginInput').addEventListener('input', e=>{
  const v = parseFloat(e.target.value);
  state.exportMargin = isNaN(v) ? 10 : Math.max(0, Math.min(30, v));
});
document.getElementById('showCutMarksToggle').checked = state.showCutMarks;
document.getElementById('showCutMarksToggle').addEventListener('change', e=>{ state.showCutMarks = e.target.checked; });
const MOON_PATH = 'M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8Z';
const SUN_PATH = 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8Z';
function applyDarkMode(on){
  document.documentElement.classList.toggle('dark', on);
  const icon = document.getElementById('darkModeIcon');
  if(icon){
    icon.querySelector('path').setAttribute('d', on ? SUN_PATH : MOON_PATH);
    icon.parentElement.title = on ? 'Switch to light mode' : 'Switch to dark mode';
  }
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if(themeMeta) themeMeta.setAttribute('content', on ? '#211c17' : '#C3B091');
}
applyDarkMode(document.documentElement.classList.contains('dark'));
document.getElementById('darkModeToggle').addEventListener('click', ()=>{
  const on = !document.documentElement.classList.contains('dark');
  applyDarkMode(on);
  localStorage.setItem('sticker_dark_mode', on ? '1' : '0');
});
document.getElementById('usageToggle').checked = state.usageOptIn;
document.getElementById('usageToggle').addEventListener('change', e=>{
  state.usageOptIn = e.target.checked;
  localStorage.setItem('sticker_usage_optin', String(e.target.checked));
});

function getEffectiveSizeMm(){
  if(state.size === 'Custom…'){
    const factor = UNITS[state.unit] || 1;
    let w = (state.customW||0) * factor, h = (state.customH||0) * factor;
    if(state.design.rotate){ [w,h] = [h,w]; }
    return [w, h];
  }
  let [w,h] = SIZES[state.size];
  if(state.design.rotate){ [w,h] = [h,w]; }
  return [w, h];
}
function getEffectiveLayout(){
  if(state.layout === 'Custom…'){
    return { cols: state.customCols, rows: state.customRows, gap: state.customGap, margin: state.exportMargin };
  }
  const l = LAYOUTS[state.layout] || { cols:1, rows:1 };
  return { cols: l.cols, rows: l.rows, gap: 2, margin: state.exportMargin };
}

function currentFormat(){
  const n = Math.max(1, state.previewRows[0] ? state.previewRows[0].length : 1);
  return { cols: Array.from({length:n},(_,i)=>`LINE${i+1}`), lines:n, school:false };
}
function currentFields(){
  const fmt = currentFormat();
  return fmt ? fmt.cols : [];
}
function checkLegibility(){
  renderLabelPreview();
  syncCanvasElements();
  const warnEl = document.getElementById('legibilityWarn');
  if(!warnEl) return;
  if(state.previewRows.length===0){ warnEl.style.display='none'; return; }
  const [,hMm] = getEffectiveSizeMm();
  const n = Math.max(1, currentFields().length || 1);
  const MARGIN = 2;
  if(!hMm || hMm <= MARGIN*2){ warnEl.style.display='none'; return; }
  const spacing = (hMm - MARGIN*2) / n;
  const autoSize = Math.min(22, Math.max(6, spacing * 2.5));
  const fontSizePt = state.design.fontSize > 0 ? state.design.fontSize : autoSize;
  const fontMm = fontSizePt * 0.3528;
  if(fontMm > spacing){
    warnEl.textContent = `âš  ${n} lines get ~${spacing.toFixed(1)}mm each but ${fontSizePt.toFixed(0)}pt text needs ~${fontMm.toFixed(1)}mm  —  lines will overlap. Fewer lines, a taller label, or a smaller manual font size fixes it.`;
    warnEl.style.display='block';
  }else{
    warnEl.style.display='none';
  }
}
function defaultCanvasElements(wMm, hMm){
  const fields = currentFields();
  const n = Math.max(1, fields.length);
  const MARGIN = 2;
  const hasQR = state.qrField !== null && state.qrField !== undefined && state.qrField >= 0;
  const codeFamily = (CODE_TYPES[state.codeType] || CODE_TYPES.qr).family;
  const CODE_H_MM = hasQR ? Math.min(hMm - MARGIN*2, 12) : 0;
  const CODE_W_MM = hasQR ? (codeFamily==='linear' ? Math.min(wMm*0.42, 32) : CODE_H_MM) : 0;
  const textW = wMm - MARGIN*2 - (hasQR ? CODE_W_MM + 1 : 0);
  const spacing = (hMm - MARGIN*2) / n;
  const els = fields.map((f,j)=>({
    type:'field', fieldIdx:j, label:f, fontSize:0,
    x: MARGIN, y: MARGIN + j*spacing, w: Math.max(4,textW), h: Math.max(3,spacing),
  }));
  if(hasQR){
    els.push({ type:'qr', label:'QR',
      x: wMm - MARGIN - CODE_W_MM, y: (hMm - CODE_H_MM)/2, w: CODE_W_MM, h: CODE_H_MM });
  }
  return els;
}

let dsgUndoStack = [];
let dsgRedoStack = [];
const DSG_HISTORY_LIMIT = 50;
function dsgSnapshot(){ return JSON.stringify(state.canvasElements); }
function dsgPushHistory(){
  dsgUndoStack.push(dsgSnapshot());
  if(dsgUndoStack.length > DSG_HISTORY_LIMIT) dsgUndoStack.shift();
  dsgRedoStack.length = 0;
  dsgUpdateHistoryButtons();
}
function dsgUpdateHistoryButtons(){
  const u = document.getElementById('designerUndoBtn');
  const r = document.getElementById('designerRedoBtn');
  if(u) u.classList.toggle('disabled', dsgUndoStack.length===0);
  if(r) r.classList.toggle('disabled', dsgRedoStack.length===0);
}
function dsgUndo(){
  if(!dsgUndoStack.length) return;
  dsgRedoStack.push(dsgSnapshot());
  state.canvasElements = JSON.parse(dsgUndoStack.pop());
  renderDesignerStage();
  dsgUpdateHistoryButtons();
}
function dsgRedo(){
  if(!dsgRedoStack.length) return;
  dsgUndoStack.push(dsgSnapshot());
  state.canvasElements = JSON.parse(dsgRedoStack.pop());
  renderDesignerStage();
  dsgUpdateHistoryButtons();
}


function dsgElName(el){
  if(el.type==='qr') return 'QR';
  if(el.type==='text') return el.text || '';
  if(el.type==='field'){
    const v = state.previewRows[0] ? String(state.previewRows[0][el.fieldIdx] ?? '').trim() : '';
    return v;
  }
  if(el.type==='image') return el.label || 'Image';
  if(el.type==='shape') return el.label || (el.shapeKind==='circle'?'Circle':el.shapeKind==='line'?'Line':'Rectangle');
  return el.label || 'Element';
}
const DSG_SINGLE_ONLY_BTN_IDS = ['dsgLockBtn','dsgHideBtn','dsgFrontBtn','dsgBackBtn'];
function dsgGroupMembers(){
  return Array.from(dsgSelectedIdxs)
    .map(i=>({i, el:state.canvasElements[i]}))
    .filter(m=>m.el && !m.el.locked);
}
function selectEl(i){
  dsgSelectedIdx = i;
  dsgSelectedIdxs = (i===null || i===undefined) ? new Set() : new Set([i]);
  dsgSyncSelectionUI();
}
function dsgToggleSelect(i){
  if(dsgSelectedIdxs.has(i)){
    dsgSelectedIdxs.delete(i);
    if(dsgSelectedIdx===i) dsgSelectedIdx = dsgSelectedIdxs.size ? Array.from(dsgSelectedIdxs).pop() : null;
  }else{
    dsgSelectedIdxs.add(i);
    dsgSelectedIdx = i;
  }
  dsgSyncSelectionUI();
}
function dsgSetSelection(idxArr){
  dsgSelectedIdxs = new Set(idxArr);
  dsgSelectedIdx = idxArr.length ? idxArr[idxArr.length-1] : null;
  dsgSyncSelectionUI();
}
function dsgSyncSelectionUI(){
  designerStage.querySelectorAll('.dsg-el').forEach(d=>{
    const i = parseInt(d.dataset.idx,10);
    const inGroup = dsgSelectedIdxs.has(i);
    d.classList.toggle('selected', inGroup);
    d.classList.toggle('group-member', inGroup && i!==dsgSelectedIdx);
  });
  const panel = document.getElementById('designerSelPanel');
  const toolsPanel = document.getElementById('defaultToolsPanel');
  const n = dsgSelectedIdxs.size;
  if(n===0){ panel.style.display='none'; if(toolsPanel) toolsPanel.style.display='flex'; renderLayersPanel(); return; }
  panel.style.display='flex';
  if(toolsPanel) toolsPanel.style.display='none';
  const opacityLbl = document.getElementById('designerSelOpacity').closest('label');
  const rotateLbl  = document.getElementById('designerSelRotation').closest('label');
  if(n>1){
    document.getElementById('designerSelName').textContent = n+' elements selected';
    ['designerSelFontSizeWrap','designerSelFillWrap','designerSelStrokeWrap'].forEach(id=>{ document.getElementById(id).style.display='none'; });
    if(opacityLbl) opacityLbl.style.display='none';
    if(rotateLbl) rotateLbl.style.display='none';
    document.getElementById('dsgAlignGroup').style.display='flex';
    const showDist = n>=3;
    document.getElementById('dsgDistHBtn').style.display = showDist ? '' : 'none';
    document.getElementById('dsgDistVBtn').style.display = showDist ? '' : 'none';
    DSG_SINGLE_ONLY_BTN_IDS.forEach(id=>{
      const b=document.getElementById(id);
      b.classList.add('disabled'); b.setAttribute('tabindex','-1'); b.setAttribute('aria-disabled','true');
    });
    renderLayersPanel();
    return;
  }
  document.getElementById('dsgAlignGroup').style.display='none';
  DSG_SINGLE_ONLY_BTN_IDS.forEach(id=>{
    const b=document.getElementById(id);
    b.classList.remove('disabled'); b.setAttribute('tabindex','0'); b.removeAttribute('aria-disabled');
  });
  const el = state.canvasElements[dsgSelectedIdx];
  if(!el){ panel.style.display='none'; renderLayersPanel(); return; }
  const isField = el.type==='field' || el.type==='text';
  const isShape = el.type==='shape';
  document.getElementById('designerSelName').textContent = dsgElName(el);
  document.getElementById('designerSelFontSizeWrap').style.display = isField ? 'flex' : 'none';
  document.getElementById('designerSelFontSize').value = (isField && el.fontSize>0) ? el.fontSize : '';
  document.getElementById('designerSelFillWrap').style.display = isShape ? 'flex' : 'none';
  document.getElementById('designerSelStrokeWrap').style.display = isShape ? 'flex' : 'none';
  document.getElementById('designerSelTextWrap').style.display = isShape ? 'flex' : 'none';
  document.getElementById('designerSelShapeFontSizeWrap').style.display = isShape ? 'flex' : 'none';
  document.getElementById('designerSelShapeColorWrap').style.display = isShape ? 'flex' : 'none';
  document.getElementById('designerSelShapeStyleWrap').style.display = isShape ? 'flex' : 'none';
  document.getElementById('designerSelShapeAlignWrap').style.display = isShape ? 'flex' : 'none';
  if(opacityLbl) opacityLbl.style.display='flex';
  if(rotateLbl) rotateLbl.style.display='flex';
  if(isShape){
    document.getElementById('designerSelFill').value = (el.fill && el.fill!=='none') ? el.fill : '#ffffff';
    document.getElementById('designerSelStroke').value = (el.stroke && el.stroke!=='none') ? el.stroke : '#3D5A85';
    document.getElementById('designerSelText').value = el.text || '';
    document.getElementById('designerSelShapeFontSize').value = (el.fontSize>0) ? el.fontSize : '';
    document.getElementById('designerSelShapeColor').value = el.color || '#000000';
    document.getElementById('designerSelShapeColorHex').value = el.color || '#000000';
    document.getElementById('designerSelShapeBold').classList.toggle('active', el.bold);
    document.getElementById('designerSelShapeItalic').classList.toggle('active', el.italic);
    document.getElementById('designerSelShapeUnderline').classList.toggle('active', el.underline);
    document.querySelectorAll('#designerSelShapeAlignWrap .align-btn').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.align === (el.align || 'Center'));
    });
  }
  document.getElementById('designerSelOpacity').value = Math.round((el.opacity ?? 1)*100);
  document.getElementById('designerSelRotation').value = Math.round(el.rotation || 0);
  document.getElementById('dsgLockBtn').textContent = el.locked ? 'Unlock' : 'Lock';
  document.getElementById('dsgHideBtn').textContent = el.hidden ? 'Show' : 'Hide';
  renderLayersPanel();
}
document.getElementById('designerSelFontSize').addEventListener('focus', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelFontSize').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const el = state.canvasElements[dsgSelectedIdx];
  if(!el || el.type!=='field') return;
  const v = parseFloat(e.target.value);
  el.fontSize = (e.target.value==='' || isNaN(v)) ? 0 : Math.max(4, v);
});
document.getElementById('designerSelOpacity').addEventListener('pointerdown', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelOpacity').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  const el = state.canvasElements[idx];
  if(!el) return;
  el.opacity = Math.max(0.1, Math.min(1, parseFloat(e.target.value)/100));
  renderDesignerStage(); selectEl(idx);
});
document.getElementById('designerSelRotation').addEventListener('focus', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelRotation').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  const el = state.canvasElements[idx];
  if(!el) return;
  const v = parseFloat(e.target.value);
  el.rotation = isNaN(v) ? 0 : ((v+180)%360+360)%360-180;
  renderDesignerStage(); selectEl(idx);
});
document.getElementById('designerSelFill').addEventListener('pointerdown', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelFill').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  const el = state.canvasElements[idx];
  if(!el || el.type!=='shape') return;
  el.fill = e.target.value;
  renderDesignerStage(); selectEl(idx);
});
document.getElementById('designerSelStroke').addEventListener('pointerdown', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelStroke').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  const el = state.canvasElements[idx];
  if(!el || el.type!=='shape') return;
  el.stroke = e.target.value;
  renderDesignerStage(); selectEl(idx);
});
document.getElementById('designerSelText').addEventListener('focus', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelText').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  const el = state.canvasElements[idx];
  if(!el || el.type!=='shape') return;
  el.text = e.target.value;
  renderDesignerStage(); selectEl(idx);
});
document.getElementById('designerSelShapeFontSize').addEventListener('focus', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelShapeFontSize').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  const el = state.canvasElements[idx];
  if(!el || el.type!=='shape') return;
  const v = parseFloat(e.target.value);
  el.fontSize = (e.target.value==='' || isNaN(v)) ? 0 : Math.max(4, v);
  renderDesignerStage(); selectEl(idx);
});
document.getElementById('designerSelShapeColor').addEventListener('pointerdown', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelShapeColor').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  const el = state.canvasElements[idx];
  if(!el || el.type!=='shape') return;
  el.color = e.target.value;
  document.getElementById('designerSelShapeColorHex').value = e.target.value;
  renderDesignerStage(); selectEl(idx);
});
document.getElementById('designerSelShapeColorHex').addEventListener('focus', ()=>{ dsgPushHistory(); });
document.getElementById('designerSelShapeColorHex').addEventListener('input', e=>{
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  const el = state.canvasElements[idx];
  if(!el || el.type!=='shape') return;
  const v = e.target.value;
  if(/^#[0-9A-Fa-f]{6}$/.test(v)){
    el.color = v.toUpperCase();
    document.getElementById('designerSelShapeColor').value = v;
    renderDesignerStage(); selectEl(idx);
  }
});
['designerSelShapeBold','designerSelShapeItalic','designerSelShapeUnderline'].forEach(id=>{
  document.getElementById(id).addEventListener('click', ()=>{
    if(dsgSelectedIdx===null) return;
    dsgPushHistory();
    const idx = dsgSelectedIdx;
    const el = state.canvasElements[idx];
    if(!el || el.type!=='shape') return;
    if(id==='designerSelShapeBold') el.bold = !el.bold;
    else if(id==='designerSelShapeItalic') el.italic = !el.italic;
    else el.underline = !el.underline;
    document.getElementById(id).classList.toggle('active');
    renderDesignerStage(); selectEl(idx);
  });
});
document.querySelectorAll('#designerSelShapeAlignWrap .align-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(dsgSelectedIdx===null) return;
    dsgPushHistory();
    const idx = dsgSelectedIdx;
    const el = state.canvasElements[idx];
    if(!el || el.type!=='shape') return;
    el.align = btn.dataset.align;
    document.querySelectorAll('#designerSelShapeAlignWrap .align-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderDesignerStage(); selectEl(idx);
  });
});

function dsgRenderRulers(wMm, hMm){
  const rh = document.getElementById('dsgRulerH');
  const rv = document.getElementById('dsgRulerV');
  if(!rh || !rv) return;
  rh.style.width = (wMm*dsgScale)+'px';
  rv.style.height = (hMm*dsgScale)+'px';
  rh.innerHTML=''; rv.innerHTML='';
  const majorStep = 10;
  const minorStep = dsgScale>=4 ? 5 : majorStep;
  function ticksFor(sizeMm){
    const out = [];
    for(let m=0; m<=sizeMm+0.001; m+=minorStep){
      out.push({ m: Math.min(m, sizeMm), isMajor: Math.abs(m % majorStep) < 0.01 });
    }
    if(Math.abs(out[out.length-1].m - sizeMm) > 0.01) out.push({m:sizeMm, isMajor:true});
    return out;
  }
  ticksFor(wMm).forEach(t=>{
    const tick=document.createElement('div');
    tick.style.cssText = `position:absolute;left:${t.m*dsgScale}px;bottom:0;width:1px;background:var(--border);`
      + (t.isMajor ? 'height:9px' : 'height:5px');
    rh.appendChild(tick);
    if(t.isMajor){
      const lbl=document.createElement('div');
      lbl.style.cssText = `position:absolute;left:${t.m*dsgScale+2}px;top:1px;font-size:8px;color:var(--text-muted);font-weight:600;white-space:nowrap`;
      lbl.textContent = Math.round(t.m);
      rh.appendChild(lbl);
    }
  });
  ticksFor(hMm).forEach(t=>{
    const tick=document.createElement('div');
    tick.style.cssText = `position:absolute;top:${t.m*dsgScale}px;right:0;height:1px;background:var(--border);`
      + (t.isMajor ? 'width:9px' : 'width:5px');
    rv.appendChild(tick);
    if(t.isMajor){
      const lbl=document.createElement('div');
      lbl.style.cssText = `position:absolute;top:${t.m*dsgScale-4}px;left:0;right:2px;text-align:right;font-size:8px;color:var(--text-muted);font-weight:600`;
      lbl.textContent = Math.round(t.m);
      rv.appendChild(lbl);
    }
  });
}
function renderDesignerStage(){
  designerStage.innerHTML='';
  dsgSelectedIdx = null;
  dsgSelectedIdxs = new Set();
  document.getElementById('designerSelPanel').style.display='none';
  { const _dtp = document.getElementById('defaultToolsPanel'); if(_dtp) _dtp.style.display='flex'; }
  const [wMm,hMm] = dsgSizeMm;
  designerStage.style.width  = (wMm*dsgScale)+'px';
  designerStage.style.height = (hMm*dsgScale)+'px';
  designerStage.style.backgroundSize = dsgScale+'px '+dsgScale+'px';
  dsgRenderRulers(wMm, hMm);
  const cap = document.getElementById('designerCaption');
  if(cap) cap.textContent = `${wMm.toFixed(1)}mm × ${hMm.toFixed(1)}mm  —  zoomed ${dsgScale.toFixed(1)}×`;
  const zoomLbl = document.getElementById('dsgZoomLabel');
  if(zoomLbl) zoomLbl.textContent = Math.round(dsgScale/(dsgFitScale||dsgScale)*100)+'%';
  (state.canvasElements||[]).forEach((el, i)=>{
    if(el.hidden) return;
    const div=document.createElement('div');
    div.dataset.idx = i;
    div.className='dsg-el'
      +(el.type==='qr'?' qr':'')
      +(el.type==='image'?' img-el':'')
      +(el.type==='shape'?' shape-'+el.shapeKind:'')
      +(el.locked?' locked':'');
    if(el.type==='image'){
      const img=document.createElement('img');
      img.src = el.src; img.draggable=false; img.alt='';
      div.appendChild(img);
    } else if(el.type==='shape'){
      div.style.background = (el.fill && el.fill!=='none') ? el.fill : 'transparent';
      div.style.border = (el.stroke && el.stroke!=='none') ? `${el.strokeWidth||0.3}mm solid ${el.stroke}` : 'none';
      if(el.text && el.text.trim()){
        const fontFamily = PREVIEW_FONTS[state.design.font] || PREVIEW_FONTS.Helvetica;
        const align = ALIGNS[el.align] || 'center';
        const autoSz = Math.min(22, Math.max(6, el.h*2.2));
        const sz = (el.fontSize>0) ? el.fontSize : autoSz;
        div.style.display='flex';
        div.style.alignItems='center';
        div.style.justifyContent = align==='left' ? 'flex-start' : align==='right' ? 'flex-end' : 'center';
        div.style.overflow='hidden';
        div.style.padding='0 2px';
        div.style.fontFamily = fontFamily;
        div.style.fontWeight = el.bold ? '700' : '400';
        div.style.fontStyle = el.italic ? 'italic' : 'normal';
        div.style.textDecoration = el.underline ? 'underline' : 'none';
        div.style.fontSize = (sz*0.3528*dsgScale)+'px';
        div.style.color = el.color || '#000000';
        const txt=document.createElement('div');
        txt.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%';
        txt.textContent = el.text;
        div.appendChild(txt);
      }
    } else if(el.type==='qr'){
      const ico=document.createElement('div');
      ico.className='dsg-ico';
      ico.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="3" height="3" fill="currentColor"/><rect x="18" y="18" width="3" height="3" fill="currentColor"/></svg>';
      const lbl=document.createElement('div');
      lbl.style.cssText='max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      lbl.textContent = 'QR';
      div.appendChild(ico); div.appendChild(lbl);
    } else {
      // ponytail: live text mirrors the real render formula (autoSz/fontSize/align) from renderLabelPreview  — 
      // same source of truth, not a second interpretation. CSS ellipsis stands in for the exact shrink-to-fit
      // loop used at PDF time, so extreme overflow can look slightly different on screen vs. final output.
      const fontFamily = PREVIEW_FONTS[state.design.font] || PREVIEW_FONTS.Helvetica;
      const align = ALIGNS[state.design.align] || 'center';
      const autoSz = Math.min(22, Math.max(6, el.h*2.2));
      const sz = (el.fontSize>0) ? el.fontSize : (state.design.fontSize>0 ? state.design.fontSize : autoSz);
      div.style.display='flex';
      div.style.alignItems='center';
      div.style.justifyContent = align==='left' ? 'flex-start' : align==='right' ? 'flex-end' : 'center';
      div.style.overflow='hidden';
      div.style.padding='0 2px';
      div.style.fontFamily = fontFamily;
      div.style.fontWeight = state.design.bold ? '700' : '400';
      div.style.fontStyle = state.design.italic ? 'italic' : 'normal';
      div.style.textDecoration = state.design.underline ? 'underline' : 'none';
      div.style.fontSize = (sz*0.3528*dsgScale)+'px';
      div.style.color = state.design.color || '#000000';
      const txt=document.createElement('div');
      txt.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%';
      txt.textContent = dsgElName(el);
      div.appendChild(txt);
    }
    if(el.locked){
      const badge=document.createElement('div');
      badge.className='dsg-lock-badge';
      badge.textContent='ðŸ”’';
      div.appendChild(badge);
    }
    positionDsgEl(div, el);
    let handles=[];
    if(!el.locked){
      handles=['n','e','s','w','nw','ne','se','sw'].map(dir=>{
        const h=document.createElement('div');
        h.className='dsg-handle dsg-handle-'+dir;
        h.dataset.dir=dir;
        div.appendChild(h);
        return h;
      });
      const rot=document.createElement('div');
      rot.className='dsg-handle-rotate';
      div.appendChild(rot);
      wireRotate(rot, div, el, i);
    }
    wireDrag(div, el, handles, i);
    if(el.type==='field') div.addEventListener('dblclick', (e)=>{ e.stopPropagation(); dsgEditFieldInline(div, el); });
    if(el.type==='text') div.addEventListener('dblclick', (e)=>{ e.stopPropagation(); dsgEditStaticTextInline(div, el); });
    designerStage.appendChild(div);
  });
  renderLayersPanel();
}
function dsgEditStaticTextInline(div, el){
  if(el.type!=='text') return;
  dsgPushHistory();
  const ta = document.createElement('textarea');
  ta.value = String(el.text ?? '');
  ta.style.cssText = `position:absolute;left:${div.style.left};top:${div.style.top};width:${div.style.width};height:${div.style.height};`
    + 'resize:none;z-index:50;font:inherit;padding:2px 4px;box-sizing:border-box;border:1.5px solid var(--accent-deep);border-radius:3px;background:#fff;color:#111';
  designerStage.appendChild(ta);
  ta.focus(); ta.select();
  let done = false;
  function commit(){
    if(done) return; done = true;
    el.text = ta.value;
    ta.remove();
    checkLegibility();
  }
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (e)=>{
    e.stopPropagation();
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); commit(); }
    else if(e.key==='Escape'){ e.preventDefault(); commit(); }
  });
}
function dsgEditFieldInline(div, el){
  if(el.type!=='field' || state.bulkMode) return;
  dsgEnsureSingleRow();
  dsgPushHistory();
  const ta = document.createElement('textarea');
  ta.value = String(state.previewRows[0][el.fieldIdx] ?? '');
  ta.style.cssText = `position:absolute;left:${div.style.left};top:${div.style.top};width:${div.style.width};height:${div.style.height};`
    + 'resize:none;z-index:50;font:inherit;padding:2px 4px;box-sizing:border-box;border:1.5px solid var(--accent-deep);border-radius:3px;background:#fff;color:#111';
  designerStage.appendChild(ta);
  ta.focus(); ta.select();
  let done = false;
  function commit(){
    if(done) return; done = true;
    state.previewRows[0][el.fieldIdx] = ta.value;
    ta.remove();
    checkLegibility();
  }
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (e)=>{
    e.stopPropagation();
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); commit(); }
    else if(e.key==='Escape'){ e.preventDefault(); commit(); }
  });
}
function positionDsgEl(div, el){
  div.style.left   = (el.x*dsgScale)+'px';
  div.style.top    = (el.y*dsgScale)+'px';
  div.style.width  = (el.w*dsgScale)+'px';
  div.style.height = (el.h*dsgScale)+'px';
  div.style.opacity = el.opacity ?? 1;
  div.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
}
function wireRotate(handle, div, el, idx){
  handle.addEventListener('pointerdown', (e)=>{
    e.preventDefault(); e.stopPropagation();
    dsgPushHistory();
    selectEl(idx);
    handle.setPointerCapture(e.pointerId);
    const rect = div.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const startAngle = Math.atan2(e.clientY-cy, e.clientX-cx) * 180/Math.PI;
    const startRot = el.rotation || 0;
    function move(ev){
      const ang = Math.atan2(ev.clientY-cy, ev.clientX-cx) * 180/Math.PI;
      let r = startRot + (ang - startAngle);
      if(ev.shiftKey) r = Math.round(r/15)*15;
      r = ((r+180)%360+360)%360-180;
      el.rotation = r;
      div.style.transform = `rotate(${r}deg)`;
      if(dsgSelectedIdx===idx){
        const rotInput = document.getElementById('designerSelRotation');
        if(rotInput) rotInput.value = Math.round(r);
      }
    }
    function up(ev){
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
const DSG_SNAP_MM = 1.2;
function dsgApplySnap(x, y, w, h, excludeIdx){
  const [wMm,hMm] = dsgSizeMm;
  const xTargets = [0, wMm/2, wMm];
  const yTargets = [0, hMm/2, hMm];
  (state.canvasElements||[]).forEach((o,i)=>{
    if(i===excludeIdx || o.hidden) return;
    xTargets.push(o.x, o.x+o.w/2, o.x+o.w);
    yTargets.push(o.y, o.y+o.h/2, o.y+o.h);
  });
  let bestXd=DSG_SNAP_MM, guideX=null, snapX=x;
  [x, x+w/2, x+w].forEach((edge, pos)=>{
    xTargets.forEach(t=>{
      const d=Math.abs(edge-t);
      if(d<bestXd){ bestXd=d; guideX=t; snapX = pos===0 ? t : pos===1 ? t-w/2 : t-w; }
    });
  });
  let bestYd=DSG_SNAP_MM, guideY=null, snapY=y;
  [y, y+h/2, y+h].forEach((edge, pos)=>{
    yTargets.forEach(t=>{
      const d=Math.abs(edge-t);
      if(d<bestYd){ bestYd=d; guideY=t; snapY = pos===0 ? t : pos===1 ? t-h/2 : t-h; }
    });
  });
  return {
    x: guideX!==null ? Math.min(Math.max(0,snapX), wMm-w) : x,
    y: guideY!==null ? Math.min(Math.max(0,snapY), hMm-h) : y,
    guideX, guideY
  };
}
function dsgShowGuides(gx, gy){
  let v = designerStage.querySelector('.dsg-guide-v');
  let h = designerStage.querySelector('.dsg-guide-h');
  if(gx!==null && gx!==undefined){
    if(!v){ v=document.createElement('div'); v.className='dsg-guide dsg-guide-v'; designerStage.appendChild(v); }
    v.style.left = (gx*dsgScale)+'px';
  } else if(v){ v.remove(); }
  if(gy!==null && gy!==undefined){
    if(!h){ h=document.createElement('div'); h.className='dsg-guide dsg-guide-h'; designerStage.appendChild(h); }
    h.style.top = (gy*dsgScale)+'px';
  } else if(h){ h.remove(); }
}
const RESIZE_EDGES={nw:'tl',n:'t',ne:'tr',e:'r',se:'br',s:'b',sw:'bl',w:'l'};
function wireDrag(div, el, handles, idx){
  const [wMm,hMm] = dsgSizeMm;
  div.addEventListener('pointerdown', (e)=>{
    if(e.target.classList.contains('dsg-handle') || e.target.classList.contains('dsg-handle-rotate')) return;
    e.preventDefault();
    if(e.shiftKey || e.ctrlKey || e.metaKey){ dsgToggleSelect(idx); return; }
    const isGroupDrag = dsgSelectedIdxs.size>1 && dsgSelectedIdxs.has(idx);
    if(!isGroupDrag) selectEl(idx);
    if(el.locked) return;
    dsgPushHistory();
    div.classList.add('dragging');
    const startX=e.clientX, startY=e.clientY;
    div.setPointerCapture(e.pointerId);
    if(isGroupDrag){
      const members = dsgGroupMembers()
        .map(m=>({...m, ox:m.el.x, oy:m.el.y, div:designerStage.querySelector('.dsg-el[data-idx="'+m.i+'"]')}));
      const gx0=Math.min(...members.map(m=>m.ox)), gy0=Math.min(...members.map(m=>m.oy));
      const gx1=Math.max(...members.map(m=>m.ox+m.el.w)), gy1=Math.max(...members.map(m=>m.oy+m.el.h));
      members.forEach(m=>{ if(m.div) m.div.classList.add('dragging'); });
      // ponytail: group drag has no snap guides yet, add dsgApplySnap-for-bbox if it's missed
      function moveGroup(ev){
        let dx=(ev.clientX-startX)/dsgScale, dy=(ev.clientY-startY)/dsgScale;
        dx = Math.max(-gx0, Math.min(wMm-gx1, dx));
        dy = Math.max(-gy0, Math.min(hMm-gy1, dy));
        members.forEach(m=>{
          m.el.x = m.ox+dx; m.el.y = m.oy+dy;
          if(m.div) positionDsgEl(m.div, m.el);
        });
      }
      function upGroup(ev){
        members.forEach(m=>{ if(m.div) m.div.classList.remove('dragging'); });
        div.releasePointerCapture(ev.pointerId);
        div.removeEventListener('pointermove', moveGroup);
        div.removeEventListener('pointerup', upGroup);
      }
      div.addEventListener('pointermove', moveGroup);
      div.addEventListener('pointerup', upGroup);
      return;
    }
    const ox=el.x, oy=el.y;
    function move(ev){
      const dx=(ev.clientX-startX)/dsgScale, dy=(ev.clientY-startY)/dsgScale;
      let nx = Math.min(Math.max(0, ox+dx), wMm-el.w);
      let ny = Math.min(Math.max(0, oy+dy), hMm-el.h);
      if(!ev.altKey){
        const s = dsgApplySnap(nx, ny, el.w, el.h, idx);
        nx = s.x; ny = s.y;
        dsgShowGuides(s.guideX, s.guideY);
      } else {
        dsgShowGuides(null, null);
      }
      el.x = nx; el.y = ny;
      positionDsgEl(div, el);
    }
    function up(ev){
      div.classList.remove('dragging');
      div.releasePointerCapture(ev.pointerId);
      div.removeEventListener('pointermove', move);
      div.removeEventListener('pointerup', up);
      dsgShowGuides(null, null);
    }
    div.addEventListener('pointermove', move);
    div.addEventListener('pointerup', up);
  });
  handles.forEach(handle=>{
    const edges = RESIZE_EDGES[handle.dataset.dir];
    handle.addEventListener('pointerdown', (e)=>{
      e.preventDefault(); e.stopPropagation();
      dsgPushHistory();
      selectEl(idx);
      div.classList.add('dragging');
      const startX=e.clientX, startY=e.clientY;
      const o={x:el.x, y:el.y, w:el.w, h:el.h};
      handle.setPointerCapture(e.pointerId);
      function move(ev){
        const dx=(ev.clientX-startX)/dsgScale, dy=(ev.clientY-startY)/dsgScale;
        if(edges.includes('l')){
          const right=o.x+o.w;
          const nx=Math.min(Math.max(0, o.x+dx), right-4);
          el.x=nx; el.w=right-nx;
        }
        if(edges.includes('r')){
          el.w=Math.min(Math.max(4, o.w+dx), wMm-o.x);
        }
        if(edges.includes('t')){
          const bottom=o.y+o.h;
          const ny=Math.min(Math.max(0, o.y+dy), bottom-3);
          el.y=ny; el.h=bottom-ny;
        }
        if(edges.includes('b')){
          el.h=Math.min(Math.max(3, o.h+dy), hMm-o.y);
        }
        positionDsgEl(div, el);
      }
      function up(ev){
        div.classList.remove('dragging');
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  });
}

function renderLayersPanel(){
  const list = document.getElementById('designerLayersList');
  if(!list) return;
  list.innerHTML='';
  const arr = state.canvasElements || [];
  const EYE_OPEN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg>';
  const EYE_HIDDEN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const LOCK_CLOSED = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" stroke-width="1.8"/></svg>';
  const LOCK_OPEN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V7a4 4 0 017.5-2.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  for(let i=arr.length-1; i>=0; i--){
    const el = arr[i];
    const row = document.createElement('div');
    row.className = 'dsg-layer-row'+(i===dsgSelectedIdx?' active':dsgSelectedIdxs.has(i)?' active-group':'');
    row.draggable = true;
    row.addEventListener('dragstart', ()=>{ dsgDragSrcIdx = i; row.classList.add('dragging'); });
    row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); });
    row.addEventListener('dragover', (e)=>{ e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', ()=>{ row.classList.remove('drag-over'); });
    row.addEventListener('drop', (e)=>{
      e.preventDefault();
      row.classList.remove('drag-over');
      if(dsgDragSrcIdx===null || dsgDragSrcIdx===i) return;
      dsgMoveLayer(dsgDragSrcIdx, i);
      dsgDragSrcIdx = null;
    });
    const eyeBtn = document.createElement('div');
    eyeBtn.className='g-btn dsg-layer-ico'; eyeBtn.title = el.hidden ? 'Show' : 'Hide';
    eyeBtn.innerHTML = el.hidden ? EYE_HIDDEN : EYE_OPEN;
    eyeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); dsgToggleHiddenAt(i); });
    row.appendChild(eyeBtn);
    const lockBtn = document.createElement('div');
    lockBtn.className='g-btn dsg-layer-ico'; lockBtn.title = el.locked ? 'Unlock' : 'Lock';
    lockBtn.innerHTML = el.locked ? LOCK_CLOSED : LOCK_OPEN;
    lockBtn.addEventListener('click', (e)=>{ e.stopPropagation(); dsgToggleLockAt(i); });
    row.appendChild(lockBtn);
    const lbl = document.createElement('span');
    lbl.className='lbl';
    lbl.textContent = dsgElName(el);
    lbl.addEventListener('click', (e)=>{ (e.shiftKey||e.ctrlKey||e.metaKey) ? dsgToggleSelect(i) : selectEl(i); });
    row.appendChild(lbl);
    const up = document.createElement('div'); up.className='g-btn'; up.textContent='â†‘'; up.title='Move forward';
    up.addEventListener('click', ()=>{ dsgSelectedIdx=i; dsgReorder('forward'); });
    const down = document.createElement('div'); down.className='g-btn'; down.textContent='â†“'; down.title='Move backward';
    down.addEventListener('click', ()=>{ dsgSelectedIdx=i; dsgReorder('backward'); });
    row.appendChild(up); row.appendChild(down);
    if(el.type==='image' || el.type==='shape' || el.type==='text'){
      const del = document.createElement('div'); del.className='g-btn'; del.textContent='âœ•'; del.title='Delete';
      del.addEventListener('click', ()=>{ dsgSelectedIdx=i; dsgDeleteSelected(); });
      row.appendChild(del);
    }
    list.appendChild(row);
  }
}
function dsgToggleHiddenAt(i){
  dsgPushHistory();
  state.canvasElements[i].hidden = !state.canvasElements[i].hidden;
  renderDesignerStage(); selectEl(i);
}
function dsgToggleLockAt(i){
  dsgPushHistory();
  state.canvasElements[i].locked = !state.canvasElements[i].locked;
  renderDesignerStage(); selectEl(i);
}
function dsgCenterDefaults(w, h){
  const [wMm,hMm] = dsgSizeMm;
  return { x: Math.max(0,(wMm-w)/2), y: Math.max(0,(hMm-h)/2), w, h };
}
function dsgAddText(){
  dsgPushHistory();
  if(!state.canvasElements) state.canvasElements = [];
  const [wMm,hMm] = dsgSizeMm;
  const w = Math.min(wMm*0.6, 24), h = Math.min(hMm*0.35, 8);
  const el = Object.assign(
    { type:'text', label:'Text', text:'Sample Text', fontSize:0, rotation:0, opacity:1 },
    dsgCenterDefaults(Math.max(6,w), Math.max(3,h))
  );
  state.canvasElements.push(el);
  renderDesignerStage();
  selectEl(state.canvasElements.length-1);
}
function dsgAddShape(kind){
  dsgPushHistory();
  if(!state.canvasElements) state.canvasElements = [];
  const [wMm,hMm] = dsgSizeMm;
  const w = kind==='line' ? Math.min(wMm*0.6, 20) : Math.min(wMm*0.4, 15);
  const h = kind==='line' ? 1 : Math.min(hMm*0.4, 15);
  const el = Object.assign(
    { type:'shape', shapeKind:kind, label: kind==='circle'?'Circle':kind==='line'?'Line':'Rectangle',
      fill: '#ffffff', stroke: '#3D5A85', strokeWidth: 0.3, rotation:0, opacity:1,
      text: '', fontSize: 0, color: '#000000', bold: false, italic: false, underline: false, align: 'Center' },
    dsgCenterDefaults(Math.max(kind==='line'?4:3, w), Math.max(kind==='line'?1:3, h))
  );
  state.canvasElements.push(el);
  renderDesignerStage();
  selectEl(state.canvasElements.length-1);
}
function dsgAddImageFromFile(file){
  if(!file || !file.type || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    dsgPushHistory();
    if(!state.canvasElements) state.canvasElements = [];
    const img = new Image();
    img.onload = ()=>{
      const [wMm,hMm] = dsgSizeMm;
      const maxW = wMm*0.5, maxH = hMm*0.5;
      const ratio = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth/img.naturalHeight : 1;
      let w = maxW, h = w/ratio;
      if(h > maxH){ h = maxH; w = h*ratio; }
      const el = Object.assign(
        { type:'image', label: file.name || 'Image', src: reader.result, rotation:0, opacity:1 },
        dsgCenterDefaults(Math.max(4,w), Math.max(4,h))
      );
      state.canvasElements.push(el);
      renderDesignerStage();
      selectEl(state.canvasElements.length-1);
    };
    img.onerror = ()=>{ setStatus('Could not read that image', '#A83232'); };
    img.src = reader.result;
  };
  reader.onerror = ()=>{ setStatus('Could not read that image', '#A83232'); };
  reader.readAsDataURL(file);
}
function dsgCopySelected(){
  const idxs = dsgSelectedIdxs.size ? Array.from(dsgSelectedIdxs) : (dsgSelectedIdx!==null ? [dsgSelectedIdx] : []);
  if(!idxs.length) return;
  const items = idxs.map(i=>state.canvasElements[i]).filter(Boolean).map(el=>JSON.parse(JSON.stringify(el)));
  if(!items.length) return;
  dsgClipboard = { items, pasteCount: 0 };
  setStatus('Copied '+items.length+' element'+(items.length>1?'s':''), '#065F46');
}
function dsgPasteClipboard(){
  if(!dsgClipboard || !dsgClipboard.items.length) return;
  dsgPushHistory();
  const [wMm,hMm] = dsgSizeMm;
  dsgClipboard.pasteCount++;
  const off = dsgClipboard.pasteCount*2;
  const startIdx = state.canvasElements.length;
  const copies = dsgClipboard.items.map(src=>{
    const copy = JSON.parse(JSON.stringify(src));
    copy.x = Math.min(wMm-copy.w, copy.x+off);
    copy.y = Math.min(hMm-copy.h, copy.y+off);
    return copy;
  });
  state.canvasElements.push(...copies);
  renderDesignerStage();
  dsgSetSelection(copies.map((_,k)=>startIdx+k));
}
function dsgDuplicateSelected(){
  if(dsgSelectedIdxs.size>1){
    dsgPushHistory();
    const [wMm,hMm] = dsgSizeMm;
    const srcIdxs = Array.from(dsgSelectedIdxs).sort((a,b)=>a-b);
    const copies = srcIdxs.map(i=>{
      const copy = JSON.parse(JSON.stringify(state.canvasElements[i]));
      copy.x = Math.min(wMm-copy.w, copy.x+2);
      copy.y = Math.min(hMm-copy.h, copy.y+2);
      return copy;
    });
    const startIdx = state.canvasElements.length;
    state.canvasElements.push(...copies);
    renderDesignerStage();
    dsgSetSelection(copies.map((_,k)=>startIdx+k));
    return;
  }
  if(dsgSelectedIdx===null) return;
  dsgPushHistory();
  const src = state.canvasElements[dsgSelectedIdx];
  const copy = JSON.parse(JSON.stringify(src));
  const [wMm,hMm] = dsgSizeMm;
  copy.x = Math.min(wMm-copy.w, copy.x+2);
  copy.y = Math.min(hMm-copy.h, copy.y+2);
  state.canvasElements.splice(dsgSelectedIdx+1, 0, copy);
  renderDesignerStage();
  selectEl(dsgSelectedIdx+1);
}
function dsgDeleteSelected(){
  if(dsgSelectedIdxs.size>1){
    const idxs = Array.from(dsgSelectedIdxs).sort((a,b)=>a-b);
    const blocked = idxs.some(i=>{ const el=state.canvasElements[i]; return el && (el.type==='field'||el.type==='qr'); });
    const toDelete = idxs.filter(i=>{ const el=state.canvasElements[i]; return !(el && (el.type==='field'||el.type==='qr')); });
    if(!toDelete.length){
      setStatus("Can't delete a data field  —  remove it from your source columns instead", '#A83232');
      return;
    }
    dsgPushHistory();
    toDelete.slice().reverse().forEach(i=>state.canvasElements.splice(i,1));
    renderDesignerStage();
    if(blocked) setStatus("Data fields were kept  —  remove those from your source columns instead", '#A83232');
    return;
  }
  if(dsgSelectedIdx===null) return;
  const el = state.canvasElements[dsgSelectedIdx];
  if(el && (el.type==='field' || el.type==='qr')){
    setStatus("Can't delete a data field  —  remove it from your source columns instead", '#A83232');
    return;
  }
  dsgPushHistory();
  state.canvasElements.splice(dsgSelectedIdx, 1);
  renderDesignerStage();
}
function dsgMoveLayer(from, to){
  if(from===to) return;
  dsgPushHistory();
  const arr = state.canvasElements;
  const [item] = arr.splice(from,1);
  arr.splice(to,0,item);
  renderDesignerStage();
  selectEl(to);
}
function dsgReorder(dir){
  if(dsgSelectedIdx===null) return;
  const arr = state.canvasElements;
  const i = dsgSelectedIdx;
  dsgPushHistory();
  if(dir==='front'){ const [el]=arr.splice(i,1); arr.push(el); renderDesignerStage(); selectEl(arr.length-1); }
  else if(dir==='back'){ const [el]=arr.splice(i,1); arr.unshift(el); renderDesignerStage(); selectEl(0); }
  else if(dir==='forward' && i<arr.length-1){ [arr[i],arr[i+1]]=[arr[i+1],arr[i]]; renderDesignerStage(); selectEl(i+1); }
  else if(dir==='backward' && i>0){ [arr[i],arr[i-1]]=[arr[i-1],arr[i]]; renderDesignerStage(); selectEl(i-1); }
  else renderDesignerStage();
}
function dsgToggleLock(){
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  dsgPushHistory();
  state.canvasElements[idx].locked = !state.canvasElements[idx].locked;
  renderDesignerStage(); selectEl(idx);
}
function dsgToggleHidden(){
  if(dsgSelectedIdx===null) return;
  const idx = dsgSelectedIdx;
  dsgPushHistory();
  state.canvasElements[idx].hidden = !state.canvasElements[idx].hidden;
  renderDesignerStage(); selectEl(idx);
}
function dsgComputeFitScale(){
  const content = document.getElementById('designerContent');
  const [wMm,hMm] = dsgSizeMm;
  const availW = Math.max(160, content.clientWidth  - 24);
  const availH = Math.max(160, content.clientHeight - 24);
  return Math.max(1.5, Math.min(availW/wMm, availH/hMm, 24));
}
document.getElementById('dsgAddTextBtn').addEventListener('click', dsgAddText);
document.getElementById('dsgAddImageBtn').addEventListener('click', ()=>document.getElementById('dsgImageInput').click());
document.getElementById('dsgImageInput').addEventListener('change', (e)=>{
  const f = e.target.files[0];
  if(f) dsgAddImageFromFile(f);
  e.target.value='';
});
document.getElementById('dsgAddRectBtn').addEventListener('click', ()=>dsgAddShape('rect'));
document.getElementById('dsgAddCircleBtn').addEventListener('click', ()=>dsgAddShape('circle'));
document.getElementById('dsgAddLineBtn').addEventListener('click', ()=>dsgAddShape('line'));
document.getElementById('dsgLockBtn').addEventListener('click', dsgToggleLock);
document.getElementById('dsgHideBtn').addEventListener('click', dsgToggleHidden);
document.getElementById('dsgFrontBtn').addEventListener('click', ()=>dsgReorder('front'));
document.getElementById('dsgBackBtn').addEventListener('click', ()=>dsgReorder('back'));
document.getElementById('dsgDuplicateBtn').addEventListener('click', dsgDuplicateSelected);
document.getElementById('dsgDeleteBtn').addEventListener('click', dsgDeleteSelected);
function dsgAlign(mode){
  const members = dsgGroupMembers();
  if(members.length<2) return;
  dsgPushHistory();
  const x0=Math.min(...members.map(m=>m.el.x)), x1=Math.max(...members.map(m=>m.el.x+m.el.w));
  const y0=Math.min(...members.map(m=>m.el.y)), y1=Math.max(...members.map(m=>m.el.y+m.el.h));
  members.forEach(m=>{
    if(mode==='left') m.el.x = x0;
    else if(mode==='right') m.el.x = x1-m.el.w;
    else if(mode==='hcenter') m.el.x = x0+(x1-x0-m.el.w)/2;
    else if(mode==='top') m.el.y = y0;
    else if(mode==='bottom') m.el.y = y1-m.el.h;
    else if(mode==='vcenter') m.el.y = y0+(y1-y0-m.el.h)/2;
  });
  renderDesignerStage();
  dsgSetSelection(members.map(m=>m.i));
}
function dsgDistribute(axis){
  const members = dsgGroupMembers();
  if(members.length<3) return;
  dsgPushHistory();
  const key = axis==='h' ? 'x' : 'y';
  const size = axis==='h' ? 'w' : 'h';
  const sorted = members.slice().sort((a,b)=>a.el[key]-b.el[key]);
  const first = sorted[0], last = sorted[sorted.length-1];
  const span = (last.el[key]+last.el[size]) - first.el[key];
  const totalSize = sorted.reduce((s,m)=>s+m.el[size],0);
  const gap = (span - totalSize) / (sorted.length-1);
  let cursor = first.el[key];
  sorted.forEach(m=>{
    m.el[key] = cursor;
    cursor += m.el[size] + gap;
  });
  renderDesignerStage();
  dsgSetSelection(members.map(m=>m.i));
}
document.getElementById('dsgAlignLeftBtn').addEventListener('click', ()=>dsgAlign('left'));
document.getElementById('dsgAlignHCenterBtn').addEventListener('click', ()=>dsgAlign('hcenter'));
document.getElementById('dsgAlignRightBtn').addEventListener('click', ()=>dsgAlign('right'));
document.getElementById('dsgAlignTopBtn').addEventListener('click', ()=>dsgAlign('top'));
document.getElementById('dsgAlignVCenterBtn').addEventListener('click', ()=>dsgAlign('vcenter'));
document.getElementById('dsgAlignBottomBtn').addEventListener('click', ()=>dsgAlign('bottom'));
document.getElementById('dsgDistHBtn').addEventListener('click', ()=>dsgDistribute('h'));
document.getElementById('dsgDistVBtn').addEventListener('click', ()=>dsgDistribute('v'));
document.getElementById('dsgZoomInBtn').addEventListener('click', ()=>{ dsgScale = Math.min(24, dsgScale*1.2); renderDesignerStage(); });
document.getElementById('dsgZoomOutBtn').addEventListener('click', ()=>{ dsgScale = Math.max(1, dsgScale/1.2); renderDesignerStage(); });
document.getElementById('dsgZoomResetBtn').addEventListener('click', ()=>{ dsgFitScale = dsgComputeFitScale(); dsgScale = dsgFitScale; renderDesignerStage(); });
designerStage.addEventListener('pointerdown', (e)=>{
  if(e.target !== designerStage) return;
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const rect = designerStage.getBoundingClientRect();
  const startX = e.clientX, startY = e.clientY;
  const box = document.createElement('div');
  box.className = 'dsg-marquee';
  designerStage.appendChild(box);
  designerStage.setPointerCapture(e.pointerId);
  function move(ev){
    const x0=startX-rect.left, y0=startY-rect.top;
    const x1=ev.clientX-rect.left, y1=ev.clientY-rect.top;
    box.style.left=Math.min(x0,x1)+'px'; box.style.top=Math.min(y0,y1)+'px';
    box.style.width=Math.abs(x1-x0)+'px'; box.style.height=Math.abs(y1-y0)+'px';
  }
  function up(ev){
    designerStage.removeEventListener('pointermove', move);
    designerStage.removeEventListener('pointerup', up);
    designerStage.releasePointerCapture(ev.pointerId);
    const mLeft=Math.min(startX,ev.clientX)-rect.left, mRight=Math.max(startX,ev.clientX)-rect.left;
    const mTop=Math.min(startY,ev.clientY)-rect.top, mBottom=Math.max(startY,ev.clientY)-rect.top;
    box.remove();
    const hits=[];
    (state.canvasElements||[]).forEach((el,i)=>{
      if(el.hidden) return;
      const ex0=el.x*dsgScale, ey0=el.y*dsgScale, ex1=ex0+el.w*dsgScale, ey1=ey0+el.h*dsgScale;
      if(ex0<mRight && ex1>mLeft && ey0<mBottom && ey1>mTop) hits.push(i);
    });
    if(additive){
      const merged = new Set(dsgSelectedIdxs);
      hits.forEach(i=>merged.add(i));
      dsgSetSelection(Array.from(merged));
    }else{
      dsgSetSelection(hits);
    }
  }
  designerStage.addEventListener('pointermove', move);
  designerStage.addEventListener('pointerup', up);
});
designerStage.addEventListener('dragover', (e)=>{ e.preventDefault(); });
designerStage.addEventListener('drop', (e)=>{
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) dsgAddImageFromFile(f);
});
document.addEventListener('paste', (e)=>{
  if(designerOverlay.style.display!=='flex') return;
  const items = e.clipboardData && e.clipboardData.items;
  if(!items) return;
  for(const item of items){
    if(item.type && item.type.startsWith('image/')){
      const f = item.getAsFile();
      if(f) dsgAddImageFromFile(f);
      break;
    }
  }
});

function dsgEnsureSingleRow(){
  // ponytail: bulk-off editing always targets previewRows[0]; never touches other rows/length
  if(state.manualRows.length===0 && state.previewRows.length===0) return; // no real data yet -> stay empty, no phantom field
  if(state.previewRows.length===0) state.previewRows = [[]];
  const n = Math.max(1, currentFields().length || 1);
  const row = state.previewRows[0];
  while(row.length < n) row.push('');
}
function syncCanvasElements(){
  const [wMm,hMm] = getEffectiveSizeMm();
  if(!wMm || !hMm) return;
  dsgSizeMm = [wMm, hMm];
  // ponytail: field-sync only makes sense once real data rows exist, but the redraw below
  // must always run - manually-placed text/shape/image elements need to repaint regardless
  // of whether any data has been entered (syncCanvasElements is the app-wide redraw trigger,
  // not just the data-field-sync step, don't let one early return silently skip the other).
  if(state.previewRows.length>0){
    const fields = currentFields();
    const hasQR = state.qrField !== null && state.qrField !== undefined && state.qrField >= 0;
    const fieldsMatch = state.canvasElements
      && state.canvasElements.filter(e=>e.type==='field').length === fields.length
      && (!hasQR || state.canvasElements.some(e=>e.type==='qr'))
      && (hasQR || !state.canvasElements.some(e=>e.type==='qr'));
    if(!fieldsMatch){
      const kept = (state.canvasElements||[]).filter(e=>e.type==='image' || e.type==='shape');
      state.canvasElements = defaultCanvasElements(wMm, hMm).concat(kept);
    }
  }
  dsgFitScale = dsgComputeFitScale();
  dsgScale = dsgFitScale;
  renderDesignerStage();
}
window.addEventListener('resize', ()=>{
  dsgFitScale = dsgComputeFitScale();
  dsgScale = dsgFitScale;
  renderDesignerStage();
});
document.getElementById('designerResetBtn').addEventListener('click', ()=>{
  dsgPushHistory();
  state.canvasElements = defaultCanvasElements(dsgSizeMm[0], dsgSizeMm[1]);
  renderDesignerStage();
});
document.getElementById('designerUndoBtn').addEventListener('click', dsgUndo);
document.getElementById('designerRedoBtn').addEventListener('click', dsgRedo);
document.addEventListener('keydown', (e)=>{
  const tag = (e.target.tagName||'').toLowerCase();
  const typing = tag==='input' || tag==='textarea' || e.target.isContentEditable;
  if(typing) return;
  const mod = e.ctrlKey || e.metaKey;
  if(mod && e.key==='z' && !e.shiftKey){ e.preventDefault(); dsgUndo(); return; }
  if(mod && ((e.key==='z' && e.shiftKey) || e.key==='y')){ e.preventDefault(); dsgRedo(); return; }
  if(mod && e.key==='c'){ e.preventDefault(); dsgCopySelected(); return; }
  if(mod && e.key==='v'){ e.preventDefault(); dsgPasteClipboard(); return; }
  if(mod && e.key==='d'){ e.preventDefault(); dsgDuplicateSelected(); return; }
  if((e.key==='Delete' || e.key==='Backspace') && dsgSelectedIdx!==null){ e.preventDefault(); dsgDeleteSelected(); return; }
  if(dsgSelectedIdx!==null && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
    e.preventDefault();
    const idx = dsgSelectedIdx;
    const el = state.canvasElements[idx];
    if(!el || el.locked) return;
    dsgPushHistory();
    const step = e.shiftKey ? 2 : 0.5;
    const [wMm,hMm] = dsgSizeMm;
    if(e.key==='ArrowUp') el.y = Math.max(0, el.y-step);
    if(e.key==='ArrowDown') el.y = Math.min(hMm-el.h, el.y+step);
    if(e.key==='ArrowLeft') el.x = Math.max(0, el.x-step);
    if(e.key==='ArrowRight') el.x = Math.min(wMm-el.w, el.x+step);
    renderDesignerStage(); selectEl(idx);
  }
});

const sTxt=document.getElementById('sTxt');
const sDot=document.getElementById('sDot');
const progFill=document.getElementById('progFill');
const progShimmer=document.getElementById('progShimmer');

function setStatus(msg,col){
  sTxt.textContent=msg;sTxt.style.color=col;
  sDot.style.background=col;sDot.style.boxShadow='none';
}
function setProgress(pct,col,shimmer){
  progFill.style.width=pct+'%';
  curveCtrl.setTarget(pct/100);
  if(col){
    progFill.style.background=col;
    progFill.style.boxShadow='none';
  }
  progShimmer.classList.toggle('on', !!shimmer);
}

const fileInput=document.getElementById('fileInput');
const filePill=document.getElementById('filePill');
const browseBtn=document.getElementById('browseBtn');
function syncBulkUI(){
  document.body.classList.toggle('bulk-off', !state.bulkMode);
  const btn = document.getElementById('bulkToggleBtn');
  if(btn) btn.setAttribute('aria-checked', state.bulkMode ? 'true' : 'false');
  const isExcel = state.dataSourceMode === 'excel';
  document.getElementById('fileRow')?.classList.toggle('hidden', !isExcel);
  document.getElementById('manualRow')?.classList.toggle('hidden', isExcel);
  document.getElementById('excelCard')?.classList.toggle('active', isExcel);
  document.getElementById('manualCard')?.classList.toggle('active', !isExcel);
  if(!state.bulkMode){ dsgEnsureSingleRow(); syncCanvasElements(); }
}
document.getElementById('bulkToggleBtn')?.addEventListener('click', ()=>{
  state.bulkMode = !state.bulkMode;
  syncBulkUI();
});
syncBulkUI();
document.getElementById('excelCard')?.addEventListener('click', ()=>{
  state.dataSourceMode = 'excel';
  syncBulkUI();
  setTimeout(()=>browseBtn.click(), 0);
});
document.getElementById('manualCard')?.addEventListener('click', ()=>{
  state.dataSourceMode = 'manual';
  syncBulkUI();
  document.getElementById('manualText')?.focus();
});

browseBtn.addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change', async (e)=>{
  const f=e.target.files[0];
  if(!f)return;
  state.file=f;
  state.fileName=f.name;
  filePill.textContent=f.name;
  filePill.classList.add('filled');
  setStatus(`Reading ${f.name}…`,'#4A4032');
  try{
    const rows = await readExcelFile(f);
    state.previewRows = rows;
    renderPreview();
    setStatus(`Loaded ${rows.length} rows  —  review below`,'#4A4032');
  }catch(err){
    setStatus(`Could not read file: ${err.message||err}`, '#A83232');
  }
});

const manualText=document.getElementById('manualText');
const manualAddBtn=document.getElementById('manualAddBtn');
const manualCount=document.getElementById('manualCount');
const manualList=document.getElementById('manualList');

function autosizeManualText(){
  manualText.style.height='auto';
  manualText.style.height=manualText.scrollHeight+'px';
}
manualText.addEventListener('input', autosizeManualText);
autosizeManualText();

function renderManualList(){
  manualList.innerHTML='';
  manualCount.textContent = `${state.manualRows.length} manual row${state.manualRows.length===1?'':'s'}`;
  state.manualRows.forEach((row,i)=>{
    const item=document.createElement('div');
    item.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:var(--surface);border:1px solid var(--border);box-shadow:none';
    const span=document.createElement('span');
    span.textContent=row.join(' / ');
    span.style.cssText='flex:1;font-size:9px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600';
    span.contentEditable=true;
    span.addEventListener('blur',()=>{
      state.manualRows[i]=span.textContent.split('/').map(v=>v.trim().toUpperCase());
      renderManualList();
    });
    const del=document.createElement('span');
    del.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    del.style.cssText='display:inline-flex;align-items:center;cursor:pointer;color:var(--red-ink);flex-shrink:0';
    del.addEventListener('click',()=>{
      state.manualRows.splice(i,1);
      renderManualList();
    });
    item.appendChild(span);
    item.appendChild(del);
    manualList.appendChild(item);
  });
}

manualAddBtn.addEventListener('click',()=>{
  const lines = manualText.value.split('\n').map(l=>l.trim()).filter(Boolean);
  const rawVals = lines.map(l=>l.split(',').map(v=>v.trim().toUpperCase()));
  const n = Math.max(1, state.previewRows[0]?.length||0, ...rawVals.map(v=>v.length));
  const pad = r => { r=r.slice(0,n); while(r.length<n) r.push(''); return r; };
  const parsed = rawVals.map(pad);
  state.previewRows = state.previewRows.map(pad).concat(parsed);
  state.manualRows = state.manualRows.concat(parsed);
  manualText.value='';
  autosizeManualText();
  renderManualList();
  renderPreview();
  setStatus(`Added ${parsed.length} manual rows`, '#4A4032');
});

const previewWrap=document.getElementById('previewWrap');
const previewList=document.getElementById('previewList');
const previewCount=document.getElementById('previewCount');

function renderPreview(){
  updateLock();
  renderLabelPreview();
  syncCanvasElements();
  previewList.innerHTML='';
  if(state.previewRows.length===0){
    previewWrap.style.display='none';
    return;
  }
  previewWrap.style.display='flex';
  const hasCodeField = state.qrField!==null && state.qrField!==undefined && state.qrField>=0;
  const checkCode = hasCodeField && (state.codeType==='ean13' || state.codeType==='upc');
  const effRows = withSerials(state.previewRows);
  let invalidCount = 0;
  state.previewRows.forEach((rawRow,i)=>{
    const row = effRows[i];
    const issue = checkCode ? codeValidationIssue(row[state.qrField], state.codeType) : null;
    if(issue) invalidCount++;
    const item=document.createElement('div');
    item.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:var(--surface);'
      +(issue ? 'border:1px solid var(--red-ink);' : 'border:1px solid var(--border);')
      +'box-shadow:none';
    if(issue) item.title = issue;
    const idx=document.createElement('span');
    idx.textContent=i+1;
    idx.style.cssText='font-size:8px;color:var(--text-muted);flex-shrink:0;width:14px;font-weight:700';
    const span=document.createElement('span');
    span.textContent=row.join(' / ');
    span.style.cssText='flex:1;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;color:'
      +(issue ? 'var(--red-ink)' : 'var(--text-primary)');
    span.contentEditable=true;
    span.addEventListener('blur',()=>{
      state.previewRows[i]=span.textContent.split('/').map(v=>v.trim().toUpperCase());
      renderPreview();
    });
    const del=document.createElement('span');
    del.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    del.style.cssText='display:inline-flex;align-items:center;cursor:pointer;color:var(--red-ink);flex-shrink:0';
    del.addEventListener('click',()=>{
      state.previewRows.splice(i,1);
      renderPreview();
    });
    item.appendChild(idx);
    if(issue){
      const warn=document.createElement('span');
      warn.textContent='âš ';
      warn.title=issue;
      warn.style.cssText='color:var(--red-ink);font-size:11px;flex-shrink:0';
      item.appendChild(warn);
    }
    item.appendChild(span);
    item.appendChild(del);
    previewList.appendChild(item);
  });
  previewCount.textContent = invalidCount>0
    ? `${state.previewRows.length} row${state.previewRows.length===1?'':'s'} Â· ${invalidCount} bad checksum${invalidCount===1?'':'s'}`
    : `${state.previewRows.length} row${state.previewRows.length===1?'':'s'}`;
  previewCount.style.color = invalidCount>0 ? 'var(--red-ink)' : 'var(--text-muted)';
}

function cleanNamePhone(rawName, rawPhone){
  let name = String(rawName||'').replace(/\u00a0/g,' ').trim();
  let phone = String(rawPhone||'').trim();
  phone = phone.replace(/\.0$/, '');
  const m = name.match(/\b(\d{10})\b/);
  if(m){
    if(!phone || phone==='None' || phone==='nan') phone = m[1];
    name = name.replace(m[0],'').trim();
  }
  name = name.replace(/\s+/g,' ').trim().toUpperCase();
  if(phone==='None'||phone==='nan') phone='';
  return [name, phone];
}

function cellStr(v){
  if(v===undefined || v===null) return '';
  if(typeof v === 'number'){
    return Number.isInteger(v) ? String(v) : String(v);
  }
  return String(v).trim();
}

async function readExcelFile(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type:'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });

  const clean = raw
    .map(r => (r||[]).map(cellStr))
    .filter(vals => vals.some(v=>v!==''));
  const n = Math.max(1, ...clean.map(r=>r.length));
  return clean.map(vals=>{
    vals = vals.slice(0,n);
    while(vals.length < n) vals.push('');
    return vals.map(v=>v.toUpperCase());
  });
}

function hexToRgb(hex){
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'#666666');
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [102,102,102];
}
function withOpacity(doc, opacity, fn){
  if(opacity!==undefined && opacity<1 && doc.GState){
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({opacity, 'stroke-opacity': opacity}));
    fn();
    doc.restoreGraphicsState();
  } else {
    fn();
  }
}
function rotatePointDeg(px, py, cx, cy, deg){
  const rad = deg * Math.PI/180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = px-cx, dy = py-cy;
  return [cx + dx*cos - dy*sin, cy + dx*sin + dy*cos];
}
function drawShapeInPdf(doc, el, offsetX, offsetY){
  const x = offsetX+el.x, y = offsetY+el.y, w = el.w, h = el.h;
  const cx = x+w/2, cy = y+h/2;
  const rot = el.rotation || 0;
  if(el.shapeKind==='line'){
    const color = (el.fill && el.fill!=='none') ? el.fill : ((el.stroke && el.stroke!=='none') ? el.stroke : '#3D5A85');
    const [r,g,b] = hexToRgb(color);
    doc.setDrawColor(r,g,b);
    doc.setLineWidth(Math.max(0.2, h));
    const [x1,y1] = rotatePointDeg(x, cy, cx, cy, rot);
    const [x2,y2] = rotatePointDeg(x+w, cy, cx, cy, rot);
    doc.line(x1, y1, x2, y2);
    return;
  }
  const hasFill = el.fill && el.fill!=='none';
  const hasStroke = el.stroke && el.stroke!=='none';
  if(!hasFill && !hasStroke) return;
  const sw = el.strokeWidth>0 ? el.strokeWidth : 0.3;
  if(hasFill){ const [r,g,b]=hexToRgb(el.fill); doc.setFillColor(r,g,b); }
  if(hasStroke){ const [r,g,b]=hexToRgb(el.stroke); doc.setDrawColor(r,g,b); doc.setLineWidth(sw); }
  const style = hasFill && hasStroke ? 'FD' : hasFill ? 'F' : 'D';
  if(el.shapeKind==='circle'){
    doc.ellipse(cx, cy, w/2, h/2, style);
  } else {
    // rect: rotate corners about center, draw as closed polygon (jsPDF has no native rotated-rect primitive)
    const corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([px,py])=>rotatePointDeg(px,py,cx,cy,rot));
    const [start, ...rest] = corners;
    const deltas = [];
    let prev = start;
    for(const pt of rest){ deltas.push([pt[0]-prev[0], pt[1]-prev[1]]); prev = pt; }
    doc.lines(deltas, start[0], start[1], [1,1], style, true);
  }
  // draw text inside shape
  if(el.text && el.text.trim()){
    const fontFamily = FONTS[el.font || state.design.font] || 'helvetica';
    const align = ALIGNS[el.align] || 'center';
    const sz = (el.fontSize>0) ? el.fontSize : (state.design.fontSize>0 ? state.design.fontSize : Math.min(22, Math.max(6, h*2.2)));
    doc.setFont(fontFamily, (el.bold ? 'bold' : 'normal') + (el.italic ? 'italic' : ''));
    doc.setFontSize(sz * 0.3528);
    const [r,g,b] = hexToRgb(el.color || '#000000');
    doc.setTextColor(r,g,b);
    if(el.underline){
      const textWidth = doc.getTextWidth(el.text);
      let textX = x + (w - textWidth) / 2;
      if(align === 'left') textX = x + 0.5;
      else if(align === 'right') textX = x + w - textWidth - 0.5;
      doc.text(el.text, textX, cy + sz * 0.3528 * 0.35, { angle: rot });
      // underline
      doc.setDrawColor(r,g,b);
      doc.setLineWidth(0.1);
      const ulY = cy + sz * 0.3528 * 0.35 + 0.3;
      doc.line(textX, ulY, textX + textWidth, ulY);
    } else {
      let textX = x + (w - doc.getTextWidth(el.text)) / 2;
      if(align === 'left') textX = x + 0.5;
      else if(align === 'right') textX = x + w - doc.getTextWidth(el.text) - 0.5;
      doc.text(el.text, textX, cy + sz * 0.3528 * 0.35, { angle: rot });
    }
  }
}
function qrToDataURL(text, sizePx){
  return new Promise((resolve, reject)=>{
    const div = document.createElement('div');
    div.style.cssText='position:absolute;left:-9999px;top:-9999px';
    document.body.appendChild(div);
    try{
      new QRCode(div, {
        text: text||' ',
        width: sizePx, height: sizePx,
        colorDark:'#000000', colorLight:'#ffffff',
        correctLevel: QRCode.CorrectLevel[state.qrErrorCorrection] || QRCode.CorrectLevel.M,
      });
      function extract(){
        const canvas = div.querySelector('canvas');
        if(canvas){
          const url = canvas.toDataURL('image/png');
          document.body.removeChild(div);
          resolve(url);
          return true;
        }
        const img = div.querySelector('img');
        if(img && img.complete && img.naturalWidth > 0){
          document.body.removeChild(div);
          resolve(img.src);
          return true;
        }
        return false;
      }
      if(extract()) return;
      const img = div.querySelector('img');
      if(img){
        img.onload = ()=>{ extract(); };
        img.onerror = ()=>{ document.body.removeChild(div); reject(new Error('QR img failed')); };
      }
      setTimeout(()=>{
        if(div.parentNode){
          if(!extract()){
            document.body.removeChild(div);
            reject(new Error('QR render timeout'));
          }
        }
      }, 1000);
    }catch(e){ if(div.parentNode) document.body.removeChild(div); reject(e); }
  });
}
function barcodeToDataURL(text, bcFormat, heightPx, displayValue){
  return new Promise((resolve, reject)=>{
    try{
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, text||' ', {
        format: bcFormat,
        width: 2,
        height: heightPx,
        margin: 0,
        displayValue: !!displayValue,
      });
      resolve(canvas.toDataURL('image/png'));
    }catch(e){ reject(e); }
  });
}
function codeToDataURL(text, codeType, displayValue){
  const cfg = CODE_TYPES[codeType] || CODE_TYPES.qr;
  if(cfg.family==='square') return qrToDataURL(text, 128);
  return barcodeToDataURL(text, cfg.bcFormat, 80, displayValue);
}

function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function roundRectPath(ctx,x,y,w,h,r){
  r = Math.max(0, Math.min(r, w/2, h/2));
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
let previewRenderToken = 0;
async function renderLabelPreview(){
  const canvas = document.getElementById('labelPreviewCanvas');
  const caption = document.getElementById('labelPreviewCaption');
  if(!canvas || !caption) return;
  if(state.previewRows.length===0) return;
  const [labelWmm, labelHmm] = getEffectiveSizeMm();
  if(!labelWmm || !labelHmm) return;

  const myToken = ++previewRenderToken; // ponytail: a slow QR fetch from a stale call landing after a newer one just gets discarded below  —  no real cancel API needed for a canvas redraw

  const design = state.design || {};
  const useCanvas = !!design.useCanvas && Array.isArray(state.canvasElements) && state.canvasElements.length>0;
  const fontFamily = PREVIEW_FONTS[design.font] || PREVIEW_FONTS.Helvetica;
  const align = ALIGNS[design.align] || 'center';
  const rowData = state.previewRows[0];
  const n = Math.max(1, rowData.length);
  const hasQR = state.qrField !== null && state.qrField !== undefined && state.qrField >= 0;
  const codeFamily = (CODE_TYPES[state.codeType] || CODE_TYPES.qr).family;

  const scale = Math.min(320/labelWmm, 400/labelHmm);
  canvas.width = Math.round(labelWmm*scale);
  canvas.height = Math.round(labelHmm*scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const MARGIN = 2;
  const CODE_H_MM = hasQR ? Math.min(labelHmm-MARGIN*2, 12) : 0;
  const CODE_W_MM = hasQR ? (codeFamily==='linear' ? Math.min(labelWmm*0.42,32) : CODE_H_MM) : 0;

  let codeImg = null;
  if(hasQR){
    const text = String(rowData[state.qrField] ?? '').trim();
    try{
      const url = await codeToDataURL(text, state.codeType, design.barcodeDisplayValue);
      codeImg = await loadImage(url);
    }catch(e){ codeImg = null; }
  }
  if(myToken !== previewRenderToken) return;

  if(design.border){
    ctx.strokeStyle = design.borderColor || '#666666';
    const lw = Math.max(1, 0.4*scale);
    ctx.lineWidth = lw;
    roundRectPath(ctx, lw/2, lw/2, canvas.width-lw, canvas.height-lw, (design.radius||0)*scale);
    ctx.stroke();
  }

  ctx.fillStyle = design.color || '#000000';
  ctx.textBaseline = 'alphabetic';

  if(useCanvas){
    state.canvasElements.forEach(el=>{
      if(el.hidden || el.type==='shape' || el.type==='image') return; // ponytail: shapes/images skipped  —  rare in practice, image-loading + shape-path translation is real added complexity for a preview that already covers the common case
      ctx.globalAlpha = el.opacity ?? 1;
      if(el.type==='qr'){
        if(codeImg) ctx.drawImage(codeImg, el.x*scale, el.y*scale, el.w*scale, el.h*scale);
      } else if(el.type==='field' || el.type==='text'){
        const text = el.type==='text' ? String(el.text ?? '').trim() : String(rowData[el.fieldIdx] ?? '').trim();
        const boxWpx = Math.max(1, (el.w-1)*scale);
        const autoSz = Math.min(22, Math.max(6, el.h*2.2));
        let sz = (el.fontSize>0) ? el.fontSize : (design.fontSize>0 ? design.fontSize : autoSz);
        ctx.font = `${design.italic?'italic ':''}${design.bold?'bold ':''}${sz*0.3528*scale}px ${fontFamily}`;
        let w = ctx.measureText(text).width;
        while(w > boxWpx && sz > 4){ sz -= 0.5; ctx.font = `${design.italic?'italic ':''}${design.bold?'bold ':''}${sz*0.3528*scale}px ${fontFamily}`; w = ctx.measureText(text).width; }
        const elXpx = el.x*scale, elWpx = el.w*scale;
        let x;
        if(align==='left') x = elXpx;
        else if(align==='right') x = elXpx + (elWpx - w);
        else x = elXpx + (elWpx - w)/2;
        const y = (el.y + el.h/2 + sz*0.13) * scale;
        ctx.save();
        if(el.rotation){
          ctx.translate(Math.max(x,elXpx), y); ctx.rotate(el.rotation*Math.PI/180); ctx.fillText(text,0,0);
          if(design.underline){ ctx.strokeStyle=ctx.fillStyle; ctx.lineWidth=Math.max(1,sz*0.05*scale); ctx.beginPath(); ctx.moveTo(0,sz*0.12*scale); ctx.lineTo(w,sz*0.12*scale); ctx.stroke(); }
        } else {
          ctx.fillText(text, Math.max(x,elXpx), y);
          if(design.underline){ ctx.strokeStyle=ctx.fillStyle; ctx.lineWidth=Math.max(1,sz*0.05*scale); ctx.beginPath(); ctx.moveTo(Math.max(x,elXpx), y+sz*0.12*scale); ctx.lineTo(Math.max(x,elXpx)+w, y+sz*0.12*scale); ctx.stroke(); }
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    });
  } else {
    const textWmm = labelWmm - MARGIN*2 - (hasQR ? CODE_W_MM+1 : 0);
    const maxFontByHeight = (labelHmm-MARGIN*2)/n * 2.5;
    const autoSize = Math.min(22, Math.max(6, maxFontByHeight));
    const BASE_SIZE = design.fontSize>0 ? design.fontSize : autoSize;
    const spacing = (labelHmm-MARGIN*2)/n;
    const firstY = MARGIN + spacing/2 + BASE_SIZE*0.12;
    const textWpx = textWmm*scale;
    rowData.forEach((text,j)=>{
      text = String(text ?? '').trim();
      let sz = BASE_SIZE;
      ctx.font = `${design.italic?'italic ':''}${design.bold?'bold ':''}${sz*0.3528*scale}px ${fontFamily}`;
      let w = ctx.measureText(text).width;
      while(w > textWpx && sz > 6){ sz -= 0.5; ctx.font = `${design.italic?'italic ':''}${design.bold?'bold ':''}${sz*0.3528*scale}px ${fontFamily}`; w = ctx.measureText(text).width; }
      let x;
      if(align==='left') x = MARGIN*scale;
      else if(align==='right') x = MARGIN*scale + (textWpx - w);
      else x = MARGIN*scale + (textWpx - w)/2;
      const _ty = (firstY + j*spacing) * scale, _tx = Math.max(x, MARGIN*scale);
      ctx.fillText(text, _tx, _ty);
      if(design.underline){ ctx.strokeStyle=ctx.fillStyle; ctx.lineWidth=Math.max(1,sz*0.05*scale); ctx.beginPath(); ctx.moveTo(_tx, _ty+sz*0.12*scale); ctx.lineTo(_tx+w, _ty+sz*0.12*scale); ctx.stroke(); }
    });
    if(hasQR && codeImg){
      ctx.drawImage(codeImg, (labelWmm-MARGIN-CODE_W_MM)*scale, ((labelHmm-CODE_H_MM)/2)*scale, CODE_W_MM*scale, CODE_H_MM*scale);
    }
  }

  caption.textContent = `${labelWmm}mm × ${labelHmm}mm Â· sample from row 1 of ${state.previewRows.length}`;
}

function eanChecksumOk(digits){
  const body = digits.length===13 ? digits.slice(0,12) : digits;
  const provided = digits.length===13 ? Number(digits[12]) : null;
  let sum=0;
  for(let i=0;i<12;i++) sum += Number(body[i]) * (i%2===0 ? 1 : 3);
  if(provided===null) return true;
  return ((10 - (sum%10))%10) === provided;
}
function upcChecksumOk(digits){
  const body = digits.length===12 ? digits.slice(0,11) : digits;
  const provided = digits.length===12 ? Number(digits[11]) : null;
  let sum=0;
  for(let i=0;i<11;i++) sum += Number(body[i]) * (i%2===0 ? 3 : 1);
  if(provided===null) return true;
  return ((10 - (sum%10))%10) === provided;
}
function codeValidationIssue(text, codeType){
  text = String(text||'').trim();
  if(codeType==='ean13'){
    if(!/^\d{12,13}$/.test(text)) return 'EAN-13 needs 12â€“13 digits';
    if(!eanChecksumOk(text)) return 'bad EAN-13 check digit';
  }else if(codeType==='upc'){
    if(!/^\d{11,12}$/.test(text)) return 'UPC-A needs 11â€“12 digits';
    if(!upcChecksumOk(text)) return 'bad UPC-A check digit';
  }
  return null;
}

async function generatePdf(rows, labelWmm, labelHmm, qrFieldIdx, layout, design, canvasElements, codeType, showMarks=true){
  const { jsPDF } = window.jspdf;
  layout = layout || { cols:1, rows:1, gap:2 };
  design = design || { font:'Helvetica', align:'Center', border:false, borderColor:'#666666', radius:0 };
  const useCanvas = !!design.useCanvas && Array.isArray(canvasElements) && canvasElements.length>0;
  const multiUp = layout.cols > 1 || layout.rows > 1;
  const fontName = FONTS[design.font] || 'helvetica';
  const align = ALIGNS[design.align] || 'center';

  const gridW = layout.cols * labelWmm + (layout.cols-1) * (layout.gap ?? 2);
  const gridH = layout.rows * labelHmm + (layout.rows-1) * (layout.gap ?? 2);
  const SHEET_W = multiUp ? (gridW > 210 ? 297 : 210) : labelWmm;
  const SHEET_H = multiUp ? (gridW > 210 ? 210 : 297) : labelHmm;
  const sheetOrientation = SHEET_W >= SHEET_H ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation: sheetOrientation, unit:'mm', format:[SHEET_W, SHEET_H] });

  const GAP = multiUp ? (layout.gap ?? 2) : 0;
  const SHEET_MARGIN = multiUp ? (layout.margin ?? 10) : 0;
  const gridTotalW = layout.cols * labelWmm + (layout.cols-1)*GAP;
  const gridStartX = multiUp ? (SHEET_W - gridTotalW) / 2 : 0;
  const gridStartY = multiUp ? SHEET_MARGIN : 0;
  const MARGIN = 2;
  const n = rows[0].length;
  const hasQR = qrFieldIdx !== null && qrFieldIdx !== undefined && qrFieldIdx >= 0;
  const codeFamily = (CODE_TYPES[codeType] || CODE_TYPES.qr).family;

  const CODE_H_MM = hasQR ? Math.min(labelHmm - MARGIN*2, 12) : 0;
  const CODE_W_MM = hasQR ? (codeFamily==='linear' ? Math.min(labelWmm*0.42, 32) : CODE_H_MM) : 0;
  const textW = labelWmm - MARGIN*2 - (hasQR ? CODE_W_MM + 1 : 0);

  const maxFontByHeight = (labelHmm - MARGIN*2) / n * 2.5;
  const autoSize = Math.min(22, Math.max(6, maxFontByHeight));
  const BASE_SIZE = design.fontSize > 0 ? design.fontSize : autoSize;
  const spacing = (labelHmm - MARGIN*2) / n;
  const firstY = MARGIN + spacing/2 + BASE_SIZE*0.12;

  let codeImages = [];
  let skippedCount = 0;
  if(hasQR){
    const results = await Promise.allSettled(
      rows.map(row => {
        const text = String(row[qrFieldIdx]||'').trim();
        return codeToDataURL(text, codeType, design.barcodeDisplayValue);
      })
    );
    for(const r of results){
      if(r.status === 'fulfilled'){ codeImages.push(r.value); }
      else { codeImages.push(null); skippedCount++; }
    }
  }

  const labelsPerSheet = layout.cols * layout.rows;
  let labelIdx = 0;

  while(labelIdx < rows.length){
    if(labelIdx > 0 && labelIdx % labelsPerSheet === 0){
      doc.addPage([SHEET_W, SHEET_H], sheetOrientation);
    }
    const posOnSheet = labelIdx % labelsPerSheet;
    const col = posOnSheet % layout.cols;
    const row = Math.floor(posOnSheet / layout.cols);

    const offsetX = multiUp ? gridStartX + col * (labelWmm + GAP) : 0;
    const offsetY = multiUp ? gridStartY + row * (labelHmm + GAP) : 0;

    const rowData = rows[labelIdx];

    if(multiUp && showMarks){
      doc.setDrawColor(180);
      doc.setLineWidth(0.2);
      if(design.radius > 0) doc.roundedRect(offsetX, offsetY, labelWmm, labelHmm, design.radius, design.radius);
      else doc.rect(offsetX, offsetY, labelWmm, labelHmm);
    }
    if(design.border){
      const [r,g,b] = hexToRgb(design.borderColor);
      doc.setDrawColor(r,g,b);
      doc.setLineWidth(0.4);
      if(design.radius > 0) doc.roundedRect(offsetX, offsetY, labelWmm, labelHmm, design.radius, design.radius);
      else doc.rect(offsetX, offsetY, labelWmm, labelHmm);
    }

    const _fStyle = (design.bold && design.italic) ? 'bolditalic' : design.bold ? 'bold' : design.italic ? 'italic' : 'normal';
    doc.setFont(fontName, _fStyle);
    const [_tr,_tg,_tb] = hexToRgb(design.color);
    doc.setTextColor(_tr,_tg,_tb);
    if(useCanvas){
      canvasElements.forEach(el=>{
        if(el.hidden) return;
        const opacity = el.opacity ?? 1;
        if(el.type==='qr'){
          if(hasQR && codeImages[labelIdx]){
            withOpacity(doc, opacity, ()=>{
              doc.addImage(codeImages[labelIdx], 'PNG', offsetX+el.x, offsetY+el.y, el.w, el.h, undefined, undefined, el.rotation||0);
            });
          }
          return;
        }
        if(el.type==='image'){
          if(el.src){
            withOpacity(doc, opacity, ()=>{
              const fmt = /^data:image\/png/i.test(el.src) ? 'PNG' : /^data:image\/webp/i.test(el.src) ? 'WEBP' : 'JPEG';
              doc.addImage(el.src, fmt, offsetX+el.x, offsetY+el.y, el.w, el.h, undefined, undefined, el.rotation||0);
            });
          }
          return;
        }
        if(el.type==='shape'){
          withOpacity(doc, opacity, ()=>{ drawShapeInPdf(doc, el, offsetX, offsetY); });
          return;
        }
        if(el.type!=='field' && el.type!=='text') return;
        const text = el.type==='text' ? String(el.text ?? '').trim() : String(rowData[el.fieldIdx] ?? '').trim();
        const boxW = Math.max(1, el.w - 1);
        const autoSz = Math.min(22, Math.max(6, el.h*2.2));
        let sz = (el.fontSize > 0) ? el.fontSize : (design.fontSize > 0 ? design.fontSize : autoSz);
        doc.setFontSize(sz);
        let w = doc.getTextWidth(text);
        while(w > boxW && sz > 4){
          sz -= 0.5; doc.setFontSize(sz); w = doc.getTextWidth(text);
        }
        let x;
        if(align === 'left')        x = offsetX + el.x;
        else if(align === 'right')  x = offsetX + el.x + (el.w - w);
        else                        x = offsetX + el.x + (el.w - w)/2;
        const y = offsetY + el.y + el.h/2 + sz*0.13;
        withOpacity(doc, opacity, ()=>{
          if(el.rotation){
            doc.text(text, Math.max(x, offsetX+el.x), y, { angle: -el.rotation });
          } else {
            const ux = Math.max(x, offsetX+el.x);
            doc.text(text, ux, y);
            if(design.underline){
              doc.setDrawColor(_tr,_tg,_tb);
              doc.setLineWidth(Math.max(0.1, sz*0.04));
              doc.line(ux, y+sz*0.08, ux+w, y+sz*0.08);
            }
          }
        });
      });
    } else {
      rowData.forEach((text, j)=>{
        text = String(text||'').trim();
        const y = offsetY + firstY + j*spacing;
        let sz = BASE_SIZE;
        doc.setFontSize(sz);
        let w = doc.getTextWidth(text);
        while(w > textW && sz > 6){
          sz -= 0.5; doc.setFontSize(sz); w = doc.getTextWidth(text);
        }
        let x;
        if(align === 'left')        x = offsetX + MARGIN;
        else if(align === 'right')  x = offsetX + MARGIN + (textW - w);
        else                        x = offsetX + MARGIN + (textW - w)/2;
        const ux = Math.max(x, offsetX + MARGIN);
        doc.text(text, ux, y);
        if(design.underline){
          doc.setDrawColor(_tr,_tg,_tb);
          doc.setLineWidth(Math.max(0.1, sz*0.04));
          doc.line(ux, y+sz*0.08, ux+w, y+sz*0.08);
        }
      });
      if(hasQR && codeImages[labelIdx]){
        const codeX = offsetX + labelWmm - MARGIN - CODE_W_MM;
        const codeY = offsetY + (labelHmm - CODE_H_MM)/2;
        doc.addImage(codeImages[labelIdx], 'PNG', codeX, codeY, CODE_W_MM, CODE_H_MM);
      }
    }

    labelIdx++;
  }

  return { doc, skippedCount };
}

function mmToDots(mm, dpi){ return Math.round(mm * dpi / 25.4); }

function zplEscape(text){ return String(text ?? '').replace(/[\^~]/g, ''); }

function zplBarcodeField(codeType, text, heightDots){
  const t = zplEscape(text);
  switch(codeType){
    case 'code128': return `^BCN,${heightDots},Y,N,N\n^FD${t}^FS\n`;
    case 'code39':  return `^B3N,N,${heightDots},Y,N\n^FD${t}^FS\n`;
    case 'ean13':   return `^BEN,${heightDots},Y,N\n^FD${t}^FS\n`;
    case 'upc':     return `^BUN,${heightDots},Y,N\n^FD${t}^FS\n`;
    default:        return '';
  }
}

function generateZPL(rows, labelWmm, labelHmm, qrFieldIdx, design, canvasElements, codeType, dpi){
  dpi = dpi || 203;
  design = design || {};
  const useCanvas = !!design.useCanvas && Array.isArray(canvasElements) && canvasElements.length>0;
  const align = ALIGNS[design.align] || 'center';
  const justify = align==='left' ? 'L' : align==='right' ? 'R' : 'C';
  const hasQR = qrFieldIdx !== null && qrFieldIdx !== undefined && qrFieldIdx >= 0;
  const codeFamily = (CODE_TYPES[codeType] || CODE_TYPES.qr).family;
  const n = rows[0].length;

  const wDots = mmToDots(labelWmm, dpi);
  const hDots = mmToDots(labelHmm, dpi);
  const MARGIN = mmToDots(2, dpi);
  const CODE_H_DOTS = hasQR ? Math.min(hDots - MARGIN*2, mmToDots(12, dpi)) : 0;
  const CODE_W_DOTS = hasQR ? (codeFamily==='linear' ? Math.min(mmToDots(labelWmm*0.42, dpi), mmToDots(32, dpi)) : CODE_H_DOTS) : 0;
  const textWDots = wDots - MARGIN*2 - (hasQR ? CODE_W_DOTS + mmToDots(1, dpi) : 0);
  const qrMag = Math.max(1, Math.min(10, dpi>=300 ? 3 : 2));

  const MARGIN_MM_FALLBACK = 2;
  let skippedCount = 0;

  let out = '';
  for(const row of rows){
    out += '^XA\n^CI28\n';
    out += `^PW${wDots}\n^LL${hDots}\n`;
    out += `^BY2,3,${Math.max(1, CODE_H_DOTS || mmToDots(10,dpi))}\n`;

    if(useCanvas){
      canvasElements.forEach(el=>{
        if(el.hidden) return;
        if(el.type==='qr'){
          if(!hasQR) return;
          const text = String(row[qrFieldIdx] ?? '').trim();
          const x = mmToDots(el.x, dpi), y = mmToDots(el.y, dpi);
          if(codeFamily==='square'){
            out += `^FO${x},${y}^BQN,2,${qrMag}\n^FDMA,${zplEscape(text)}^FS\n`;
          } else {
            const issue = codeValidationIssue(text, codeType);
            if(issue){ skippedCount++; return; }
            out += `^FO${x},${y}` + zplBarcodeField(codeType, text, mmToDots(el.h, dpi));
          }
          return;
        }
        if(el.type!=='field' && el.type!=='text' && el.type!=='shape') return; // ponytail: image not supported in ZPL yet, skip rather than print "undefined"
        const isShape = el.type==='shape';
        const text = isShape ? String(el.text ?? '').trim() : (el.type==='text' ? String(el.text ?? '').trim() : String(row[el.fieldIdx] ?? '').trim());
        const szPt = isShape ? (el.fontSize>0 ? el.fontSize : (design.fontSize>0 ? design.fontSize : Math.min(22, Math.max(6, el.h*2.2)))) : (el.fontSize>0 ? el.fontSize : (design.fontSize>0 ? design.fontSize : Math.min(22, Math.max(6, el.h*2.2))));
        const szDots = mmToDots(szPt*0.3528, dpi);
        const wDotsBold = (isShape && el.bold) || design.bold ? Math.round(szDots*1.15) : szDots;
        const x = mmToDots(el.x, dpi), y = mmToDots(el.y, dpi);
        const w = Math.max(1, mmToDots(el.w, dpi));
        const shapeAlign = isShape ? (ALIGNS[el.align] || 'center') : align;
        const shapeJustify = shapeAlign==='left' ? 'L' : shapeAlign==='right' ? 'R' : 'C';
        out += `^FO${x},${y}^A0N,${szDots},${wDotsBold}^FB${w},1,0,${shapeJustify},0^FD${zplEscape(text)}^FS\n`;
        const shapeUnderline = isShape ? el.underline : design.underline;
        if(shapeUnderline){ const lt=Math.max(1,Math.round(szDots*0.06)); out += `^FO${x},${y+szDots}^GB${w},${lt},${lt}^FS\n`; }
      });
    } else {
      const spacing = (hDots - MARGIN*2) / n;
      const autoSizeMm = Math.min(22, Math.max(6, ((labelHmm - MARGIN_MM_FALLBACK*2) / n) * 2.5));
      const szPt = design.fontSize>0 ? design.fontSize : autoSizeMm;
      const szDots = mmToDots(szPt*0.3528, dpi);
      const wDotsBold = design.bold ? Math.round(szDots*1.15) : szDots;
      row.forEach((text, j)=>{
        text = String(text ?? '').trim();
        const y = MARGIN + Math.round(spacing*j + (spacing-szDots)/2);
        out += `^FO${MARGIN},${y}^A0N,${szDots},${wDotsBold}^FB${Math.max(1,textWDots)},1,0,${justify},0^FD${zplEscape(text)}^FS\n`;
        if(design.underline){ const lt=Math.max(1,Math.round(szDots*0.06)); out += `^FO${MARGIN},${y+szDots}^GB${Math.max(1,textWDots)},${lt},${lt}^FS\n`; }
      });
      if(hasQR){
        const text = String(row[qrFieldIdx] ?? '').trim();
        const x = wDots - MARGIN - CODE_W_DOTS;
        const y = Math.round((hDots - CODE_H_DOTS)/2);
        if(codeFamily==='square'){
          out += `^FO${x},${y}^BQN,2,${qrMag}\n^FDMA,${zplEscape(text)}^FS\n`;
        } else {
          const issue = codeValidationIssue(text, codeType);
          if(issue){ skippedCount++; }
          else out += `^FO${x},${y}` + zplBarcodeField(codeType, text, CODE_H_DOTS);
        }
      }
    }
    out += '^XZ\n';
  }
  return { zpl: out, skippedCount };
}

function generateEPL(rows, labelWmm, labelHmm, qrFieldIdx, design, canvasElements, codeType, dpi){
  dpi = dpi || 203;
  design = design || {};
  const useCanvas = !!design.useCanvas && Array.isArray(canvasElements) && canvasElements.length>0;
  const align = ALIGNS[design.align] || 'center';
  const justify = align==='left' ? '0' : align==='right' ? '2' : '1';
  const hasQR = qrFieldIdx !== null && qrFieldIdx !== undefined && qrFieldIdx >= 0;
  const codeFamily = (CODE_TYPES[codeType] || CODE_TYPES.qr).family;
  const n = rows[0].length;

  const wDots = mmToDots(labelWmm, dpi);
  const hDots = mmToDots(labelHmm, dpi);
  const MARGIN = mmToDots(2, dpi);
  const CODE_H_DOTS = hasQR ? Math.min(hDots - MARGIN*2, mmToDots(12, dpi)) : 0;
  const CODE_W_DOTS = hasQR ? (codeFamily==='linear' ? Math.min(mmToDots(labelWmm*0.42, dpi), mmToDots(32, dpi)) : CODE_H_DOTS) : 0;
  const textWDots = wDots - MARGIN*2 - (hasQR ? CODE_W_DOTS + mmToDots(1, dpi) : 0);

  let skippedCount = 0;

  function eplBarcodeField(codeType, text, heightDots){
    const t = String(text ?? '').replace(/[\\\"]/g, '');
    switch(codeType){
      case 'code128': return `B128,${heightDots},N,${t}\n`;
      case 'code39':  return `B3,3,${heightDots},N,${t}\n`;
      case 'ean13':   return `BE,3,${heightDots},N,${t}\n`;
      case 'upc':     return `BU,3,${heightDots},N,${t}\n`;
      default:        return '';
    }
  }

  let out = '';
  for(const row of rows){
    out += 'N\n';
    out += `q${wDots}\n`;
    out += `Q${hDots},0\n`;

    if(useCanvas){
      canvasElements.forEach(el=>{
        if(el.hidden) return;
        if(el.type==='qr'){
          if(!hasQR) return;
          const text = String(row[qrFieldIdx] ?? '').trim();
          const x = mmToDots(el.x, dpi), y = mmToDots(el.y, dpi);
          if(codeFamily==='square'){
            out += `b${x},${y},M,${text.replace(/[\\\"]/g, '')}\n`;
          } else {
            const issue = codeValidationIssue(text, codeType);
            if(issue){ skippedCount++; return; }
            out += `b${x},${y},` + eplBarcodeField(codeType, text, mmToDots(el.h, dpi));
          }
          return;
        }
        if(el.type!=='field' && el.type!=='text') return; // ponytail: image/shape not supported in EPL yet, skip rather than print "undefined"
        const text = el.type==='text' ? String(el.text ?? '').trim() : String(row[el.fieldIdx] ?? '').trim();
        const szPt = el.fontSize>0 ? el.fontSize : (design.fontSize>0 ? design.fontSize : Math.min(22, Math.max(6, el.h*2.2)));
        const x = mmToDots(el.x, dpi), y = mmToDots(el.y, dpi);
        const hMult = design.bold ? 2 : 1;
        out += `A${x},${y},0,1,${hMult},1,N,"${zplEscape(text)}"\n`;
        if(design.underline){ const lh=Math.max(1,mmToDots(0.3,dpi)); out += `LO${x},${y+mmToDots(szPt*0.3528,dpi)},${mmToDots(el.w,dpi)},${lh}\n`; }
      });
    } else {
      const spacing = (hDots - MARGIN*2) / n;
      const autoSizeMm = Math.min(22, Math.max(6, ((labelHmm - 2*2) / n) * 2.5));
      const szPt = design.fontSize>0 ? design.fontSize : autoSizeMm;
      const hMult = design.bold ? 2 : 1;
      row.forEach((text, j)=>{
        text = String(text ?? '').trim();
        const y = MARGIN + Math.round(spacing*j + (spacing-mmToDots(szPt*0.3528, dpi))/2);
        out += `A${MARGIN},${y},0,1,${hMult},1,N,"${zplEscape(text)}"\n`;
        if(design.underline){ const lh=Math.max(1,mmToDots(0.3,dpi)); out += `LO${MARGIN},${y+mmToDots(szPt*0.3528,dpi)},${Math.max(1,textWDots)},${lh}\n`; }
      });
      if(hasQR){
        const text = String(row[qrFieldIdx] ?? '').trim();
        const x = wDots - MARGIN - CODE_W_DOTS;
        const y = Math.round((hDots - CODE_H_DOTS)/2);
        if(codeFamily==='square'){
          out += `b${x},${y},M,${text.replace(/[\\\"]/g, '')}\n`;
        } else {
          const issue = codeValidationIssue(text, codeType);
          if(issue){ skippedCount++; }
          else out += `b${x},${y},` + eplBarcodeField(codeType, text, CODE_H_DOTS);
        }
      }
    }
    out += 'P1\n';
  }
  return { epl: out, skippedCount };
}

function tsplEscape(text){ return String(text ?? '').replace(/[\\"]/g, ''); }

function tsplBarcodeField(codeType, text, heightDots){
  const t = tsplEscape(text);
  switch(codeType){
    case 'code128': return `"128",${heightDots},1,0,2,2,"${t}"\n`;
    case 'code39':  return `"39",${heightDots},1,0,2,2,"${t}"\n`;
    case 'ean13':   return `"EAN13",${heightDots},1,0,2,2,"${t}"\n`;
    case 'upc':     return `"UPCA",${heightDots},1,0,2,2,"${t}"\n`;
    default:        return '';
  }
}

function generateTSPL(rows, labelWmm, labelHmm, qrFieldIdx, design, canvasElements, codeType, dpi){
  dpi = dpi || 203;
  design = design || {};
  const useCanvas = !!design.useCanvas && Array.isArray(canvasElements) && canvasElements.length>0;
  const hasQR = qrFieldIdx !== null && qrFieldIdx !== undefined && qrFieldIdx >= 0;
  const codeFamily = (CODE_TYPES[codeType] || CODE_TYPES.qr).family;
  const n = rows[0].length;

  const wDots = mmToDots(labelWmm, dpi);
  const hDots = mmToDots(labelHmm, dpi);
  const MARGIN = mmToDots(2, dpi);
  const CODE_H_DOTS = hasQR ? Math.min(hDots - MARGIN*2, mmToDots(12, dpi)) : 0;
  const CODE_W_DOTS = hasQR ? (codeFamily==='linear' ? Math.min(mmToDots(labelWmm*0.42, dpi), mmToDots(32, dpi)) : CODE_H_DOTS) : 0;
  // ponytail: TSPL QRCODE cell width is dots-per-module (1-10), not a magnification factor like ZPL's ^BQ  —  sized up a notch for a similar physical footprint at each DPI
  const qrCell = Math.max(1, Math.min(10, dpi>=300 ? 5 : 3));

  const MARGIN_MM_FALLBACK = 2;
  let skippedCount = 0;

  let out = '';
  for(const row of rows){
    out += `SIZE ${labelWmm} mm,${labelHmm} mm\nGAP 0,0\nDIRECTION 0\nCLS\n`;

    if(useCanvas){
      canvasElements.forEach(el=>{
        if(el.hidden) return;
        if(el.type==='qr'){
          if(!hasQR) return;
          const text = String(row[qrFieldIdx] ?? '').trim();
          const x = mmToDots(el.x, dpi), y = mmToDots(el.y, dpi);
          if(codeFamily==='square'){
            out += `QRCODE ${x},${y},M,${qrCell},A,0,"${tsplEscape(text)}"\n`;
          } else {
            const issue = codeValidationIssue(text, codeType);
            if(issue){ skippedCount++; return; }
            out += `BARCODE ${x},${y},` + tsplBarcodeField(codeType, text, mmToDots(el.h, dpi));
          }
          return;
        }
        if(el.type!=='field' && el.type!=='text') return; // ponytail: image/shape not supported in TSPL yet, skip rather than print garbage
        const text = el.type==='text' ? String(el.text ?? '').trim() : String(row[el.fieldIdx] ?? '').trim();
        const szPt = Math.max(6, Math.round(el.fontSize>0 ? el.fontSize : (design.fontSize>0 ? design.fontSize : Math.min(22, Math.max(6, el.h*2.2)))));
        const x = mmToDots(el.x, dpi), y = mmToDots(el.y, dpi);
        const xMultBold = design.bold ? Math.round(szPt*1.15) : szPt;
        // ponytail: font "0" is TSPL2's scalable TrueType font  —  x/y-mult become point sizes directly, same unit as szPt. No bounded-box alignment (left/center/right) yet, add via BLOCK if needed.
        out += `TEXT ${x},${y},"0",0,${xMultBold},${szPt},"${tsplEscape(text)}"\n`;
        if(design.underline){ const szDots=mmToDots(szPt*0.3528,dpi); const lt=Math.max(1,Math.round(szDots*0.06)); out += `BAR ${x},${y+szDots},${mmToDots(el.w,dpi)},${lt}\n`; }
      });
    } else {
      const spacing = (hDots - MARGIN*2) / n;
      const autoSizeMm = Math.min(22, Math.max(6, ((labelHmm - MARGIN_MM_FALLBACK*2) / n) * 2.5));
      const szPt = Math.max(6, Math.round(design.fontSize>0 ? design.fontSize : autoSizeMm));
      const szDots = mmToDots(szPt*0.3528, dpi);
      const xMultBold = design.bold ? Math.round(szPt*1.15) : szPt;
      row.forEach((text, j)=>{
        text = String(text ?? '').trim();
        const y = MARGIN + Math.round(spacing*j + (spacing-szDots)/2);
        out += `TEXT ${MARGIN},${y},"0",0,${xMultBold},${szPt},"${tsplEscape(text)}"\n`;
        if(design.underline){ const lt=Math.max(1,Math.round(szDots*0.06)); out += `BAR ${MARGIN},${y+szDots},${Math.max(1,wDots-MARGIN*2)},${lt}\n`; }
      });
      if(hasQR){
        const text = String(row[qrFieldIdx] ?? '').trim();
        const x = wDots - MARGIN - CODE_W_DOTS;
        const y = Math.round((hDots - CODE_H_DOTS)/2);
        if(codeFamily==='square'){
          out += `QRCODE ${x},${y},M,${qrCell},A,0,"${tsplEscape(text)}"\n`;
        } else {
          const issue = codeValidationIssue(text, codeType);
          if(issue){ skippedCount++; }
          else out += `BARCODE ${x},${y},` + tsplBarcodeField(codeType, text, CODE_H_DOTS);
        }
      }
    }
    out += 'PRINT 1,1\n';
  }
  return { tspl: out, skippedCount };
}

const EXPORT_FORMATS = ['PDF (sheet)', 'ZPL (Zebra thermal)', 'EPL (Eltron thermal)', 'TSPL (TSC thermal)'];
const DPI_LABELS = { '203 dpi (standard)': 203, '300 dpi (high-res)': 300 };
const exportFormatSelect = document.getElementById('exportFormatSelect');
const exportFormatOptions = document.getElementById('exportFormatOptions');
const exportFormatLabel = document.getElementById('exportFormatLabel');
const zplDpiSelect = document.getElementById('zplDpiSelect');
const zplDpiOptions = document.getElementById('zplDpiOptions');
const zplDpiLabel = document.getElementById('zplDpiLabel');
const zplNoteEl = document.getElementById('zplNote');

function syncExportFormatUI(){
  const isThermal = state.exportFormat.startsWith('ZPL') || state.exportFormat.startsWith('EPL') || state.exportFormat.startsWith('TSPL');
  const isPdf = !isThermal;
  zplDpiSelect.style.display = isThermal ? 'flex' : 'none';
  zplNoteEl.style.display = isThermal ? 'block' : 'none';
  const marksRow = document.getElementById('printMarksRow');
  if(marksRow){
    const l = getEffectiveLayout();
    marksRow.style.display = (!isThermal && (l.cols>1 || l.rows>1)) ? 'flex' : 'none';
  }
  if(typeof busy==='undefined' || !busy){
    const gt = document.getElementById('genText');
    if(gt){
      gt.textContent = isPdf ? 'GENERATE PDF' : 'DIRECT PRINT';
    }
  }
}
function buildExportFormatOptions(){
  exportFormatOptions.innerHTML='';
  EXPORT_FORMATS.forEach(key=>{
    const opt=document.createElement('div');
    opt.className='g-opt'+(key===state.exportFormat?' active':'');
    opt.textContent=key;
    opt.addEventListener('click',(e)=>{
      e.stopPropagation();
      state.exportFormat=key;
      exportFormatLabel.textContent=key;
      document.body.classList.add('export-chosen');
      closeAll();
      buildExportFormatOptions();
      syncExportFormatUI();
    });
    exportFormatOptions.appendChild(opt);
  });
}
buildExportFormatOptions();
exportFormatSelect.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen=exportFormatSelect.classList.contains('open');
  closeAll();
  if(!isOpen){
    exportFormatSelect.classList.add('open');
    exportFormatOptions.classList.add('open');
    const row=exportFormatSelect.closest('.form-row');
    if(row) row.classList.add('row-active');
    positionOpenDropdowns();
  }
});
function buildDpiOptions(){
  zplDpiOptions.innerHTML='';
  Object.keys(DPI_LABELS).forEach(key=>{
    const opt=document.createElement('div');
    opt.className='g-opt'+(key===state.dpi?' active':'');
    opt.textContent=key;
    opt.addEventListener('click',(e)=>{
      e.stopPropagation();
      state.dpi=key;
      zplDpiLabel.textContent=key;
      closeAll();
      buildDpiOptions();
    });
    zplDpiOptions.appendChild(opt);
  });
}
buildDpiOptions();
zplDpiSelect.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen=zplDpiSelect.classList.contains('open');
  closeAll();
  if(!isOpen){
    zplDpiSelect.classList.add('open');
    zplDpiOptions.classList.add('open');
    const row=zplDpiSelect.closest('.form-row');
    if(row) row.classList.add('row-active');
    positionOpenDropdowns();
  }
});

const genBtn=document.getElementById('genBtn');
const genWrap=document.getElementById('genWrap');
const genIcon=document.getElementById('genIcon');
const genText=document.getElementById('genText');

let busy=false;
genBtn.addEventListener('click', async ()=>{
  if(busy) return;

  busy = true;
  genWrap.classList.add('disabled');
  document.querySelectorAll('.gen-progress-el').forEach(el=>el.classList.add('active'));
  genIcon.innerHTML='<svg class="ic ic-spin" viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>';

  const isPdf = !state.exportFormat.startsWith('ZPL') && !state.exportFormat.startsWith('EPL') && !state.exportFormat.startsWith('TSPL');
  genText.textContent = isPdf ? 'GENERATING…' : 'PRINTING…';
  const genPrefix = state.exportFormat.startsWith('ZPL') ? 'ZPL' : state.exportFormat.startsWith('EPL') ? 'EPL' : state.exportFormat.startsWith('TSPL') ? 'TSPL' : 'PDF';
  setStatus(`Preparing ${isPdf ? 'PDF' : 'direct print'}…`, '#4A4032');
  setProgress(8, '#4A4032', true);

  try{
    await new Promise(r=>setTimeout(r, 250));
    const rows = state.previewRows.length ? (state.bulkMode ? state.previewRows : state.previewRows.slice(0,1)) : [[]];

    if(!rows.length){
      setStatus('No data found', '#A83232');
      setProgress(0, '#4A4032', false);
      document.querySelectorAll('.gen-progress-el').forEach(el=>el.classList.remove('active'));
      resetBtn();
      return;
    }

    setProgress(45, '#4A4032', true);
    setStatus(`Exporting ${rows.length} stickers…`, '#4A4032');
    await new Promise(r=>setTimeout(r, 200));

    const [wMm, hMm] = getEffectiveSizeMm();
    const isZpl = state.exportFormat.startsWith('ZPL');
    const baseName = state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : 'manual_stickers';
    let skippedCount = 0;

    if(isPdf){
      /* -------- PDF / ZPL / EPL / TSPL: generate & download file -------- */
      if(isZpl){
        const dpi = DPI_LABELS[state.dpi] || 203;
        const result = generateZPL(withSerials(rows), wMm, hMm, state.qrField, state.design, state.canvasElements, state.codeType, dpi);
        skippedCount = result.skippedCount;
        setProgress(85, '#4A4032', true);
        await new Promise(r=>setTimeout(r, 150));
        const blob = new Blob([result.zpl], { type:'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${baseName}_ZPL.zpl`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } else if(state.exportFormat.startsWith('EPL')){
        const dpi = DPI_LABELS[state.dpi] || 203;
        const result = generateEPL(withSerials(rows), wMm, hMm, state.qrField, state.design, state.canvasElements, state.codeType, dpi);
        skippedCount = result.skippedCount;
        setProgress(85, '#4A4032', true);
        await new Promise(r=>setTimeout(r, 150));
        const blob = new Blob([result.epl], { type:'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${baseName}_EPL.epl`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } else if(state.exportFormat.startsWith('TSPL')){
        const dpi = DPI_LABELS[state.dpi] || 203;
        const result = generateTSPL(withSerials(rows), wMm, hMm, state.qrField, state.design, state.canvasElements, state.codeType, dpi);
        skippedCount = result.skippedCount;
        setProgress(85, '#4A4032', true);
        await new Promise(r=>setTimeout(r, 150));
        const blob = new Blob([result.tspl], { type:'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${baseName}_TSPL.tspl`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } else {
        const layout = getEffectiveLayout();
        const { doc, skippedCount: pdfSkipped } = await generatePdf(withSerials(rows), wMm, hMm, state.qrField, layout, state.design, state.canvasElements, state.codeType, state.showCutMarks);
        skippedCount = pdfSkipped;
        setProgress(85, '#4A4032', true);
        await new Promise(r=>setTimeout(r, 150));
        doc.save(`${baseName}_STICKERS.pdf`);
      }

      if(skippedCount===0) sendUsageBeacon(rows.length, state.exportFormat);

      const printerDroppedElements = (isZpl || state.exportFormat.startsWith('EPL') || state.exportFormat.startsWith('TSPL'))
        && !!state.design.useCanvas
        && Array.isArray(state.canvasElements)
        && state.canvasElements.some(e=>!e.hidden && (e.type==='image' || e.type==='shape'));

      setProgress(100, skippedCount>0 ? '#A83232' : '#6EE7B7', false);
      setStatus(
        skippedCount>0
          ? `Done  —  ${rows.length} stickers saved, ${skippedCount} code${skippedCount===1?'':'s'} skipped (bad data  —  check preview)`
          : printerDroppedElements
            ? `Done  —  ${rows.length} labels saved (images/shapes in your layout aren't supported in ZPL/EPL yet  —  use PDF export to include them)`
            : `Done  —  ${rows.length} stickers saved`,
        (skippedCount>0 || printerDroppedElements) ? '#A83232' : '#6EE7B7'
      );

    } else {
      /* -------- Direct print: generate 1x1 PDF then print immediately -------- */
      setStatus('Preparing print…', '#4A4032');
      setProgress(55, '#4A4032', true);

      const { doc, skippedCount: printSkipped } = await generatePdf(
        withSerials(rows), wMm, hMm, state.qrField, {cols:1, rows:1, gap:0},
        state.design, state.canvasElements, state.codeType, false
      );
      skippedCount = printSkipped;

      setProgress(80, '#4A4032', true);
      setStatus('Sending to printer…', '#4A4032');
      await new Promise(r=>setTimeout(r, 100));

      /* Try Electron silent print first, fall back to browser print */
      let printed = false;
      if(window.electronAPI){
        try{
          const pdfArrayBuf = doc.output('arraybuffer');
          const bytes = new Uint8Array(pdfArrayBuf);
          let binary = '';
          for(let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          const pdfBase64 = btoa(binary);
          const result = await window.electronAPI.silentPrint(pdfBase64, '', 1);
          printed = result && result.success;
        }catch(e){ /* fallback */ }
      }
      if(!printed){
        /* Browser fallback: open PDF in hidden iframe and print */
        const blobUrl = URL.createObjectURL(doc.output('blob'));
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
        iframe.src = blobUrl;
        document.body.appendChild(iframe);
        await new Promise(r => { iframe.onload = r; setTimeout(r, 1500); });
        try{
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          printed = true;
        }catch(e){ /* cross-origin or blocked */ }
        setTimeout(()=>{ document.body.removeChild(iframe); URL.revokeObjectURL(blobUrl); }, 3000);
      }

      if(skippedCount===0) sendUsageBeacon(rows.length, state.exportFormat + '-PRINT');

      setProgress(100, skippedCount>0 ? '#A83232' : '#6EE7B7', false);
      setStatus(
        skippedCount>0
          ? `Print sent  —  ${skippedCount} code${skippedCount===1?'':'s'} skipped (bad data, check preview)`
          : `Print sent to printer`,
        skippedCount>0 ? '#A83232' : '#6EE7B7'
      );
    }

    setTimeout(()=>{
      setProgress(0, '#4A4032', false);
      setStatus('System Ready', '#4A4032');
      document.querySelectorAll('.gen-progress-el').forEach(el=>el.classList.remove('active'));
    }, skippedCount>0 ? 7000 : 3500);

  }catch(err){
    console.error(err);
    setStatus(`Error: ${err.message || err}`, '#A83232');
    setProgress(0, '#4A4032', false);
    document.querySelectorAll('.gen-progress-el').forEach(el=>el.classList.remove('active'));
  }finally{
    resetBtn();
  }
});

let printPreviewResolve = null;
let printPreviewPdfBlobUrl = null;
let printPreviewPdfBase64 = null;

async function loadPrinters(){
  const sel = document.getElementById('printPrinterSelect');
  const errEl = document.getElementById('printPrinterError');
  if(!window.electronAPI || !sel) return;
  try {
    const printers = await window.electronAPI.getPrinters();
    sel.innerHTML = '';
    if(!printers.length){
      sel.innerHTML = '<option value="">No printers found</option>';
      return;
    }
    printers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.displayName + (p.isDefault ? ' (default)' : '');
      if(p.isDefault) opt.selected = true;
      sel.appendChild(opt);
    });
    const row = document.getElementById('printPrinterRow');
    if(row) row.style.display = 'block';
    if(errEl) errEl.style.display = 'none';
  } catch(e) {
    if(sel) sel.innerHTML = '<option value="">Error loading printers</option>';
    if(errEl){ errEl.textContent = 'Could not load printers: ' + e; errEl.style.display = 'block'; }
  }
}

function showPrintPreview(blobUrl, wMm, hMm, pdfBase64){
  return new Promise(resolve=>{
    const modal = document.getElementById('printPreviewModal');
    const frame = document.getElementById('printPreviewFrame');
    const dims  = document.getElementById('printPreviewDims');
    const orientation = wMm >= hMm ? 'landscape' : 'portrait';
    dims.textContent = `${wMm}mm \u00d7 ${hMm}mm \u2014 ${orientation}`;
    const scale = Math.max(2, Math.min(380/wMm, 260/hMm, 14));
    frame.style.width  = (wMm*scale)+'px';
    frame.style.height = (hMm*scale)+'px';
    frame.src = blobUrl + '#view=Fit&toolbar=0';
    modal.style.display = 'flex';

    // Store for silent print
    printPreviewPdfBlobUrl = blobUrl;
    printPreviewPdfBase64 = pdfBase64 || null;

    // Load available printers
    loadPrinters();

    printPreviewResolve = (ok)=>{
      modal.style.display = 'none';
      if(!ok) frame.src = 'about:blank';
      printPreviewResolve = null;
      printPreviewPdfBlobUrl = null;
      printPreviewPdfBase64 = null;
      resolve(ok);
    };
  });
}
document.getElementById('printPreviewCancel')?.addEventListener('click', ()=>{ printPreviewResolve?.(false); });

document.getElementById('printPreviewConfirm')?.addEventListener('click', async ()=>{
  // If Electron API available, do silent print to selected printer
  if(window.electronAPI && printPreviewPdfBase64){
    const sel = document.getElementById('printPrinterSelect');
    const errEl = document.getElementById('printPrinterError');
    const printerName = sel ? sel.value : '';
    const copiesEl = document.getElementById('printCopies');
    const copies = copiesEl ? Math.max(1, parseInt(copiesEl.value)||1) : 1;

    if(errEl) errEl.style.display = 'none';

    const btn = document.getElementById('printPreviewConfirm');
    const origText = btn.textContent;
    btn.textContent = 'PRINTING...';
    btn.style.opacity = '0.6';
    btn.style.pointerEvents = 'none';

    const result = await window.electronAPI.silentPrint(printPreviewPdfBase64, printerName, copies);

    btn.textContent = origText;
    btn.style.opacity = '';
    btn.style.pointerEvents = '';

    if(result && result.success){
      printPreviewResolve?.(true);
    } else {
      if(errEl){ errEl.textContent = 'Print failed: ' + (result?.error || 'Unknown error') + '. Try a different printer.'; errEl.style.display = 'block'; }
      // Don't close modal, let user pick another printer
    }
  } else {
    // Fallback: browser/system print
    const frame = document.getElementById('printPreviewFrame');
    frame.contentWindow.focus();
    frame.contentWindow.print();
    printPreviewResolve?.(true);
  }
});
document.getElementById('printPreviewModal')?.addEventListener('click', e=>{
  if(e.target.id === 'printPreviewModal') printPreviewResolve?.(false);
});
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape' && printPreviewResolve) printPreviewResolve(false);
});

function sendUsageBeacon(count, exportType){
  if(!state.usageOptIn) return;
  try{
    const payload = {
      v: 1, t: 'event', ec: 'export', ea: exportType, ev: count,
      cd1: state.format || 'none', cd2: state.size || 'custom',
      uip: '0.0.0.0', sr: `${screen.width}x${screen.height}`,
    };
    const params = new URLSearchParams(payload);
    navigator.sendBeacon('https://stickers.harshdevs.com/stats', params);
  }catch(e){}
}
function resetBtn(){
  busy=false;
  genWrap.classList.remove('disabled');
  genIcon.innerHTML='<svg class="ic" viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>';
  const isPdf = !state.exportFormat.startsWith('ZPL') && !state.exportFormat.startsWith('EPL') && !state.exportFormat.startsWith('TSPL');
  genText.textContent = isPdf ? 'GENERATE PDF' : 'DIRECT PRINT';
}

document.querySelectorAll('.g-select').forEach(sel=>{
  const labelSpan = sel.querySelector('span:first-child');
  if(labelSpan && !labelSpan.classList.contains('ph')) sel.classList.add('filled');
});

function patchGBtn(el){
  if(el.classList.contains('disabled')){
    el.setAttribute('tabindex','-1');
    el.setAttribute('aria-disabled','true');
  }else{
    if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','0');
    el.removeAttribute('aria-disabled');
  }
  if(!el.hasAttribute('role')) el.setAttribute('role','button');
}
document.querySelectorAll('.g-btn').forEach(patchGBtn);
new MutationObserver(muts=>{
  muts.forEach(m=>m.addedNodes.forEach(n=>{
    if(n.nodeType!==1) return;
    if(n.classList && n.classList.contains('g-btn')) patchGBtn(n);
    if(n.querySelectorAll) n.querySelectorAll('.g-btn').forEach(patchGBtn);
  }));
}).observe(document.body,{childList:true,subtree:true});
document.addEventListener('keydown', e=>{
  const btn = e.target.closest && e.target.closest('.g-btn:not(.disabled)');
  if(btn && (e.key==='Enter' || e.key===' ')){
    e.preventDefault();
    btn.click();
  }
});
document.addEventListener('keydown', e=>{
  if(designerOverlay.style.display==='flex') return;
  if(e.key==='Escape'){ closeAll(); return; }
  if((e.ctrlKey||e.metaKey) && e.key==='Enter' && !busy){
    e.preventDefault();
    document.getElementById('genBtn')?.click();
  }
});

// Service worker removed — Electron desktop app does not use PWA features,
// and the sw.js FetchEvent handler breaks file:// protocol loading.
