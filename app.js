import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, writeBatch, serverTimestamp, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 3200);
}

async function listAll(coll, orderField = "order", dir = "asc") {
  const s = await getDocs(query(collection(db, coll), orderBy(orderField, dir)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
/** কেনা আইটেমের মেয়াদ (দিন) — Settings থেকে, না থাকলে ৩৬৫ */
async function validityDays() {
  const c = (await getById("config", "app")) || {};
  const n = Number(c.validityDays);
  return n > 0 ? n : 365;
}
const fmtDate = (ms) => new Date(ms).toLocaleDateString("bn-IN", { day: "numeric", month: "short", year: "numeric" });

async function getById(coll, id) {
  const s = await getDoc(doc(db, coll, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

function compressImage(file, maxW = 900, icon = false) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!icon) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      if (icon) return resolve(c.toDataURL("image/png"));
      let q = 0.75, out = c.toDataURL("image/jpeg", q);
      while (out.length > 600000 && q > 0.3) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
      resolve(out);
    };
    img.onerror = () => reject(new Error("ছবি পড়া যায়নি"));
    img.src = url;
  });
}

/* ---------------- generic form ---------------- */
function fieldHtml(f, val) {
  const v = val ?? f.def ?? "";
  const hint = f.hint ? `<small>${f.hint}</small>` : "";
  switch (f.type) {
    case "textarea":
      return `<label>${esc(f.label)}</label><textarea name="${f.key}">${esc(v)}</textarea>${hint}`;
    case "number":
      return `<label>${esc(f.label)}</label><input type="number" step="any" name="${f.key}" value="${esc(v)}">${hint}`;
    case "select":
      return `<label>${esc(f.label)}</label><select name="${f.key}">${f.options
        .map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? "selected" : ""}>${esc(o.l)}</option>`)
        .join("")}</select>${hint}`;
    case "checkbox":
      return `<label class="chk"><input type="checkbox" name="${f.key}" ${v === true || v === "true" ? "checked" : ""}> ${esc(f.label)}</label>`;
    case "image":
      return `<label>${esc(f.label)}</label>
        <input type="hidden" name="${f.key}" value="${esc(v)}">
        <input type="text" data-url="${f.key}" placeholder="ছবির লিংক (URL) পেস্ট করুন" value="${v && !String(v).startsWith("data:") ? esc(v) : ""}">
        <div style="margin:6px 0;text-align:center" class="muted">অথবা</div>
        <input type="file" accept="image/*" data-file="${f.key}">
        <div class="prev" data-prev="${f.key}"></div>${hint}`;
    case "note":
      return `<div class="note" style="margin:10px 0">${f.html}</div>`;
    default:
      return `<label>${esc(f.label)}</label><input type="${f.type || "text"}" name="${f.key}" value="${esc(v)}">${hint}`;
  }
}

function wireImages(root, fields) {
  fields.filter((f) => f.type === "image").forEach((f) => {
    const hidden = root.querySelector(`input[name="${f.key}"]`);
    const url = root.querySelector(`[data-url="${f.key}"]`);
    const file = root.querySelector(`[data-file="${f.key}"]`);
    const prev = root.querySelector(`[data-prev="${f.key}"]`);
    const paint = () => {
      prev.innerHTML = "";
      if (hidden.value) { const i = new Image(); i.src = hidden.value; prev.appendChild(i); }
    };
    url.addEventListener("input", () => { hidden.value = url.value.trim(); paint(); });
    file.addEventListener("change", async () => {
      if (!file.files[0]) return;
      try {
        hidden.value = await compressImage(file.files[0], f.max || 900, !!f.icon);
        url.value = "";
        paint();
      } catch (e) { toast(e.message, true); }
    });
    paint();
  });
}

function readForm(form, fields) {
  const data = {};
  for (const f of fields) {
    if (f.type === "note") continue;
    const el = form.querySelector(`[name="${f.key}"]`);
    if (f.type === "checkbox") data[f.key] = el.checked;
    else if (f.type === "number") data[f.key] = el.value === "" ? (f.def ?? 0) : Number(el.value);
    else data[f.key] = el.value.trim();
    if (f.req && (data[f.key] === "" || data[f.key] === undefined)) throw new Error(`"${f.label}" পূরণ করুন`);
  }
  return data;
}

function openForm({ title, fields, values = {}, onSave, saveLabel = "সেভ করুন" }) {
  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.innerHTML = `<div class="sheet"><h3>${esc(title)}</h3><form>${fields.map((f) => fieldHtml(f, values[f.key])).join("")}
    <div class="row end"><button type="button" class="btn ghost" data-close>বাতিল</button><button class="btn primary" type="submit">${esc(saveLabel)}</button></div></form></div>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector("form");
  wireImages(form, fields);
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.dataset.close !== undefined) close(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const data = readForm(form, fields);
      await onSave(data);
      close();
    } catch (err) {
      console.error(err);
      toast(err.message || "সেভ হয়নি", true);
      btn.disabled = false;
    }
  });
}

const head = (title, buttons = "") => `<div class="head"><h2>${title}</h2><div class="acts">${buttons}</div></div>`;
const empty = (msg) => `<div class="card muted" style="text-align:center">${msg}</div>`;

