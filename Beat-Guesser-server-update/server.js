'use strict';
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));
app.get('/health', (_, res) => res.json({ok:true}));
const rooms = new Map();
const stages = [
  {duration:0.5,points:1000}, {duration:1,points:800},
  {duration:3,points:600}, {duration:8,points:400}, {duration:15,points:200}
];
const tidy = (v, max=120) => String(v ?? '').trim().slice(0,max);
const norm = v => tidy(v).toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const videoId = url => {
  try {
    const u = new URL(url);
    if (['youtu.be','www.youtu.be'].includes(u.hostname)) return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(u.hostname)) {
      const id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];
      return /^[\w-]{11}$/.test(id || '') ? id : null;
    }
  } catch {}
  return null;
};
const roomCode = () => {let c;do {c=crypto.randomBytes(3).toString('hex').toUpperCase()} while(rooms.has(c));return c};
const state = r => ({code:r.code,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,answered:p.answered})),songCount:r.songs.length,index:r.index,stage:r.stage,started:r.started,revealed:r.revealed,hostOnline:!!r.hostSocket,finished:r.index>=r.songs.length&&r.songs.length>0});
const broadcast = r => io.to(r.code).emit('state',state(r));
const hostData = r => io.to(r.hostSocket).emit('host:data',r.songs);
function hostOnly(socket, cb, fn){const r=rooms.get(socket.data?.code);if(!r || !socket.data?.host || r.hostSocket!==socket.id){cb?.({error:'Само домакинът може да прави това.'});return;}fn(r);}
io.on('connection',socket=>{
  socket.on('create',(_,cb)=>{
    const code=roomCode(),token=crypto.randomBytes(24).toString('hex');
    const r={code,token,hostSocket:socket.id,players:new Map(),songs:[],index:0,stage:0,started:false,revealed:false};
    rooms.set(code,r);socket.join(code);socket.data={code,host:true};cb?.({ok:true,code,token});broadcast(r);hostData(r);
  });
  socket.on('host:resume',({code,token}={},cb)=>{
    const r=rooms.get(tidy(code).toUpperCase());
    if(!r||r.token!==token)return cb?.({error:'Стаята е изтекла. Създай нова.'});
    r.hostSocket=socket.id;socket.join(r.code);socket.data={code:r.code,host:true};cb?.({ok:true});broadcast(r);hostData(r);
  });
  socket.on('join',({code,name}={},cb)=>{
    const r=rooms.get(tidy(code).toUpperCase());name=tidy(name,24);
    if(!r||!name)return cb?.({error:'Невалиден код или име.'});
    if(r.players.size>=60)return cb?.({error:'Стаята е пълна.'});
    const id=crypto.randomUUID();r.players.set(id,{id,name,score:0,answered:false,socketId:socket.id,lastGuess:0});
    socket.join(r.code);socket.data={code:r.code,playerId:id};cb?.({ok:true,id,code:r.code});broadcast(r);
  });
  socket.on('player:resume',({code,id}={},cb)=>{
    const r=rooms.get(tidy(code).toUpperCase()),p=r?.players.get(id);
    if(!p)return cb?.({error:'Играчът не е намерен.'});
    p.socketId=socket.id;socket.join(r.code);socket.data={code:r.code,playerId:id};cb?.({ok:true});broadcast(r);
  });
  socket.on('song:add',(song={},cb)=>hostOnly(socket,cb,r=>{
    const id=videoId(tidy(song.url,500)),title=tidy(song.title),artist=tidy(song.artist);
    const start=Number(song.start);
    if(!id||!title||!Number.isFinite(start)||start<0||start>7200)return cb?.({error:'Попълни заглавие, валиден YouTube линк и начало в секунди.'});
    if(r.songs.length>=100)return cb?.({error:'Максимум 100 песни.'});
    r.songs.push({videoId:id,title,artist,start});cb?.({ok:true});hostData(r);broadcast(r);
  }));
  socket.on('song:remove',(index,cb)=>hostOnly(socket,cb,r=>{
    if(r.started||r.index>0)return cb?.({error:'Песни могат да се махат само преди старта.'});
    if(!Number.isInteger(index)||index<0||index>=r.songs.length)return cb?.({error:'Невалидна песен.'});
    r.songs.splice(index,1);cb?.({ok:true});hostData(r);broadcast(r);
  }));
  socket.on('stage:play',(_,cb)=>hostOnly(socket,cb,r=>{
    const s=r.songs[r.index];if(!s)return cb?.({error:'Първо добави песни.'});
    r.started=true;r.revealed=false;
    const stage=stages[r.stage];
    io.to(r.hostSocket).emit('audio:play',{videoId:s.videoId,start:s.start,duration:stage.duration});
    io.to(r.code).emit('stage:played',{stage:r.stage,duration:stage.duration,points:stage.points});
    cb?.({ok:true});broadcast(r);
  }));
  socket.on('stage:next',(_,cb)=>hostOnly(socket,cb,r=>{
    if(!r.songs[r.index])return cb?.({error:'Няма песен.'});
    if(r.stage>=stages.length-1)return cb?.({error:'Това е последният етап. Натисни Следваща песен.'});
    r.stage++;r.started=false;io.to(r.hostSocket).emit('audio:stop');cb?.({ok:true});broadcast(r);
  }));
  socket.on('song:next',(_,cb)=>hostOnly(socket,cb,r=>{
    const s=r.songs[r.index];if(!s)return cb?.({error:'Няма повече песни.'});
    io.to(r.hostSocket).emit('audio:stop');
    io.to(r.code).emit('song:reveal',{title:s.title,artist:s.artist});
    r.index++;r.stage=0;r.started=false;r.revealed=true;
    for(const p of r.players.values())p.answered=false;
    cb?.({ok:true});broadcast(r);
  }));
  socket.on('guess',({title,artist}={},cb)=>{
    const r=rooms.get(socket.data?.code),p=r?.players.get(socket.data?.playerId),s=r?.songs[r.index];
    if(!p||!s||!r.started||r.revealed)return cb?.({error:'Изчакай домакинът да пусне песента.'});
    if(p.answered)return cb?.({error:'Вече позна тази песен.'});
    if(Date.now()-p.lastGuess<700)return cb?.({error:'Изчакай малко преди следващия опит.'});
    p.lastGuess=Date.now();
    const right=norm(title)===norm(s.title) && (!norm(s.artist)||norm(artist)===norm(s.artist));
    let awarded = 0;
    if(right){
      // Each subsequent correct guess earns 10% less of the current stage's
      // base points, down to a minimum of 10% of those points.
      const correctBefore = [...r.players.values()].filter(player => player.answered).length;
      const basePoints = stages[r.stage].points;
      awarded = Math.max(Math.round(basePoints * 0.1), basePoints - correctBefore * Math.round(basePoints * 0.1));
      p.answered = true;
      p.score += awarded;
      io.to(r.code).emit('correct',{name:p.name,points:awarded});
      broadcast(r);
    }
    cb?.({ok:true,correct:right,points:awarded});
  });
  socket.on('disconnect',()=>{const r=rooms.get(socket.data?.code);if(r&&socket.data?.host&&r.hostSocket===socket.id){r.hostSocket=null;broadcast(r);}});
});
app.get('/api/search',async(req,res)=>{
  const q=tidy(req.query.q,70);if(q.length<2)return res.json([]);
  try{
    const response=await fetch('https://itunes.apple.com/search?entity=song&limit=15&term='+encodeURIComponent(q),{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error('upstream');
    const data=await response.json();res.json((data.results||[]).map(x=>({title:x.trackName,artist:x.artistName})).filter(x=>x.title&&x.artist));
  }catch{res.json([])}
});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Beat Guesser running'));
