// Versión en inglés de las plantillas de serie (misma estructura que `builtin-templates.ts`, clave a clave).
// Se muestra y se aplica a quien usa la interfaz en inglés cuando la plantilla guardada sigue sin modificar.
// `hiddenGeneralKinds` conserva los nombres españoles: son los de los tipos generales de la base de datos.
import { col, GENERALES_SOFTWARE, isBuiltinModified, kind } from "./builtin-templates";
import { templateInputSchema, type TemplateData, type TemplateInput } from "./project-templates";

/** Plantilla canónica en inglés (validada), o null si la clave no es de serie. */
export function canonicalTemplateEn(key: string): TemplateData | null {
  const data = BUILTIN_TEMPLATES_EN[key];
  return data ? templateInputSchema.parse(data) : null;
}

/**
 * Plantilla tal y como se ofrece y se aplica según el idioma. En inglés, una de serie sin modificar (su contenido
 * coincide con el canónico en español) pasa a su versión inglesa; una modificada o propia se deja como está guardada.
 */
export function localizeTemplate<T extends TemplateData>(template: T, builtinKey: string | null | undefined, locale: "es" | "en"): T {
  if (locale !== "en" || !builtinKey || isBuiltinModified(template, builtinKey)) return template;
  const en = canonicalTemplateEn(builtinKey);
  return en ? { ...template, ...en } : template;
}