/* ---------------- router ---------------- */
const pages = {};
let currentPage = "dashboard", currentArg = null;
function go(p, arg = null) {
  currentPage = p; currentArg = arg;
  document.querySelectorAll(".nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.page === p || (p === "questions" && a.dataset.page === "content")));
  $("#drawer").classList.remove("open");
  view.innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  window.scrollTo(0, 0);
  if (typeof pages[p] !== "function") { view.innerHTML = `<div class="card err">পেজ পাওয়া যায়নি: ${esc(p)}</div>`; return; }
  pages[p](arg).catch((e) => {
    console.error(e);
    view.innerHTML = `<div class="card err">ত্রুটি: ${esc(e.message)}</div>`;
  });
}
const reload = () => go(currentPage, currentArg);

/* ---------------- dashboard ---------------- */
async function count(coll, ...cons) {
  const s = await getCountFromServer(cons.length ? query(collection(db, coll), ...cons) : collection(db, coll));
  return s.data().count;
}
pages.dashboard = async () => {
  const [tests, cats, users, pending, texts, imgs] = await Promise.all([
    count("tests"), count("sections"), count("users"),
    count("purchases", where("status", "==", "pending")),
    count("sliderTexts"), count("sliderImages"),
  ]);
  view.innerHTML = head("ড্যাশবোর্ড") + `<div class="grid">
    <div class="stat"><b>${tests}</b>মক টেস্ট</div>
    <div class="stat"><b>${cats}</b>হোম মূল বাটন</div>
    <div class="stat"><b>${users}</b>ইউজার</div>
    <div class="stat"><b>${pending}</b>পেন্ডিং পেমেন্ট</div>
    <div class="stat"><b>${texts}</b>টেক্সট স্লাইড</div>
    <div class="stat"><b>${imgs}</b>ছবির স্লাইড</div></div>
    <div class="note" style="margin-top:14px">শুরু করার ক্রম: <b>সেটিংস</b> → <b>হোম বাটন ও কনটেন্ট</b> (বাটন → ক্যাটাগরি → টেস্ট) → টেস্টের ভেতরে <b>Excel দিয়ে প্রশ্ন আপলোড</b>।</div>`;
};

/* ---------------- generic CRUD pages (text / image / buttons) ---------------- */
const ORDER = { key: "order", label: "ক্রম (ছোট সংখ্যা আগে দেখাবে)", type: "number", def: 1 };
const ACTIVE = { key: "active", label: "চালু আছে", type: "checkbox", def: true };
const CRUD = {
  sliderTexts: {
    title: "টেক্সট স্লাইডার", one: "টেক্সট",
    fields: [{ key: "text", label: "লেখা", type: "textarea", req: true }, ORDER, ACTIVE],
    row: (i) => `<div class="grow"><div>${esc(i.text)}</div><small>ক্রম ${i.order} • ${i.active ? "চালু" : "বন্ধ"}</small></div>`,
  },
  sliderImages: {
    title: "ছবির স্লাইডার", one: "ছবি",
    fields: [{ key: "image", label: "স্লাইডার ছবি", type: "image", req: true, max: 1000, hint: "চওড়া ছবি (যেমন 16:9) ভালো দেখায়" },
      { key: "link", label: "ক্লিক করলে খুলবে (লিংক, ঐচ্ছিক)", type: "text" }, ORDER, ACTIVE],
    row: (i) => `<img class="thumb" src="${esc(i.image)}"><div class="grow"><div>${esc(i.link || "লিংক নেই")}</div><small>ক্রম ${i.order} • ${i.active ? "চালু" : "বন্ধ"}</small></div>`,
  },
};
for (const coll of Object.keys(CRUD)) {
  pages[coll] = async () => {
    const c = CRUD[coll];
    const items = await listAll(coll);
    view.innerHTML = head(c.title, `<button class="btn primary" data-act="add" data-coll="${coll}">+ নতুন ${c.one}</button>`) +
      (items.length
        ? items.map((i) => `<div class="card item">${c.row(i)}<div class="acts">
            <button class="btn small" data-act="toggle" data-coll="${coll}" data-id="${i.id}">${i.active ? "বন্ধ করুন" : "চালু করুন"}</button>
            <button class="btn small" data-act="edit" data-coll="${coll}" data-id="${i.id}">এডিট</button>
            <button class="btn small danger" data-act="del" data-coll="${coll}" data-id="${i.id}">ডিলিট</button></div></div>`).join("")
        : empty(`কোনো ${c.one} নেই। উপরের বাটনে চাপ দিন।`));
  };
}
// মেনুতে পেজের নাম "texts" / "images" — আসল পেজ sliderTexts / sliderImages
pages.texts = pages.sliderTexts;
pages.images = pages.sliderImages;
async function nextOrder(coll) {
  const items = await listAll(coll);
  return items.length ? Math.max(...items.map((i) => Number(i.order) || 0)) + 1 : 1;
}

/* ---------------- হোম বাটন → বাটন → ক্যাটাগরি → টেস্ট / PDF / ভিডিও ---------------- */
const MODES = [{ v: "free", l: "Free (Reward Ad দেখে)" }, { v: "paid", l: "Paid (পেমেন্ট করতে হবে)" }, { v: "free_paid", l: "Free + Paid (দুটোই)" }];
const modeLabel = (m) => (MODES.find((x) => x.v === m) || MODES[0]).l;
const GROUP_MODES = [
  { v: "free", l: "Free (সবার জন্য খোলা)" },
  { v: "paid", l: "Paid (কিনলে তবেই ভেতরে ঢোকা যাবে, কিনলে ভেতরের সব খুলবে)" },
  { v: "free_paid", l: "Free + Paid (খোলা, তবে কিনলে ভেতরের সব বিজ্ঞাপন ছাড়া)" },
];
const groupModeShort = (m) => (m === "paid" ? "Paid" : m === "free_paid" ? "Free + Paid" : "Free");
const modeBadge = (x) => `<span class="badge ${x.mode === "paid" ? "warn" : "ok"}">${groupModeShort(x.mode)}</span>${x.mode && x.mode !== "free" ? `<span class="badge">₹${x.price}</span>` : ""}`;
const TYPES = {
  mock: { l: "মক টেস্ট", coll: "tests", one: "মক টেস্ট", ico: "📝" },
  pdf: { l: "PDF", coll: "pdfs", one: "PDF", ico: "📕" },
  video: { l: "ভিডিও", coll: "videos", one: "ভিডিও", ico: "🎬" },
  note: { l: "নোটস", coll: "notes", one: "নোট", ico: "🗒️" },
};
const SEED = [
  { id: "mock", title: "MOCK TEST", type: "mock", order: 1 },
  { id: "pdf", title: "PDF BOOK", type: "pdf", order: 2 },
  { id: "video", title: "VIDEO CLASS", type: "video", order: 3 },
  { id: "notes", title: "NOTES", type: "note", order: 4 },
];

function driveToDirect(u) {
  u = (u || "").trim();
  if (/drive\.google\.com/.test(u)) {
    const m = u.match(/\/file\/d\/([^/?#]+)/) || u.match(/[?&]id=([^&#]+)/);
    if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  }
  return u;
}
async function deleteParts(coll, id) {
  const s = await getDocs(collection(db, coll, id, "parts"));
  const ids = s.docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db);
    ids.slice(i, i + 400).forEach((x) => b.delete(doc(db, coll, id, "parts", x)));
    await b.commit();
  }
}
async function deleteLeaf(type, id) {
  if (type === "mock") {
    const qs = await getDocs(collection(db, "tests", id, "questions"));
    await deleteQuestions(id, qs.docs.map((d) => d.id));
    await deleteDoc(doc(db, "tests", id));
  } else {
    await deleteParts(TYPES[type].coll, id);
    await deleteDoc(doc(db, TYPES[type].coll, id));
  }
}
async function deleteGroupDeep(g) {
  const groups = await listAll("groups");
  for (const k of groups.filter((x) => x.parentId === g.id)) await deleteGroupDeep(k);
  for (const t of Object.keys(TYPES)) {
    const leaves = await listAll(TYPES[t].coll);
    for (const l of leaves.filter((l) => l.categoryId === g.id)) await deleteLeaf(t, l.id);
  }
  await deleteDoc(doc(db, "groups", g.id));
}
async function deleteSectionDeep(id) {
  const groups = await listAll("groups");
  for (const g of groups.filter((x) => x.sectionId === id && x.level === 1)) await deleteGroupDeep(g);
  await deleteDoc(doc(db, "sections", id));
}

pages.content = async (arg) => {
  arg = arg || {};
  if (arg.cat) return ctLeaves(arg);
  if (arg.btn) return ctGroups(arg, 2);
  if (arg.sec) return ctGroups(arg, 1);
  return ctSections();
};

const CT_NOTE = (t) => `<div class="note" style="margin-bottom:10px">${t}</div>`;
const thumb = (i) => (i.image ? `<img class="thumb" style="width:48px;border-radius:50%" src="${esc(i.image)}">` : "");

async function ctSections() {
  let secs = await listAll("sections");
  if (!secs.length) {
    for (const s of SEED) await setDoc(doc(db, "sections", s.id), { title: s.title, type: s.type, order: s.order, active: true, image: "" });
    secs = await listAll("sections");
  }
  const groups = await listAll("groups");
  view.innerHTML = head("হোম স্ক্রিনের মূল বাটন", `<button class="btn primary" data-act="ct-sec-add">+ নতুন মূল বাটন</button>`) +
    (secs.some((x) => x.type === "note") ? "" : `<div class="note" style="margin-bottom:10px">🗒️ <b>NOTES</b> বাটন এখনো নেই। <button class="btn small primary" data-act="ct-sec-seed-notes">+ NOTES বাটন যোগ করুন</button></div>`) +
    CT_NOTE("অ্যাপ খুললে হোমে এই বাটনগুলো গোল আইকনে দেখাবে। সাজানোর ক্রম: <b>মূল বাটন</b> → <b>বাটন</b> (যেমন WBP, SSC GD) → <b>ক্যাটাগরি</b> (যেমন Mega Mock Test) → <b>টেস্ট / PDF / ভিডিও</b>।") +
    secs.map((s) => {
      const n = groups.filter((g) => g.sectionId === s.id && g.level === 1).length;
      return `<div class="card item">${thumb(s)}<div class="grow"><b>${esc(s.title)}</b><br>
        <small>ধরন: ${(TYPES[s.type] || TYPES.mock).ico} ${(TYPES[s.type] || TYPES.mock).l} • ${n} টি বাটন • ক্রম ${s.order} • ${s.active ? "চালু" : "বন্ধ"}</small></div>
        <div class="acts">
          <button class="btn small primary" data-act="ct-open" data-sec="${s.id}">খুলুন</button>
          <button class="btn small" data-act="ct-sec-toggle" data-id="${s.id}">${s.active ? "বন্ধ" : "চালু"}</button>
          <button class="btn small" data-act="ct-sec-edit" data-id="${s.id}">এডিট</button>
          <button class="btn small danger" data-act="ct-sec-del" data-id="${s.id}">ডিলিট</button></div></div>`;
    }).join("");
}

function sectionForm(existing, order) {
  const fields = [
    { key: "title", label: "বাটনের নাম", type: "text", req: true },
    { key: "image", label: "আইকন / লোগো (গোল করে দেখাবে)", type: "image", icon: true, max: 300, hint: "চৌকো ছবি ভালো" },
    ...(existing ? [] : [{ key: "type", label: "ভেতরে কী থাকবে", type: "select", options: Object.entries(TYPES).map(([v, t]) => ({ v, l: t.ico + " " + t.l })) }]),
    ORDER, ACTIVE,
  ];
  openForm({
    title: existing ? "মূল বাটন এডিট" : "নতুন মূল বাটন",
    values: existing || { order, active: true, type: "mock" }, fields,
    onSave: async (d) => {
      if (existing) await updateDoc(doc(db, "sections", existing.id), d);
      else await addDoc(collection(db, "sections"), d);
      toast("সেভ হয়েছে"); reload();
    },
  });
}

async function ctGroups(arg, level) {
  const sec = await getById("sections", arg.sec);
  if (!sec) throw new Error("মূল বাটন পাওয়া যায়নি");
  const type = TYPES[sec.type] || TYPES.mock;
  const [groups, leaves] = await Promise.all([listAll("groups"), listAll(type.coll)]);
  const parent = level === 2 ? groups.find((g) => g.id === arg.btn) : null;
  const list = groups.filter((g) => (level === 1 ? g.sectionId === arg.sec && g.level === 1 : g.parentId === arg.btn));
  const back = level === 1
    ? `<button class="btn small ghost" data-act="ct-open">← সব মূল বাটন</button>`
    : `<button class="btn small ghost" data-act="ct-open" data-sec="${arg.sec}">← ${esc(sec.title)}</button>`;
  const ttl = level === 1 ? `${esc(sec.title)} — বাটন` : `${esc(parent ? parent.title : "")} — ক্যাটাগরি`;
  view.innerHTML = back + head(ttl, `<button class="btn primary" data-act="ct-grp-add" data-sec="${arg.sec}" data-level="${level}" data-btn="${arg.btn || ""}">+ নতুন ${level === 1 ? "বাটন" : "ক্যাটাগরি"}</button>`) +
    CT_NOTE(level === 1
      ? `এখানে বাটন বানান, যেমন <b>WBP</b>, <b>SSC GD</b>। প্রতিটির আলাদা Free / Paid / Free+Paid ঠিক করা যায়।`
      : `এখানে ক্যাটাগরি বানান, যেমন <b>Mega Mock Test</b>। এর ভেতরে ${type.l} যোগ হবে।`) +
    (list.length ? list.map((g) => {
      const n = level === 1 ? groups.filter((x) => x.parentId === g.id).length : leaves.filter((l) => l.categoryId === g.id).length;
      return `<div class="card item">${thumb(g)}<div class="grow"><b>${esc(g.title)}</b><br>
        <small>${n} টি ${level === 1 ? "ক্যাটাগরি" : type.one} • ক্রম ${g.order} • ${g.active ? "চালু" : "বন্ধ"}</small><br>${modeBadge(g)}</div>
        <div class="acts">
          <button class="btn small primary" data-act="ct-open" data-sec="${arg.sec}" data-btn="${level === 1 ? g.id : arg.btn}" ${level === 2 ? `data-cat="${g.id}"` : ""}>খুলুন</button>
          <button class="btn small" data-act="ct-grp-toggle" data-id="${g.id}">${g.active ? "বন্ধ" : "চালু"}</button>
          <button class="btn small" data-act="ct-grp-edit" data-id="${g.id}">এডিট / মূল্য</button>
          <button class="btn small danger" data-act="ct-grp-del" data-id="${g.id}">ডিলিট</button></div></div>`;
    }).join("") : empty(`কিছু নেই। উপরের বাটনে চাপ দিন।`));
}

function groupForm(existing, ctx) {
  openForm({
    title: existing ? "এডিট" : ctx.level === 1 ? "নতুন বাটন" : "নতুন ক্যাটাগরি",
    values: existing || { mode: "free", price: 0, order: ctx.order, active: true },
    fields: [
      { key: "title", label: "নাম", type: "text", req: true },
      { key: "image", label: "আইকন / লোগো (গোল করে দেখাবে)", type: "image", icon: true, max: 300, hint: "চৌকো ছবি ভালো" },
      { key: "mode", label: "ধরন", type: "select", options: GROUP_MODES },
      { key: "price", label: "মূল্য (₹) — Paid / Free+Paid হলে", type: "number", def: 0 },
      ORDER, ACTIVE,
    ],
    onSave: async (d) => {
      if (d.mode !== "free" && d.price <= 0) throw new Error("মূল্য দিন");
      if (existing) await updateDoc(doc(db, "groups", existing.id), d);
      else await addDoc(collection(db, "groups"), {
        ...d, sectionId: ctx.sec, level: ctx.level,
        parentId: ctx.level === 2 ? ctx.btn : "", btnId: ctx.level === 2 ? ctx.btn : "",
      });
      toast("সেভ হয়েছে"); reload();
    },
  });
}

async function ctLeaves(arg) {
  const sec = await getById("sections", arg.sec);
  const cat = await getById("groups", arg.cat);
  if (!sec || !cat) throw new Error("পাওয়া যায়নি");
  const type = TYPES[sec.type] || TYPES.mock;
  const all = await listAll(type.coll);
  const mine = all.filter((l) => l.categoryId === arg.cat);
  const ctx = `data-sec="${arg.sec}" data-btn="${arg.btn}" data-cat="${arg.cat}" data-type="${sec.type}"`;
  view.innerHTML = `<button class="btn small ghost" data-act="ct-open" data-sec="${arg.sec}" data-btn="${arg.btn}">← ক্যাটাগরিতে ফিরুন</button>` +
    head(`${esc(cat.title)} — ${type.l}`, `<button class="btn primary" data-act="ct-leaf-add" ${ctx}>+ নতুন ${type.one}</button>`) +
    (sec.type === "video" ? CT_NOTE("ভিডিওর লিংক Archive.org-এর হতে হবে (যেমন https://archive.org/details/নাম)। অ্যাপের ভেতরেই চলবে। ভিডিওগুলো এখানের ক্রমে Previous / Next হবে।")
      : sec.type === "note" ? CT_NOTE("Blogger পোস্টের লিংক বসান। অ্যাপে শুধু লেখা ও ছবি দেখাবে — Blogger-এর নাম বা লিংক ইউজার কখনো দেখতে পাবে না।")
      : sec.type === "pdf" ? CT_NOTE("PDF Google Drive-এ রেখে ('Anyone with the link') লিংক এখানে বসান।") : "") +
    (mine.length ? mine.map((l) => {
      const tail = sec.type === "mock" ? `<small>${l.durationMin} মিনিট • ${l.questionCount || 0} টি প্রশ্ন</small>` : `<small>${esc(l.description || "")}</small>`;
      return `<div class="card"><div class="item">${l.image ? `<img class="thumb" src="${esc(l.image)}">` : ""}<div class="grow"><b>${esc(l.title)}</b><br>${tail}<br>
        <span class="badge ${l.mode === "paid" ? "warn" : "ok"}">${modeLabel(l.mode)}</span>
        ${l.mode !== "free" ? `<span class="badge">₹${l.price}</span>` : ""}
        <span class="badge ${l.active ? "ok" : "bad"}">${l.active ? "চালু" : "বন্ধ"}</span></div></div>
        <div class="acts" style="margin-top:10px;justify-content:flex-start">
        ${sec.type === "mock" ? `<button class="btn small primary" data-act="questions" data-id="${l.id}">প্রশ্ন (${l.questionCount || 0})</button>` : ""}
        <button class="btn small ${sec.type === "mock" ? "" : "primary"}" data-act="ct-leaf-edit" data-id="${l.id}" ${ctx}>এডিট / মূল্য</button>
        <button class="btn small" data-act="ct-leaf-toggle" data-id="${l.id}" ${ctx}>${l.active ? "বন্ধ" : "চালু"}</button>
        <button class="btn small danger" data-act="ct-leaf-del" data-id="${l.id}" ${ctx}>ডিলিট</button></div></div>`;
    }).join("") : empty(`এখানে এখনো কোনো ${type.one} নেই।`));
}

async function testForm(existing, c) {
  const order = existing ? existing.order : await nextOrder("tests");
  openForm({
    title: existing ? "টেস্ট এডিট" : "নতুন মক টেস্ট",
    values: existing || { order, durationMin: 30, mode: "free", price: 0, marksPerQuestion: 1, negativeMarks: 0, active: true },
    fields: [
      { key: "title", label: "টেস্টের নাম (যেমন Mock Test 1)", type: "text", req: true },
      { key: "description", label: "ছোট বিবরণ (ঐচ্ছিক)", type: "text" },
      { key: "durationMin", label: "সময় (মিনিট)", type: "number", def: 30 },
      { key: "mode", label: "টেস্টের ধরন", type: "select", options: MODES },
      { key: "price", label: "মূল্য (₹) — Paid / Free+Paid হলে", type: "number", def: 0 },
      { key: "marksPerQuestion", label: "প্রতি প্রশ্নের নম্বর", type: "number", def: 1 },
      { key: "negativeMarks", label: "ভুল উত্তরে কাটা নম্বর (০ হলে নেগেটিভ নেই)", type: "number", def: 0 },
      { key: "order", label: "ক্রম", type: "number", def: 1 },
      ACTIVE,
    ],
    onSave: async (d) => {
      if (d.durationMin <= 0) throw new Error("সময় ০ এর বেশি হতে হবে");
      if (d.mode !== "free" && d.price <= 0) throw new Error("Paid টেস্টে মূল্য দিন");
      if (existing) await updateDoc(doc(db, "tests", existing.id), d);
      else await addDoc(collection(db, "tests"), { ...d, sectionId: c.sec, btnId: c.btn, categoryId: c.cat, questionCount: 0, createdAt: serverTimestamp() });
      toast("সেভ হয়েছে"); reload();
    },
  });
}

async function linkForm(type, existing, c) {
  const coll = TYPES[type].coll;
  let prevLink = "";
  if (existing) {
    const l = await getById(`${coll}/${existing.id}/parts`, "link");
    prevLink = l ? l.url : "";
  }
  const order = existing ? existing.order : (await listAll(coll)).length + 1;
  openForm({
    title: existing ? `${TYPES[type].one} এডিট` : `নতুন ${TYPES[type].one}`,
    values: existing ? { ...existing, link: prevLink } : { mode: "free", price: 0, order, active: true },
    fields: [
      { key: "title", label: "নাম", type: "text", req: true },
      { key: "description", label: "ছোট বিবরণ (ঐচ্ছিক)", type: "text" },
      { key: "image", label: "কভার / থাম্বনেইল (ঐচ্ছিক)", type: "image", icon: true, max: 400 },
      { key: "mode", label: "ধরন", type: "select", options: MODES },
      { key: "price", label: "মূল্য (₹) — Paid / Free+Paid হলে", type: "number", def: 0 },
      { key: "link", label: type === "pdf" ? "PDF লিংক (Google Drive বা সরাসরি লিংক)" : type === "note" ? "Blogger পোস্টের লিংক" : "ভিডিও লিংক (Archive.org)", type: "text", req: true,
        hint: type === "pdf" ? "Drive-এ 'Anyone with the link' করে লিংক পেস্ট করুন" : type === "note" ? "যেমন: https://আপনার-ব্লগ.blogspot.com/2026/10/post.html — ইউজার এই লিংক দেখতে পাবে না" : "যেমন: https://archive.org/details/আইডি  (অথবা সরাসরি .mp4 লিংক)" },
      ORDER, ACTIVE,
    ],
    onSave: async (d) => {
      if (d.mode !== "free" && d.price <= 0) throw new Error("Paid হলে মূল্য দিন");
      const link = String(d.link || "").trim();
      if (!link) throw new Error("লিংক দিন");
      const meta = { title: d.title, description: d.description, image: d.image, mode: d.mode, price: d.price, order: d.order, active: d.active, source: "link" };
      let id = existing && existing.id;
      if (!id) {
        const ref = await addDoc(collection(db, coll), { ...meta, sectionId: c.sec, btnId: c.btn, categoryId: c.cat, chunkCount: 0, sizeBytes: 0, rev: 0, createdAt: serverTimestamp() });
        id = ref.id;
      } else await updateDoc(doc(db, coll, id), meta);
      const url = type === "pdf" ? driveToDirect(link) : link;
      if (url !== prevLink || !existing) {
        await deleteParts(coll, id);
        await setDoc(doc(db, coll, id, "parts", "link"), { url });
        await updateDoc(doc(db, coll, id), { rev: Date.now(), chunkCount: 0, sizeBytes: 0, source: "link" });
      }
      toast("সেভ হয়েছে"); reload();
    },
  });
}

async function ctClick(act, b) {
  const { id, sec, btn, cat, type, level } = b.dataset;
  switch (act) {
    case "ct-open": go("content", { sec: sec || undefined, btn: btn || undefined, cat: cat || undefined }); break;
    case "ct-sec-add": sectionForm(null, (await listAll("sections")).length + 1); break;
    case "ct-sec-seed-notes":
      await setDoc(doc(db, "sections", "notes"), { title: "NOTES", type: "note", order: 4, active: true, image: "" });
      toast("NOTES বাটন যোগ হয়েছে"); reload(); break;
    case "ct-sec-edit": sectionForm(await getById("sections", id)); break;
    case "ct-sec-toggle": { const c = await getById("sections", id); await updateDoc(doc(db, "sections", id), { active: !c.active }); reload(); break; }
    case "ct-sec-del":
      if (confirm("এই মূল বাটন ও এর ভেতরের সবকিছু ডিলিট হবে। নিশ্চিত?")) { await deleteSectionDeep(id); toast("ডিলিট হয়েছে"); reload(); }
      break;
    case "ct-grp-add": {
      const gs = await listAll("groups");
      groupForm(null, { sec, btn, level: Number(level), order: gs.length + 1 });
      break;
    }
    case "ct-grp-edit": groupForm(await getById("groups", id), {}); break;
    case "ct-grp-toggle": { const c = await getById("groups", id); await updateDoc(doc(db, "groups", id), { active: !c.active }); reload(); break; }
    case "ct-grp-del":
      if (confirm("এটি ও এর ভেতরের সবকিছু ডিলিট হবে। নিশ্চিত?")) { await deleteGroupDeep(await getById("groups", id)); toast("ডিলিট হয়েছে"); reload(); }
      break;
    case "ct-leaf-add": type === "mock" ? testForm(null, { sec, btn, cat }) : linkForm(type, null, { sec, btn, cat }); break;
    case "ct-leaf-edit": {
      const cur = await getById(TYPES[type].coll, id);
      type === "mock" ? testForm(cur, { sec, btn, cat }) : linkForm(type, cur, { sec, btn, cat });
      break;
    }
    case "ct-leaf-toggle": { const c = await getById(TYPES[type].coll, id); await updateDoc(doc(db, TYPES[type].coll, id), { active: !c.active }); reload(); break; }
    case "ct-leaf-del":
      if (confirm("ডিলিট করবেন?")) { await deleteLeaf(type, id); toast("ডিলিট হয়েছে"); reload(); }
      break;
  }
}

/* ---------------- questions ---------------- */
const ANS = ["A", "B", "C", "D"];
function parseAnswer(v) {
  const s = String(v ?? "").trim().toUpperCase();
  const map = { A: 0, B: 1, C: 2, D: 3, "1": 0, "2": 1, "3": 2, "4": 3, "ক": 0, "খ": 1, "গ": 2, "ঘ": 3 };
  return s in map ? map[s] : -1;
}

pages.questions = async (testId) => {
  const test = await getById("tests", testId);
  if (!test) throw new Error("টেস্ট পাওয়া যায়নি");
  const qs = await listAll(`tests/${testId}/questions`);
  if ((test.questionCount || 0) !== qs.length) await updateDoc(doc(db, "tests", testId), { questionCount: qs.length });
  view.innerHTML = `<button class="btn small ghost" data-act="ct-open" data-sec="${test.sectionId || ""}" data-btn="${test.btnId || ""}" data-cat="${test.categoryId || ""}">← টেস্ট তালিকায় ফিরুন</button>` +
    head(esc(test.title), `<button class="btn primary" data-act="q-add" data-id="${testId}">+ প্রশ্ন</button>
      <button class="btn" data-act="q-excel" data-id="${testId}">📥 Excel আপলোড</button>
      <button class="btn ghost" data-act="template">নমুনা Excel</button>
      ${qs.length ? `<button class="btn danger" data-act="q-clear" data-id="${testId}">সব মুছুন</button>` : ""}`) +
    `<input type="file" id="xlsxInput" accept=".xlsx,.xls,.csv" class="hidden">
     <div class="note" style="margin-bottom:10px"><b>Excel-এর কলাম ক্রম:</b> প্রশ্ন | Option A | Option B | Option C | Option D | Answer (A/B/C/D) | ব্যাখ্যা<br>মোট প্রশ্ন: <b>${qs.length}</b></div>` +
    (qs.length ? qs.map((q, n) => `<div class="card"><div class="q-title">${n + 1}. ${esc(q.question)}</div>
      ${q.options.map((o, k) => `<div class="opt ${k === q.answer ? "right" : ""}">${ANS[k]}. ${esc(o)}</div>`).join("")}
      ${q.explanation ? `<small style="display:block;margin-top:6px">ব্যাখ্যা: ${esc(q.explanation)}</small>` : ""}
      <div class="acts" style="margin-top:8px;justify-content:flex-start">
        <button class="btn small" data-act="q-edit" data-id="${testId}" data-qid="${q.id}">এডিট</button>
        <button class="btn small danger" data-act="q-del" data-id="${testId}" data-qid="${q.id}">ডিলিট</button></div></div>`).join("")
      : empty("এখনো কোনো প্রশ্ন নেই। Excel আপলোড করুন বা এক এক করে যোগ করুন।"));
  const inp = $("#xlsxInput");
  inp.addEventListener("change", () => inp.files[0] && handleExcel(testId, test, qs, inp.files[0]));
};

function questionForm(testId, existing, nextOrderNo) {
  openForm({
    title: existing ? "প্রশ্ন এডিট" : "নতুন প্রশ্ন",
    values: existing ? { ...existing, o1: existing.options[0], o2: existing.options[1], o3: existing.options[2], o4: existing.options[3], ans: ANS[existing.answer] } : { ans: "A" },
    fields: [
      { key: "question", label: "প্রশ্ন", type: "textarea", req: true },
      { key: "o1", label: "Option A", type: "text", req: true },
      { key: "o2", label: "Option B", type: "text", req: true },
      { key: "o3", label: "Option C", type: "text", req: true },
      { key: "o4", label: "Option D", type: "text", req: true },
      { key: "ans", label: "সঠিক উত্তর", type: "select", options: ANS.map((a) => ({ v: a, l: a })) },
      { key: "explanation", label: "ব্যাখ্যা / সমাধান", type: "textarea" },
    ],
    onSave: async (d) => {
      const data = { question: d.question, options: [d.o1, d.o2, d.o3, d.o4], answer: parseAnswer(d.ans), explanation: d.explanation };
      if (existing) await updateDoc(doc(db, "tests", testId, "questions", existing.id), data);
      else await addDoc(collection(db, "tests", testId, "questions"), { ...data, order: nextOrderNo });
      toast("সেভ হয়েছে");
      reload();
    },
  });
}

async function handleExcel(testId, test, existingQs, file) {
  $("#xlsxInput").value = "";
  let rows;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  } catch (e) { return toast("Excel ফাইল পড়া যায়নি", true); }

  const parsed = [], errors = [];
  rows.forEach((r, i) => {
    if (r.every((c) => String(c).trim() === "")) return;
    const ans = parseAnswer(r[5]);
    if (i === 0 && ans === -1) return; // header row
    const q = String(r[0]).trim(), opts = [r[1], r[2], r[3], r[4]].map((x) => String(x).trim());
    if (!q || opts.some((o) => !o) || ans === -1) { errors.push(i + 1); return; }
    parsed.push({ question: q, options: opts, answer: ans, explanation: String(r[6] ?? "").trim() });
  });
  if (!parsed.length) return toast("কোনো সঠিক প্রশ্ন পাওয়া যায়নি। নমুনা Excel দেখুন।", true);

  openForm({
    title: "Excel থেকে প্রশ্ন আপলোড",
    saveLabel: `${parsed.length} টি প্রশ্ন আপলোড করুন`,
    values: { mode: "append" },
    fields: [
      { type: "note", html: `সঠিক প্রশ্ন: <b>${parsed.length}</b> টি${errors.length ? `<br>ভুল/অসম্পূর্ণ সারি (বাদ যাবে): <b>${errors.slice(0, 30).join(", ")}</b>${errors.length > 30 ? "…" : ""}` : ""}` },
      { key: "mode", label: "কীভাবে যোগ হবে", type: "select", options: [{ v: "append", l: "আগের প্রশ্ন রেখে নতুনগুলো যোগ করুন" }, { v: "replace", l: "আগের সব প্রশ্ন মুছে নতুন বসান" }] },
    ],
    onSave: async (d) => {
      let startOrder = 1;
      if (d.mode === "replace") {
        await deleteQuestions(testId, existingQs.map((q) => q.id));
      } else startOrder = existingQs.length ? Math.max(...existingQs.map((q) => q.order || 0)) + 1 : 1;
      for (let i = 0; i < parsed.length; i += 400) {
        const b = writeBatch(db);
        parsed.slice(i, i + 400).forEach((q, k) => b.set(doc(collection(db, "tests", testId, "questions")), { ...q, order: startOrder + i + k }));
        await b.commit();
      }
      const total = d.mode === "replace" ? parsed.length : existingQs.length + parsed.length;
      await updateDoc(doc(db, "tests", testId), { questionCount: total });
      toast(`${parsed.length} টি প্রশ্ন আপলোড হয়েছে`);
      reload();
    },
  });
}

async function deleteQuestions(testId, ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => b.delete(doc(db, "tests", testId, "questions", id)));
    await b.commit();
  }
}

