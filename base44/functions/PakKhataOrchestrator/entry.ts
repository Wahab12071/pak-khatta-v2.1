import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { text, context_party_id, conversation_history, speak = true } = body;
    if (!text || !text.trim()) return Response.json({ error: 'text is required' }, { status: 400 });

    const today = new Date().toISOString().slice(0, 10);

    // Fetch business context in parallel
    const [profileList, parties, recentEntries, items, marketObs, rules, pendingTasks, memories, commitments, problems, decisions, signals, observations, businessTermsList] = await Promise.all([
      base44.entities.BusinessProfile.list("-created_date", 5),
      base44.entities.Party.list("-created_date", 500),
      base44.entities.Entry.list("-created_date", 500),
      base44.entities.Item.list("-created_date", 100),
      base44.entities.MarketObservation.list("-created_date", 50),
      base44.entities.BusinessRule.filter({ active: true }),
      base44.entities.Task.filter({ status: "pending" }),
      base44.entities.BusinessMemory.list("-created_date", 200),
      base44.entities.Commitment.filter({ status: "pending" }),
      base44.entities.Problem.filter({ status: "open" }),
      base44.entities.Decision.filter({ status: "active" }),
      base44.entities.Signal.filter({ status: "active" }),
      base44.entities.Observation.list("-created_date", 20),
      base44.entities.BusinessTerm.list("-created_date", 50),
    ]);

    const profile = profileList[0];
    const onboarded = profile?.onboarded === true;

    // Build context for LLM
    const partyNames = parties.map(p => p.name).join(", ");
    const itemSummary = items.map(i => `${i.name}: ${i.current_stock || 0} ${i.unit || 'kg'}`).join("; ");
    const recentRates = marketObs.slice(0, 10).map(m => `${m.commodity} ${m.rate} ${m.currency}/${m.unit} (${m.observation_date})`).join("; ");
    const activeRules = rules.map(r => `- ${r.rule_text}`).join("\n");
    const openCommitments = commitments.map(c => `- ${c.description} (due: ${c.due_date || "N/A"}, by: ${c.committed_by_name || "N/A"})`).join("\n");
    const openProblems = problems.map(p => `- [${p.severity}] ${p.title}`).join("\n");
    const activeDecisions = decisions.map(d => `- ${d.decision}`).join("\n");
    const activeSignals = signals.map(s => `- [${s.severity}] ${s.title}`).join("\n");
    const ownerTerms = businessTermsList.map(t => `"${t.phrase}" = ${t.normalized_meaning}`).join("\n");
    const contextParty = context_party_id ? parties.find(p => p.id === context_party_id) : null;
    const history = conversation_history ? conversation_history.slice(-4).map(h => `${h.role}: ${h.text}`).join("\n") : "";
    const memorySummary = memories.slice(0, 30).map(m => `[${m.memory_date}] ${m.category}: ${m.summary}`).join("\n");

    // === STEP 1: UNDERSTAND ===
    const understandingPrompt = `You are PakKhata AI, a business brain for Pakistani SMB owners. The owner speaks in Urdu, Roman Urdu, Punjabi, Pashto, Sindhi, Saraiki, Balochi, English, or mixed language.

${profile ? `BUSINESS PROFILE:
- Business: ${profile.business_name}
- Type: ${profile.business_type}
- Location: ${profile.location || "N/A"}
- Description: ${profile.description || "N/A"}
- Language: ${profile.language}` : "No business profile yet — owner has not onboarded."}

BUSINESS CONTEXT:
- Parties (customers/suppliers): ${partyNames || "none yet"}
- Items in stock: ${itemSummary || "none yet"}
- Recent market rates: ${recentRates || "none"}
- Active business rules:
${activeRules || "none"}
${openCommitments ? `OPEN COMMITMENTS (promises to track):
${openCommitments}` : ""}
${openProblems ? `OPEN PROBLEMS:
${openProblems}` : ""}
${activeDecisions ? `OWNER DECISIONS (must respect):
${activeDecisions}` : ""}
${activeSignals ? `ACTIVE SIGNALS:
${activeSignals}` : ""}
${ownerTerms ? `OWNER VOCABULARY (business-specific terms this owner uses — learn these):
${ownerTerms}` : ""}
${contextParty ? `- Current party context: ${contextParty.name}` : ""}
${memorySummary ? `RECENT MEMORIES (what owner told you before):
${memorySummary}` : ""}
${history ? `CONVERSATION HISTORY:\n${history}` : ""}

Owner said: "${text}"

Determine the intent and extract entities.

INTENT TYPES:
- ONBOARDING: owner describing their business for the first time, or telling you about their business setup, products, customers, suppliers, location
- CREATE_ENTRY: recording a transaction (diya=gave credit/customer owes, liya=received payment/cash)
- QUERY_PARTY_BALANCE: asking about a specific party's balance/hisaab
- QUERY_RECEIVABLES: asking total money owed BY customers (kitna paisa phansa hai, kitna lena hai)
- QUERY_PAYABLES: asking total money owed TO suppliers (kitna dena hai)
- QUERY_HISTORY: asking what happened recently (pichle hafte kya hua, aaj kya hua, pichle mahine, pichla maal)
- QUERY_MEMORY: asking about a specific past detail the owner mentioned before (pichla maal mein kya dala, kal kya bataya tha, aik hafte pehle kya record diya)
- CREATE_MARKET_OBSERVATION: recording a market rate (aaj rate 10800 hai, mandi ka rate note kar lo)
- CREATE_RULE: creating a business rule (yaad rakhna, agar...to batana, credit nahi dena, credit limit)
- CREATE_TASK: creating a task/commitment (kal karna hai, call karna hai, khareedna hai, bhejna hai)
- CALCULATE_MANDI: mandi lot calculation (weight, bardana, commission, katoti, nami)
- QUERY_STOCK: asking about stock/inventory (godam mein kitna hai, maal kitna hai)
- BUSINESS_BRIEF: asking what's important / business overview (aaj kya important hai, kya chal raha hai, business ka scene)
- QUERY_TOP_PARTY: asking who owes the most / who paid the most
- QUERY_WHAT_REMEMBER: asking what PakKhata remembers/knows about the business (tumhe kya yaad hai, tumhe mere business ke bare mein kya pata, what do you know about my business, tum kya jante ho)
- QUERY_MISSED: asking what the owner missed or what needs attention (maine kya miss kiya, kya pending hai, kya reh gaya, what did I miss, kya bacha hai, kya important hai)
- QUERY_EOD: asking for end-of-day summary or what happened today (aaj kya hua, aaj ki summary, aaj ka hisaab, end of day, aaj ka wrap)
- CREATE_COMMITMENT: recording a promise someone made (payment promise, delivery promise, "Nadeem ne Monday ko payment ka bola", "supplier ne kal maal bhejne ka kaha")
- CREATE_DECISION: owner making a business decision ("Javed ko credit nahi dena", "aslam ko 2 lakh tak credit de sakte hain", "cash reserve 300k rakho")
- REPORT_PROBLEM: reporting an issue or problem ("maal mein damage aya", "cash mismatch hai", "customer complain kar raha hai")
- CREATE_REMINDER: asking to send/generate a reminder
- ADVICE: asking for business advice or recommendation (mashwara, kya karoon, kaisa lage, mosam ke hisaab se)
- CLARIFY: when critical info is missing (like party name or amount for a transaction)
- UNKNOWN: cannot determine intent

NUMBER UNDERSTANDING (critical):
- "paanch hazar" / "5 hazar" / "panch hazar" = 5000
- "1 lakh" / "aik lakh" = 100000
- "2 lakh 50" = 250000
- "deedh lakh" / "derh lakh" = 150000
- "sarhe teen lakh" = 350000
- "pone do lakh" = 175000
- "1 crore" = 10000000
- "50 hazar" = 50000
- "paanch sau" = 500

ENTRY TYPE:
- "diya"/"deyna"/"gave"/"udhaar"/"credit"/"ma diya" = "diya" (customer owes you)
- "liya"/"lena"/"received"/"payment"/"cash"/"chukta"/"jama"/"payment liya" = "liya" (customer paid you)

CRITICAL RULES:
- Only set needs_clarification=true if CRITICAL info is missing for a financial transaction (no party name, or no amount). Do NOT clarify for notes, observations, rules, tasks, or onboarding.
- For ONBOARDING: extract business_name, owner_name (the person's name), business_type, location, and a description of what the owner told you.
- For CREATE_RULE, put the full rule in rule_text and set condition_type (credit_limit, price_alert, stock_alert, hold_credit, payment_reminder, custom) and condition_value if numeric.
- For CREATE_TASK, put the task description in task_description, set task_type (call_customer, collect_payment, pay_supplier, buy_stock, check_stock, deliver_order, follow_up, reconcile_stock, check_rate, verify_payment, other), and due_date if mentioned.
- For time references: "aaj"=today (${today}), "kal"=infer from context (tomorrow if future tense, yesterday if past), "pichle hafte"=last week, "is mahine"=this month. Use ISO date.
- For CALCULATE_MANDI, extract gross_weight, bardana_count, bardana_weight, rate, commission_rate, katoti, moisture_percent.
- For CREATE_COMMITMENT, extract who made the promise (committed_by_name), what was promised (description/task_description), when (due_date), commitment_type (payment_promise, delivery_promise, call_promise, follow_up_promise, supply_promise, collection_promise, other), and amount if applicable.
- For CREATE_DECISION, extract the decision text, reason, scope (general, party_specific, product_specific, financial, operational), and related party/product if any.
- For REPORT_PROBLEM, extract the problem title, description, problem_type (missing_payment, damaged_stock, cash_mismatch, supplier_dispute, customer_complaint, employee_issue, stock_mismatch, rate_discrepancy, missing_information, other), and severity (critical, high, medium, low).
- For QUERY_MEMORY, extract what the owner is trying to recall (search_terms) and time_reference.

Return JSON:`;

    const understanding = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: understandingPrompt,
      response_json_schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          intent: { type: "string", enum: [
            "ONBOARDING", "CREATE_ENTRY", "QUERY_PARTY_BALANCE", "QUERY_RECEIVABLES", "QUERY_PAYABLES",
            "QUERY_HISTORY", "QUERY_MEMORY", "CREATE_MARKET_OBSERVATION", "CREATE_RULE", "CREATE_TASK",
            "CALCULATE_MANDI", "QUERY_STOCK", "BUSINESS_BRIEF", "QUERY_TOP_PARTY",
            "QUERY_WHAT_REMEMBER", "QUERY_MISSED", "QUERY_EOD",
            "CREATE_REMINDER", "CREATE_COMMITMENT", "CREATE_DECISION", "REPORT_PROBLEM",
            "ADVICE", "CLARIFY", "UNKNOWN"
          ]},
          entities: {
            type: "object",
            additionalProperties: true,
            properties: {
              business_name: { type: "string" },
              owner_name: { type: "string" },
              business_type: { type: "string" },
              location: { type: "string" },
              description: { type: "string" },
              party_name: { type: "string" },
              entry_type: { type: "string", enum: ["diya", "liya"] },
              amount: { type: "number" },
              currency: { type: "string", enum: ["PKR", "AFN", "IRR", "USD"] },
              item: { type: "string" },
              quantity: { type: "number" },
              unit: { type: "string" },
              rate: { type: "number" },
              date: { type: "string" },
              commodity: { type: "string" },
              market: { type: "string" },
              rule_text: { type: "string" },
              condition_type: { type: "string" },
              condition_value: { type: "number" },
              task_description: { type: "string" },
              task_type: { type: "string" },
              due_date: { type: "string" },
              time_reference: { type: "string" },
              search_terms: { type: "string" },
              gross_weight: { type: "number" },
              bardana_weight: { type: "number" },
              bardana_count: { type: "number" },
              commission_rate: { type: "number" },
              katoti: { type: "number" },
              moisture_percent: { type: "number" },
              commitment_type: { type: "string" },
              committed_by_name: { type: "string" },
              commitment_to_name: { type: "string" },
              decision_scope: { type: "string" },
              problem_severity: { type: "string" },
              problem_type: { type: "string" }
            }
          },
          needs_clarification: { type: "boolean" },
          clarification_question: { type: "string" }
        },
        required: ["intent", "needs_clarification"]
      }
    });

    const intent = understanding.intent;
    const entities = understanding.entities || {};

    // Handle clarification
    if (intent === "CLARIFY" || understanding.needs_clarification) {
      const clarText = understanding.clarification_question || "Aap thoda detail mein batayein?";
      // Store clarification as memory
      await base44.entities.BusinessMemory.create({
        raw_text: text,
        summary: `Clarification asked: ${clarText}`,
        category: "other",
        memory_date: today,
        intent: "CLARIFY",
      });
      // Generate speech
      let audioUrl = null;
      if (speak) {
        try {
          const speech = await base44.asServiceRole.integrations.Core.GenerateSpeech({ text: clarText, language_code: "ur" });
          audioUrl = speech.url;
        } catch (e) {}
      }
      return Response.json({
        intent: "CLARIFY",
        response_text: clarText,
        audio_url: audioUrl,
        needs_clarification: true,
        clarification_question: clarText,
      });
    }

    // === STEP 2: EXECUTE ACTION ===
    let actionResult = {};
    let queryData = "";
    let memoryCategory = "other";
    let memorySummaryText = "";

    // Helper: resolve party by name
    function resolveParty(name) {
      if (!name) return null;
      const lower = name.toLowerCase().trim();
      const exact = parties.filter(p => p.name.toLowerCase() === lower);
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) return null;
      const partial = parties.filter(p => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
      if (partial.length === 1) return partial[0];
      return null;
    }

    function resolvePartyDisambig(name) {
      if (!name) return { party: null, ambiguous: false, alternatives: [] };
      const lower = name.toLowerCase().trim();
      const exact = parties.filter(p => p.name.toLowerCase() === lower);
      if (exact.length === 1) return { party: exact[0], ambiguous: false, alternatives: [] };
      if (exact.length > 1) return { party: null, ambiguous: true, alternatives: exact.map(p => p.name) };
      const partial = parties.filter(p => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
      if (partial.length === 1) return { party: partial[0], ambiguous: false, alternatives: [] };
      if (partial.length > 1) return { party: null, ambiguous: true, alternatives: partial.map(p => p.name) };
      return { party: null, ambiguous: false, alternatives: [] };
    }

    // Helper: calculate party balance from entries
    function partyBalance(pid) {
      let bal = 0;
      for (const e of recentEntries) {
        if (e.party_id === pid) {
          if (e.entry_type === "diya") bal += e.amount;
          else bal -= e.amount;
        }
      }
      return bal;
    }

    function partyState(pid) {
      const party = parties.find(p => p.id === pid);
      if (!party) return null;
      const balance = partyBalance(pid);
      const partyEntries = recentEntries.filter(e => e.party_id === pid);
      const recent7d = partyEntries.filter(e => {
        const d = new Date(e.entry_date || e.created_date);
        const daysAgo = (new Date(today) - d) / (86400000);
        return daysAgo <= 7 && daysAgo >= 0;
      });
      const recentDiya = recent7d.filter(e => e.entry_type === "diya").reduce((s, e) => s + e.amount, 0);
      const recentLiya = recent7d.filter(e => e.entry_type === "liya").reduce((s, e) => s + e.amount, 0);
      const partyCommitments = commitments.filter(c => c.committed_by_party_id === pid || (c.committed_by_name && c.committed_by_name.toLowerCase() === party.name.toLowerCase()));
      const partyDecisions = decisions.filter(d => d.subject_name && d.subject_name.toLowerCase() === party.name.toLowerCase());
      const partyProblems = problems.filter(p => p.related_party_id === pid);
      const creditLimit = party.credit_limit;
      const overLimit = creditLimit && balance > creditLimit;
      const payments = partyEntries.filter(e => e.entry_type === "liya");
      const credits = partyEntries.filter(e => e.entry_type === "diya");
      const paymentBehavior = party.payment_behavior || "unknown";
      return { balance, recentDiya, recentLiya, entryCount: partyEntries.length, commitments: partyCommitments, decisions: partyDecisions, problems: partyProblems, creditLimit, overLimit, paymentBehavior, creditExposure: balance, paymentCount: payments.length, creditCount: credits.length };
    }

    switch (intent) {
      case "ONBOARDING": {
        // Clean business_type to match enum
        const rawType = (entities.business_type || "").toLowerCase();
        const typeMap = { karyana: "karyana", grocery: "karyana", garments: "garments", cloth: "garments", mobile: "mobile_repair", arhti: "mandi_arhti", mandi: "mandi_arhti", wholesale: "wholesale", restaurant: "restaurant", general: "general_store", store: "general_store", fruit: "fruit_vegetable", vegetable: "fruit_vegetable" };
        const bizType = typeMap[Object.keys(typeMap).find(k => rawType.includes(k))] || "general_store";

        const profileData = {
          business_name: entities.business_name || "Mera Business",
          owner_name: entities.owner_name || "",
          business_type: bizType,
          location: entities.location || "",
          description: entities.description || text,
          language: "urdu",
          currency: "PKR",
          onboarded: true,
        };
        let profileRec;
        if (profile) {
          profileRec = await base44.entities.BusinessProfile.update(profile.id, profileData);
        } else {
          profileRec = await base44.entities.BusinessProfile.create(profileData);
        }

        // Extract parties and items from the description
        const extractPrompt = `Extract customer/supplier names and product/item names from this business description by a Pakistani owner.

Owner said: "${text}"

Return JSON with:
- parties: array of customer or supplier names mentioned (first names or business names)
- items: array of product/commodity names mentioned with category and default unit

Return JSON:`;

        const extracted = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: extractPrompt,
          response_json_schema: {
            type: "object",
            additionalProperties: true,
            properties: {
              parties: { type: "array", items: { type: "string" } },
              items: { type: "array", items: { type: "object", additionalProperties: true, properties: { name: { type: "string" }, category: { type: "string" }, unit: { type: "string" } } } },
            },
          },
        });

        // Create parties
        const createdParties = [];
        for (const name of (extracted.parties || [])) {
          if (name && name.trim() && !parties.find(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
            const p = await base44.entities.Party.create({ name: name.trim(), currency: "PKR", party_type: "customer" });
            createdParties.push(p);
          }
        }

        // Create items
        const createdItems = [];
        for (const item of (extracted.items || [])) {
          if (item.name && item.name.trim() && !items.find(i => i.name.toLowerCase() === item.name.trim().toLowerCase())) {
            const i = await base44.entities.Item.create({
              name: item.name.trim(),
              category: item.category || "",
              unit: item.unit || "kg",
              currency: "PKR",
            });
            createdItems.push(i);
          }
        }

        actionResult = { type: "onboarded", profile: profileRec, parties: createdParties, items: createdItems };
        queryData = `Onboarding completed. Business: ${profileData.business_name}, Owner: ${profileData.owner_name || "N/A"}, Type: ${profileData.business_type}, Location: ${profileData.location}. Created ${createdParties.length} parties (${createdParties.map(p => p.name).join(", ")}) and ${createdItems.length} items (${createdItems.map(i => i.name).join(", ")}).`;
        memoryCategory = "onboarding";
        memorySummaryText = `Business onboarded: ${profileData.business_name} (${profileData.business_type}) in ${profileData.location}. Parties: ${createdParties.map(p => p.name).join(", ")}. Items: ${createdItems.map(i => i.name).join(", ")}`;
        break;
      }

      case "CREATE_ENTRY": {
        const entryDisambig = resolvePartyDisambig(entities.party_name);
        let party = entryDisambig.party;
        if (entryDisambig.ambiguous && !contextParty) {
          actionResult = { type: "disambiguation_needed", alternatives: entryDisambig.alternatives };
          queryData = `Entity disambiguation needed: Multiple parties match "${entities.party_name}": ${entryDisambig.alternatives.join(" ya ")}. Ask the owner which one they mean. Do NOT guess or create the entry yet.`;
          memoryCategory = "query";
          memorySummaryText = `Disambiguation needed for: ${entities.party_name}`;
          break;
        }
        if (!party && entities.party_name && !entryDisambig.ambiguous) {
          party = await base44.entities.Party.create({
            name: entities.party_name,
            currency: entities.currency || "PKR",
            party_type: "customer",
          });
        }
        if (party && entities.amount != null && entities.amount > 0) {
          // Contradiction/duplicate check: if owner claims a past payment, verify it doesn't already exist
          const entryDate = entities.date || today;
          const existingEntry = recentEntries.find(e =>
            e.party_id === party.id &&
            e.entry_type === (entities.entry_type || "diya") &&
            e.amount === entities.amount &&
            e.entry_date === entryDate
          );
          if (existingEntry) {
            actionResult = { type: "duplicate_detected", existingEntry, party };
            queryData = `Duplicate detected: An entry already exists for ${party.name}, ${entities.entry_type || "diya"} Rs ${entities.amount} on ${entryDate}. Tell the owner this is already recorded on ${entryDate}. Do NOT create a duplicate.`;
            memoryCategory = "other";
            memorySummaryText = `Duplicate entry prevented: ${party.name} ${entities.entry_type} Rs ${entities.amount} on ${entryDate}`;
            break;
          }

          const entry = await base44.entities.Entry.create({
            party_id: party.id,
            party_name: party.name,
            entry_type: entities.entry_type || "diya",
            amount: entities.amount,
            currency: entities.currency || party.currency || "PKR",
            item_description: entities.item || "",
            entry_date: entities.date || today,
            entry_method: "voice",
            notes: text,
          });
          const newBal = partyBalance(party.id) + (entities.entry_type === "diya" ? entities.amount : -entities.amount);

          await base44.entities.BusinessEvent.create({
            event_type: entities.entry_type === "diya" ? "sale_created" : "payment_received",
            event_time: entities.date || today,
            actor_party_id: party.id,
            actor_name: party.name,
            subject_type: "party",
            subject_id: party.id,
            subject_name: party.name,
            description: `${entities.entry_type === "diya" ? "Credit given" : "Payment received"}: ${party.name} Rs ${entities.amount} ${entities.currency || "PKR"} ${entities.item ? "for " + entities.item : ""}`,
            amount: entities.amount,
            currency: entities.currency || "PKR",
            source: "voice",
            source_text: text,
          });

          if (entities.entry_type === "diya" && party.credit_limit && newBal > party.credit_limit) {
            await base44.entities.Signal.create({
              signal_type: "credit_limit_pressure",
              severity: "important",
              title: `${party.name} ka credit limit paar ho gaya`,
              description: `${party.name} ka balance Rs ${newBal} hai, jo aapki set ki hui limit Rs ${party.credit_limit} se zyada hai.`,
              subject_type: "party",
              subject_id: party.id,
              subject_name: party.name,
              evidence: `Balance Rs ${newBal} exceeds limit Rs ${party.credit_limit}`,
              financial_impact: newBal - party.credit_limit,
              currency: entities.currency || "PKR",
              detected_date: today,
              status: "active",
            });
          }

          // Pattern detection: update party payment behavior based on history
          const allPartyEntries = recentEntries.filter(e => e.party_id === party.id);
          const payments = allPartyEntries.filter(e => e.entry_type === "liya");
          const credits = allPartyEntries.filter(e => e.entry_type === "diya");
          if (payments.length >= 3 && (!party.payment_behavior || party.payment_behavior === "unknown")) {
            const avgPayment = payments.reduce((s, e) => s + e.amount, 0) / payments.length;
            const avgCredit = credits.length > 0 ? credits.reduce((s, e) => s + e.amount, 0) / credits.length : avgPayment;
            const behavior = avgPayment < avgCredit * 0.5 ? "partial" : avgPayment < avgCredit * 0.9 ? "delayed" : "prompt";
            await base44.entities.Party.update(party.id, { payment_behavior: behavior });
          }

          if (entities.entry_type === "liya") {
            const partyCommitments = commitments.filter(c => c.committed_by_party_id === party.id || (c.committed_by_name && c.committed_by_name.toLowerCase() === party.name.toLowerCase()));
            for (const c of partyCommitments) {
              await base44.entities.Commitment.update(c.id, {
                status: "fulfilled",
                resolved_date: today,
                resolution_notes: `Payment of Rs ${entities.amount} received`,
              });
              await base44.entities.BusinessEvent.create({
                event_type: "promise_fulfilled",
                event_time: today,
                subject_type: "commitment",
                subject_id: c.id,
                description: `Commitment fulfilled: ${c.description}`,
                source: "system",
              });
            }
          }

          actionResult = { type: "entry_created", entry, party, new_balance: newBal };
          queryData = `Action completed: Created ${entities.entry_type} entry for ${party.name}, amount Rs ${entities.amount} ${entities.currency || "PKR"}, item: ${entities.item || "N/A"}, date: ${entities.date || today}. New balance: Rs ${newBal} ${entities.currency || "PKR"}.`;
          memoryCategory = "transaction";
          memorySummaryText = `${party.name} ko ${entities.entry_type === "diya" ? "udhaar diya" : "payment liya"}: Rs ${entities.amount} ${entities.currency || "PKR"} ${entities.item ? "for " + entities.item : ""} on ${entities.date || today}`;
        } else {
          actionResult = { type: "error", message: "Missing party or amount" };
          queryData = "Could not create entry - missing party name or amount.";
        }
        break;
      }

      case "QUERY_PARTY_BALANCE": {
        const disambig = resolvePartyDisambig(entities.party_name);
        let party = disambig.party || contextParty;
        if (disambig.ambiguous && !contextParty) {
          actionResult = { type: "disambiguation_needed", alternatives: disambig.alternatives };
          queryData = `Entity disambiguation needed: Multiple parties match "${entities.party_name}": ${disambig.alternatives.join(" ya ")}. Ask the owner which one they mean. Do NOT guess.`;
          memoryCategory = "query";
          memorySummaryText = `Disambiguation needed for: ${entities.party_name}`;
          break;
        }
        if (party) {
          const state = partyState(party.id);
          const lastPayment = recentEntries.filter(e => e.party_id === party.id && e.entry_type === "liya").sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date))[0];
          actionResult = { type: "party_balance", party, ...state, last_payment: lastPayment };
          queryData = `Query result for ${party.name}:
- Balance: Rs ${state.balance} ${party.currency || "PKR"}
- This week: Bought Rs ${state.recentDiya}, Paid Rs ${state.recentLiya}
- Total entries: ${state.entryCount}
- Last payment: ${lastPayment ? `Rs ${lastPayment.amount} on ${lastPayment.entry_date}` : "none"}
- Credit limit: ${state.creditLimit ? `Rs ${state.creditLimit}` : "not set"} ${state.overLimit ? "(OVER LIMIT)" : ""}
- Payment behavior: ${state.paymentBehavior}
- Open commitments: ${state.commitments.length}. ${state.commitments.slice(0, 2).map(c => c.description).join("; ")}
- Active decisions: ${state.decisions.length}. ${state.decisions.slice(0, 2).map(d => d.decision).join("; ")}
- Open problems: ${state.problems.length}. ${state.problems.slice(0, 2).map(p => p.title).join("; ")}
Recent entries: ${recentEntries.filter(e => e.party_id === party.id).slice(0, 5).map(e => `${e.entry_date}: ${e.entry_type} Rs ${e.amount} (${e.item_description || "N/A"})`).join("; ")}`;
          memoryCategory = "query";
          memorySummaryText = `Queried ${party.name} balance: Rs ${state.balance}`;
        } else {
          actionResult = { type: "error", message: "Party not found" };
          queryData = `Could not find party "${entities.party_name}". Available parties: ${partyNames || "none"}.`;
        }
        break;
      }

      case "QUERY_RECEIVABLES": {
        const receivables = [];
        for (const p of parties) {
          const bal = partyBalance(p.id);
          if (bal > 0) receivables.push({ name: p.name, balance: bal, currency: p.currency || "PKR" });
        }
        receivables.sort((a, b) => b.balance - a.balance);
        const total = receivables.reduce((s, r) => s + r.balance, 0);
        actionResult = { type: "receivables", total, parties: receivables };
        queryData = `Query result: Total receivables (customers owe you) = Rs ${total} PKR across ${receivables.length} parties. ${receivables.length > 0 ? `Top: ${receivables.slice(0, 5).map(r => `${r.name}: Rs ${r.balance}`).join(", ")}` : "No receivables."}`;
        memoryCategory = "query";
        memorySummaryText = `Queried total receivables: Rs ${total} from ${receivables.length} parties`;
        break;
      }

      case "QUERY_PAYABLES": {
        const payables = [];
        for (const p of parties) {
          const bal = partyBalance(p.id);
          if (bal < 0) payables.push({ name: p.name, balance: Math.abs(bal), currency: p.currency || "PKR" });
        }
        const total = payables.reduce((s, r) => s + r.balance, 0);
        actionResult = { type: "payables", total, parties: payables };
        queryData = `Query result: Total payables (you owe suppliers) = Rs ${total} PKR across ${payables.length} parties. ${payables.map(p => `${p.name}: Rs ${p.balance}`).join(", ")}.`;
        memoryCategory = "query";
        memorySummaryText = `Queried total payables: Rs ${total} to ${payables.length} parties`;
        break;
      }

      case "QUERY_HISTORY": {
        const now = new Date();
        let startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const timeRef = (entities.time_reference || "").toLowerCase();
        const textLower = text.toLowerCase();
        if (timeRef.includes("today") || textLower.includes("aaj")) {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (timeRef.includes("yesterday") || textLower.includes("kal hua") || textLower.includes("kal kiya")) {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        } else if (timeRef.includes("last_week") || textLower.includes("pichle hafte") || textLower.includes("pichle week")) {
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (timeRef.includes("this_month") || textLower.includes("is mahine")) {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (timeRef.includes("last_month") || textLower.includes("pichle mahine")) {
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        }
        const filtered = recentEntries.filter(e => new Date(e.entry_date) >= startDate);
        const totalDiya = filtered.filter(e => e.entry_type === "diya").reduce((s, e) => s + e.amount, 0);
        const totalLiya = filtered.filter(e => e.entry_type === "liya").reduce((s, e) => s + e.amount, 0);
        actionResult = { type: "history", entries: filtered, total_diya: totalDiya, total_liya: totalLiya, count: filtered.length };
        queryData = `Query result: Found ${filtered.length} entries. Total diya (credit given): Rs ${totalDiya}. Total liya (payments received): Rs ${totalLiya}. Entries: ${filtered.slice(0, 10).map(e => `${e.entry_date}: ${e.party_name} ${e.entry_type} Rs ${e.amount} (${e.item_description || "N/A"})`).join("; ")}.`;
        memoryCategory = "query";
        memorySummaryText = `Queried history: ${filtered.length} entries, diya Rs ${totalDiya}, liya Rs ${totalLiya}`;
        break;
      }

      case "QUERY_MEMORY": {
        // Search through memories and entries for the requested detail
        const searchTerms = (entities.search_terms || text).toLowerCase();
        const timeRef = (entities.time_reference || "").toLowerCase();
        let searchDate = null;
        const now = new Date();
        if (timeRef.includes("yesterday") || timeRef.includes("kal")) {
          searchDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        } else if (timeRef.includes("last_week") || timeRef.includes("pichle hafte") || timeRef.includes("aik hafte")) {
          searchDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        } else if (timeRef.includes("last_month") || timeRef.includes("pichle mahine")) {
          searchDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        }

        // Search memories
        const matchingMemories = memories.filter(m => {
          const rawMatch = m.raw_text && m.raw_text.toLowerCase().includes(searchTerms);
          const summaryMatch = m.summary && m.summary.toLowerCase().includes(searchTerms);
          let dateMatch = true;
          if (searchDate) {
            dateMatch = m.memory_date && m.memory_date <= today && m.memory_date >= searchDate;
          }
          return (rawMatch || summaryMatch) && dateMatch;
        });

        // Also search entries
        const matchingEntries = recentEntries.filter(e => {
          const textMatch = (e.item_description || "").toLowerCase().includes(searchTerms) ||
                           (e.party_name || "").toLowerCase().includes(searchTerms) ||
                           (e.notes || "").toLowerCase().includes(searchTerms);
          let dateMatch = true;
          if (searchDate) {
            dateMatch = e.entry_date && e.entry_date <= today && e.entry_date >= searchDate;
          }
          return textMatch && dateMatch;
        });

        // Also search market observations
        const matchingObs = marketObs.filter(m => {
          const textMatch = (m.commodity || "").toLowerCase().includes(searchTerms) ||
                           (m.notes || "").toLowerCase().includes(searchTerms);
          let dateMatch = true;
          if (searchDate) {
            dateMatch = m.observation_date && m.observation_date <= today && m.observation_date >= searchDate;
          }
          return textMatch && dateMatch;
        });

        actionResult = { type: "memory_search", memories: matchingMemories.slice(0, 10), entries: matchingEntries.slice(0, 10), observations: matchingObs.slice(0, 5) };
        queryData = `Memory search for "${searchTerms}" ${searchDate ? `since ${searchDate}` : "all time"}. Found ${matchingMemories.length} memories, ${matchingEntries.length} entries, ${matchingObs.length} market observations. ` +
          (matchingMemories.length > 0 ? `Memories: ${matchingMemories.slice(0, 5).map(m => `[${m.memory_date}] ${m.summary}`).join("; ")}. ` : "") +
          (matchingEntries.length > 0 ? `Entries: ${matchingEntries.slice(0, 5).map(e => `[${e.entry_date}] ${e.party_name} ${e.entry_type} Rs ${e.amount} (${e.item_description || ""})`).join("; ")}. ` : "") +
          (matchingObs.length > 0 ? `Rates: ${matchingObs.slice(0, 3).map(m => `[${m.observation_date}] ${m.commodity} Rs ${m.rate}/${m.unit}`).join("; ")}.` : "") +
          (matchingMemories.length === 0 && matchingEntries.length === 0 && matchingObs.length === 0 ? "No matching records found. Tell the owner honestly that this information was not recorded." : "");
        memoryCategory = "query";
        memorySummaryText = `Searched memory for: ${searchTerms}`;
        break;
      }

      case "CREATE_MARKET_OBSERVATION": {
        const cleanStr = (v) => (v && v !== "null" && v !== "undefined") ? v : "";
        const obs = await base44.entities.MarketObservation.create({
          commodity: cleanStr(entities.commodity) || cleanStr(entities.item) || "",
          market: cleanStr(entities.market),
          rate: entities.rate,
          unit: cleanStr(entities.unit) || "kg",
          currency: entities.currency || "PKR",
          observation_date: entities.date || today,
          source: "owner_observation",
          notes: text,
        });
        await base44.entities.Observation.create({
          observation_type: "market_rate",
          subject_type: "product",
          subject_name: cleanStr(entities.commodity) || cleanStr(entities.item),
          content: `${cleanStr(entities.commodity) || cleanStr(entities.item)} rate: ${entities.rate} ${entities.currency || "PKR"}/${cleanStr(entities.unit) || "kg"}`,
          observed_by: "owner",
          observation_date: entities.date || today,
          confidence: 1,
          source: "owner",
          amount: entities.rate,
          currency: entities.currency || "PKR",
          unit: cleanStr(entities.unit) || "kg",
          status: "active",
        });
        await base44.entities.BusinessEvent.create({
          event_type: "market_observation",
          event_time: entities.date || today,
          subject_type: "market",
          subject_name: cleanStr(entities.commodity) || cleanStr(entities.item),
          description: `Market rate: ${cleanStr(entities.commodity) || cleanStr(entities.item)} at ${entities.rate} ${entities.currency || "PKR"}/${cleanStr(entities.unit) || "kg"}`,
          amount: entities.rate,
          currency: entities.currency || "PKR",
          source: "voice",
          source_text: text,
        });
        actionResult = { type: "market_obs_created", observation: obs };
        queryData = `Action completed: Recorded market observation - ${obs.commodity} at Rs ${obs.rate} ${obs.currency}/${obs.unit} on ${obs.observation_date}.`;
        memoryCategory = "market";
        memorySummaryText = `Market rate: ${obs.commodity} Rs ${obs.rate}/${obs.unit} on ${obs.observation_date}`;
        break;
      }

      case "CREATE_RULE": {
        const rule = await base44.entities.BusinessRule.create({
          subject: entities.party_name || entities.commodity || "general",
          rule_text: entities.rule_text || text,
          condition_type: entities.condition_type || "custom",
          condition_value: entities.condition_value,
          condition_unit: entities.currency || "",
          action: "notify_owner",
          active: true,
        });
        const decision = await base44.entities.Decision.create({
          decision_maker: "owner",
          decision: entities.rule_text || text,
          reason: "",
          scope: entities.party_name ? "party_specific" : "general",
          subject_type: entities.party_name ? "party" : "business",
          subject_name: entities.party_name || entities.commodity || null,
          effective_from: today,
          status: "active",
          source_text: text,
        });
        actionResult = { type: "rule_created", rule, decision };
        queryData = `Action completed: Created business rule - "${rule.rule_text}". Subject: ${rule.subject}. Also recorded as a decision.`;
        memoryCategory = "rule";
        memorySummaryText = `Rule: ${rule.rule_text}`;
        break;
      }

      case "CREATE_TASK": {
        let party = resolveParty(entities.party_name);
        const task = await base44.entities.Task.create({
          party_id: party?.id,
          party_name: party?.name || entities.party_name,
          task_type: entities.task_type || "other",
          description: entities.task_description || text,
          amount: entities.amount,
          currency: entities.currency || "PKR",
          due_date: entities.due_date || entities.date,
          status: "pending",
          priority: "medium",
        });
        actionResult = { type: "task_created", task };
        queryData = `Action completed: Created task - "${task.description}". Due: ${task.due_date || "N/A"}. Party: ${task.party_name || "N/A"}.`;
        memoryCategory = "reminder";
        memorySummaryText = `Task: ${task.description} due ${task.due_date || "N/A"}`;
        break;
      }

      case "QUERY_STOCK": {
        if (entities.item) {
          const item = items.find(i =>
            i.name.toLowerCase().includes(entities.item.toLowerCase()) ||
            entities.item.toLowerCase().includes(i.name.toLowerCase())
          );
          if (item) {
            actionResult = { type: "stock", item };
            queryData = `Query result: ${item.name} stock is ${item.current_stock || 0} ${item.unit || "kg"}. Last purchase rate: ${item.last_purchase_rate || "N/A"}. Average purchase rate: ${item.average_purchase_rate || "N/A"}.`;
            memoryCategory = "query";
            memorySummaryText = `Queried stock: ${item.name} = ${item.current_stock} ${item.unit}`;
          } else {
            actionResult = { type: "error", message: "Item not found" };
            queryData = `Item "${entities.item}" not found. Available items: ${itemSummary || "none"}.`;
          }
        } else {
          actionResult = { type: "stock_all", items };
          queryData = `Query result: Stock summary: ${items.length} items. ${items.map(i => `${i.name}: ${i.current_stock || 0} ${i.unit || ""}`).join(", ")}.`;
          memoryCategory = "query";
          memorySummaryText = `Queried all stock: ${items.length} items`;
        }
        break;
      }

      case "CALCULATE_MANDI": {
        const gross = entities.gross_weight || 0;
        const bardanaCount = entities.bardana_count || 0;
        const bardanaWt = entities.bardana_weight || 0;
        const bardanaTotal = bardanaCount * bardanaWt;
        const net = gross - bardanaTotal;
        const rate = entities.rate || 0;
        const grossValue = net * rate;
        const commissionRate = entities.commission_rate || 0;
        const commission = grossValue * commissionRate / 100;
        const katoti = entities.katoti || 0;
        const moisture = entities.moisture_percent ? grossValue * entities.moisture_percent / 100 : 0;
        const netSettlement = grossValue - commission - katoti - moisture;
        actionResult = { type: "mandi_calc", result: { gross, bardanaCount, bardanaWt, bardanaTotal, net, rate, grossValue, commissionRate, commission, katoti, moisture, netSettlement } };
        queryData = `Mandi calculation result: Gross weight: ${gross} kg. Bardana: ${bardanaCount} × ${bardanaWt} kg = ${bardanaTotal} kg. Net weight: ${net} kg. Rate: Rs ${rate}/kg. Gross value: Rs ${grossValue}. Commission (${commissionRate}%): Rs ${commission}. Katoti: Rs ${katoti}. Moisture: Rs ${moisture}. Net settlement: Rs ${netSettlement}.`;
        memoryCategory = "mandi";
        memorySummaryText = `Mandi calc: ${gross}kg gross, net ${net}kg, settlement Rs ${netSettlement}`;
        break;
      }

      case "QUERY_TOP_PARTY": {
        const balances = parties.map(p => ({ name: p.name, balance: partyBalance(p.id), currency: p.currency || "PKR" }));
        balances.sort((a, b) => b.balance - a.balance);
        actionResult = { type: "top_parties", parties: balances.slice(0, 5) };
        queryData = `Query result: Top balances: ${balances.slice(0, 5).map(b => `${b.name}: Rs ${b.balance} ${b.currency}`).join(", ")}.`;
        memoryCategory = "query";
        memorySummaryText = `Queried top parties by balance`;
        break;
      }

      case "BUSINESS_BRIEF": {
        const receivables = parties.map(p => ({ name: p.name, balance: partyBalance(p.id) })).filter(b => b.balance > 0);
        const totalRecv = receivables.reduce((s, r) => s + r.balance, 0);
        const todayEntries = recentEntries.filter(e => e.entry_date === today);
        const overdueTasks = pendingTasks.filter(t => t.due_date && t.due_date <= today);
        const topRecv = receivables.sort((a, b) => b.balance - a.balance).slice(0, 3);
        const overdueCommitments = commitments.filter(c => c.due_date && c.due_date <= today);
        const criticalProblems = problems.filter(p => p.severity === "critical" || p.severity === "high");
        const importantSignals = signals.filter(s => s.severity === "critical" || s.severity === "important");
        const briefLowStock = items.filter(i => (i.current_stock || 0) < (i.low_stock_threshold || 50));
        actionResult = { type: "brief", total_receivables: totalRecv, receivable_count: receivables.length, today_entries: todayEntries.length, pending_tasks: pendingTasks.length, overdue_tasks: overdueTasks.length, top_receivables: topRecv, active_rules: rules.length, recent_rates: recentRates, overdue_commitments: overdueCommitments, critical_problems: criticalProblems, important_signals: importantSignals, low_stock: briefLowStock };
        queryData = `Business brief for the owner. Generate a concise "Aaj kya dekhni hain" briefing. Here is the real data:
- Total receivables: Rs ${totalRecv} from ${receivables.length} parties. Top: ${topRecv.map(r => `${r.name}: Rs ${r.balance}`).join(", ")}.
- Today: ${todayEntries.length} entries recorded.
- Pending tasks: ${pendingTasks.length} (${overdueTasks.length} overdue).
- Overdue commitments: ${overdueCommitments.length}. ${overdueCommitments.slice(0, 3).map(c => `${c.committed_by_name}: "${c.description}" due ${c.due_date}`).join("; ")}.
- Open problems: ${criticalProblems.length} critical/high. ${criticalProblems.slice(0, 2).map(p => p.title).join("; ")}.
- Active signals: ${importantSignals.length}. ${importantSignals.slice(0, 3).map(s => s.title).join("; ")}.
- Low stock: ${briefLowStock.length} items. ${briefLowStock.slice(0, 2).map(i => `${i.name}: ${i.current_stock} ${i.unit}`).join("; ")}.
- Active decisions: ${decisions.length}. ${decisions.slice(0, 2).map(d => d.decision).join("; ")}.
- Recent market rates: ${recentRates || "none"}.
IMPORTANT: List only the 3-4 most important things. Be concise. Use natural Urdu/Roman Urdu. Start with "Aaj [N] cheezein dekhni hain:" or if nothing urgent, say "Baaki business normal hai."`;
        memoryCategory = "query";
        memorySummaryText = `Generated business brief`;
        break;
      }

      case "CREATE_REMINDER": {
        let party = resolveParty(entities.party_name) || contextParty;
        if (party) {
          const bal = partyBalance(party.id);
          if (bal > 0) {
            const reminder = await base44.entities.Reminder.create({
              party_id: party.id,
              party_name: party.name,
              amount_due: bal,
              currency: party.currency || "PKR",
              language: "urdu",
              message: `${party.name} bhai, aapka Rs ${bal} ${party.currency || "PKR"} baki hai. Jald chukta karein. Shukriya.`,
              status: "pending",
            });
            actionResult = { type: "reminder_created", reminder, party, balance: bal };
            queryData = `Action completed: Created reminder for ${party.name}, amount Rs ${bal} ${party.currency || "PKR"}. Message: "${reminder.message}"`;
            memoryCategory = "reminder";
            memorySummaryText = `Reminder for ${party.name}: Rs ${bal}`;
          } else {
            actionResult = { type: "error", message: "No balance" };
            queryData = `${party.name} ka koi baki nahi hai.`;
          }
        } else {
          actionResult = { type: "error", message: "Party not found" };
          queryData = `Party not found. Available: ${partyNames || "none"}`;
        }
        break;
      }

      case "CREATE_COMMITMENT": {
        let party = resolveParty(entities.committed_by_name || entities.party_name) || contextParty;
        const commitment = await base44.entities.Commitment.create({
          committed_by_party_id: party?.id,
          committed_by_name: party?.name || entities.committed_by_name || entities.party_name,
          commitment_to_name: entities.commitment_to_name,
          description: entities.task_description || entities.description || text,
          commitment_type: entities.commitment_type || "payment_promise",
          amount: entities.amount,
          currency: entities.currency || "PKR",
          due_date: entities.due_date || entities.date,
          status: "pending",
          source_text: text,
          confidence: 1,
        });
        await base44.entities.BusinessEvent.create({
          event_type: "promise_made",
          event_time: today,
          actor_party_id: party?.id,
          actor_name: party?.name || entities.committed_by_name,
          subject_type: "commitment",
          subject_id: commitment.id,
          subject_name: commitment.description,
          description: `Promise recorded: ${commitment.description}`,
          amount: entities.amount,
          currency: entities.currency || "PKR",
          source: "voice",
          source_text: text,
        });
        actionResult = { type: "commitment_created", commitment, party };
        queryData = `Action completed: Recorded commitment - "${commitment.description}". Made by: ${commitment.committed_by_name || "N/A"}. Due: ${commitment.due_date || "N/A"}. Amount: ${entities.amount || "N/A"}.`;
        memoryCategory = "commitment";
        memorySummaryText = `Commitment: ${commitment.committed_by_name || "Someone"} promised "${commitment.description}" by ${commitment.due_date || "N/A"}`;
        break;
      }

      case "CREATE_DECISION": {
        const decision = await base44.entities.Decision.create({
          decision_maker: "owner",
          decision: entities.rule_text || entities.description || text,
          reason: entities.reason || "",
          scope: entities.decision_scope || "general",
          subject_type: entities.party_name ? "party" : (entities.item ? "product" : "business"),
          subject_name: entities.party_name || entities.item || null,
          effective_from: today,
          status: "active",
          source_text: text,
        });
        await base44.entities.BusinessEvent.create({
          event_type: "decision_made",
          event_time: today,
          actor_name: "owner",
          subject_type: "business",
          subject_id: decision.id,
          description: `Decision: ${decision.decision}`,
          source: "voice",
          source_text: text,
        });
        actionResult = { type: "decision_created", decision };
        queryData = `Action completed: Recorded decision - "${decision.decision}". Scope: ${decision.scope}. Subject: ${decision.subject_name || "general"}.`;
        memoryCategory = "decision";
        memorySummaryText = `Decision: ${decision.decision}`;
        break;
      }

      case "REPORT_PROBLEM": {
        const problem = await base44.entities.Problem.create({
          title: entities.task_description || entities.description || text.slice(0, 100),
          description: text,
          severity: entities.problem_severity || "medium",
          problem_type: entities.problem_type || "other",
          related_party_id: resolveParty(entities.party_name)?.id || null,
          related_party_name: entities.party_name || null,
          related_product: entities.item || null,
          status: "open",
          opened_date: today,
          source_text: text,
        });
        await base44.entities.BusinessEvent.create({
          event_type: "problem_detected",
          event_time: today,
          subject_type: "party",
          subject_id: problem.related_party_id,
          subject_name: problem.related_party_name,
          description: `Problem: ${problem.title}`,
          source: "voice",
          source_text: text,
        });
        await base44.entities.Signal.create({
          signal_type: "unresolved_problem",
          severity: problem.severity === "critical" ? "critical" : problem.severity === "high" ? "important" : "useful",
          title: problem.title,
          description: problem.description,
          subject_type: "party",
          subject_id: problem.related_party_id,
          subject_name: problem.related_party_name,
          evidence: `Owner reported: ${text}`,
          detected_date: today,
          status: "active",
        });
        actionResult = { type: "problem_created", problem };
        queryData = `Action completed: Recorded problem - "${problem.title}". Severity: ${problem.severity}. Type: ${problem.problem_type}.`;
        memoryCategory = "problem";
        memorySummaryText = `Problem: ${problem.title} (${problem.severity})`;
        break;
      }

      case "ADVICE": {
        // Give data-driven advice only from real stored data — never guesses
        const receivables = parties.map(p => ({ name: p.name, balance: partyBalance(p.id) })).filter(b => b.balance > 0);
        const totalRecv = receivables.reduce((s, r) => s + r.balance, 0);
        const overdueTasks = pendingTasks.filter(t => t.due_date && t.due_date <= today);
        const lowStockItems = items.filter(i => (i.current_stock || 0) < 50);
        const topRecv = receivables.sort((a, b) => b.balance - a.balance).slice(0, 3);
        const latestRates = marketObs.slice(0, 5);

        actionResult = { type: "advice", total_receivables: totalRecv, overdue_tasks: overdueTasks, low_stock: lowStockItems, top_receivables: topRecv, recent_rates: latestRates };
        queryData = `Advice based on real data only: Total receivables Rs ${totalRecv} from ${receivables.length} parties. ${overdueTasks.length} overdue tasks. ${lowStockItems.length} low-stock items. Top balances: ${topRecv.map(r => `${r.name}: Rs ${r.balance}`).join(", ")}. Recent rates: ${latestRates.map(m => `${m.commodity} Rs ${m.rate}`).join(", ") || "none"}. Open commitments: ${commitments.length}. Open problems: ${problems.length}. Active decisions: ${decisions.map(d => d.decision).join("; ") || "none"}. Active signals: ${signals.map(s => s.title).join("; ") || "none"}. IMPORTANT: Only give advice based on this real data. Do NOT guess or make up information. If data is insufficient, say so honestly. Respect owner decisions. Distinguish FACT from OBSERVATION from CALCULATION from RECOMMENDATION.`;
        memoryCategory = "advice";
        memorySummaryText = `Gave data-driven advice based on receivables Rs ${totalRecv}, ${overdueTasks.length} overdue tasks`;
        break;
      }

      case "QUERY_WHAT_REMEMBER": {
        const customerCount = parties.filter(p => p.party_type === "customer" || p.party_type === "both").length;
        const supplierCount = parties.filter(p => p.party_type === "supplier" || p.party_type === "both").length;
        const topItems = items.slice(0, 5).map(i => i.name).join(", ");
        const topParties = parties.slice(0, 5).map(p => p.name).join(", ");
        actionResult = { type: "what_remember", partyCount: parties.length, customerCount, supplierCount, itemCount: items.length, commitmentCount: commitments.length, problemCount: problems.length, decisionCount: decisions.length, ruleCount: rules.length, memoryCount: memories.length, topItems, topParties };
        queryData = `What PakKhata remembers about this business:
- ${parties.length} parties (${customerCount} customers, ${supplierCount} suppliers). Top: ${topParties}.
- ${items.length} items. Top: ${topItems}.
- ${commitments.length} open commitments.
- ${problems.length} open problems.
- ${decisions.length} active decisions.
- ${rules.length} active rules.
- ${memories.length} total memories.
Generate a natural summary in Urdu/Roman Urdu of what PakKhata knows about this business. Use categories: customers, suppliers, maal, paisa, commitments, decisions, rules. Be conversational. Start with "Mujhe aapke business ke bare mein ye yaad hai:" and list by category.`;
        memoryCategory = "query";
        memorySummaryText = `Owner asked what PakKhata remembers`;
        break;
      }

      case "QUERY_MISSED": {
        const overdueCommitments = commitments.filter(c => c.due_date && c.due_date <= today);
        const overdueTasks = pendingTasks.filter(t => t.due_date && t.due_date <= today);
        const criticalProblems = problems.filter(p => p.severity === "critical" || p.severity === "high");
        const importantSignals = signals.filter(s => s.severity === "critical" || s.severity === "important");
        const missedLowStock = items.filter(i => (i.current_stock || 0) < (i.low_stock_threshold || 50));
        actionResult = { type: "missed", overdueCommitments, overdueTasks, criticalProblems, importantSignals, lowStock: missedLowStock };
        queryData = `What the owner might have missed:
- Overdue commitments: ${overdueCommitments.length}. ${overdueCommitments.slice(0, 3).map(c => `${c.committed_by_name}: "${c.description}" due ${c.due_date}`).join("; ")}.
- Overdue tasks: ${overdueTasks.length}. ${overdueTasks.slice(0, 3).map(t => t.description).join("; ")}.
- Critical problems: ${criticalProblems.length}. ${criticalProblems.slice(0, 2).map(p => p.title).join("; ")}.
- Important signals: ${importantSignals.length}. ${importantSignals.slice(0, 3).map(s => s.title).join("; ")}.
- Low stock: ${missedLowStock.length}. ${missedLowStock.slice(0, 3).map(i => `${i.name}: ${i.current_stock} ${i.unit}`).join(", ")}.
IMPORTANT: Only mention items that actually exist. If nothing is missed, say "Sab kuch theek hai, kuch miss nahi hua." Be concise and actionable.`;
        memoryCategory = "query";
        memorySummaryText = `Owner asked what they missed`;
        break;
      }

      case "QUERY_EOD": {
        const todayEntries = recentEntries.filter(e => e.entry_date === today);
        const todayDiya = todayEntries.filter(e => e.entry_type === "diya").reduce((s, e) => s + e.amount, 0);
        const todayLiya = todayEntries.filter(e => e.entry_type === "liya").reduce((s, e) => s + e.amount, 0);
        const todayMemories = memories.filter(m => m.memory_date === today);
        const futureCommitments = commitments.filter(c => c.due_date && c.due_date > today);
        actionResult = { type: "eod", todayEntries: todayEntries.length, todayDiya, todayLiya, todayMemories: todayMemories.length, futureCommitments: futureCommitments.length };
        queryData = `End-of-day summary for ${today}:
- Entries today: ${todayEntries.length}. Credit given: Rs ${todayDiya}. Payments received: Rs ${todayLiya}.
- Memories created today: ${todayMemories.length}.
- Pending commitments (future): ${futureCommitments.length}. ${futureCommitments.slice(0, 3).map(c => `${c.committed_by_name}: "${c.description}" due ${c.due_date}`).join("; ")}.
- Open problems: ${problems.length}.
Generate a natural end-of-day summary in Urdu/Roman Urdu. Start with "Aaj ki summary:" and mention key numbers. If nothing happened, say "Aaj abhi tak kuch record nahi hua. Bolen to main yaad rakh loon." Keep it concise.`;
        memoryCategory = "query";
        memorySummaryText = `End-of-day summary generated`;
        break;
      }

      default:
        actionResult = { type: "unknown" };
        queryData = `Could not understand the request. The owner said: "${text}". No matching intent found. Tell the owner honestly that you did not understand, and ask them to rephrase.`;
    }

    // === STEP 2.5: DETECT SIGNALS ===
    for (const c of commitments) {
      if (c.due_date && c.due_date < today && c.status === "pending") {
        const existingSignal = signals.find(s => s.signal_type === "payment_overdue" && s.subject_name === c.committed_by_name);
        if (!existingSignal) {
          await base44.entities.Signal.create({
            signal_type: "payment_overdue",
            severity: "important",
            title: `${c.committed_by_name || "Someone"} ka wada guzar gaya`,
            description: `${c.committed_by_name || "Someone"} ne ${c.due_date} ko wada kiya tha: "${c.description}". Abhi tak pura nahi hua.`,
            subject_type: "party",
            subject_name: c.committed_by_name,
            evidence: `Promise: ${c.description}, Due: ${c.due_date}, Status: pending`,
            detected_date: today,
            status: "active",
          });
        }
      }
    }

    // === STEP 3: GENERATE NATURAL LANGUAGE RESPONSE ===
    const responsePrompt = `You are PakKhata AI, a business brain for a Pakistani SMB owner. You speak naturally in the owner's language (Roman Urdu mixed with English numbers is fine, or Urdu script if the owner used Urdu script).

The owner said: "${text}"
Intent identified: ${intent}

${queryData}

${activeDecisions ? `OWNER DECISIONS TO RESPECT:
${activeDecisions}` : ""}
${openCommitments ? `OPEN COMMITMENTS TO TRACK:
${openCommitments}` : ""}

CRITICAL RULES:
- NEVER guess or make up numbers, names, or facts. Only use the data provided above.
- If a party has an active decision about credit limits and the new transaction would exceed it, mention it naturally: "Aapne decide kiya tha: [decision]. Is transaction se [party] ka balance limit se upar jaayega."
- If a commitment is overdue and the same party is placing a new order, mention it: "[Party] ka [date] wala payment abhi record nahi hua. Naya maal credit pe bhejna hai ya pehle purana clear karna hai?"
- When giving advice, distinguish between FACT (recorded data), OBSERVATION (pattern noticed), CALCULATION (derived), and RECOMMENDATION (suggestion). Never blur these layers.
- If the owner records a large credit sale (over Rs 100,000) to a party with no previous payments, you may offer education: "Ye receivable hai - paisa abhi receive nahi hua. Agar chaho to main bata doon ke iska cash flow pe kya effect hoga."
- If the owner asks "kya scene hai" or "kya haal hai", give a concise operational summary using party state data (balance, recent activity, commitments, decisions, credit limit). Don't just give the balance number.
- If the data says "not found" or "none", tell the owner honestly. Say "Mujhe ye information nahi hai" or "Abhi tak ye record nahi hua" — never fabricate.
- Be like a trusted business partner — short, direct, helpful.
- Use Rs for PKR. Use lakh/crore formatting for large numbers where natural (e.g. "Rs 4.8 lakh" not "Rs 480,000").
- For onboarding: acknowledge warmly, confirm what you understood, and invite the owner to start telling you about daily business.

Good response examples:
- "Theek hai. Aslam ke khate mein Rs 5,000 add kar diya. Item: ghee, udhaar, aaj ki date. Ab Aslam ka total baki Rs 5,000 hai."
- "Aslam ka total baki Rs 48,500 hai. Aakhri payment 12 Sep ko Rs 10,000 ayi thi."
- "Customers se total Rs 18.4 lakh lena hai. 7 parties mein. Sab se bara: Ahmed Traders — Rs 4.8 lakh."
- "Aaj 4 cheezein important hain: Rs 7.8 lakh outstanding, 2 parties overdue, 3 pending tasks kal ke liye."
- "Theek hai, yaad rakh liya. Javed ko credit nahi denge jab tak purana balance clear nahi hota."
- "Gandum ka rate Rs 10,800/kg note kar liya."
- "Mujhe ye information nahi hai. Aap ne abhi tak ye record nahi bataya. Bataiye, main yaad rakh loonga."
- "Shukriya! Main samajh gaya. Aap ka business samajh liya. Ab bataiye, aaj kya hua business mein?"

Keep it to 1-3 sentences. Respond naturally:`;

    const responseText = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: responsePrompt,
    });

    // === STEP 4: STORE IN BUSINESS MEMORY ===
    try {
      await base44.entities.BusinessMemory.create({
        raw_text: text,
        summary: memorySummaryText || queryData.slice(0, 200),
        category: memoryCategory,
        memory_date: today,
        related_party_id: actionResult.party?.id || actionResult.entry?.party_id || null,
        related_party_name: actionResult.party?.name || actionResult.entry?.party_name || entities.party_name || null,
        related_item: entities.item || entities.commodity || null,
        amount: entities.amount || null,
        currency: entities.currency || "PKR",
        intent: intent,
      });
    } catch (e) {}

    // === STEP 5: GENERATE SPEECH ===
    let audioUrl = null;
    if (speak) {
      try {
        const speech = await base44.asServiceRole.integrations.Core.GenerateSpeech({
          text: responseText,
          language_code: "ur",
          voice: "honey",
        });
        audioUrl = speech.url;
      } catch (e) {}
    }

    // === BUILD INTERACTION RECEIPT ===
    const receipt = { understood: [], recorded: [], remembered: null, impact: [] };

    // What was understood (only for action intents, not queries)
    const isActionIntent = ["CREATE_ENTRY", "CREATE_MARKET_OBSERVATION", "CREATE_RULE", "CREATE_TASK", "CREATE_COMMITMENT", "CREATE_DECISION", "REPORT_PROBLEM", "ONBOARDING", "CALCULATE_MANDI", "CREATE_REMINDER"].includes(intent);
    if (isActionIntent) {
    if (entities.party_name) receipt.understood.push({ label: "Party", value: entities.party_name });
    if (entities.entry_type) receipt.understood.push({ label: "Type", value: entities.entry_type === "diya" ? "Udhaar (diya)" : "Payment (liya)" });
    if (entities.amount != null) receipt.understood.push({ label: "Amount", value: `Rs ${Number(entities.amount).toLocaleString()}` });
    if (entities.item) receipt.understood.push({ label: "Item", value: entities.item });
    if (entities.commodity) receipt.understood.push({ label: "Commodity", value: entities.commodity });
    if (entities.rate != null) receipt.understood.push({ label: "Rate", value: `Rs ${entities.rate}` });
    if (entities.quantity != null) receipt.understood.push({ label: "Quantity", value: `${entities.quantity} ${entities.unit || ""}` });
    if (entities.date) receipt.understood.push({ label: "Date", value: entities.date });
    if (entities.due_date) receipt.understood.push({ label: "Due", value: entities.due_date });
    if (entities.business_name) receipt.understood.push({ label: "Business", value: entities.business_name });
    if (entities.owner_name) receipt.understood.push({ label: "Owner", value: entities.owner_name });
    if (entities.rule_text) receipt.understood.push({ label: "Rule", value: entities.rule_text.slice(0, 60) });
    if (entities.task_description) receipt.understood.push({ label: "Task", value: entities.task_description.slice(0, 60) });
    if (entities.committed_by_name) receipt.understood.push({ label: "Promised by", value: entities.committed_by_name });
    if (entities.description) receipt.understood.push({ label: "Description", value: entities.description.slice(0, 60) });
    }

    // What was recorded
    if (actionResult.entry) receipt.recorded.push({ label: "Entry", value: `${actionResult.entry.entry_type === "diya" ? "Udhaar" : "Payment"} — Rs ${Number(actionResult.entry.amount).toLocaleString()}` });
    if (actionResult.party && actionResult.type !== "entry_created") receipt.recorded.push({ label: "Party", value: actionResult.party.name });
    if (actionResult.rule) receipt.recorded.push({ label: "Rule", value: actionResult.rule.rule_text.slice(0, 60) });
    if (actionResult.task) receipt.recorded.push({ label: "Task", value: actionResult.task.description.slice(0, 60) });
    if (actionResult.commitment) receipt.recorded.push({ label: "Commitment", value: actionResult.commitment.description.slice(0, 60) });
    if (actionResult.decision) receipt.recorded.push({ label: "Decision", value: actionResult.decision.decision.slice(0, 60) });
    if (actionResult.problem) receipt.recorded.push({ label: "Problem", value: actionResult.problem.title });
    if (actionResult.observation) receipt.recorded.push({ label: "Market rate", value: `${actionResult.observation.commodity} — Rs ${actionResult.observation.rate}` });
    if (actionResult.reminder) receipt.recorded.push({ label: "Reminder", value: "Created" });
    if (actionResult.profile) receipt.recorded.push({ label: "Business", value: actionResult.profile.business_name });

    // What was remembered
    if (memorySummaryText) receipt.remembered = memorySummaryText;

    // Business impact
    if (actionResult.new_balance != null && actionResult.party) {
      receipt.impact.push({ label: `${actionResult.party.name} balance`, value: `Rs ${Number(actionResult.new_balance).toLocaleString()}` });
    }
    if (actionResult.type === "entry_created" && entities.entry_type === "diya") {
      receipt.impact.push({ label: "Receivables", value: `+Rs ${Number(entities.amount).toLocaleString()}` });
    }
    if (actionResult.type === "entry_created" && entities.entry_type === "liya") {
      receipt.impact.push({ label: "Receivables", value: `-Rs ${Number(entities.amount).toLocaleString()}` });
      receipt.impact.push({ label: "Cash", value: `+Rs ${Number(entities.amount).toLocaleString()}` });
    }
    if (actionResult.type === "receivables" && actionResult.total != null) {
      receipt.impact.push({ label: "Total receivable", value: `Rs ${Number(actionResult.total).toLocaleString()}` });
      receipt.impact.push({ label: "Parties", value: `${actionResult.parties?.length || 0}` });
    }
    if (actionResult.type === "payables" && actionResult.total != null) {
      receipt.impact.push({ label: "Total payable", value: `Rs ${Number(actionResult.total).toLocaleString()}` });
    }
    if (actionResult.type === "party_balance" && actionResult.balance != null) {
      receipt.impact.push({ label: "Balance", value: `Rs ${Number(actionResult.balance).toLocaleString()}` });
    }
    if (actionResult.type === "stock" && actionResult.item) {
      receipt.impact.push({ label: "Stock", value: `${actionResult.item.current_stock} ${actionResult.item.unit}` });
    }
    if (actionResult.type === "mandi_calc" && actionResult.result) {
      receipt.impact.push({ label: "Net settlement", value: `Rs ${Number(actionResult.result.netSettlement).toLocaleString()}` });
    }
    if (actionResult.type === "top_parties" && actionResult.parties) {
      actionResult.parties.slice(0, 3).forEach(p => {
        receipt.impact.push({ label: p.name, value: `Rs ${Number(p.balance).toLocaleString()}` });
      });
    }
    if (actionResult.type === "brief" && actionResult.total_receivables != null) {
      receipt.impact.push({ label: "Receivables", value: `Rs ${Number(actionResult.total_receivables).toLocaleString()}` });
      receipt.impact.push({ label: "Pending tasks", value: `${actionResult.pending_tasks || 0}` });
    }
    if (actionResult.type === "what_remember") {
      receipt.impact.push({ label: "Parties", value: `${actionResult.partyCount}` });
      receipt.impact.push({ label: "Items", value: `${actionResult.itemCount}` });
      receipt.impact.push({ label: "Decisions", value: `${actionResult.decisionCount}` });
      receipt.impact.push({ label: "Rules", value: `${actionResult.ruleCount}` });
      receipt.impact.push({ label: "Memories", value: `${actionResult.memoryCount}` });
    }
    if (actionResult.type === "missed") {
      receipt.impact.push({ label: "Overdue commitments", value: `${actionResult.overdueCommitments?.length || 0}` });
      receipt.impact.push({ label: "Overdue tasks", value: `${actionResult.overdueTasks?.length || 0}` });
      receipt.impact.push({ label: "Critical problems", value: `${actionResult.criticalProblems?.length || 0}` });
      receipt.impact.push({ label: "Low stock", value: `${actionResult.lowStock?.length || 0}` });
    }
    if (actionResult.type === "eod") {
      receipt.impact.push({ label: "Entries today", value: `${actionResult.todayEntries}` });
      receipt.impact.push({ label: "Credit given", value: `Rs ${Number(actionResult.todayDiya).toLocaleString()}` });
      receipt.impact.push({ label: "Payments received", value: `Rs ${Number(actionResult.todayLiya).toLocaleString()}` });
    }

    return Response.json({
      intent,
      action_taken: actionResult.type,
      data: actionResult,
      response_text: responseText,
      audio_url: audioUrl,
      needs_clarification: false,
      onboarded,
      receipt,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}