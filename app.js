const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
let me=null,view='dash',editing=null;
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
async function api(url,o={}){
  if(o.json){o.method=o.method||'POST';o.headers={'Content-Type':'application/json'};o.body=JSON.stringify(o.json);delete o.json}
  const r=await fetch(url,{credentials:'same-origin',...o});let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d.error||'Lỗi '+r.status);return d}
const act=async(f,ok)=>{try{await f();if(ok)toast(ok)}catch(e){toast('⚠ '+e.message)}};

/* ---- giao diện / theme ---- */
const THEMES={gold:['Vàng sang trọng','linear-gradient(135deg,#0b0a08,#b8862b)'],emerald:['Ngọc lục bảo','linear-gradient(135deg,#06120e,#059669)'],violet:['Tím huyền bí','linear-gradient(135deg,#0d0a1a,#7c3aed)'],ocean:['Đại dương','linear-gradient(135deg,#06111c,#0284c7)'],rose:['Hồng đỏ','linear-gradient(135deg,#160a10,#e11d48)'],light:['Sáng','linear-gradient(135deg,#f6f4ef,#b8862b)']};
const onColor=h=>{const n=parseInt(h.slice(1),16),r=n>>16,g=n>>8&255,b=n&255;return (r*299+g*587+b*114)/1000>150?'#111':'#fff'};
function applyTheme(){
  const r=document.documentElement,a=localStorage.getItem('cv_accent');
  r.dataset.theme=localStorage.getItem('cv_theme')||'gold';
  ['--accent','--accent2','--on'].forEach(k=>r.style.removeProperty(k));
  if(a){r.style.setProperty('--accent',a);r.style.setProperty('--accent2',a);r.style.setProperty('--on',onColor(a))}}
applyTheme();

/* ---- đăng nhập ---- */
function renderAuth(mode='login'){
  $('#root').innerHTML=`<div class="auth"><div class="logo" style="text-align:center;font-size:34px">⛏ CraftVault</div>
  <p class="sub" style="text-align:center">Kho lưu trữ &amp; trợ lý cho server Minecraft của bạn</p>
  <div class="card"><div class="tabs"><button class="btn ${mode=='login'?'':'ghost'}" id="tl">Đăng nhập</button><button class="btn ${mode=='reg'?'':'ghost'}" id="tr">Tạo tài khoản</button></div>
  <input id="u" placeholder="Tên tài khoản" autocomplete="username"><div class="pw"><input id="p" type="password" placeholder="Mật khẩu (tối thiểu 6 ký tự)" autocomplete="${mode=='login'?'current-password':'new-password'}"><button type="button" id="eye" class="eye" title="Hiện/ẩn mật khẩu">👁</button></div>
  <button class="btn" style="width:100%" id="go">${mode=='login'?'Đăng nhập':'Đăng ký'}</button></div></div>`;
  $('#tl').onclick=()=>renderAuth('login');$('#tr').onclick=()=>renderAuth('reg');
  const go=()=>act(async()=>{await api(mode=='login'?'/api/login':'/api/register',{json:{username:$('#u').value,password:$('#p').value}});await boot()});
  $('#eye').onclick=()=>{const p=$('#p');p.type=p.type=='password'?'text':'password';p.focus()};
  $('#go').onclick=go;$('#p').onkeydown=e=>e.key=='Enter'&&go();$('#u').onkeydown=e=>e.key=='Enter'&&$('#p').focus();$('#u').focus()}

/* ---- khung ứng dụng ---- */
const NAV=[['dash','🏠','Tổng quan'],['plugins','🧩','Kho plugin'],['notes','📝','Ghi chú'],['guides','📚','Hướng dẫn'],['admin','🛡','Quản trị',1],['theme','🎨','Giao diện']];
function renderApp(){
  $('#root').innerHTML=`<div class="app"><aside><div class="logo">⛏ CraftVault</div>
  ${NAV.filter(n=>!n[3]||me.role=='admin').map(n=>`<div class="nav ${view==n[0]?'on':''}" data-v="${n[0]}"><span>${n[1]}</span>${n[2]}</div>`).join('')}
  <div class="grow"></div><div class="user"><b>${esc(me.username)}</b> ${me.role=='admin'?'<span class="badge">Admin</span>':''}<br><a href="#" id="lo" class="muted">Đăng xuất</a></div></aside><main id="v"></main></div>`;
  document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>{view=n.dataset.v;editing=null;renderApp()});
  $('#lo').onclick=async e=>{e.preventDefault();await api('/api/logout',{method:'POST'});me=null;renderAuth()};
  ({dash,plugins,notes,guides,admin,theme})[view]()}

