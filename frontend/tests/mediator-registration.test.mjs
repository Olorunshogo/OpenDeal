import assert from "node:assert/strict";
import {test} from "node:test";
import {finalizeEvent,getPublicKey} from "nostr-tools/pure";
import {mediatorRegistrationEvent,mediatorRegistrationSignature} from "../src/lib/mediator-registration.ts";
const secret=Uint8Array.from([...new Uint8Array(31),1]),pubkey=getPublicKey(secret);
test("NIP-07 application proves control without exporting a Bitcoin signing key",async()=>{
 globalThis.window={nostr:{getPublicKey:async()=>pubkey,signEvent:async template=>finalizeEvent(template,secret)}};
 const event=await mediatorRegistrationEvent(pubkey,"Named mediator");assert.equal(event.content,`OpenDeal mediator registration v1\n${pubkey}\nNamed mediator`);
 await assert.rejects(mediatorRegistrationEvent("22".repeat(32),"Named mediator"),/Connect a Nostr extension/);
 globalThis.window.nostr.signEvent=async template=>finalizeEvent({...template,content:"changed"},secret);
 await assert.rejects(mediatorRegistrationEvent(pubkey,"Named mediator"),/requested registration terms/);
});
test("local registration cannot sign as another identity or hide name changes",()=>{
 assert.throws(()=>mediatorRegistrationSignature("01".padStart(64,"0"),"22".repeat(32),"Name"),/does not match/);
 assert.throws(()=>mediatorRegistrationSignature("01".padStart(64,"0"),pubkey,"Name\nspoof"),/without line breaks/);
});
