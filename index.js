/**
 * TUMANA - Firebase Cloud Functions v2
 * Project: chawkpro1  |  Node: 18
 *
 * FUNCTIONS (no external APIs needed):
 * 1. registerFCMToken  - saves push token per user on login
 * 2. onOrderUpdate     - notifies riders + customers on status change
 * 3. requestPinReset   - user requests PIN reset, admin notified
 * 4. approvePinReset   - admin approves, user PIN cleared, notified
 * 5. onNewShop         - admin notified to verify new shop
 * 6. onNewRider        - admin notified to verify new rider
 * 7. dailyReport       - 6PM EAT daily summary push to admin
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const MASTER = "0799878872";

function norm(p){ return String(p||"").replace(/^[+]?254/,"0").replace(/^00/,"0").trim(); }

async function push(phone, title, body, data){
  try{
    const p = norm(phone);
    let token = null;
    const ud = await db.collection("tumana_users").doc(p).get().catch(()=>null);
    if(ud&&ud.exists) token = ud.data().fcm_token;
    if(!token){const rd = await db.collection("riders").doc(p).get().catch(()=>null);if(rd&&rd.exists) token=rd.data().fcm_token;}
    if(!token){console.log("No FCM token for",p);return;}
    await admin.messaging().send({token,notification:{title,body},data:data||{},
      android:{priority:"high",notification:{sound:"default",channelId:"tumana"}},
      apns:{payload:{aps:{sound:"default",badge:1}}}});
    console.log("Push to",p,":",title);
  }catch(e){console.log("Push error",phone,":",e.message);}
}

async function pushMulti(tokens, title, body, data){
  if(!tokens||!tokens.length) return;
  const msgs = tokens.map(token=>({token,notification:{title,body},data:data||{},android:{priority:"high"},apns:{payload:{aps:{sound:"default"}}}}));
  const res  = await admin.messaging().sendAll(msgs).catch(e=>{console.log("Multi-push error:",e.message);return null;});
  if(res) console.log("Multi-push:",res.successCount,"ok,",res.failureCount,"failed");
}

// 1. REGISTER FCM TOKEN
exports.registerFCMToken = functions.https.onCall(async(data)=>{
  const{phone,token,role}=data;
  if(!phone||!token) return{ok:false};
  const col = role==="rider"?"riders":"tumana_users";
  await db.collection(col).doc(norm(phone)).set({phone:norm(phone),fcm_token:token,fcm_updated:Date.now()},{merge:true}).catch(()=>{});
  return{ok:true};
});

// 2. ORDER UPDATE TRIGGER
exports.onOrderUpdate = functions.firestore.document("delivery_orders/{orderId}").onWrite(async(change,context)=>{
  const before = change.before.exists?change.before.data():null;
  const after  = change.after.exists ?change.after.data() :null;
  if(!after) return null;
  const orderId = context.params.orderId;
  const bStatus = before?before.status:null;
  const aStatus = after.status;
  if(bStatus===aStatus) return null;

  if(aStatus==="confirmed"){
    const snap=await db.collection("riders")
      .where("online","==",true)
      .where("verified","==",true)
      .get().catch(()=>null);
    if(snap&&snap.docs.length){
      // Filter busy riders in code (not WHERE clause) because existing docs
      // without a 'busy' field would be excluded by WHERE busy==false,
      // meaning NO rider would ever get notified.
      const availableRiders=snap.docs.filter(d=>d.data().busy!==true);
      const tokens=availableRiders.map(d=>d.data().fcm_token).filter(Boolean);
      const fee=after.delivery_fee||70;
      const from=after.shopName||after.pickup_from||"Shop";
      const type=after.type==="pickup"?"Pickup":"Delivery";
      await pushMulti(tokens,"New Job! KSh "+fee,type+" from "+from+" - KSh "+fee,{type:"new_job",order_id:orderId,fee:String(fee)});
    }
  }

  if(aStatus==="assigned"&&after.customer_phone)
    await push(after.customer_phone,"Rider on the way!",(after.rider_name||"Your rider")+" accepted and is heading to the shop.",{type:"order_update",order_id:orderId,status:"assigned"});

  if(aStatus==="transit"&&after.customer_phone)
    await push(after.customer_phone,"Order on the way!","Your order is out for delivery. Get ready!",{type:"order_update",order_id:orderId,status:"transit"});

  if(aStatus==="delivered"){
    if(after.customer_phone)
      await push(after.customer_phone,"Order Delivered!","Your order has arrived. Tap to rate your experience.",{type:"delivered",order_id:orderId});
    if(after.rider_phone){
      const riderEarn=after.rider_earnings||after.delivery_fee||70;
      const platEarn=after.platform_earnings||0;
      await db.collection("riders").doc(norm(after.rider_phone)).update({
        total_earnings:   admin.firestore.FieldValue.increment(riderEarn),
        orders_completed: admin.firestore.FieldValue.increment(1),
        pending_payout:   admin.firestore.FieldValue.increment(riderEarn),
      }).catch(()=>{});
      await db.collection("platform_revenue").doc("totals").set({
        total_revenue:    admin.firestore.FieldValue.increment(platEarn),
        total_deliveries: admin.firestore.FieldValue.increment(1),
        rider_payouts:    admin.firestore.FieldValue.increment(riderEarn),
        last_updated:     admin.firestore.FieldValue.serverTimestamp(),
      },{merge:true}).catch(()=>{});
    }
  }

  if(aStatus==="rejected"&&after.customer_phone)
    await push(after.customer_phone,"Order Rejected","Your order was rejected. Please try again.",{type:"rejected",order_id:orderId});

  return null;
});

// 3. REQUEST PIN RESET
exports.requestPinReset = functions.https.onCall(async(data)=>{
  const{phone,role,name}=data;
  if(!phone) throw new functions.https.HttpsError("invalid-argument","Phone required");
  const p=norm(phone);
  await db.collection("pin_resets").doc(p).set({phone:p,role:role||"customer",name:name||p,status:"pending",requested_at:admin.firestore.FieldValue.serverTimestamp()});
  await push(MASTER,"PIN Reset Request",(name||p)+" ("+( role||"user")+") needs a PIN reset. Approve in admin panel.",{type:"pin_reset",phone:p});
  return{ok:true,message:"Request sent. Admin will approve shortly."};
});

// 4. APPROVE PIN RESET
exports.approvePinReset = functions.https.onCall(async(data)=>{
  const{target_phone,admin_phone}=data;
  if(!target_phone) throw new functions.https.HttpsError("invalid-argument","Phone required");
  const p=norm(target_phone);
  await db.collection("tumana_users").doc(p).update({pin_hash:null,pin_attempts:0,reset_approved_at:admin.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
  await db.collection("pin_resets").doc(p).update({status:"approved",approved_by:admin_phone||MASTER,approved_at:admin.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
  await push(p,"PIN Reset Approved","Open Tumana and log in with your phone number to set a new PIN.",{type:"pin_reset_approved"});
  return{ok:true};
});

// 5. NEW SHOP
exports.onNewShop = functions.firestore.document("shops/{phone}").onCreate(async(snap)=>{
  const s=snap.data();
  await push(MASTER,"New Shop to Verify!",(s.name||snap.id)+" registered in "+(s.category||"General")+". Verify in admin panel.",{type:"new_shop",phone:snap.id});
  return null;
});

// 6. NEW RIDER
exports.onNewRider = functions.firestore.document("riders/{phone}").onCreate(async(snap)=>{
  const r=snap.data();
  await push(MASTER,"New Rider to Verify!",(r.name||snap.id)+" wants to join as a rider. Verify in admin panel.",{type:"new_rider",phone:snap.id});
  return null;
});

// 7. DAILY REPORT - 6PM EAT
exports.dailyReport = functions.pubsub.schedule("0 15 * * *").timeZone("Africa/Nairobi").onRun(async()=>{
  const today=new Date();today.setHours(0,0,0,0);
  const snap=await db.collection("delivery_orders").where("status","==","delivered").get().catch(()=>null);
  if(!snap) return null;
  let orders=0,rev=0,riderPay=0;
  snap.docs.forEach(doc=>{
    const o=doc.data();
    const ts=o.ts&&o.ts.toDate?o.ts.toDate():new Date(o.delivered_at||o.created_at||0);
    if(ts>=today){orders++;rev+=o.platform_earnings||0;riderPay+=o.rider_earnings||o.delivery_fee||0;}
  });
  await push(MASTER,"Tumana Daily Report",orders+" deliveries today. Platform KSh"+rev+". Riders KSh"+riderPay,{type:"daily_report"});
  return null;
});
