export const normalizeLeadSource = (value = "") => {
  try {
    const v = String(value || "").trim().toLowerCase();

    const map = {
      whatsapp: "WhatsApp",
      wa: "WhatsApp",
      "w/a": "WhatsApp",
      "call/wa": "WhatsApp",
      "call / wa": "WhatsApp",
      "wa/call": "WhatsApp",

      call: "Call",
      calling: "Call",
      phone: "Call",

      website: "Website",
      web: "Website",

      instagram: "Instagram",
      insta: "Instagram",

      referral: "Referral",
      reference: "Referral",

      "google ads": "Google Ads",
      googleads: "Google Ads",
      google: "Google Ads",

      justdial: "JustDial",
      "just dial": "JustDial",
    };

    return map[v] || "WhatsApp";
  } catch (error) {
    console.error("normalizeLeadSource error:", error);
    return "WhatsApp";
  }
};

export const normalizeLeadStage = (value = "") => {
  try {
    const v = String(value || "").trim().toLowerCase();

    const map = {
      "lead capture": "Lead Capture",
      "lead_capture": "Lead Capture",
      new: "Lead Capture",

      contacted: "Reachable",
      reachable: "Reachable",
      followup: "Reachable",
      "follow up": "Reachable",

      qualified: "Qualified",
      proposal: "Proposal",
      quotation: "Proposal",
      quote: "Proposal",

      negotiation: "Negotiation",
      payment: "Negotiation",

      closed: "Closed",
      lost: "Closed",

      won: "Closed Won",
      "closed won": "Closed Won",
    };

    return map[v] || "Lead Capture";
  } catch (error) {
    console.error("normalizeLeadStage error:", error);
    return "Lead Capture";
  }
};

export const normalizeFollowupChannel = (value = "") => {
  try {
    const v = String(value || "").trim().toLowerCase();

    const map = {
      call: "Call",
      phone: "Call",
      whatsapp: "WhatsApp",
      wa: "WhatsApp",
      "call/wa": "WhatsApp",
      "call / wa": "WhatsApp",
      email: "Email",
      meeting: "Meeting",
    };

    return map[v] || "Call";
  } catch (error) {
    console.error("normalizeFollowupChannel error:", error);
    return "Call";
  }
};

export const normalizeFollowupStatus = (value = "") => {
  try {
    const v = String(value || "").trim().toLowerCase();

    const map = {
      pending: "Pending",
      due: "Due",
      overdue: "Overdue",
      done: "Done",
      completed: "Done",
      complete: "Done",
    };

    return map[v] || "Pending";
  } catch (error) {
    console.error("normalizeFollowupStatus error:", error);
    return "Pending";
  }
};