// js/modules/user_status.js
// Hiện thị trạng thái vai trò/KYC trên Dashboard + phát sự kiện cho module khác (VD: wallet)

import { auth } from "../core/firebase.js";
import { getProfile } from "../utils/api.js";

const $ = (s, r = document) => r.querySelector(s);
let user = null;

const LS = {
  role: (uid)=> localStorage.getItem(`taedu:role:${uid}`),
  lastStep: (uid)=> localStorage.getItem(`taedu_onboarding:${uid}:lastStep`),
  studentPayload: (uid)=> {
    try{ return JSON.parse(localStorage.getItem(`taedu_onboarding:${uid}:student_payload`)||"null"); }
    catch{return null;}
  }
};

function showBanner({level,text,primaryHref,primaryLabel,canDismiss}){
  const box = $("#verifyBanner"); if(!box) return;
  box.hidden=false;
  box.classList.remove("notice--warn","notice--err","notice--ok");
  if(level==="ok"){ box.classList.add("notice--ok"); } 
  else if(level==="error"){ box.classList.add("notice--err"); }
  else { box.classList.add("notice--warn"); }
  $("#verifyText").textContent = text;

  const a = $("#verifyPrimary"), d = $("#verifyDismiss");
  if(primaryHref){
    a.href = primaryHref; a.textContent = primaryLabel || "M?";
    a.hidden=false;
  } else { a.hidden=true; }
  d.hidden = !canDismiss;
  if(!d.hidden){ d.onclick = ()=> (box.hidden=true); }
}

function hideBanner(){
  const box = $("#verifyBanner");
  if(box) box.hidden = true;
}

function dispatchStatus(payload){
  window.dispatchEvent(new CustomEvent("taedu:verify-status", { detail: payload }));
}

async function fetchProfile(u) {
  try {
    const token = await u.getIdToken();
    const res = await getProfile(token);
    return res?.profile || null;
  } catch (err) {
    console.warn("getProfile failed", err);
    return null;
  }
}

async function getStatus(u){
  let role=null, verify={status:null, reviewNote:null}, parentOK=false;

  const profile = await fetchProfile(u);
  if (profile) {
    role = profile.role || null;
    verify = {
      status: profile.verify_status || "unverified",
      reviewNote: profile.verify_note || "",
    };
    if (role === "student") {
      parentOK = !!(profile.parent_email || "").trim();
    }
  }
  // Fallback local
  if(!role) role = LS.role(u.uid);
  if(role==="student" && !parentOK){
    const p = LS.studentPayload(u.uid);
    parentOK = !!(p && p.parent && (p.parent.email||"").trim());
  }
  const last = LS.lastStep(u.uid); // "submitted" n?u d� g?i KYC qua local mock

  // T�nh th�ng di?p
  if(!role){
    return {
      level:"error",
      text:"B?n chua ch?n vai tr�. H�y ch?n H?c sinh ho?c Gia su d? ti?p t?c.",
      primaryHref:"/role.html#step=select",
      primaryLabel:"Ch?n vai tr�",
      allowWithdraw:false, role:null, verify:{status:"missing"}
    };
  }
  if(role==="student"){
    if(!parentOK){
      return {
        level:"warn",
        text:"Vui l�ng b? sung th�ng tin ph? huynh (email b?t bu?c) d? d�ng c�c t�nh nang thanh to�n.",
        primaryHref:"/role.html#step=student",
        primaryLabel:"B? sung ngay",
        allowWithdraw:false, role, verify:{status:"unverified"}
      };
    }
  }
  // Uu ti�n tr?ng th�i KYC
  const st = (verify && verify.status) || (last==="submitted" ? "submitted" : "unverified");
  if(st==="unverified"){
    return {
      level:"warn",
      text:(role==="student"
          ?"B?n chua g?i h? so x�c minh. Vui l�ng ho�n th�nh d? b?o v? t�i kho?n & giao d?ch."
          :"B?n chua g?i h? so x�c minh. Vui l�ng ho�n t?t KYC d? b?t d?u d?y."),
      primaryHref:`/role.html#step=${role}`,
      primaryLabel:"G?i h? so",
      allowWithdraw:false, role, verify
    };
  }
  if(st==="submitted"){
    return {
      level:"warn",
      text:"H? so d� g?i, dang ch? duy?t.",
      primaryHref:null, primaryLabel:null, canDismiss:true,
      allowWithdraw:true, role, verify
    };
  }
  if(st==="rejected"){
    const note = verify.reviewNote ? ` L� do: ${verify.reviewNote}` : "";
    return {
      level:"error",
      text:`H? so b? t? ch?i.${note} B?n c� th? c?p nh?t v� g?i l?i.`,
      primaryHref:`/role.html#step=${role}`,
      primaryLabel:"S?a & g?i l?i",
      allowWithdraw:false, role, verify
    };
  }
  // approved
  return {
    level:"ok",
    text:"T�i kho?n d� du?c x�c minh.",
    primaryHref:null, primaryLabel:null, canDismiss:true,
    allowWithdraw:true, role, verify
  };
}

document.addEventListener("DOMContentLoaded", () => {
  if (!auth) {
    hideBanner();
    return;
  }
  auth.onAuthStateChanged(async (u) => {
    user = u;
    if (!u) {
      hideBanner();
      return;
    }
    const res = await getStatus(u);
    dispatchStatus(res);
    if (res.level === "ok") {
      hideBanner();
    } else {
      showBanner(res);
    }
  });
});
