/* Shared taxonomy: the topic set the site and the pipeline agree on,
   plus keyword hints used to auto-classify fetched articles. */
export const TOPICS = [
  { id: "ux-research",        label: "UX Research",    color: "#6C8EF5", blurb: "Finding out what people actually need.", kw: ["research", "usability", "interview", "survey", "persona", "insight", "testing", "ethnograph"] },
  { id: "service-design",     label: "Service Design", color: "#27B5A8", blurb: "Designing the whole journey, front and back stage.", kw: ["service design", "blueprint", "journey map", "touchpoint", "front stage", "back stage", "ecosystem"] },
  { id: "ai-design",          label: "AI & Design",    color: "#8B5CF6", blurb: "Designing with and for intelligent systems.", kw: ["ai", "artificial intelligence", "llm", "prompt", "generative", "machine learning", "model", "agent", "copilot"] },
  { id: "design-systems",     label: "Design Systems", color: "#F59E0B", blurb: "Reusable parts that scale a product.", kw: ["design system", "component", "token", "atomic", "pattern library", "figma", "variants"] },
  { id: "product-management", label: "Product",        color: "#EF6F6C", blurb: "Deciding what to build and why.", kw: ["product manager", "roadmap", "prioriti", "backlog", "outcome", "okr", "discovery", "stakeholder", "mvp"] },
  { id: "accessibility",      label: "Accessibility",  color: "#22A06B", blurb: "Making it usable by everyone.", kw: ["accessib", "a11y", "wcag", "screen reader", "contrast", "inclusive", "aria", "keyboard"] },
  { id: "ux-craft",           label: "UX Craft",       color: "#EC4899", blurb: "The hands-on practice of design.", kw: ["wireframe", "prototype", "interaction", "visual design", "ui", "layout", "typography", "microcopy", "craft"] },
  { id: "design-leadership",  label: "Leadership",     color: "#0EA5E9", blurb: "Teams, influence and direction.", kw: ["leadership", "manage", "team", "culture", "strategy", "mentor", "hiring", "stakeholder", "influence"] }
];

export function classify(text, max = 3) {
  const low = (text || "").toLowerCase();
  const scored = TOPICS.map(t => ({ id: t.id, score: t.kw.reduce((s, k) => s + (low.includes(k) ? 1 : 0), 0) }))
    .filter(t => t.score > 0).sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, max).map(t => t.id);
  return picked.length ? picked : ["ux-craft"];
}

/* Build a few learning paths automatically by grouping articles per dominant topic. */
export function buildPaths(articles) {
  const byTopic = {};
  articles.forEach(a => { const t = a.topics[0]; (byTopic[t] = byTopic[t] || []).push(a.id); });
  const icon = { "ux-research": "🔎", "service-design": "🧭", "ai-design": "✨", "design-systems": "🧱", "product-management": "🎯", "accessibility": "🫶", "ux-craft": "🎨", "design-leadership": "⛰" };
  return TOPICS.filter(t => (byTopic[t.id] || []).length >= 2).map(t => ({
    id: "path-" + t.id, title: t.label + " track", icon: icon[t.id] || "📘",
    blurb: t.blurb, articleIds: byTopic[t.id].slice(0, 6)
  }));
}
