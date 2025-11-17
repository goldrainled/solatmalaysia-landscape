/* ============================================================
   main.js — Option A (NO SCALING) — FULL FIXED VERSION
   - No transform scaling (Option A)
   - Robust time parsing & formatting
   - Safe guards for undefined API fields
   - Title-case location + "Malaysia" -> "MY"
   - Correct next-prayer logic (after Isyak -> Subuh tomorrow)
============================================================ */

/* ----- NO SCALING (Option A) ----- */
function autoDetectMode() { /* no-op */ }
function scaleToFit() {
  const app = document.getElementById("app");
  if (!app) return;
  app.style.transform = "none";
  app.style.width = "100%";
  app.style.height = "auto";
}

/* ----- Globals ----- */
let zoneCode = "JHR02";
let prayerTimes = {};      // internal storage: keys -> "HH:MM" (24h)
let nextPrayerTime = null; // Date
let dbgEnabled = false;

function dbg(...args){ if(dbgEnabled) console.debug("dbg:", ...args); }

function setText(id, txt){
  const el = document.getElementById(id);
  if(!el) return;
  el.innerText = txt;
}

/* ============================================================
   DATE HANDLING (Gregorian + Hijri)
============================================================ */
async function setAutoDates(){
  try {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2,'0');
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const yyyy = now.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`;

    const res = await fetch(`https://api.aladhan.com/v1/gToH?date=${dateStr}`);
    const j = await res.json();

    if(j && j.data && j.data.hijri){
      const h = j.data.hijri;
      const gMonthName = new Intl.DateTimeFormat('en-US',{month:'long'}).format(now);
      setText("dateTodayG", `${dd} ${gMonthName} ${yyyy}`);

      const hijriMonth = (h.month && (h.month.en || h.month.ar)) || "";
      setText("dateTodayH", `${h.day} ${hijriMonth} ${h.year}H`);
      return;
    }

    setText("dateTodayG", now.toLocaleDateString());
    setText("dateTodayH", "");
  } catch(e){
    setText("dateTodayG", new Date().toLocaleDateString());
    setText("dateTodayH", "");
  }
}

/* ============================================================
   GEOLOCATION (reverse geocode + ip fallback)
============================================================ */
async function reverseGeocode(lat, lon){
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'solat-display/1.0' }});
    if(!res.ok) return "";
    const j = await res.json();
    const addr = j.address || {};
    const parts = [
      addr.city, addr.town, addr.village,
      addr.county, addr.state, addr.region, addr.state_district,
      addr.country
    ].filter(Boolean).map(s => String(s).toLowerCase());
    return parts.join(", ");
  } catch(e){
    return "";
  }
}

async function ipGeolocate(){
  try {
    const res = await fetch("https://ipapi.co/json/");
    if(!res.ok) return "";
    const j = await res.json();
    const parts = [j.city, j.region, j.country_name].filter(Boolean).map(s => String(s).toLowerCase());
    return parts.join(", ");
  } catch(e){
    return "";
  }
}

/* ============================================================
   LOCATION / TEXT HELPERS
============================================================ */
function capitalizePlace(s){
  if(!s) return "";
  return s.split(",")
    .map(p => p.trim().split(" ")
      .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : "")
      .join(" ")
    )
    .filter(Boolean)
    .join(", ");
}

function shortenCountry(placeStr){
  if(!placeStr) return placeStr;
  // replace full 'malaysia' occurrences with 'MY' (case-insensitive)
  return placeStr.replace(/malaysia/gi, "MY");
}

/* ============================================================
   ZONE MAP & DETECTION
============================================================ */
const ZONE_MAP = {
  "JHR01": ["pulau aur","pulau pemanggil"],
  "JHR02": ["johor bahru","kota tinggi","mersing","jhr02","jb","johor bharu"],
  "JHR03": ["kluang","pontian"],
  "JHR04": ["batu pahat","muar","segamat","gemas"],
  "KDH01": ["kota setar","kubang pasu","pokok sena"],
  "KDH02": ["kuala muda","yan","pendang"],
  "KDH03": ["padang terap","sik"],
  "KDH04": ["baling"],
  "KDH05": ["bandar baharu","kulim"],
  "KDH06": ["langkawi"],
  "KTN01": ["bachok","kota bharu","machang","pasir mas","pasir puteh","tanah merah","tumpat","kuala krai"],
  "MLK01": ["alor gajah","melaka"],
  "PLS01": ["perlis","kangar"],
  "PNG01": ["pulau pinang","george town","penang","seberang perai"],
  "KDH07": ["gunung jerai"],
  "PHG01": ["pahang","kuantan","cameron"],
  "PHG02": ["temerloh","lipis","raub"],
  "PRK01": ["ipoh","perak","kinta","manjung","taiping","kerian"],
  "SGR01": ["selangor","shah alam","kajang","klang","petaling","gombak","kuala langat","kuala selangor","hulu selangor"],
  "KUL01": ["kuala lumpur","wp kuala lumpur","wp kl"],
  "SBH01": ["sabah","kota kinabalu","sandakan","tawau"],
  "SRW01": ["sri aman","sarawak","kuching","sibu","miri"],
  "TRG01": ["kuala terengganu"],
  "KEL01": ["kelantan"],
  "JHR02_alias": ["johor","johor bahru","jb"],
  "SBH02": ["labuan"],
};