async function dash(){
  const [p,n]=await Promise.all([api('/api/plugins'),api('/api/notes')]);
  $('#v').innerHTML=`<h1>Xin chào, ${esc(me.username)} 👋</h1><p class="sub">Đây là trung tâm quản lý server Minecraft của bạn.</p>
  <div class="grid"><div class="card"><div class="stat">${p.length}</div><div class="muted">Plugin trong kho</div></div>
  <div class="card"><div class="stat">${n.length}</div><div class="muted">Ghi chú</div></div>
  <div class="card"><div class="stat">${fmt(p.reduce((a,b)=>a+b.size,0))}</div><div class="muted">Dung lượng đã dùng</div></div></div>
  <div class="card g"><h2>🚀 Bắt đầu nhanh</h2><ul><li>Vào <b>Hướng dẫn</b> để xem cách dựng server Paper từ đầu.</li><li>Tải plugin .jar lên <b>Kho plugin</b> để cả nhóm dùng chung.</li><li>Ghi lại lệnh, cấu hình, lỗi thường gặp trong <b>Ghi chú</b>.</li></ul></div>`}

async function plugins(){
  const list=await api('/api/plugins');
  $('#v').innerHTML=`<h1>🧩 Kho plugin</h1><p class="sub">Lưu và chia sẻ plugin, config cho server (.jar .zip .yml .json .properties .txt .toml .conf, tối đa 200MB).</p>
  <div class="card"><h2>Tải lên</h2><input id="pn" placeholder="Tên hiển thị (vd: EssentialsX 2.21)"><input id="pd" placeholder="Mô tả / phiên bản Minecraft hỗ trợ"><input type="file" id="pf">
  <button class="btn" id="up">⬆ Tải lên</button></div>
  <input id="q" placeholder="🔍 Tìm plugin...">
  <div class="grid" id="pl"></div>`;
  const draw=()=>{const q=$('#q').value.toLowerCase();
    $('#pl').innerHTML=list.filter(p=>(p.name+p.description).toLowerCase().includes(q)).map(p=>`<div class="card"><b>${esc(p.name)}</b>
    <p class="muted" style="margin:6px 0">${esc(p.description)||'Không có mô tả'}</p><p class="muted">${esc(p.original)} · ${fmt(p.size)}<br>bởi ${esc(p.username)} · ${p.created_at}</p>
    <div class="row" style="margin-top:12px"><a class="btn sm" style="text-decoration:none" href="/api/plugins/${p.id}/download">⬇ Tải về</a>
    ${p.user_id==me.id||me.role=='admin'?`<button class="btn sm danger" data-d="${p.id}">Xóa</button>`:''}</div></div>`).join('')||'<p class="muted">Chưa có plugin nào.</p>';
    document.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>confirm('Xóa plugin này?')&&act(async()=>{await api('/api/plugins/'+b.dataset.d,{method:'DELETE'});plugins()},'Đã xóa'))};
  draw();$('#q').oninput=draw;
  $('#up').onclick=()=>act(async()=>{const f=$('#pf').files[0];if(!f)throw new Error('Chưa chọn file');
    const fd=new FormData();fd.append('file',f);fd.append('name',$('#pn').value);fd.append('description',$('#pd').value);
    await api('/api/plugins',{method:'POST',body:fd});plugins()},'Đã tải lên')}

