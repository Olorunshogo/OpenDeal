import assert from "node:assert/strict";
import { test } from "node:test";
import * as secp from "@noble/secp256k1";
import { hex } from "@scure/base";
import { nextDealStep } from "../src/lib/lifecycle.ts";
import { loadContacts, removeContact, saveContact, validatedContact } from "../src/lib/contacts.ts";
const key="79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
test("public contacts preserve the exact selected identity and never persist secret fields",()=>{
 const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 saveContact({name:"Buyer",pubkey:"02"+key,secret:"do not store"});assert.deepEqual(loadContacts(),[{name:"Buyer",pubkey:key}]);assert.equal(JSON.stringify([...map.values()]).includes("do not store"),false);
 assert.throws(()=>validatedContact("Unknown","invalid"),/valid public key/);
});
test("guidance follows real lifecycle state without skipping explicit signature and confirmation steps",()=>{
 assert.equal(nextDealStep({status:"draft"},"seller",false,false).actor,"seller");assert.equal(nextDealStep({status:"draft"},"buyer",true,false).actor,"buyer");
 assert.equal(nextDealStep({status:"funded"},"buyer").actor,"seller");assert.equal(nextDealStep({status:"shipped"},"seller").actor,"buyer");
 assert.equal(nextDealStep({status:"accepted",current_psbt:"psbt"},"buyer").index,10);
 assert.equal(nextDealStep({status:"accepted",settlement_txid:"txid"},"buyer").index,13);
 assert.equal(nextDealStep({status:"refunded",settlement_txid:"txid"},"buyer").index,14);
 assert.match(nextDealStep({status:"disputed"},"mediator").explanation,/never transfers Bitcoin/);
 assert.equal(nextDealStep({status:"accepted",current_psbt:"psbt"},"buyer",true,true,1).index,11);
 assert.equal(nextDealStep({status:"accepted",current_psbt:"psbt"},"buyer",true,true,2).index,12);
 assert.equal(nextDealStep({status:"disputed"},"mediator",true,true,0,true).actor,"a participant");
});

test("leftover /demo contacts are dropped and contacts can be removed",()=>{
 const key=(n)=>hex.encode(secp.getPublicKey(new Uint8Array(32).fill(n),true)).slice(2);
 localStorage.setItem("opendeal.public-contacts",JSON.stringify([{name:"Demo seller",pubkey:key(1)},{name:"Demo buyer",pubkey:key(2)},{name:"Alice",pubkey:key(3)}]));
 assert.deepEqual(loadContacts().map(c=>c.name),["Alice"]);
 assert.equal(localStorage.getItem("opendeal.public-contacts").includes("Demo"),false);
 assert.deepEqual(removeContact(key(3)),[]);
 assert.deepEqual(loadContacts(),[]);
});