const zoneKeywords = [];
for(const [zone,arr] of Object.entries(ZONE_MAP)){
  if(!Array.isArray(arr)) continue;
  arr.forEach(k => zoneKeywords.push({ zone, key: k.toLowerCase() }));
}

function determineZoneFromPlace(placeStr){
  if(!placeStr) return null;
  const norm = placeStr.toLowerCase().replace(/[^\w\s]/g,' ');
  // pass 1 - non-alias zones
  for(const z of zoneKeywords){
    if(z.zone.endsWith("_alias")) continue;
    if(norm.includes(z.key)) return z.zone;
  }
  // pass 2 - include aliases
  for(const z of zoneKeywords){
    if(norm.includes(z.key)) return z.zone;
  }
  return null;
}

/* ============================================================
   DETECT ZONE & FORMAT LOCATION (Title-case + short country)
============================================================ */
async function detectZoneAndLoad(){
  setText("zoneName", "Mengesan lokasi...");

  let placeStr = "";
  if(navigator.geolocation){
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 5*60*1000 });
      });
      placeStr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    } catch(e){
      placeStr = await ipGeolocate();
    }
  } else {
    placeStr = await ipGeolocate();
  }

  // Shorten country (Malaysia -> MY) before title-casing
  placeStr = shortenCountry(placeStr || "");
  const placeCap = capitalizePlace(placeStr);
  const foundZone = determineZoneFromPlace(placeStr);

  if(foundZone){
    zoneCode = foundZone.replace(/_alias$/,'');
    setText("zoneName", `${zoneCode.toUpperCase()} - ${placeCap}`);
  } else {
    setText("zoneName", `${zoneCode} - ${placeCap || "Lokasi tidak dikesan"}`);
  }

  await loadPrayerTimesForZone(zoneCode);
}

/* ============================================================
   PRAYER TIMES LOADING & NORMALISATION
   - fixTime() ensures internal format "HH:MM"
   - UI uses format() to display "h:mm AM/PM"
============================================================ */
function fixTime(t){
  // t can be "0535", "530", "05:35", undefined, ""
  if(!t && t !== 0) return null;
  let s = String(t).trim();
  // If already contains ":", try to normalise
  if(s.includes(":")){
    const [hh,mm] = s.split(":").map(p => p.replace(/\D/g,''));
    if(!hh) return null;
    return hh.padStart(2,"0") + ":" + (String(mm||"0").padStart(2,"0"));
  }
  // If digits only
  s = s.replace(/\D/g,'').padStart(4,"0");
  return s.slice(0,2) + ":" + s.slice(2);
}

async function loadPrayerTimesForZone(Z){
  try {
    const url = `https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=month&zone=${encodeURIComponent(Z)}`;
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    const list = Array.isArray(data.prayerTime) ? data.prayerTime : [];
    const today = new Date();
    const dd = String(today.getDate()).padStart(2,'0');
    const yyyy = today.getFullYear();
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const key1 = `${dd}-${months[today.getMonth()]}-${yyyy}`;
    const key2 = `${dd}-${months[today.getMonth()].toUpperCase()}-${yyyy}`;

    let todayEntry = list.find(p => (p && (p.date === key1 || p.date === key2)));
    if(!todayEntry) todayEntry = list[list.length - 1] || {};

    // Normalise internal times (HH:MM) or null if not available
    prayerTimes = {
      Imsak   : fixTime(todayEntry.imsak),
      Subuh   : fixTime(todayEntry.fajr),
      Syuruk  : fixTime(todayEntry.syuruk),
      Zohor   : fixTime(todayEntry.dhuhr),
      Asar    : fixTime(todayEntry.asr),
      Maghrib : fixTime(todayEntry.maghrib),
      Isyak   : fixTime(todayEntry.isha)
    };

    // Update UI (display in AM/PM) or --:-- if unavailable
    const uiSet = (id, value) => {
      const el = document.getElementById(id);
      if(!el) return;
      el.innerText = value ? format(value) : "--:--";
    };

    uiSet("imsakTime", prayerTimes.Imsak);
    uiSet("subuhTime", prayerTimes.Subuh);
    uiSet("syurukTime", prayerTimes.Syuruk);
    uiSet("zohorTime", prayerTimes.Zohor);
    uiSet("asarTime", prayerTimes.Asar);
    uiSet("maghribTime", prayerTimes.Maghrib);
    uiSet("isyakTime", prayerTimes.Isyak);

    determineNextPrayer();
    updateHighlight();
    updateCurrentPrayerCard();

  } catch(err){
    dbg("loadPrayerTimesForZone error:", err);
    setText("zoneName", `Gagal muat masa solat (${Z})`);
  }
}

