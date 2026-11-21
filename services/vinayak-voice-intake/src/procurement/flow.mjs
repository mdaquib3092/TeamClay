import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { CaseInputError, check, HELP, SAMPLE, captureScope, catalogVendors, formatMoney, linesForQuote, parseTerms, renderRfq, scopeSummary } from "./boq.mjs";
import { ROLE_POLICY } from "../roles.mjs";
import { VendorDataError, vendorDirectory, availablePerformance, vendorSourceStatus } from "./vendor-data.mjs";

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 12).toUpperCase();
const now = () => new Date().toISOString();
const rfq = c => `RFQ-${c.id.slice(5)}-B${c.boq_rev}`;
const scopeOK = (user, c) => user?.project_id === c.project_id || (user?.role === "hod" && user.project_id === "ALL");
const member = (users, id) => [...users.values()].find(u => u.user_id === id);
const minimum = c => c.demo ? 2 : ROLE_POLICY.controls.minimumEligibleRfqVendors;
const allowed = (u, c) => scopeOK(u, c) && ((u.role === "site_engineer" && u.user_id === c.owner_id) ||
  (u.role === "project_manager" && u.user_id === c.pm_id) || (u.role === "hod" && u.user_id === c.hod_id));
const commands = /^(?:(?:DEMO\s+)?RFQ(?:\s*\||\s+HELP\b|$)|(?:PREVIEW|SEND|STATUS|RECOMMEND|APPROVE|RETURN|CORRECT)\s+CASE-)/i;
const parse = r => r && ({ ...r, scope: JSON.parse(r.scope_json) });
const clip = (s, n = 120) => String(s).replace(/\s+/g, " ").slice(0, n);
function assigned(users, role, project) {
  const matches = [...users.values()].filter(u => u.role === role && (u.project_id === project || (role === "hod" && u.project_id === "ALL")));
  check(matches.length === 1, `Assign one ${role} to this project before opening a case.`);
  return matches[0].user_id;
}

