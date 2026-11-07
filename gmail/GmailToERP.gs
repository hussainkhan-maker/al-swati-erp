/**
 * Gmail → Al-Swati ERP. Paste into script.google.com (signed in with the Gmail that receives RFQs).
 * Every 5 minutes it sends new emails with the label "RFQ" (and anything from your website form)
 * to the app, with their attachments, then labels them "RFQ/Sent to ERP" so nothing is sent twice.
 *
 * Setup:  1) Fill the two values below.  2) Run setup() once and allow access.  3) In Gmail, make a filter
 *         that adds the label "RFQ" to client queries (e.g. emails from your website form, or containing BOQ / RFQ / عرض سعر).
 */
const ERP_URL = "https://PROJECT_REF.supabase.co/functions/v1/inbound-query";
const INTAKE_SECRET = "PASTE_THE_SAME_INTAKE_SECRET_AS_IN_SUPABASE";

function setup() {
  GmailApp.createLabel("RFQ");
  GmailApp.createLabel("RFQ/Sent to ERP");
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("pushNewQueries").timeBased().everyMinutes(5).create();
}

function pushNewQueries() {
  const done = GmailApp.getUserLabelByName("RFQ/Sent to ERP");
  const threads = GmailApp.search('label:RFQ -label:"RFQ/Sent to ERP" newer_than:14d', 0, 20);
  threads.forEach((th) => {
    const m = th.getMessages()[0];
    const from = m.getFrom();
    const atts = m.getAttachments({ includeInlineImages: false }).filter((a) => a.getSize() < 15 * 1024 * 1024).slice(0, 10).map((a) => ({
      name: a.getName(), type: a.getContentType(), base64: Utilities.base64Encode(a.getBytes()),
    }));
    const res = UrlFetchApp.fetch(ERP_URL, {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: { "x-intake-secret": INTAKE_SECRET },
      payload: JSON.stringify({
        source: /website|form|wordpress|wix/i.test(from) ? "website" : "email",
        from_name: from.replace(/<.*>/, "").trim(), from_email: (from.match(/<(.+)>/) || [, from])[1],
        subject: m.getSubject(), body: m.getPlainBody().slice(0, 100000), message_id: m.getId(), attachments: atts,
      }),
    });
    if (res.getResponseCode() < 300) th.addLabel(done);
    else console.log("ERP refused: " + res.getContentText());
  });
}