async function notes(){
  const list=await api('/api/notes'),e=list.find(n=>n.id==editing);
  $('#v').innerHTML=`<h1>📝 Ghi chú</h1><p class="sub">Lưu lệnh, cấu hình, ý tưởng. Tick "chia sẻ" để mọi thành viên cùng xem.</p>
  <div class="card"><h2>${e?'Sửa ghi chú':'Ghi chú mới'}</h2><input id="nt" placeholder="Tiêu đề" value="${esc(e?.title)}"><textarea id="nb" placeholder="Nội dung...">${esc(e?.body)}</textarea>
  <label class="muted"><input type="checkbox" id="ns" style="width:auto;margin-right:8px" ${e?.shared?'checked':''}>Chia sẻ cho mọi người</label>
  <div class="row" style="margin-top:10px"><button class="btn" id="sv">💾 Lưu</button>${e?'<button class="btn ghost" id="cn">Hủy</button>':''}</div></div>
  <div class="grid">${list.map(n=>`<div class="card"><b>${esc(n.title)}</b> ${n.shared?'<span class="badge">chia sẻ</span>':''}
  <p style="white-space:pre-wrap;margin:8px 0;color:var(--muted)">${esc(n.body)}</p><p class="muted">${esc(n.username)} · ${n.updated_at}</p>
  <div class="row" style="margin-top:10px">${n.user_id==me.id?`<button class="btn sm ghost" data-e="${n.id}">Sửa</button>`:''}${n.user_id==me.id||me.role=='admin'?`<button class="btn sm danger" data-d="${n.id}">Xóa</button>`:''}</div></div>`).join('')}</div>`;
  $('#sv').onclick=()=>act(async()=>{await api('/api/notes'+(e?'/'+e.id:''),{method:e?'PUT':'POST',json:{title:$('#nt').value,body:$('#nb').value,shared:$('#ns').checked}});editing=null;notes()},'Đã lưu');
  if(e)$('#cn').onclick=()=>{editing=null;notes()};
  document.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{editing=+b.dataset.e;notes()});
  document.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>confirm('Xóa ghi chú?')&&act(async()=>{await api('/api/notes/'+b.dataset.d,{method:'DELETE'});notes()},'Đã xóa'))}

const GUIDES=[
['⚙️ Chọn loại server','<p><b>Vanilla</b>: bản gốc của Mojang, không plugin. <b>Paper</b>: nhanh, nhẹ, hỗ trợ plugin Bukkit/Spigot — lựa chọn tốt nhất cho người mới. <b>Purpur</b>: fork của Paper, nhiều tùy chỉnh hơn. <b>Fabric/Forge</b>: dành cho mod (khác với plugin, người chơi cũng phải cài mod).</p>'],
['🚀 Dựng server Paper','<ul><li>Cài <b>Java 21</b> (Minecraft 1.21 trở lên yêu cầu Java 21).</li><li>Tải file .jar tại <b>papermc.io/downloads</b>, đặt vào thư mục riêng.</li><li>Tạo file <b>start.bat</b>:</li></ul><pre>java -Xms2G -Xmx2G -jar paper.jar nogui\npause</pre><p>Chạy lần đầu sẽ tạo file <b>eula.txt</b>. Mở ra, đổi <b>eula=false</b> thành <b>eula=true</b>, rồi chạy lại.</p>'],
['🛠 server.properties','<ul><li><b>server-port</b>: mặc định 25565.</li><li><b>online-mode</b>: true = chỉ tài khoản bản quyền. Đặt false chỉ khi bạn hiểu rủi ro (cần plugin đăng nhập như AuthMe).</li><li><b>max-players</b>, <b>motd</b> (dòng mô tả), <b>difficulty</b>, <b>gamemode</b>.</li><li><b>view-distance</b>: giảm xuống 6–8 nếu server lag.</li><li><b>white-list=true</b>: chỉ người trong danh sách được vào.</li></ul>'],
['🧩 Cài plugin','<ul><li>Bỏ file .jar vào thư mục <b>plugins/</b>, rồi <b>restart</b> server (đừng dùng /reload).</li><li>Kiểm tra plugin hỗ trợ đúng phiên bản Minecraft của bạn.</li><li>Nên có: <b>LuckPerms</b> (phân quyền), <b>EssentialsX</b> (lệnh cơ bản), <b>WorldEdit</b>, <b>Vault</b>.</li><li>Config của mỗi plugin nằm trong <b>plugins/TênPlugin/</b>. Xem log nếu plugin không chạy.</li></ul>'],
['🌐 Mở server cho bạn bè','<ul><li>Cùng mạng LAN: dùng IP nội bộ của máy chủ (gõ <b>ipconfig</b>).</li><li>Qua Internet: mở (port forward) cổng <b>25565 TCP</b> trên router và cho phép qua Windows Firewall.</li><li>Không muốn đụng router: dùng dịch vụ tunnel như <b>playit.gg</b>.</li></ul>'],
['💾 Backup &amp; tối ưu','<ul><li>Sao lưu thư mục <b>world</b> thường xuyên (lệnh <b>/save-all</b> trước khi copy).</li><li>Cấp RAM vừa đủ (2–6GB cho nhóm nhỏ), không cấp hết RAM máy.</li><li>Giảm view-distance, dùng Paper, tìm hiểu "Aikar\'s flags" cho tham số Java tối ưu.</li></ul>'],
['⌨️ Lệnh quản trị hay dùng','<pre>/op &lt;tên&gt;            cấp quyền admin\n/whitelist add &lt;tên&gt;  thêm vào danh sách\n/gamemode creative    đổi chế độ\n/save-all             lưu thế giới\n/stop                 tắt server an toàn</pre>']];
function guides(){
  $('#v').innerHTML=`<h1>📚 Hướng dẫn làm server</h1><p class="sub">Những kiến thức cơ bản để dựng và vận hành server Minecraft.</p>`+
  GUIDES.map(g=>`<div class="card g"><h2>${g[0]}</h2>${g[1]}</div>`).join('')}

