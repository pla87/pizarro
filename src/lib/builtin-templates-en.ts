// Versión en inglés de las plantillas de serie (misma estructura que `builtin-templates.ts`, clave a clave).
// Se muestra y se aplica a quien usa la interfaz en inglés cuando la plantilla guardada sigue sin modificar.
// `hiddenGeneralKinds` conserva los nombres españoles: son los de los tipos generales de la base de datos.
import { col, isBuiltinModified, kind } from "./builtin-templates";
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
  "trabajo-clientes": {
    name: "Work and clients",
    description: "Jobs, proposals, issues and internal tasks for a business or a freelancer, with client, priority and cost, a reminder when something waits too long and periodic tasks that repeat on their own.",
    columns: [
      col("To do"),
      col("In progress"),
      col("Waiting", false, "WAITING"),
      col("Review", false, "REVIEW"),
      col("Periodic tasks", false, "ROUTINES"),
      col("Done", true),
    ],
    kinds: [
      kind("Job", "#6366f1", "", "**What the client asks for:**\n\n**Agreed deadline:**\n\n**What gets delivered:**\n", ["Clarify what they need", "Do the work", "Deliver and confirm with the client"]),
      kind("Proposal or quote", "#eab308", "Proposal: ", "**What it includes:**\n\n**Price and terms:**\n\n**Valid until:**\n", ["Prepare the proposal", "Review it", "Send it", "Call to discuss it"]),
      kind("Meeting", "#a855f7", "Meeting: ", "**With whom:**\n\n**Date and format:**\n\n**Goal:**\n\n**Agreements and next step:**\n", ["Prepare the meeting", "Send the summary and agreements"]),
      kind("Issue", "#ef4444", "Issue: ", "**What is happening:**\n\n**Where and who is affected:**\n\n**Fix applied:**\n", ["Confirm the problem", "Find the cause", "Fix it", "Let the client know"]),
      kind("Invoicing", "#22c55e", "", "**Item and amount:**\n\n**Due date:**\n", ["Issue or record the invoice", "Check it is paid", "File the receipt"]),
      kind("Content or campaign", "#ec4899", "", "**Goal and audience:**\n\n**Channel:**\n\n**Publication date:**\n", ["Write the copy", "Prepare the image or video", "Review and schedule"]),
      kind("Internal task", "#64748b", "", "**What needs doing:**\n\n**Supplier or authority:**\n\n**Deadline:**\n"),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Blocked", color: "#f97316" },
      { name: "Reopened", color: "#eab308" },
      { name: "Under warranty", color: "#0ea5e9" },
    ],
    taskFields: ["priority", "client", "cost"],
  },
  "casa-familia": {
    name: "Home and family",
    description: "Shopping, chores, paperwork, appointments, renovations and house moves, with the week by person, the shopping list and tasks that repeat on their own.",
    columns: [
      col("To do"),
      col("This week", false, "WEEKLY_PLAN"),
      col("Waiting", false, "WAITING"),
      col("Shopping list", false, "CHECKLIST"),
      col("Appointments"),
      col("Routines", false, "ROUTINES"),
      col("Done", true),
    ],
    kinds: [
      kind("Shopping", "#22c55e", "Buy ", "**Where:**\n\n**Needed by:**\n"),
      kind("Home", "#f97316", "", "**What needs doing:**\n\n**Materials needed:**\n"),
      kind("Paperwork", "#64748b", "Sort out ", "**Procedure:**\n\n**Documents needed:**\n\n**Deadline:**\n", ["Gather documents", "Book an appointment or do it online", "File the receipt"]),
      kind("Appointment", "#6366f1", "Appointment: ", "**Who:**\n\n**Where and when:**\n\n**What to ask or bring:**\n", ["Book the appointment", "Prepare documents", "Note the instructions"]),
      kind("Renovation or repair", "#8b5a2b", "Work: ", "**Room or area:**\n\n**What needs doing:**\n\n**Who does it and quote:**\n\n**Planned dates:**\n", ["Request quotes", "Agree on a date", "Keep track while the work is done", "Check the result and pay"]),
      kind("Move", "#0ea5e9", "Move: ", "**What needs doing (paperwork, packing, transportation, utilities):**\n\n**Date:**\n", ["Request quotes for the movers", "Pack and label", "Change the address and the utilities", "Hand over the keys"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Person 1", color: "#0ea5e9" },
      { name: "Person 2", color: "#ec4899" },
      { name: "Whole family", color: "#a855f7" },
      { name: "Urgent", color: "#ef4444" },
    ],
    taskFields: ["cost", "startDate"],
  },
  "eventos-viajes": {
    name: "Events and travel",
    description: "Organize an event or a trip: venue or accommodation, transportation, suppliers, guests and program, with the budget of what is booked, the agenda and a single list for the day or for packing.",
    columns: [
      col("Ideas"),
      col("To confirm", false, "WAITING"),
      col("Booked", false, "BUDGET"),
      col("Preparing"),
      col("Agenda"),
      col("Day list and packing", false, "CHECKLIST"),
      col("Done", true),
    ],
    kinds: [
      kind("Venue or accommodation", "#6366f1", "", "**Options:**\n\n**Dates, capacity and price:**\n\n**Cancellation policy:**\n", ["Compare options", "Book", "Save the confirmation"]),
      kind("Transportation", "#0ea5e9", "Transportation: ", "**Route and dates:**\n\n**Carrier and booking reference:**\n\n**Times:**\n", ["Compare prices", "Book", "Save the tickets"]),
      kind("Supplier", "#f97316", "Supplier: ", "**Service (catering, music, photography…):**\n\n**Contact:**\n\n**Quote and deposit:**\n", ["Request a quote", "Compare options", "Confirm and pay the deposit"]),
      kind("Guests", "#ec4899", "", "**List and headcount:**\n\n**Special needs:**\n", ["Finalize the list", "Send invitations", "Confirm attendance"]),
      kind("Activity or program", "#a855f7", "", "**What and where:**\n\n**Day, time and length:**\n\n**Who takes part or what is needed:**\n", ["Fix the schedule", "Book or confirm", "Let the others know"]),
      kind("Documents", "#64748b", "Documents: ", "**Which document:**\n\n**Who needs it:**\n\n**Expiry or deadline:**\n", ["Check it is valid", "Apply for it if needed", "Keep a digital copy"]),
      kind("Packing and supplies", "#14b8a6", "", "**For whom or for what:**\n\n**Do not forget:**\n\n- \n", ["Documents and tickets", "Chargers and adapter", "Medicines", "Clothes for the weather"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Must-have", color: "#a855f7" },
      { name: "Optional", color: "#64748b" },
      { name: "Free cancellation", color: "#22c55e" },
    ],
    taskFields: ["cost", "startDate"],
  },
  "estudios-tesis": {
    name: "Study and learning",
    description: "Learn anything: a course, a civil service exam, a language or a thesis. Topics, reading, practice, reviews that repeat on their own, corrections, assignments and exams.",
    columns: [
      col("To do"),
      col("Studying"),
      col("Reviews", false, "ROUTINES"),
      col("Waiting for feedback", false, "WAITING"),
      col("Revising", false, "REVIEW"),
      col("Done", true),
    ],
    kinds: [
      kind("Topic or lesson", "#0ea5e9", "Topic: ", "**Topic or unit:**\n\n**What I need to know:**\n\n- \n\n**Materials:**\n", ["Read or watch the lesson", "Make an outline or summary", "Do the exercises"]),
      kind("Reading", "#8b5a2b", "Read: ", "**Source:**\n\n**What it is for:**\n\n**Main ideas:**\n", ["Read", "Summarize", "Save the reference"]),
      kind("Practice", "#22c55e", "Practice: ", "**What is practiced (exercises, conversation, problems):**\n\n**Time:**\n\n**Questions:**\n", ["Do the exercises", "Check them", "Note the mistakes"]),
      kind("Writing", "#6366f1", "Write: ", "**Assignment, chapter or section:**\n\n**Outline:**\n\n- \n\n**Expected length:**\n", ["Outline", "First draft", "Check the style", "Check the citations"]),
      kind("Office hours or class", "#a855f7", "Office hours: ", "**Date:**\n\n**What to bring:**\n\n**Questions:**\n\n**Agreements:**\n", ["Prepare the questions", "Note the agreements"]),
      kind("Corrections", "#f97316", "Revise: ", "**Assignment or section:**\n\n**Next submission date:**\n\n**Comments received (one per subtask):**\n"),
      kind("Exam or submission", "#ef4444", "", "**What it is (exam, submission or defense):**\n\n**Date and place:**\n\n**What it covers or requires:**\n", ["Go over the whole syllabus", "Practice exam or final check", "Prepare what to bring or submit"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Block 1", color: "#0ea5e9" },
      { name: "Block 2", color: "#6366f1" },
      { name: "Question", color: "#f97316" },
      { name: "Struggling", color: "#ef4444" },
    ],
    taskFields: ["hours", "startDate"],
  },
  "curso-master": {
    name: "Course or talk",
    description: "Prepare a course, a master's program or a talk with help from an AI agent: a work plan for the agent, a session-by-session program you can publish as a PDF, materials, exercises and exams, and student follow-up.",
    columns: [
      col("Ideas"),
      col("Materials"),
      col("Exercises and exams"),
      col("AI work plan", false, "AI_PLAN"),
      col("Program", false, "PROGRAM"),
      col("Student follow-up"),
      col("Published", true),
    ],
    kinds: [
      kind("Session", "#6366f1", "Session: ", "**Objectives:**\n\n**Topics:**\n\n- \n\n**Activities:**\n\n**Readings and materials:**\n", ["Prepare the slides", "Prepare the activity", "Upload the materials"]),
      kind(
        "Prepare material",
        "#0ea5e9",
        "Material: ",
        "**Objective:**\n\n**Content:**\n\n- \n\n**Delivery format:** Google Slides, Google Docs, Markdown, PDF or HTML\n\n**Length or duration:**\n\n**Notes for the agent:**\n",
        ["Ask the agent for a draft", "Review and correct it", "Publish it to students"],
      ),
      kind(
        "Prepare exercise",
        "#22c55e",
        "Exercise: ",
        "**Objective:**\n\n**Task or topic:**\n\n**Delivery format:** Google Docs, Markdown, PDF or HTML\n\n**Estimated time:**\n\n**Grading criteria:**\n\n**Notes for the agent:** also prepare the solution.\n",
        ["Write the task", "Prepare the solution", "Check the difficulty"],
      ),
      kind(
        "Prepare exam",
        "#ef4444",
        "Exam: ",
        "**Objective (what is assessed):**\n\n**Syllabus:**\n\n- \n\n**Type and format:** multiple choice, short questions or case study; Google Docs or PDF\n\n**Duration:**\n\n**Assessment criteria:**\n\n**Notes for the agent:** include the grading rubric.\n",
        ["Prepare the questions", "Prepare the grading rubric", "Review by another teacher", "Publish or print"],
      ),
      kind("Review student profile", "#a855f7", "Profile: ", "**Student:** [name or reference]\n\n**What to review:** progress, submissions and attendance\n\n**Observations:**\n\n**Next step:**\n", ["Review submissions and grades", "Note observations", "Decide whether office hours are needed"]),
      kind(
        "Grade",
        "#f97316",
        "Grade: ",
        "**What is being graded:** exercise, exam or assignment\n\n**Criteria:**\n\n**Deadline to return grades:**\n\n**Notes for the agent:** first pass against the criteria; the teacher sets the final grade.\n",
        ["Grade", "Review borderline cases", "Publish grades and feedback"],
      ),
      kind("Office hours", "#14b8a6", "Office hours: ", "**Student or group:** [name or reference]\n\n**Date and format:** in person or video call\n\n**Topics:**\n\n**Agreements:**\n", ["Agree on a date", "Prepare the topics", "Note the agreements"]),
    ],
    hiddenGeneralKinds: [],
    hideAllGeneralKinds: true,
    labels: [
      { name: "Module 1", color: "#0ea5e9" },
      { name: "Module 2", color: "#6366f1" },
      { name: "Module 3", color: "#a855f7" },
      { name: "For the agent", color: "#14b8a6" },
      { name: "Coordination review", color: "#f97316" },
      { name: "Urgent", color: "#ef4444" },
    ],
    taskFields: ["startDate"],
  },
};