function downloadTemplate() {
  const rows = [
    ["প্রশ্ন", "Option A", "Option B", "Option C", "Option D", "Answer (A/B/C/D)", "ব্যাখ্যা"],
    ["ভারতের রাজধানী কোনটি?", "মুম্বাই", "কলকাতা", "নতুন দিল্লি", "চেন্নাই", "C", "ভারতের রাজধানী নতুন দিল্লি।"],
    ["২ + ২ = কত?", "৩", "৪", "৫", "৬", "B", "২ এর সাথে ২ যোগ করলে ৪ হয়।"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Questions");
  XLSX.writeFile(wb, "TD_MOCK_TEST_sample.xlsx");
}

/* ---------------- payments ---------------- */
pages.payments = async () => {
  const [list, tests, pdfItems, videos, groups, notes] = await Promise.all([listAll("purchases", "createdAt", "desc"), listAll("tests"), listAll("pdfs"), listAll("videos"), listAll("groups"), listAll("notes")]);
  const tName = Object.fromEntries([
    ...tests.map((t) => [t.id, "📝 " + t.title]), ...pdfItems.map((t) => [t.id, "📕 " + t.title]),
    ...videos.map((t) => [t.id, "🎬 " + t.title]), ...notes.map((t) => [t.id, "🗒️ " + t.title]), ...groups.map((t) => [t.id, "📂 " + t.title]),
  ]);
  const stat = { pending: ["পেন্ডিং", "warn"], approved: ["অনুমোদিত", "ok"], rejected: ["বাতিল", "bad"] };
  view.innerHTML = head("পেমেন্ট রিকোয়েস্ট", `<button class="btn primary" data-act="grant">+ হাতে অ্যাক্সেস দিন</button>`) +
    `<div class="note" style="margin-bottom:10px">ইউজার UPI-তে টাকা পাঠিয়ে Transaction ID (UTR) দেয়। আপনার UPI অ্যাপে টাকা এসেছে মিলিয়ে <b>অনুমোদন</b> করুন — তখন ওই টেস্ট ওই ইউজারের জন্য Ads-মুক্ত খুলে যাবে।</div>` +
    (list.length ? list.map((p) => {
      const exp = p.expiresAt?.toMillis ? p.expiresAt.toMillis() : null;
      const expired = p.status === "approved" && exp && exp <= Date.now();
      const s = expired ? ["মেয়াদ শেষ", "bad"] : (stat[p.status] || stat.pending);
      const when = p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString("bn-IN") : "";
      return `<div class="card"><div class="item"><div class="grow"><b>${esc(tName[p.testId] || p.testId)}</b> — ₹${esc(p.amount)}<br>
        <small>${esc(p.email)} • ${p.method === "razorpay" ? "Razorpay ID" : "UTR"}: <b>${esc(p.utr || "—")}</b> • ${esc(when)}${p.status === "approved" && exp ? ` • মেয়াদ: <b>${esc(fmtDate(exp))}</b> পর্যন্ত` : ""}</small></div><span class="badge ${s[1]}">${s[0]}</span></div>
        <div class="acts" style="margin-top:8px;justify-content:flex-start">
        ${p.status !== "approved" ? `<button class="btn small primary" data-act="pay-ok" data-id="${p.id}">✔ অনুমোদন</button>` : `<button class="btn small" data-act="pay-renew" data-id="${p.id}">🔄 মেয়াদ বাড়ান (আজ থেকে)</button>`}
        ${p.status === "pending" ? `<button class="btn small" data-act="pay-no" data-id="${p.id}">বাতিল</button>` : ""}
        <button class="btn small danger" data-act="pay-del" data-id="${p.id}">ডিলিট</button></div></div>`;
    }).join("") : empty("এখনো কোনো পেমেন্ট রিকোয়েস্ট নেই।"));
};

async function grantForm() {
  const [tests, pdfs, videos, groups, notes] = await Promise.all([listAll("tests"), listAll("pdfs"), listAll("videos"), listAll("groups"), listAll("notes")]);
  const items = [
    ...groups.map((g) => ({ id: g.id, label: "📂 " + g.title + (g.level === 1 ? " (বাটন)" : " (ক্যাটাগরি)"), price: g.price, mode: g.mode, kind: "group" })),
    ...tests.map((t) => ({ id: t.id, label: "📝 " + t.title, price: t.price, mode: t.mode, kind: "test" })),
    ...pdfs.map((p) => ({ id: p.id, label: "📕 " + p.title, price: p.price, mode: p.mode, kind: "pdf" })),
    ...videos.map((p) => ({ id: p.id, label: "🎬 " + p.title, price: p.price, mode: p.mode, kind: "video" })),
    ...notes.map((p) => ({ id: p.id, label: "🗒️ " + p.title, price: p.price, mode: p.mode, kind: "note" })),
  ].filter((x) => x.mode && x.mode !== "free");
  if (!items.length) return toast("কোনো Paid আইটেম নেই", true);
  openForm({
    title: "হাতে অ্যাক্সেস দিন",
    fields: [
      { key: "email", label: "ইউজারের ইমেইল (অ্যাপে যে ইমেইলে সাইনআপ করেছে)", type: "email", req: true },
      { key: "testId", label: "কোন বাটন / ক্যাটাগরি / টেস্ট / PDF / ভিডিও", type: "select", options: items.map((t) => ({ v: t.id, l: t.label })) },
    ],
    onSave: async (d) => {
      const email = d.email.toLowerCase();
      const s = await getDocs(query(collection(db, "users"), where("email", "==", email), limit(1)));
      if (s.empty) throw new Error("এই ইমেইলে কোনো ইউজার পাওয়া যায়নি");
      const t = items.find((x) => x.id === d.testId);
      const uid = s.docs[0].id;
      const days = await validityDays();
      await setDoc(doc(db, "purchases", `${uid}_${d.testId}`), { uid, email, testId: d.testId, kind: t.kind, amount: t.price, utr: "ADMIN-GRANT", status: "approved", createdAt: serverTimestamp(), approvedAt: serverTimestamp(), expiresAt: new Date(Date.now() + days * 864e5) });
      toast("অ্যাক্সেস দেওয়া হয়েছে");
      reload();
    },
  });
}

/* ---------------- settings ---------------- */
const SETTINGS = [
  { group: "সাধারণ" },
  { key: "appName", label: "অ্যাপের নাম", type: "text", def: "TD STUDY CENTER" },
  { key: "shareText", label: "Share করার লেখা", type: "textarea", def: "TD STUDY CENTER অ্যাপে ফ্রি মক টেস্ট দিন!" },
  { key: "playStoreUrl", label: "Play Store লিংক (Share ও Rating এর জন্য)", type: "text", hint: "যেমন: https://play.google.com/store/apps/details?id=com.tdmocktest.app" },
  { group: "AdMob বিজ্ঞাপন" },
  { key: "adsEnabled", label: "বিজ্ঞাপন চালু আছে", type: "checkbox", def: true },
  { key: "bannerId", label: "Banner Ad Unit ID", type: "text", hint: "ca-app-pub-xxxxxxxx/xxxxxxxx (ফাঁকা রাখলে Test Ad দেখাবে)" },
  { key: "interstitialId", label: "Interstitial Ad Unit ID", type: "text" },
  { key: "rewardedId", label: "Rewarded Ad Unit ID", type: "text" },
  { key: "rewardPopupText", label: "Free পরীক্ষার Popup-এর লেখা", type: "text", def: "সম্পূর্ণ বিনামূল্যে পরীক্ষা দেওয়ার জন্য Reward Ads দেখুন" },
  { type: "note", html: "⚠️ <b>AdMob App ID</b> (ca-app-pub-…~…) অ্যাপের ভেতরে <code>res/values/strings.xml</code>-এ একবার বসাতে হয় — Google-এর নিয়মে এটা রিমোটলি বদলানো যায় না। শুধু উপরের Ad Unit ID গুলো এখান থেকে বদলানো যায়।" },
  { group: "PDF, ভিডিও ও নোটস" },
  { key: "pdfInterstitialMin", label: "PDF পড়ার সময় প্রতি কত মিনিট পর Interstitial Ad", type: "number", def: 3, hint: "০ দিলে বন্ধ। (কেনা আইটেমে কোনো বিজ্ঞাপন আসে না)" },
  { key: "pdfRewardPopupText", label: "Free PDF-এর Popup-এর লেখা", type: "text", def: "সম্পূর্ণ বিনামূল্যে পিডিএফ পড়ার জন্য Reward Ads দেখুন" },
  { key: "videoInterstitialMin", label: "ভিডিও দেখার সময় প্রতি কত মিনিট পর Interstitial Ad", type: "number", def: 5, hint: "০ দিলে বন্ধ। (কেনা আইটেমে কোনো বিজ্ঞাপন আসে না)" },
  { key: "videoRewardPopupText", label: "Free ভিডিওর Popup-এর লেখা", type: "text", def: "সম্পূর্ণ বিনামূল্যে ভিডিও দেখার জন্য Reward Ads দেখুন" },
  { key: "noteInterstitialMin", label: "নোটস পড়ার সময় প্রতি কত মিনিট পর Interstitial Ad", type: "number", def: 3, hint: "০ দিলে বন্ধ।" },
  { key: "noteRewardPopupText", label: "Free নোটসের Popup-এর লেখা", type: "text", def: "সম্পূর্ণ বিনামূল্যে নোটস পড়ার জন্য Reward Ads দেখুন" },
  { group: "OneSignal নোটিফিকেশন" },
  { key: "oneSignalAppId", label: "OneSignal App ID", type: "text", hint: "OneSignal Dashboard → Settings → Keys & IDs। অ্যাপ পরের বার খুললে চালু হবে।" },
  { group: "কেনা আইটেমের মেয়াদ" },
  { key: "validityDays", label: "কেনার পর কত দিন চালু থাকবে", type: "number", def: 365, hint: "পেমেন্টের দিন থেকে গোনা হয়। ৩৬৫ = ১ বছর। মেয়াদ শেষ হলে ইউজারকে আবার কিনতে হবে।" },
  { group: "পেমেন্ট — Razorpay" },
  { key: "paymentMethod", label: "পেমেন্ট পদ্ধতি", type: "select", def: "both", options: [
    { v: "both", l: "Razorpay + হাতে UPI (দুটোই)" },
    { v: "razorpay", l: "শুধু Razorpay" },
    { v: "upi", l: "শুধু হাতে UPI" }] },
  { key: "razorpayKeyId", label: "Razorpay Key ID", type: "text", hint: "rzp_live_XXXX (টেস্টের জন্য rzp_test_XXXX)। ⚠️ Key Secret কখনো এখানে বা অ্যাপে দেবেন না" },
  { key: "razorpayServerUrl", label: "পেমেন্ট সার্ভারের লিংক (স্বয়ংক্রিয় অনুমোদন)", type: "text", hint: "Cloudflare Worker-এর লিংক। ফাঁকা থাকলে পেমেন্টের পর আপনি Razorpay Dashboard মিলিয়ে নিজে অনুমোদন করবেন" },
  { group: "পেমেন্ট — হাতে UPI" },
  { key: "upiId", label: "আপনার UPI ID", type: "text", hint: "যেমন: yourname@okaxis" },
  { key: "upiName", label: "UPI-তে নাম", type: "text" },
  { key: "paymentNote", label: "পেমেন্ট পেজে নির্দেশনা", type: "textarea", def: "টাকা পাঠানোর পর Transaction ID (UTR) লিখে জমা দিন। কিছুক্ষণের মধ্যে অনুমোদন হবে।" },
];
pages.settings = async () => {
  const cur = (await getById("config", "app")) || {};
  const fields = SETTINGS.filter((s) => !s.group);
  view.innerHTML = head("সেটিংস") + `<form id="setForm" class="card">${SETTINGS.map((s) =>
    s.group ? `<div class="section-title">${s.group}</div>` : fieldHtml(s, cur[s.key])).join("")}
    <button class="btn primary block" style="margin-top:16px" type="submit">সব সেভ করুন</button></form>`;
  wireImages($("#setForm"), fields);
  $("#setForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, "config", "app"), readForm(e.target, fields), { merge: true });
      toast("সেটিংস সেভ হয়েছে");
    } catch (err) { toast(err.message, true); }
  });
};