async function admin(){
  const us=await api('/api/admin/users');
  $('#v').innerHTML=`<h1>🛡 Quản trị</h1><p class="sub">Quản lý thành viên. Mật khẩu được mã hóa một chiều nên không ai xem được — nếu thành viên quên, hãy đặt lại mật khẩu cho họ.</p>
  <div class="card" style="overflow:auto"><table><tr><th>Tài khoản</th><th>Quyền</th><th>Tạo lúc</th><th>Đăng nhập cuối</th><th>Plugin/Note</th><th></th></tr>
  ${us.map(u=>`<tr><td><b>${esc(u.username)}</b></td><td><span class="badge">${u.role}</span></td><td>${u.created_at}</td><td>${u.last_login||'-'}</td><td>${u.plugins}/${u.notes}</td>
  <td class="row">${u.id==me.id?'<span class="muted">(bạn)</span>':`<button class="btn sm ghost" data-r="${u.id}">Đặt lại MK</button>
  <button class="btn sm ghost" data-a="${u.id}" data-role="${u.role=='admin'?'user':'admin'}">${u.role=='admin'?'Hạ quyền':'Lên Admin'}</button><button class="btn sm danger" data-x="${u.id}">Xóa</button>`}</td></tr>`).join('')}</table></div>`;
  document.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{const p=prompt('Mật khẩu mới (tối thiểu 6 ký tự):');p&&act(()=>api(`/api/admin/users/${b.dataset.r}/reset`,{json:{password:p}}),'Đã đặt lại mật khẩu')});
  document.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>act(async()=>{await api(`/api/admin/users/${b.dataset.a}/role`,{json:{role:b.dataset.role}});admin()},'Đã đổi quyền'));
  document.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>confirm('Xóa tài khoản này cùng toàn bộ file/ghi chú của họ?')&&act(async()=>{await api('/api/admin/users/'+b.dataset.x,{method:'DELETE'});admin()},'Đã xóa'))}

function theme(){
  const cur=localStorage.getItem('cv_theme')||'gold',acc=localStorage.getItem('cv_accent')||'#e6b85c';
  $('#v').innerHTML=`<h1>🎨 Giao diện</h1><p class="sub">Chọn màu nền và màu nhấn theo ý bạn. Lưu riêng trên trình duyệt này.</p>
  <div class="card"><h2>Bảng màu</h2><div class="row" style="gap:14px">${Object.entries(THEMES).map(([k,v])=>`<div class="swatch ${k==cur?'on':''}" data-t="${k}" style="background:${v[1]}">${v[0]}</div>`).join('')}</div></div>
  <div class="card"><h2>Màu nhấn tùy chọn</h2><div class="row"><input type="color" id="ac" value="${acc}" style="width:70px;height:44px;padding:2px;margin:0"><button class="btn ghost" id="rs">Về mặc định</button></div></div>`;
  document.querySelectorAll('[data-t]').forEach(s=>s.onclick=()=>{localStorage.setItem('cv_theme',s.dataset.t);localStorage.removeItem('cv_accent');applyTheme();theme()});
  $('#ac').oninput=e=>{localStorage.setItem('cv_accent',e.target.value);applyTheme()};
  $('#rs').onclick=()=>{localStorage.removeItem('cv_accent');applyTheme();theme()}}

async function boot(){try{me=await api('/api/me');renderApp()}catch{renderAuth()}}
boot();