export const BUILTIN_TEMPLATES_EN: Record<string, TemplateInput> = {
  vibecoding: {
    name: "Vibecoding",
    description: "Build software with AI assistants: from idea to production, with a human review before every release.",
    columns: [
      col("Ideas"),
      col("Backlog"),
      col("In progress with AI"),
      col("Review and test"),
      col("Next release", false, "NEXT_RELEASE"),
      col("In production", true, "IN_PRODUCTION"),
    ],
    kinds: [
      kind("Improvement", "#0ea5e9", "", "**What it improves:**\n\n**Why:**\n\n**How I will know it works:**\n", ["Ask the AI for the change", "Review the diff", "Try it locally"]),
      kind("Prompt and research", "#a855f7", "", "**Question or prompt:**\n\n**Context the AI needs:**\n\n**Expected result:**\n", ["Write the prompt with its context", "Cross-check the answer", "Note what was learned"]),
      kind("Refactor", "#6366f1", "Refactor: ", "**What gets cleaned up:**\n\n**Risk:** no visible changes for the user.\n", ["Cover what is touched with tests", "Apply the change", "Check that everything still works the same"]),
      kind("Deployment", "#14b8a6", "Deploy ", "**Version or change:**\n\n**New variables or migrations:**\n", ["Review migrations", "Check environment variables", "Deploy", "Quick smoke test in production"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: false,
    labels: [
      { name: "Blocked by the AI", color: "#ef4444" },
      { name: "Needs review", color: "#f97316" },
      { name: "Frontend", color: "#0ea5e9" },
      { name: "Backend", color: "#6366f1" },
      { name: "Tech debt", color: "#8b5a2b" },
    ],
  },
  "tareas-familiares": {
    name: "Family chores",
    description: "Household organisation: shopping, home, paperwork and plans. One label per person to share out the work.",
    columns: [col("To do"), col("This week"), col("Done", true)],
    kinds: [
      kind("Shopping", "#22c55e", "Buy ", "**What is missing:**\n\n- \n\n**Where:**\n", ["Make the list", "Buy", "Put away"]),
      kind("Home", "#f97316", "", "**What needs doing:**\n\n**Materials needed:**\n"),
      kind("Paperwork", "#64748b", "Sort out ", "**Procedure:**\n\n**Documents needed:**\n\n**Deadline:**\n", ["Gather documents", "Book an appointment or do it online", "File the receipt"]),
      kind("Health", "#ef4444", "Appointment: ", "**Who:**\n\n**Where and when:**\n\n**Questions for the visit:**\n", ["Book the appointment", "Prepare documents", "Note the instructions"]),
      kind("School and kids", "#eab308", "", "**What needs doing:**\n\n**Deadline:**\n\n**What to bring:**\n"),
      kind("Leisure", "#ec4899", "", "**Plan:**\n\n**When and where:**\n\n**Who is coming:**\n", ["Pick a date", "Book", "Let the others know"]),
    ],
    hiddenGeneralKinds: GENERALES_SOFTWARE,
    hideAllGeneralKinds: true,
    labels: [
      { name: "Person 1", color: "#0ea5e9" },
      { name: "Person 2", color: "#ec4899" },
      { name: "Person 3", color: "#22c55e" },
      { name: "Whole family", color: "#a855f7" },
      { name: "Urgent", color: "#ef4444" },
    ],
  },
  "produccion-audiovisual": {
    name: "Video production",
    description: "From script to delivery: pre-production, shooting, editing and client reviews.",
    columns: [col("Idea"), col("Script"), col("Pre-production"), col("Shooting"), col("Editing"), col("Client review"), col("Delivered", true)],
    kinds: [
      kind("Script", "#a855f7", "Script: ", "**Synopsis:**\n\n**Estimated length:**\n\n**Client notes:**\n", ["First draft", "Review with the client", "Final script"]),
      kind("Shoot", "#ef4444", "Shoot: ", "**Location:**\n\n**Date and hours:**\n\n**Crew and equipment:**\n\n**Shot list:**\n", ["Confirm location and permits", "Prepare equipment and batteries", "Send the shooting plan to the crew", "Back up the memory cards"]),
      kind("Editing", "#0ea5e9", "Edit: ", "**Version:** v1\n\n**References:**\n\n**Pending:**\n", ["Rough cut", "Fine cut", "Colour grading", "Export the review version"]),
      kind("Sound", "#14b8a6", "Sound: ", "**What is needed:** music, voice-over, effects or mixing.\n\n**Licences:**\n", ["Pick music and check the licence", "Clean up and mix the audio", "Balance the levels"]),
      kind("Graphics", "#f97316", "Graphics: ", "**What is needed:** titles, captions, logos or animations.\n\n**Format and resolution:**\n"),
      kind("Delivery", "#22c55e", "Delivery: ", "**Requested formats:**\n\n**Destination:**\n", ["Export in the agreed formats", "Watch the full export", "Send to the client", "Archive the project and footage"]),
    ],
    hiddenGeneralKinds: GENERALES_SOFTWARE,
    hideAllGeneralKinds: true,
    labels: [
      { name: "Urgent", color: "#ef4444" },
      { name: "Waiting on client", color: "#f97316" },
      { name: "Missing footage", color: "#eab308" },
      { name: "Approved", color: "#22c55e" },
      { name: "Budget", color: "#6366f1" },
    ],
  },
  negocio: {
    name: "Business",
    description: "Day-to-day running of a small business: sales, customers, finance, admin and marketing.",
    columns: [col("Backlog"), col("This week"), col("In progress"), col("Waiting on others"), col("Done", true)],
    kinds: [
      kind("Sales", "#22c55e", "", "**Customer or contact:**\n\n**Opportunity:**\n\n**Next step:**\n", ["Get in touch", "Send a proposal", "Follow up"]),
      kind("Customers", "#0ea5e9", "", "**Customer:**\n\n**What they need:**\n\n**Commitment and date:**\n"),
      kind("Finance", "#eab308", "", "**Item and amount:**\n\n**Due date:**\n", ["Gather invoices or receipts", "Record in the accounts"]),
      kind("Legal and admin", "#64748b", "", "**Procedure or obligation:**\n\n**Authority or supplier:**\n\n**Deadline:**\n", ["Gather documentation", "File or send", "Keep the receipt"]),
      kind("Operations", "#f97316", "", "**What needs doing:**\n\n**Owner:**\n\n**Suppliers involved:**\n"),
      kind("Marketing", "#ec4899", "", "**Goal:**\n\n**Channel:**\n\n**Publication date:**\n"),
    ],
    hiddenGeneralKinds: GENERALES_SOFTWARE,
    hideAllGeneralKinds: true,
    labels: [
      { name: "Urgent", color: "#ef4444" },
      { name: "Important", color: "#f97316" },
      { name: "Recurring", color: "#6366f1" },
      { name: "Payment due", color: "#eab308" },
      { name: "Awaiting reply", color: "#64748b" },
    ],
  },
  "marketing-contenidos": {
    name: "Marketing and content",
    description: "Editorial calendar: from idea to publication on social media, blog and newsletter.",
    columns: [col("Ideas"), col("Writing"), col("Design"), col("Review"), col("Scheduled"), col("Published", true)],
    kinds: [
      kind("Social media post", "#ec4899", "Post: ", "**Network:**\n\n**Main message:**\n\n**Copy:**\n\n**Image or video:**\n\n**Hashtags:**\n", ["Write the copy", "Prepare the image", "Schedule the post"]),
      kind("Blog article", "#0ea5e9", "Article: ", "**Keyword:**\n\n**Audience:**\n\n**Outline:**\n\n- \n\n**Call to action:**\n", ["Outline", "First draft", "SEO review", "Images and links", "Publish"]),
      kind("Newsletter", "#a855f7", "Newsletter: ", "**Subject line:**\n\n**Featured content:**\n\n- \n\n**Call to action:**\n", ["Write", "Send a test", "Schedule the send"]),
      kind("Campaign", "#f97316", "Campaign: ", "**Goal:**\n\n**Audience:**\n\n**Channels:**\n\n**Budget:**\n\n**Dates:**\n", ["Define goal and audience", "Prepare the assets", "Launch the campaign", "Measure results"]),
      kind("Video", "#ef4444", "Video: ", "**Idea and length:**\n\n**Script:**\n\n**Platform:**\n", ["Script", "Record", "Edit", "Thumbnail and title", "Publish"]),
    ],
    hiddenGeneralKinds: GENERALES_SOFTWARE,
    hideAllGeneralKinds: true,
    labels: [
      { name: "Instagram", color: "#ec4899" },
      { name: "LinkedIn", color: "#1e3a8a" },
      { name: "Blog", color: "#0ea5e9" },
      { name: "Newsletter", color: "#a855f7" },
      { name: "Evergreen", color: "#22c55e" },
      { name: "Urgent", color: "#ef4444" },
    ],
  },
  eventos: {
    name: "Event planning",
    description: "From the first sketch to the day itself: venue, suppliers, guests, logistics and budget.",
    columns: [col("Ideas"), col("To confirm"), col("Confirmed"), col("Preparing"), col("Ready"), col("Held", true)],
    kinds: [
      kind("Venue", "#0ea5e9", "Venue: ", "**Options:**\n\n**Capacity and price:**\n\n**Terms (hours, set-up, cancellation):**\n", ["Request quotes", "Visit the venue", "Book and sign"]),
      kind("Suppliers", "#f97316", "Supplier: ", "**Service (catering, music, photography…):**\n\n**Contact:**\n\n**Quote:**\n", ["Request a quote", "Compare options", "Confirm and pay the deposit"]),
      kind("Guests", "#ec4899", "", "**List and headcount:**\n\n**Special needs:**\n", ["Finalise the list", "Send invitations", "Confirm attendance"]),
      kind("Logistics", "#6366f1", "", "**What needs moving or preparing:**\n\n**When and who:**\n", ["Plan for the day", "Transport and set-up", "Pack up and take down"]),
      kind("Budget", "#eab308", "", "**Item and amount:**\n\n**Paid / outstanding:**\n"),
    ],
    hiddenGeneralKinds: GENERALES_SOFTWARE,
    hideAllGeneralKinds: true,
    labels: [
      { name: "Urgent", color: "#ef4444" },
      { name: "Payment due", color: "#eab308" },
      { name: "Awaiting reply", color: "#64748b" },
      { name: "Confirmed", color: "#22c55e" },
      { name: "Event day", color: "#a855f7" },
    ],
  },
  "soporte-clientes": {
    name: "Customer support",
    description: "Customer issues, questions and complaints: from first contact to resolution, tracking whatever is still pending.",
    columns: [col("New"), col("In progress"), col("Waiting on customer"), col("Escalated"), col("Resolved", true)],
    kinds: [
      kind("Issue", "#ef4444", "Issue: ", "**Customer:** [name or reference]\n\n**What is happening:**\n\n**Steps to reproduce:**\n\n**Impact (how many affected):**\n", ["Confirm the problem", "Find the cause", "Apply the fix", "Let the customer know", "Check it stays resolved"]),
      kind("Question", "#0ea5e9", "Question: ", "**Customer:**\n\n**What they ask:**\n\n**Answer given:**\n", ["Reply to the customer", "Confirm it helped"]),
      kind("Request", "#6366f1", "Request: ", "**Customer:**\n\n**What they ask for:**\n\n**Agreed deadline:**\n", ["Assess whether it is possible", "Do it", "Confirm with the customer"]),
      kind("Complaint", "#f97316", "Complaint: ", "**Customer:**\n\n**Reason:**\n\n**What the customer asks for:**\n\n**Proposed solution:**\n", ["Acknowledge receipt", "Review the history", "Propose a solution", "Close with the customer"]),
      kind("Follow-up", "#14b8a6", "Follow-up: ", "**Customer:**\n\n**What to check:**\n\n**Contact date:**\n"),
      kind("Help article", "#a855f7", "Help: ", "**Frequently asked question:**\n\n**Answer:**\n\n**When it applies:**\n", ["Write the article", "Review it", "Publish it"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Urgent", color: "#ef4444" },
      { name: "Key customer", color: "#a855f7" },
      { name: "Reopened", color: "#f97316" },
      { name: "Waiting on third party", color: "#64748b" },
      { name: "Closed without reply", color: "#eab308" },
    ],
  },
  "seleccion-personal": {
    name: "Recruitment",
    description: "Hiring processes: from opening a vacancy to onboarding, with one card per candidate and per task.",
    columns: [col("Open vacancy"), col("Shortlisted"), col("Interview"), col("Assessment"), col("Offer"), col("Hired", true), col("Rejected", true)],
    kinds: [
      kind("Vacancy", "#6366f1", "Vacancy: ", "**Position:**\n\n**Main responsibilities:**\n\n**Essential requirements:**\n\n**Terms (hours, salary range):**\n", ["Define the profile", "Write and publish the job ad", "Review the applications received"]),
      kind("Candidate", "#0ea5e9", "Candidate: ", "**Name:** [candidate name]\n\n**Position:**\n\n**Where the application came from:**\n\n**First impression:**\n", ["Review the CV", "First contact", "Decide whether to interview"]),
      kind("Interview", "#a855f7", "Interview: ", "**Candidate:**\n\n**Date and format:**\n\n**Interviewers:**\n\n**Key questions:**\n\n**Evaluation:**\n", ["Agree a date with the candidate", "Prepare the questions", "Interview", "Write up the evaluation"]),
      kind("Assessment", "#14b8a6", "Assessment: ", "**Candidate:**\n\n**What is evaluated:**\n\n**Submission deadline:**\n\n**Marking criteria:**\n", ["Send the brief", "Mark the assessment", "Give feedback"]),
      kind("Offer", "#22c55e", "Offer: ", "**Candidate:**\n\n**Terms offered:**\n\n**Reply deadline:**\n", ["Approve the terms", "Send the offer", "Negotiate or confirm"]),
      kind("Onboarding", "#eab308", "Onboarding: ", "**Person:**\n\n**Start date:**\n\n**Equipment and access:**\n", ["Prepare contract and registration", "Prepare equipment and access", "First-day welcome plan", "Check in after the first week"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Urgent", color: "#ef4444" },
      { name: "Strong profile", color: "#22c55e" },
      { name: "Undecided", color: "#eab308" },
      { name: "Awaiting reply", color: "#64748b" },
      { name: "Referral", color: "#6366f1" },
    ],
  },
  "reformas-obras": {
    name: "Renovation and building work",
    description: "Renovate a home or shop: quotes, permits, materials, trades and payments, up to the final handover.",
    columns: [col("Ideas"), col("Quotes"), col("Permits"), col("Scheduled"), col("On site"), col("Final inspection"), col("Finished", true)],
    kinds: [
      kind("Quote", "#eab308", "Quote: ", "**Company or professional:** [name]\n\n**Scope included:**\n\n**Price and payment terms:**\n\n**Completion time:**\n", ["Request a quote", "Compare with others", "Accept or decline"]),
      kind("Permits and licences", "#64748b", "Permit: ", "**Procedure:**\n\n**Authority:**\n\n**Documents needed:**\n\n**Deadline:**\n", ["Gather the documentation", "Submit the application", "Keep the decision"]),
      kind("Materials", "#8b5a2b", "Material: ", "**What is needed:**\n\n**Measurements or quantity:**\n\n**Supplier and delivery time:**\n", ["Choose the model", "Order and pay", "Receive and check"]),
      kind("Site work", "#f97316", "Work: ", "**Room or area:**\n\n**Work to be done:**\n\n**Trade responsible:**\n\n**Planned dates:**\n", ["Agree a start date", "Monitor progress", "Check the result"]),
      kind("Payment", "#22c55e", "Payment: ", "**Item and company:**\n\n**Amount:**\n\n**Due date:**\n", ["Check the work done", "Make the payment", "Keep the invoice"]),
      kind("Site issue", "#ef4444", "Issue: ", "**What happened:**\n\n**Who is fixing it:**\n\n**Cost or delay:**\n", ["Document with photos", "Notify the person responsible", "Agree on the fix"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Urgent", color: "#ef4444" },
      { name: "Payment due", color: "#eab308" },
      { name: "Waiting on materials", color: "#8b5a2b" },
      { name: "Waiting on the trade", color: "#64748b" },
      { name: "Approved", color: "#22c55e" },
    ],
  },
  viajes: {
    name: "Travel",
    description: "Plan a trip from start to finish: transport, accommodation, activities, documents and budget.",
    columns: [col("Ideas"), col("To book"), col("Booked"), col("Before departure"), col("During the trip"), col("Done", true)],
    kinds: [
      kind("Transport", "#0ea5e9", "Transport: ", "**Route and dates:**\n\n**Carrier and booking reference:**\n\n**Times:**\n", ["Compare prices", "Book", "Save the tickets"]),
      kind("Accommodation", "#6366f1", "Accommodation: ", "**Place and dates:**\n\n**Address and contact:**\n\n**Cancellation policy:**\n", ["Compare options", "Book", "Confirm the arrival time"]),
      kind("Activity", "#ec4899", "Activity: ", "**What and where:**\n\n**Day and time:**\n\n**Price and booking:**\n", ["Check times and prices", "Book tickets"]),
      kind("Documents", "#64748b", "Documents: ", "**Which document:**\n\n**Who needs it:**\n\n**Expiry or deadline:**\n", ["Check it is valid", "Apply for it if needed", "Keep a digital copy"]),
      kind("Packing", "#14b8a6", "Packing: ", "**For whom:**\n\n**Expected weather:**\n\n**Do not forget:**\n\n- \n", ["Make the list", "Pack the bags", "Check chargers and documents"]),
      kind("Budget", "#eab308", "", "**Item and amount:**\n\n**Paid / outstanding:**\n"),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Must-do", color: "#ef4444" },
      { name: "Optional", color: "#64748b" },
      { name: "Free cancellation", color: "#22c55e" },
      { name: "Payment due", color: "#eab308" },
      { name: "Paid", color: "#166534" },
    ],
  },
  "estudios-tesis": {
    name: "Study or thesis",
    description: "Long study or research projects: reading, writing by chapter, supervisor reviews and submission.",
    columns: [col("Pending"), col("Researching"), col("Writing"), col("Supervisor review"), col("Revising"), col("Submitted", true)],
    kinds: [
      kind("Reading", "#0ea5e9", "Read: ", "**Source:**\n\n**For which chapter:**\n\n**Main ideas:**\n\n**Useful quotes:**\n", ["Read", "Summarise", "Add to the bibliography"]),
      kind("Writing", "#6366f1", "Write: ", "**Chapter or section:**\n\n**Outline:**\n\n- \n\n**Expected length:**\n", ["Outline", "First draft", "Check the style", "Check the citations"]),
      kind("Fieldwork", "#22c55e", "Fieldwork: ", "**Objective:**\n\n**Method:**\n\n**Data to collect:**\n\n**Dates:**\n", ["Prepare the materials", "Collect the data", "Organise and back up"]),
      kind("Supervisor meeting", "#a855f7", "Meeting: ", "**Date:**\n\n**What to present:**\n\n**Questions:**\n\n**Agreements:**\n", ["Send the material beforehand", "Prepare the questions", "Note the agreements"]),
      kind("Bibliography", "#8b5a2b", "", "**References to add or check:**\n\n- \n\n**Citation style:**\n"),
      kind("Submission or defence", "#ef4444", "Submission: ", "**What is submitted and where:**\n\n**Deadline:**\n\n**Formatting requirements:**\n", ["Final proofread", "Check the formatting", "Submit and keep the receipt", "Prepare the presentation"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Chapter 1", color: "#0ea5e9" },
      { name: "Chapter 2", color: "#6366f1" },
      { name: "Chapter 3", color: "#a855f7" },
      { name: "With the supervisor", color: "#f97316" },
      { name: "Urgent", color: "#ef4444" },
    ],
  },
  mudanza: {
    name: "House move",
    description: "Moving home without forgetting anything: paperwork, packing, transport, cleaning and settling into the new place.",
    columns: [col("To do"), col("This week"), col("Waiting"), col("Done", true)],
    kinds: [
      kind("Admin and change of address", "#64748b", "Change address: ", "**Organisation or company:**\n\n**Documents needed:**\n\n**Deadline:**\n", ["Gather documents", "Make the change", "Keep the confirmation"]),
      kind("Packing", "#8b5a2b", "Pack: ", "**Room:**\n\n**What is being packed:**\n\n**Fragile or valuable:**\n", ["Get boxes and materials", "Pack and label", "List the contents of each box"]),
      kind("Transport", "#0ea5e9", "Transport: ", "**Company or helpers:** [name]\n\n**Date and time:**\n\n**Approximate volume:**\n\n**Access at both ends:**\n", ["Request quotes", "Book the date", "Reserve a parking space or permit", "Confirm the day before"]),
      kind("Cleaning and handing back keys", "#14b8a6", "", "**Property:**\n\n**What must be done:**\n\n**Key handover date:**\n", ["Deep clean", "Take photos of the condition", "Read the meters", "Hand over the keys"]),
      kind("Utilities", "#eab308", "Utilities: ", "**Service (electricity, water, internet…):**\n\n**Cancel or set up:**\n\n**Switch date:**\n", ["Cancel at the old home", "Set up at the new one", "Check it works"]),
      kind("New home", "#ec4899", "", "**What to buy or assemble:**\n\n**Room:**\n\n**Measurements:**\n"),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Kitchen", color: "#f97316" },
      { name: "Living room", color: "#0ea5e9" },
      { name: "Bedrooms", color: "#a855f7" },
      { name: "Bathroom", color: "#14b8a6" },
      { name: "Urgent", color: "#ef4444" },
      { name: "Fragile", color: "#eab308" },
    ],
  },
};