/* ---------------- click handling ---------------- */
view.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const { act, coll, id, qid } = b.dataset;
  try {
    if (act.startsWith("ct-")) return await ctClick(act, b);
    switch (act) {
      case "add": {
        const c = CRUD[coll];
        openForm({ title: `নতুন ${c.one}`, fields: c.fields, values: { order: await nextOrder(coll), active: true },
          onSave: async (d) => { await addDoc(collection(db, coll), d); toast("যোগ হয়েছে"); reload(); } });
        break;
      }
      case "edit": {
        const c = CRUD[coll];
        openForm({ title: `${c.one} এডিট`, fields: c.fields, values: await getById(coll, id),
          onSave: async (d) => { await updateDoc(doc(db, coll, id), d); toast("সেভ হয়েছে"); reload(); } });
        break;
      }
      case "toggle": {
        const cur = await getById(coll, id);
        await updateDoc(doc(db, coll, id), { active: !cur.active });
        reload();
        break;
      }
      case "del":
        if (confirm("সত্যিই ডিলিট করবেন?")) { await deleteDoc(doc(db, coll, id)); toast("ডিলিট হয়েছে"); reload(); }
        break;
      case "questions": go("questions", id); break;
      case "q-add": {
        const qs = await listAll(`tests/${id}/questions`);
        questionForm(id, null, qs.length ? Math.max(...qs.map((q) => q.order || 0)) + 1 : 1);
        break;
      }
      case "q-edit": questionForm(id, await getById(`tests/${id}/questions`, qid)); break;
      case "q-del":
        if (confirm("প্রশ্নটি ডিলিট করবেন?")) {
          await deleteDoc(doc(db, "tests", id, "questions", qid));
          toast("ডিলিট হয়েছে"); reload();
        }
        break;
      case "q-clear":
        if (confirm("এই টেস্টের সব প্রশ্ন মুছে যাবে। নিশ্চিত?")) {
          const qs = await getDocs(collection(db, "tests", id, "questions"));
          await deleteQuestions(id, qs.docs.map((d) => d.id));
          await updateDoc(doc(db, "tests", id), { questionCount: 0 });
          reload();
        }
        break;
      case "q-excel": $("#xlsxInput").click(); break;
      case "template": downloadTemplate(); break;
      case "grant": grantForm(); break;
      case "pay-ok": case "pay-renew": {
        // মেয়াদ = পেমেন্টের (জমা দেওয়ার) দিন + N দিন; নবায়নে আজ থেকে
        const p = await getById("purchases", id);
        const days = await validityDays();
        const base = act === "pay-renew" ? Date.now() : (p?.createdAt?.toMillis?.() ?? Date.now());
        await updateDoc(doc(db, "purchases", id), { status: "approved", approvedAt: serverTimestamp(), expiresAt: new Date(base + days * 864e5) });
        toast(act === "pay-renew" ? "মেয়াদ বাড়ানো হয়েছে" : "অনুমোদিত"); reload(); break;
      }
      case "pay-no": await updateDoc(doc(db, "purchases", id), { status: "rejected" }); reload(); break;
      case "pay-del":
        if (confirm("ডিলিট করবেন?")) { await deleteDoc(doc(db, "purchases", id)); reload(); }
        break;
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "সমস্যা হয়েছে", true);
  }
});

/* ---------------- auth ---------------- */
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#lErr").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("#lEmail").value.trim(), $("#lPass").value);
  } catch (err) {
    $("#lErr").textContent = "ইমেইল বা পাসওয়ার্ড ভুল";
  }
});
$("#logoutBtn").addEventListener("click", () => signOut(auth));
$("#menuBtn").addEventListener("click", () => $("#drawer").classList.toggle("open"));
$("#drawer").addEventListener("click", (e) => { const a = e.target.closest("a[data-page]"); if (a) go(a.dataset.page); });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
    return;
  }
  try {
    // শুধু Admin এই কুয়েরি চালাতে পারে (rules অনুযায়ী)
    await getDocs(query(collection(db, "purchases"), limit(1)));
  } catch (err) {
    await signOut(auth);
    $("#lErr").textContent = "এই অ্যাকাউন্ট Admin নয় (Firestore rules-এ Admin ইমেইল ঠিক আছে কিনা দেখুন)";
    return;
  }
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  go("dashboard");
});
