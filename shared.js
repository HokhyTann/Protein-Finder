const GRAPHQL_URL = "https://data.rcsb.org/graphql";

function viewerUrl(code) {
  return `https://molstar.org/viewer/?pdb=${encodeURIComponent(code)}&hide-controls=1`;
}

function rcsbStructureUrl(code) {
  return `https://www.rcsb.org/structure/${encodeURIComponent(code)}`;
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function titleCase(value = "") {
  const lower = value.toLowerCase();

  return lower.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return "Unknown";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.getUTCFullYear().toString();
}

function formatFullDate(value) {
  if (!value) return "Unknown";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "N/A";

  return value.toLocaleString();
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  element.textContent = text;

  return element;
}

function metadataItem(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");

  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);

  return wrapper;
}