/* ============================================================
   FORMAT DISPLAY (safe)
   - input t expected "HH:MM" or similar; returns "h:mm AM/PM"
   - returns "--:--" on invalid input
============================================================ */
function format(t){
  if(!t && t !== 0) return "--:--";
  try {
    t = t.toString().trim();
    if(t.length === 4 && !t.includes(":")) t = t.slice(0,2) + ":" + t.slice(2);
    if(!t.includes(":")) return "--:--";
    let [h,m] = t.split(":").map(x => Number(String(x).replace(/\D/g,'')));
    if(Number.isNaN(h) || Number.isNaN(m)) return "--:--";
    h = Math.max(0, Math.min(23, h));
    m = Math.max(0, Math.min(59, m));
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = (h % 12) || 12;
    return `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
  } catch(e){
    return "--:--";
  }
}

/* ============================================================
   NEXT PRAYER / COUNTDOWN (robust)
============================================================ */
function determineNextPrayer(){
  // find the next prayer time after now (today)
  const now = new Date();
  let found = null;
  let foundName = null;

  // Iterate in object order (Imsak, Subuh, Syuruk, Zohor, Asar, Maghrib, Isyak)
  for(const [name, raw] of Object.entries(prayerTimes)){
    if(!raw) continue;
    const [h,m] = raw.split(":").map(Number);
    if(Number.isNaN(h) || Number.isNaN(m)) continue;
    const when = new Date();
    when.setHours(h, m, 0, 0);
    if(when > now){
      found = when;
      foundName = name;
      break;
    }
  }

  // If none found (we are after Isyak), go to Subuh tomorrow (if available)
  if(!found){
    const sub = prayerTimes.Subuh;
    if(sub){
      const [h,m] = sub.split(":").map(Number);
      const when = new Date();
      when.setDate(when.getDate() + 1);
      when.setHours(h, m, 0, 0);
      found = when;
      foundName = "Subuh";
    } else {
      // Last resort: set nextPrayerTime null (countdown disabled)
      nextPrayerTime = null;
      setText("nextPrayerNameLarge", "--");
      return;
    }
  }

  nextPrayerTime = found;
  setText("nextPrayerNameLarge", foundName || "--");
}

/* Countdown updater */
setInterval(()=>{
    if (!nextPrayerTime) return;

    const now = new Date();
    const diff = nextPrayerTime - now;

    if (diff <= 0) { 
        determineNextPrayer(); 
        return; 
    }

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff / 60000) % 60);
    const s = Math.floor((diff / 1000) % 60);

    // Update UI
    const set = (id,v)=>{
        const el=document.getElementById(id);
        if(el) el.innerText = String(v).padStart(2,"0");
    };
    set("cdHour",h);
    set("cdMin",m);
    set("cdSec",s);

    /* -------------------------------
       Highlight countdown when <10 min
    --------------------------------*/
    const items = document.querySelectorAll(".count-item");

    if (h === 0 && m <= 10) {
        items.forEach(box => box.classList.add("count-urgent"));
    } else {
        items.forEach(box => box.classList.remove("count-urgent"));
    }

}, 1000);


/* ============================================================
   CLOCK / CURRENT PRAYER CARD / HIGHLIGHT
============================================================ */
function updateClock(){
  const now = new Date();
  let h = now.getHours();
  let m = String(now.getMinutes()).padStart(2,"0");
  let s = String(now.getSeconds()).padStart(2,"0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = (h % 12) || 12;
  setText("currentTime", `${h12}:${m}:${s} ${ampm}`);
  updateHighlight();
  updateCurrentPrayerCard();
}
setInterval(updateClock, 1000);
updateClock();

function updateCurrentPrayerCard(){
  // determine active prayer (latest one whose time <= now)
  const now = new Date();
  let active = "Isyak"; // default fallback
  for(const [name, raw] of Object.entries(prayerTimes)){
    if(!raw) continue;
    const [h,m] = raw.split(":").map(Number);
    if(Number.isNaN(h) || Number.isNaN(m)) continue;
    const t = new Date();
    t.setHours(h,m,0,0);
    if(t <= now) active = name;
  }

  setText("currentPrayerName", active);
  const activeTime = prayerTimes[active];
  setText("currentPrayerTime", activeTime ? format(activeTime) : "--:--");
}

function updateHighlight(){
  let active = "Isyak";
  const now = new Date();
  for(const [name, raw] of Object.entries(prayerTimes)){
    if(!raw) continue;
    const [h,m] = raw.split(":").map(Number);
    if(Number.isNaN(h) || Number.isNaN(m)) continue;
    const t = new Date();
    t.setHours(h,m,0,0);
    if(t <= now) active = name;
  }
  document.querySelectorAll(".prayer-row").forEach(e => e.classList.remove("currentPrayer"));
  const el = document.getElementById("card" + active);
  if(el) el.classList.add("currentPrayer");
}

/* ============================================================
   STARTUP
============================================================ */
(async function init(){
  await setAutoDates();
  scaleToFit();          // Option A: no transform scaling
  await detectZoneAndLoad();
})();