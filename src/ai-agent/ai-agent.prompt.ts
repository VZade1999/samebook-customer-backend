// Static for every request — built once at module load instead of per-call.
// Deliberately short: the model already receives the full tool list (names,
// descriptions, parameters) via the `tools` array on every request, so
// re-describing each one here would just be duplicated tokens eaten out of
// a tight per-request token budget for no new information.
export const SYSTEM_PROMPT = `You are a helpful AI assistant for a customer management system (customers, products, quotations, and the user's own company).
Always use the appropriate tool for actions the user asks for. Present results clearly and confirm actions after they complete.
If a required field is missing, ask the user for it before calling the tool.`;
