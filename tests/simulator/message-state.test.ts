import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageState, MESSAGE_UI_KEY, receivedKey, sentKey, messageScope } from '../../clients/web/message-state.ts';
import { threadMessages, conversationKey } from '../../clients/web/conversations.ts';
function store() { const data = new Map<string,string>(); return { getItem:(k:string)=>data.get(k)??null, setItem:(k:string,v:string)=>{ data.set(k,v); }, data }; }
const first = { device:'device-A', origin:'node-0000000000000002', channel:0, messageId:'remote-1', text:'hello' };
const second = {...first, messageId:'remote-2', text:'new'};
test('baseline history is read, unique new messages are unread once, and reload keeps read state', () => {
  const memory=store(), state=new MessageState(memory);
  state.observe([{source:'usb',messages:[first]}]); assert.equal(state.unread('usb',[first]).length,0);
  state.observe([{source:'usb',messages:[first,second]}]); state.observe([{source:'usb',messages:[second]}]);
  assert.equal(state.unread('usb',[first,second,second]).length,1);
  const restored=new MessageState(memory); restored.observe([{source:'usb',messages:[first,second]}]); assert.equal(restored.unread('usb',[first,second]).length,1);
  restored.markRead('usb',[second]); assert.equal(new MessageState(memory).unread('usb',[second]).length,0);
});
test('only attended matching device/source/channel conversations mark arrivals read', () => {
  const state=new MessageState(store()); state.observe([]);
  const active={source:'usb',device:'device-A',destination:first.origin,channel:0};
  const other={...first,device:'device-B'}, otherChannel={...second,channel:1};
  state.observe([{source:'usb',messages:[first,other,otherChannel]},{source:'demo',messages:[first]}],active);
  assert.equal(state.unread('usb',[first]).length,0); assert.equal(state.unread('usb',[other,otherChannel]).length,2); assert.equal(state.unread('demo',[first]).length,1);
});
test('deleting received history suppresses reconnect/reload duplicates and clears unread without changing core input', () => {
  const memory=store(), state=new MessageState(memory); state.observe([]); state.observe([{source:'usb',messages:[first]}]);
  const key=receivedKey('usb',first); state.remove([key]);
  const restored=new MessageState(memory); restored.observe([{source:'usb',messages:[first]}]);
  assert.equal(restored.deleted(key),true); assert.equal(restored.unread('usb',[first]).length,0); assert.equal(first.text,'hello');
  assert.equal(restored.deleted(receivedKey('usb',{...first,device:'device-B'})),false);
  assert.equal(restored.deleted(sentKey('usb',first.device,'remote-1')),false);
});
test('conversation deletion uses a fixed snapshot: a new arrival survives and makes the thread available', () => {
  const state=new MessageState(store()); state.observe([]);
  const snapshot=[receivedKey('usb',first)], scope=messageScope('usb',first.device), key=conversationKey(first.origin,0);
  state.observe([{source:'usb',messages:[first,second]}]); state.remove(snapshot,{scope,key});
  assert.equal(state.hidden(scope,key),true);
  const visible=[first,second].filter(m=>!state.deleted(receivedKey('usb',m)));
  assert.equal(threadMessages(first.device,first.origin,0,[],visible).length,1); assert.equal(state.unread('usb',visible).length,1);
  state.reopen(scope,key); assert.equal(state.hidden(scope,key),false); assert.equal(state.deleted(snapshot[0]),true);
});
test('storage failure/read-only history fails deletion closed and preserves malformed saved metadata', () => {
  const memory=store(), state=new MessageState(memory); state.observe([{source:'usb',messages:[first]}]);
  memory.setItem=()=>{throw Error('quota');}; assert.throws(()=>state.remove([receivedKey('usb',first)]),/quota/); assert.equal(state.deleted(receivedKey('usb',first)),false);
  const readOnly=new MessageState(store(),()=>false); assert.throws(()=>readOnly.remove(['x']),/own/);
  const bad=store(); bad.setItem(MESSAGE_UI_KEY,'broken'); assert.throws(()=>new MessageState(bad)); assert.equal(bad.getItem(MESSAGE_UI_KEY),'broken');
});
test('a saved empty baseline recognizes messages first recovered after a reload as new', () => {
  const memory=store(); new MessageState(memory).observe([]);
  const restored=new MessageState(memory); restored.observe([{source:'usb',messages:[first]}]);
  assert.equal(restored.unread('usb',[first]).length,1);
});
test('bounded tombstones fail closed instead of evicting old deletions and resurrecting history', () => {
  const memory=store(); memory.setItem(MESSAGE_UI_KEY,JSON.stringify({version:1,records:Array.from({length:4096},(_,n)=>['key'+n,true,true]),hidden:[]}));
  const state=new MessageState(memory); assert.throws(()=>state.remove(['new-key']),/full/);
  assert.equal(state.deleted('key0'),true); assert.equal(state.deleted('new-key'),false);
});