export class CaseFlow {
  constructor({ root, db, mailbox, sendStaff, pauseCheck = () => false, recoverOutbox = true }) {
    this.root = root; this.mailbox = mailbox; this.sendStaff = sendStaff; this.pauseCheck = pauseCheck;
    this.db = db || new DatabaseSync(fs.realpathSync(path.join(root, "clay.db")));
    this.template = fs.readFileSync(path.join(root, "templates/rfq_email.txt"), "utf8");
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(schema);
    if (recoverOutbox) this.db.exec("UPDATE wa_flow_outbox SET state='unconfirmed',error='interrupted; inspect provider before retrying' WHERE state='sending'");
    this.lastError = null;
  }
  one(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  tx(fn) { this.db.exec("BEGIN IMMEDIATE"); try { const v = fn(); this.db.exec("COMMIT"); return v; } catch (e) { this.db.exec("ROLLBACK"); throw e; } }
  get(id) { return parse(this.one("SELECT * FROM wa_flow_cases WHERE id=?", id)); }
  event(c, channel, direction, from, to, body, status) {
    this.run("INSERT INTO messages(at,channel,direction,from_id,to_id,requirement_id,body,status) VALUES(?,?,?,?,?,?,?,?)",
      now(), channel, direction, from, to, c.id, JSON.stringify(body), status);
  }
  enqueue(c, key, kind, target, role, payload, quoteRev = null, stage = null) {
    this.run(`INSERT OR IGNORE INTO wa_flow_outbox(id,case_id,kind,target,role,payload,boq_rev,quote_rev,required_stage,created)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, `${c.id}:${key}`, c.id, kind, target, role, JSON.stringify(payload), c.boq_rev, quoteRev, stage, now());
  }
  notify(c, key, role, text, q = null, stage = null) {
    this.enqueue(c, key, "whatsapp", role === "hod" ? c.hod_id : role === "project_manager" ? c.pm_id : c.owner_id,
      role, { text: `${c.demo ? "[DEMO] " : ""}${c.id} · ${text}` }, q, stage);
  }
  review(c) {
    const vendors = c.scope.vendors;
    return `BOQ B${c.boq_rev}: ${scopeSummary(c)}\nDeliver ${c.scope.site}, ${c.scope.project}; needed ${c.scope.needBy}; reply by ${c.scope.deadline}.\n` +
      `Segment: ${c.scope.segment}. ${vendors.map(v => `${v.id} ${v.name} <${v.email}>`).join("; ")}.\n` +
      (vendors.length ? `Read the generated RFQ: PREVIEW ${c.id} B${c.boq_rev} ${vendors[0].id}\n` : "") +
      (vendors.length >= minimum(c) ? `If the BOQ, item mappings and eligibility of these ${c.demo ? "test " : ""}recipients are correct, type:\nSEND ${c.id} B${c.boq_rev} ${vendors.map(v => v.id).join(" ")}` :
        `Blocked: ${minimum(c)} distinct eligible vendors required; only ${vendors.length} configured. Update the segment roster and correct the case.`);
  }
  prepareDrafts(c, pm) {
    c.scope.drafts = Object.fromEntries(c.scope.vendors.map(v => [v.id,{to:v.email,...renderRfq(this.template,c,v,pm)}]));
    this.run("UPDATE wa_flow_cases SET scope_json=? WHERE id=?",JSON.stringify(c.scope),c.id);
  }
  saveLines(c) {
    this.run("DELETE FROM requirement_lines WHERE requirement_id=?", c.id);
    for (const l of c.scope.lines) this.run(`INSERT INTO requirement_lines(requirement_id,material_code,qty,unit,qty_available,shortfall,rfq_qty,action)
      VALUES(?,?,?,?,?,?,?,?)`, c.id, l.code, l.requested, l.unit, l.stock, l.qty, l.qty, l.qty ? "QUOTE_SHORTFALL" : "IN_STOCK");
  }
  create(msg, user, users, fields, demo) {
    check(user.role === "site_engineer", "The registered site engineer opens a requirement.");
    const project = user.project_id, scope = captureScope(this.db, this.root, project, fields);
    const pm = assigned(users, "project_manager", project), hod = assigned(users, "hod", project);
    const id = `CASE-${hash(msg.id)}`, stamp = now(), stockOnly = scope.lines.every(l => l.qty === 0);
    this.run(`INSERT INTO requirements(requirement_id,project_id,raised_by,channel,raw_message,needed_by,status,created_at)
      VALUES(?,?,?,'whatsapp',?,?,?,?)`, id, project, user.user_id, msg.user_text, scope.needBy, stockOnly ? "IN_STOCK" : "WAITING_PM", stamp);
    this.run(`INSERT INTO wa_flow_cases(id,demo,project_id,owner_id,pm_id,hod_id,scope_json,stage,created) VALUES(?,?,?,?,?,?,?,?,?)`,
      id, +demo, project, user.user_id, pm, hod, JSON.stringify(scope), stockOnly ? "IN_STOCK" : "BOQ_REVIEW", stamp);
    const c = this.get(id); this.saveLines(c);
    if (!stockOnly) {
      this.prepareDrafts(c,member(users,pm));
      this.notify(c, "review:B1", "project_manager", this.review(c), null, "BOQ_REVIEW");
    }
    return { c, reply: `${c.demo ? "DEMO " : ""}${id} created. ${scopeSummary(c)}\n${stockOnly ? "Fully covered by the stock snapshot; no RFQ needed." : "BOQ sent to the project manager’s review queue."}` };
  }
  dispatch(c, user, words, route = "whatsapp") {
    check(user.role === "project_manager" && allowed(user,c), "Only the assigned project manager confirms vendor eligibility and dispatch.");
    check(c.stage === "BOQ_REVIEW" && words[0] === `B${c.boq_rev}`, "BOQ is not awaiting this revision’s dispatch.");
    check(new Date(Date.now() + 19800000).toISOString().slice(0, 10) <= c.scope.deadline, "The quotation deadline has passed; correct the dates.");
    const ids = words.slice(1), candidates = vendorDirectory(this.root).filter(v => v.segments.includes(c.scope.segment));
    check(ids.length >= minimum(c) && ids.length === new Set(ids).size, `Select at least ${minimum(c)} distinct eligible ${c.scope.segment} vendors.`);
    const selected = ids.map(id => {
      const v = c.scope.vendors.find(x => x.id === id), current = candidates.find(x => x.id === id);
      check(v && current?.email === v.email && current?.name === v.name, "Recipient not in the reviewed segment roster, or contact changed. Review a fresh BOQ.");
      return current;
    });
    this.run("INSERT INTO rfqs(rfq_id,requirement_id,created_at,status) VALUES(?,?,?,'DISPATCHING')", rfq(c), c.id, now());
    for (const v of selected) {
      // An owner may add a vendor to the CSV without reseeding the business DB.
      // Materialise only a newly confirmed recipient needed by this case's FKs.
      this.run(`INSERT INTO vendors(vendor_id,vendor_name,category,whatsapp,email,payment_terms)
        VALUES(?,?,?,?,?,?) ON CONFLICT(vendor_id) DO NOTHING`,v.id,v.name,v.segments.join(";"),v.whatsapp,v.email,v.paymentTerms);
      this.run("INSERT INTO rfq_recipients(rfq_id,vendor_id,channel) VALUES(?,?,'email')", rfq(c), v.id);
      this.run("INSERT INTO wa_flow_mail(case_id,vendor_id,rfq_id,email,vendor_name) VALUES(?,?,?,?,?)", c.id, v.id, rfq(c), v.email, v.name);
      this.enqueue(c, `email:${v.id}:B${c.boq_rev}`, "email", v.id, null, c.scope.drafts?.[v.id] || { to:v.email,...renderRfq(this.template,c,v,user) });
    }
    this.run("UPDATE wa_flow_cases SET stage='DISPATCHING' WHERE id=?", c.id);
    this.run("INSERT INTO approvals(requirement_id,stage,user_id,status,note,decided_via,decided_at) VALUES(?,'pm',?,'APPROVED',?,?,?)",
      c.id, user.user_id, `BOQ B${c.boq_rev}, ERP codes and eligibility checked: ${ids.join(", ")}`, route, now());
    return `Confirmed ${c.id} B${c.boq_rev}. Queued ${selected.length} individual ${c.demo ? "DEMO " : ""}RFQ emails. I’ll report Gmail acceptance.`;
  }
  comparison(c) {
    return this.one("SELECT data FROM wa_flow_snapshots WHERE case_id=? AND quote_rev=?", c.id, c.quote_rev)?.data;
  }
  statusText(c, user) {
    const mail = this.all("SELECT m.vendor_id,m.thread_id,o.state FROM wa_flow_mail m LEFT JOIN wa_flow_outbox o ON o.case_id=m.case_id AND o.kind='email' AND o.target=m.vendor_id WHERE m.case_id=?", c.id);
    const info = `B${c.boq_rev} / Q${c.quote_rev} · ${c.scope.site} · ${c.stage}.` +
      (mail.length ? ` Gmail: ${mail.filter(m => m.thread_id).length}/${mail.length} accepted.` : "");
    if (user.role === "site_engineer") return `${c.id}: ${info}`;
    return `${c.id}: ${info}\n` + (c.stage === "BOQ_REVIEW" ? this.review(c) : this.comparison(c) ? this.analysis(c, JSON.parse(this.comparison(c))) : "Waiting for quotations.") +
      (mail.some(m => ["unconfirmed","failed"].includes(m.state)) ? "\nDispatch needs attention; check Gmail Sent. No blind resend." : "");
  }
  async handle(msg, user, users) {
    const raw = msg.user_text.trim();
    if (!commands.test(raw) && !/^\/(?:rfq|procurement)(?:\s+help)?$/i.test(raw)) return null;
    const previous = this.one("SELECT reply FROM wa_flow_commands WHERE id=?", msg.id);
    if (previous) return previous.reply;
    const parts = raw.split("|").map(s => s.trim()), [verb, id, ...words] = parts[0].toUpperCase().split(/\s+/);
    try {
      if (/^(?:RFQ(?: HELP)?|DEMO RFQ HELP|\/(?:rfq|procurement)(?: help)?)$/i.test(raw)) return HELP;
      const isNew = /^(?:DEMO )?RFQ$/i.test(parts[0]);
      const initial = !isNew && this.get(id);
      if (!isNew) check(initial && allowed(user, initial), "No accessible case with that reference.");
      if (["SEND","RECOMMEND","APPROVE","RETURN"].includes(verb)) check(msg.channel === "text", "Type the decision command from your registered WhatsApp number; a transcript cannot authorise it.");
      if ((verb === "RECOMMEND" && user.role === "project_manager" && initial.stage === "COMPARISON") ||
          (["APPROVE","RETURN"].includes(verb) && user.role === "hod" && initial.stage === "WITH_HOD")) {
        try { await this.refreshCase(initial.id, users); }
        catch { return "Could not check the RFQ threads for amendments. Please retry this decision after Gmail reconnects."; }
      }
      return this.tx(() => {
        let c = initial && this.get(id), reply;
        if (isNew) ({ c, reply } = this.create(msg, user, users, parts.slice(1), /^DEMO/i.test(parts[0])));
        else if (verb === "STATUS") reply = this.statusText(c, user);
        else if (verb === "PREVIEW") {
          check(["project_manager","hod"].includes(user.role) && words[0]===`B${c.boq_rev}`, "Use the current BOQ revision from the assigned PM or HOD number.");
          const v=c.scope.vendors.find(v=>v.id===words[1]);
          check(v && c.scope.lines.some(l=>l.qty>0),"Choose a vendor from the reviewed RFQ roster.");
          const draft=c.scope.drafts?.[v.id] || {to:v.email,...renderRfq(this.template,c,v,member(users,c.pm_id))};
          reply=`RFQ preview · ${c.id} B${c.boq_rev}\nTo: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.text}`;
        }
        else if (verb === "CORRECT") {
          check(user.role === "site_engineer" && ["BOQ_REVIEW","IN_STOCK"].includes(c.stage) && words[0] === `B${c.boq_rev}`, "Only the site engineer can correct the current unissued BOQ revision.");
          const s = captureScope(this.db, this.root, c.project_id, parts.slice(1));
          const covered = s.lines.every(l => !l.qty);
          this.run("UPDATE wa_flow_cases SET scope_json=?,boq_rev=boq_rev+1,stage=? WHERE id=?", JSON.stringify(s), covered ? "IN_STOCK" : "BOQ_REVIEW", id);
          this.run("UPDATE requirements SET needed_by=?,status=? WHERE requirement_id=?", s.needBy, covered ? "IN_STOCK" : "WAITING_PM", id);
          c = this.get(id); this.saveLines(c);
          if (!covered) {
            this.prepareDrafts(c,member(users,c.pm_id));
            this.notify(c, `review:B${c.boq_rev}`, "project_manager", this.review(c), null, "BOQ_REVIEW");
          }
          reply = `${id} BOQ updated to B${c.boq_rev}. ${covered ? "No shortfall." : "Queued for a fresh PM review."}`;
        } else if (verb === "SEND") reply = this.dispatch(c, user, words);
        else {
          const recommending = verb === "RECOMMEND";
          check(recommending ? user.role === "project_manager" && c.stage === "COMPARISON" :
            user.role === "hod" && c.stage === "WITH_HOD", "This decision is not pending for your role.");
          check(words[0] === `Q${c.quote_rev}` && parts.length === 2 && parts[1].length >= 2 && parts[1].length <= 500,
            "Use the current Q revision and add | followed by a human review note.");
          const data = JSON.parse(this.comparison(c)), v = words[1], note = parts[1];
          if (verb !== "RETURN") check(data.filter(x => x.terms?.landed != null).length >= ROLE_POLICY.controls.minimumReviewedComparableQuotations &&
            data.some(x => x.id === v && x.terms?.landed != null), "Choose a comparable vendor from the current snapshot.");
          if (recommending) {
            this.run("UPDATE wa_flow_cases SET stage='WITH_HOD',selected=?,rationale=? WHERE id=?", v, note, id);
            this.run("UPDATE requirements SET status='WITH_HOD' WHERE requirement_id=?", id);
            this.run("INSERT INTO approvals(requirement_id,stage,user_id,status,vendor_id,note,decided_via,decided_at) VALUES(?,'pm',?,'APPROVED',?,?,'whatsapp',?)", id, user.user_id, v, `Q${c.quote_rev}: ${note}`, now());
            this.notify(c, `decision:${msg.id}`, "hod", `${this.analysis(c, data)}\nPM recommends ${v}: ${note}\nApprove these vendor/rates or return for review:\nAPPROVE ${id} Q${c.quote_rev} ${v} | your reason\nRETURN ${id} Q${c.quote_rev} | required changes`, c.quote_rev, "WITH_HOD");
            reply = `${id} Q${c.quote_rev}: ${v} submitted for HOD review.`;
          } else {
            const yes = verb === "APPROVE";
            check(!yes || v === c.selected, "Vendor differs from the current recommendation.");
            const stage = yes ? "APPROVED" : "COMPARISON";
            this.run("UPDATE wa_flow_cases SET stage=? WHERE id=?", stage, id);
            this.run("UPDATE requirements SET status=? WHERE requirement_id=?", yes ? "APPROVED" : "SENT_BACK", id);
            this.run("INSERT INTO approvals(requirement_id,stage,user_id,status,vendor_id,note,decided_via,decided_at) VALUES(?,'hod',?,?,?,?, 'whatsapp',?)",
              id, user.user_id, yes ? "APPROVED" : "SENT_BACK", c.selected, `Q${c.quote_rev}: ${note}`, now());
            reply = `${id} Q${c.quote_rev}: HOD ${yes ? `approved ${c.selected} and the quoted rates` : "requested changes"}. ${note}. No work order issued.`;
            for (const role of ["project_manager","site_engineer"]) this.notify(c, `outcome:${msg.id}:${role}`, role, reply, c.quote_rev, stage);
          }
        }
        this.event(c, "whatsapp", "inbound", user.user_id, "agent", { messageId: msg.message_id, channel: msg.channel, text: raw }, "recorded");
        this.run("INSERT INTO wa_flow_commands VALUES(?,?,?,?)", msg.id, c.id, user.user_id, reply);
        return reply;
      });
    } catch (e) {
      if (e instanceof CaseInputError || e instanceof VendorDataError) return e.message;
      throw e;
    }
  }
  analysis(c, data) {
    const received = data.filter(x => x.terms).length, comparable = data.filter(x => x.terms?.landed != null).length;
    return `Comparison Q${c.quote_rev} · BOQ B${c.boq_rev}: ${linesForQuote(c).map(l => `${l.qty} ${l.unit} ${l.code}`).join("; ")}. INR, same BOQ. Needed ${c.scope.needBy} at ${c.scope.site}.\n${received}/${data.length} vendors replied; ${comparable} comparable.\n` +
      data.map(x => {
        const t = x.terms;
        const h = x.history ? " Sample history (unverified): " + [
          `${x.history.orders} orders`, x.history.onTime != null && `${x.history.onTime}% on time`,
          x.history.quality != null && `quality ${x.history.quality}/5`, x.history.replyHours != null && `${x.history.replyHours}h avg reply`,
          x.history.replyRate != null && `${x.history.replyRate}% reply rate`,
        ].filter(Boolean).join(", ") + "." : " No usable vendor history on file.";
        if (!t) return `${x.id} ${x.name}: awaiting reply.`;
        if (t.flags.length) return `${x.id} ${x.name}: not comparable — ${t.flags.join(", ")}.${t.exclusions ? ` Exclusions: ${clip(t.exclusions)}.` : ""}${h}`;
        return `${x.id} ${x.name}: ${Object.entries(t.rates).map(([code,r]) => `${code} ${formatMoney(r)}/${c.scope.lines.find(l=>l.code===code).unit}`).join(", ")}; GST ${t.gst}%, freight ${formatMoney(t.freight)}; landed ${formatMoney(t.landed)}. ${t.days} days; ${clip(t.payment)}; exclusions: ${clip(t.exclusions)}.${h}`;
      }).join("\n") + (() => {
        const sorted = data.filter(x => x.terms?.landed != null).sort((a,b) => a.terms.landed-b.terms.landed);
        if (sorted.length < ROLE_POLICY.controls.minimumReviewedComparableQuotations) return "\nAwaiting comparable quotes; no recommendation.";
        const ties = sorted.filter(v => v.terms.landed === sorted[0].terms.landed);
        const difference = ties.length === 1 ? ` (${formatMoney(sorted[1].terms.landed - sorted[0].terms.landed)} below ${sorted[1].id})` : "";
        return `\n${ties.length > 1 ? "Lowest price tied" : "Lowest comparable landed price"}: ${ties.map(v=>v.id).join(", ")}${difference}. PM reviews scope, terms and lead time before recommending.`;
      })();
  }
  ingest(inv, mail) {
    if (mail.threadId !== inv.thread_id || !mail.id || this.one("SELECT 1 FROM wa_flow_replies WHERE gmail_id=?",mail.id)) return;
    this.tx(() => {
      let c = this.get(inv.case_id);
      const terms = parseTerms(mail.text || "", linesForQuote(c));
      this.run("INSERT INTO wa_flow_replies VALUES(?,?,?,?,?,?)", mail.id, c.id, inv.vendor_id, mail.received, JSON.stringify(terms), mail.text || "");
      this.event(c,"email","inbound",inv.vendor_id,"agent",{rfq:inv.rfq_id,gmailId:mail.id,threadId:inv.thread_id,terms}, "received");
      const latest = this.one("SELECT gmail_id FROM wa_flow_replies WHERE case_id=? AND vendor_id=? ORDER BY received DESC,gmail_id DESC LIMIT 1", c.id,inv.vendor_id);
      if(latest.gmail_id !== mail.id) return;
      this.run("UPDATE rfq_recipients SET replied_at=? WHERE rfq_id=? AND vendor_id=?",new Date(mail.received).toISOString(),inv.rfq_id,inv.vendor_id);
      for(const l of linesForQuote(c)) this.run(`INSERT INTO quotes(rfq_id,vendor_id,material_code,rate_as_quoted,unit_as_quoted,gst_included,rate_ex_gst_per_unit,delivery_days,payment_terms,spec_match,flags,raw_message,received_at)
        VALUES(?,?,?,?,?,'no',?,?,?,?,?,?,?)`,inv.rfq_id,inv.vendor_id,l.code,terms.rates[l.code]!=null?terms.rates[l.code]/100:null,l.unit,terms.rates[l.code]!=null?terms.rates[l.code]/100:null,terms.days,terms.payment||null,+/^exact|^as specified/i.test(terms.spec),JSON.stringify(terms.flags),mail.text||"",new Date(mail.received).toISOString());
      this.publishComparison(c);
    });
  }
  publishComparison(c) {
      const histories=availablePerformance(this.root);
      const data=this.all("SELECT * FROM wa_flow_mail WHERE case_id=? ORDER BY vendor_id",c.id).map(v=>{
        const r=this.one("SELECT gmail_id,terms FROM wa_flow_replies WHERE case_id=? AND vendor_id=? ORDER BY received DESC,gmail_id DESC LIMIT 1",c.id,v.vendor_id);
        return {id:v.vendor_id,name:v.vendor_name,source:r?.gmail_id||null,terms:r?JSON.parse(r.terms):null,history:histories.get(v.vendor_id)||null};
      });
      const allSent=this.one("SELECT COUNT(*) n FROM wa_flow_mail WHERE case_id=? AND thread_id IS NOT NULL",c.id).n===data.length;
      const ready=allSent && data.filter(x=>x.terms?.landed!=null).length>=ROLE_POLICY.controls.minimumReviewedComparableQuotations;
      const stage=ready?"COMPARISON":allSent?"AWAITING_QUOTES":"DISPATCHING";
      const superseded=["WITH_HOD","APPROVED"].includes(c.stage);
      this.run("UPDATE wa_flow_cases SET quote_rev=quote_rev+1,stage=?,selected=NULL,rationale=NULL WHERE id=?",stage,c.id);
      if(allSent)this.run("UPDATE requirements SET status='REPLIES_IN' WHERE requirement_id=?",c.id);
      c=this.get(c.id);this.run("INSERT INTO wa_flow_snapshots VALUES(?,?,?)",c.id,c.quote_rev,JSON.stringify(data));
      const brief=this.analysis(c,data);
      this.notify(c,`quote:${c.quote_rev}:pm`,"project_manager",brief+(ready?`\nWhen reviewed, type RECOMMEND ${c.id} Q${c.quote_rev} <vendor ID> | your rationale`:
        "\nMissing/changed terms? Have the vendor reply with their complete revised quotation in this RFQ thread."),c.quote_rev);
      if(ready||superseded||data.every(x=>x.terms))this.notify(c,`quote:${c.quote_rev}:hod`,"hod",(superseded?"Prior review superseded by a vendor amendment.\n":"")+brief+
        (ready?"\nFor information. The PM recommendation is required before approval.":"\nIncomplete comparison. Awaiting clarification; no decision requested."),c.quote_rev);
  }
  async refresh(inv) {
    const seen=new Set(this.all("SELECT gmail_id FROM wa_flow_replies WHERE case_id=? AND vendor_id=?",inv.case_id,inv.vendor_id).map(x=>x.gmail_id));
    try{
      for(const reply of await this.mailbox.replies(inv,seen))this.ingest(inv,reply);
      this.run("UPDATE wa_flow_mail SET poll_after=?,poll_error=NULL WHERE thread_id=?",Date.now()+15000,inv.thread_id);
    }catch(e){this.run("UPDATE wa_flow_mail SET poll_after=?,poll_error='gmail_thread_read_failed' WHERE thread_id=?",Date.now()+60000,inv.thread_id);throw e;}
  }
  async refreshCase(id) {
    for(const inv of this.all("SELECT * FROM wa_flow_mail WHERE case_id=? AND thread_id IS NOT NULL",id))await this.refresh(inv);
  }
  async deliver(users) {
    const o=this.one("SELECT * FROM wa_flow_outbox WHERE state='queued' ORDER BY rowid LIMIT 1");if(!o)return;
    const c=this.get(o.case_id), p=JSON.parse(o.payload);
    if(o.boq_rev!==c.boq_rev||(o.quote_rev!==null&&o.quote_rev!==c.quote_rev)||(o.required_stage&&o.required_stage!==c.stage)){
      this.run("UPDATE wa_flow_outbox SET state='superseded' WHERE id=?",o.id);return;
    }
    const recipient=member(users,o.target);
    if(o.kind==="whatsapp"&&(!recipient||recipient.role!==o.role||!allowed(recipient,c)||this.pauseCheck(o.target))){
      this.run("UPDATE wa_flow_outbox SET state='held',error='staff_scope_or_paused' WHERE id=?",o.id);return;
    }
    if(o.kind==="email"&&!catalogVendors(this.root,c.scope.segment).some(v=>v.id===o.target&&v.email===p.to)){
      this.run("UPDATE wa_flow_outbox SET state='held',error='vendor_contact_changed' WHERE id=?",o.id);return;
    }
    if(!this.run("UPDATE wa_flow_outbox SET state='sending',attempted=? WHERE id=? AND state='queued'",now(),o.id).changes)return;
    try{
      const receipt=o.kind==="email"?await this.mailbox.send(p):await this.sendStaff(recipient,p.text);
      if(o.kind==="email"&&(!receipt?.sent||!receipt.threadId||!receipt.messageId))throw new Error("unconfirmed Gmail send");
      this.tx(()=>{
        this.run("UPDATE wa_flow_outbox SET state='accepted',accepted=?,receipt=? WHERE id=?",now(),JSON.stringify(receipt),o.id);
        this.event(c,o.kind,"outbound","agent",o.target,{outbox:o.id,body:p.text,subject:p.subject,receipt},"accepted");
        if(o.kind==="email"){
          this.run("UPDATE wa_flow_mail SET gmail_id=?,thread_id=? WHERE case_id=? AND vendor_id=?",receipt.messageId,receipt.threadId,c.id,o.target);
          this.run("UPDATE rfq_recipients SET sent_at=? WHERE rfq_id=? AND vendor_id=?",now(),rfq(c),o.target);
          if(!this.one("SELECT 1 FROM wa_flow_mail WHERE case_id=? AND thread_id IS NULL",c.id)){
            this.run("UPDATE wa_flow_cases SET stage='AWAITING_QUOTES' WHERE id=?",c.id);
            this.run("UPDATE requirements SET status='RFQ_SENT' WHERE requirement_id=?",c.id);
            this.run("UPDATE rfqs SET status='RFQ_SENT' WHERE rfq_id=?",rfq(c));
            this.notify(c,"dispatch-accepted","project_manager",`Gmail accepted the individual RFQs. Watching their reply threads.`);
            if(c.quote_rev>0)this.publishComparison(this.get(c.id));
          }
        }
      });
    }catch{
      this.tx(()=>{this.run("UPDATE wa_flow_outbox SET state='unconfirmed',error='verify_provider_no_auto_resend' WHERE id=?",o.id);
        if(o.kind==="email")this.notify(c,`uncertain:${o.id}`,"project_manager",`Could not confirm Gmail acceptance for ${o.target}. Inspect Sent before retrying.`);});
    }
  }
  async tick(users) {
    try{
      await this.deliver(users);
      const inv=this.one(`SELECT m.* FROM wa_flow_mail m JOIN wa_flow_cases c ON c.id=m.case_id
        WHERE m.thread_id IS NOT NULL AND m.poll_after<=? AND date(json_extract(c.scope_json,'$.needBy'),'+1 day')>=date('now') ORDER BY m.poll_after,m.rowid LIMIT 1`,Date.now());
      if(inv)await this.refresh(inv);
      this.lastError=null;
    }catch{this.lastError="case_transport_needs_attention";}
  }
  summary() {
    return {enabled:true,standardMinimum:ROLE_POLICY.controls.minimumEligibleRfqVendors,demoMinimum:2,
      error:this.lastError,sample:SAMPLE,vendorSources:vendorSourceStatus(this.root),cases:this.all("SELECT id,demo,project_id,stage,boq_rev,quote_rev FROM wa_flow_cases ORDER BY created DESC LIMIT 30"),
      outbox:this.all("SELECT state,COUNT(*) n FROM wa_flow_outbox GROUP BY state")};
  }
}
