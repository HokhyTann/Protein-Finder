const SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query";
const GRAPHQL_URL = "https://data.rcsb.org/graphql";
const PAGE_SIZE = 24;

const grid = document.querySelector("#proteinGrid");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const resultStatus = document.querySelector("#resultStatus");
const pageIndicator = document.querySelector("#pageIndicator");
const prevPageButton = document.querySelector("#prevPageButton");
const nextPageButton = document.querySelector("#nextPageButton");
const quickSearches = document.querySelectorAll(".filter");

let activeQuery = "";
let currentPage = 1;
let totalCount = 0;
let isLoading = false;
let requestToken = 0;

const structureObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const frame = entry.target;
      frame.src = frame.dataset.src;
      frame.removeAttribute("data-src");
      structureObserver.unobserve(frame);
    });
  },
  { rootMargin: "500px 0px" },
);

function debounce(callback, delay = 350) {
  let timeoutId;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delay);
  };
}

function viewerUrl(code) {
  return `https://molstar.org/viewer/?pdb=${encodeURIComponent(code)}&hide-controls=1`;
}

function searchPayload(query, start) {
  const proteinOnlyQuery = {
    type: "terminal",
    service: "text",
    parameters: {
      attribute: "rcsb_entry_info.selected_polymer_entity_types",
      operator: "exact_match",
      value: "Protein (only)",
    },
  };

  const textQuery = {
    type: "terminal",
    service: "full_text",
    parameters: {
      value: query,
    },
  };

  return {
    query: query
      ? {
          type: "group",
          logical_operator: "and",
          nodes: [proteinOnlyQuery, textQuery],
        }
      : proteinOnlyQuery,
    return_type: "entry",
    request_options: {
      paginate: {
        start,
        rows: PAGE_SIZE,
      },
    },
  };
}

async function fetchSearchIds(query, start) {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(searchPayload(query, start)),
  });

  if (!response.ok) {
    throw new Error(`Search failed with status ${response.status}`);
  }

  const data = await response.json();

  return {
    ids: (data.result_set || []).map((result) => result.identifier),
    total: data.total_count || 0,
  };
}

async function fetchEntryMetadata(ids) {
  if (!ids.length) return [];

  const query = `
    query ProteinCards($ids: [String!]!) {
      entries(entry_ids: $ids) {
        rcsb_id
        struct {
          title
        }
        exptl {
          method
        }
        rcsb_accession_info {
          initial_release_date
        }
        rcsb_entry_info {
          resolution_combined
          selected_polymer_entity_types
          polymer_entity_count
        }
        polymer_entities {
          rcsb_polymer_entity {
            pdbx_description
          }
          rcsb_entity_source_organism {
            ncbi_scientific_name
          }
        }
      }
    }
  `;

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { ids },
    }),
  });

  if (!response.ok) {
    throw new Error(`Metadata failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.errors?.length) {
    throw new Error(data.errors[0].message);
  }

  return data.data.entries.filter(Boolean).map(normalizeEntry);
}

function normalizeEntry(entry) {
  const descriptions = uniqueValues(
    entry.polymer_entities?.map((entity) => titleCase(entity.rcsb_polymer_entity?.pdbx_description)),
  );
  const organisms = uniqueValues(
    entry.polymer_entities?.flatMap((entity) =>
      entity.rcsb_entity_source_organism?.map((organism) => organism.ncbi_scientific_name) || [],
    ),
  );
  const methods = uniqueValues(entry.exptl?.map((experiment) => experiment.method));
  const resolution = entry.rcsb_entry_info?.resolution_combined?.[0];

  return {
    code: entry.rcsb_id,
    name: descriptions.slice(0, 2).join(" / ") || titleCase(entry.struct?.title) || entry.rcsb_id,
    group: entry.rcsb_entry_info?.selected_polymer_entity_types || "Protein",
    method: methods.join(", ") || "Unknown",
    resolution: Number.isFinite(resolution) ? `${resolution.toFixed(2)} A` : "N/A",
    organism: organisms.slice(0, 2).join(", ") || "Unknown",
    summary: titleCase(entry.struct?.title) || "Protein structure from the RCSB Protein Data Bank.",
    released: formatDate(entry.rcsb_accession_info?.initial_release_date),
  };
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

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
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

function proteinCard(protein) {
  const card = document.createElement("article");
  card.className = "protein-card";

  const viewerShell = document.createElement("div");
  viewerShell.className = "viewer-shell";

  const fallback = createTextElement("p", "viewer-fallback", `Loading 3D structure for ${protein.code}`);
  const iframe = document.createElement("iframe");
  iframe.title = `${protein.name} 3D structure`;
  iframe.dataset.src = viewerUrl(protein.code);
  iframe.loading = "lazy";
  iframe.allow = "fullscreen";
  structureObserver.observe(iframe);
  viewerShell.append(fallback, iframe);

  const body = document.createElement("div");
  body.className = "protein-body";

  const topLine = document.createElement("div");
  topLine.className = "card-topline";
  topLine.append(createTextElement("span", "code", protein.code), createTextElement("span", "category", protein.group));

  const name = createTextElement("h2", "", protein.name);
  const summary = createTextElement("p", "summary", protein.summary);

  const metadata = document.createElement("dl");
  metadata.className = "metadata";
  metadata.append(
    metadataItem("Method", protein.method),
    metadataItem("Resolution", protein.resolution),
    metadataItem("Organism", protein.organism),
    metadataItem("Released", protein.released),
  );

  body.append(topLine, name, summary, metadata);
  card.append(viewerShell, body);

  return card;
}

function setStatus(message) {
  resultStatus.textContent = message;
}

function updatePagination() {
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  pageIndicator.textContent = `Page ${currentPage.toLocaleString()} of ${totalPages.toLocaleString()}`;
  prevPageButton.disabled = isLoading || currentPage <= 1;
  nextPageButton.disabled = isLoading || currentPage >= totalPages || totalCount === 0;
}

function resetResults(query) {
  activeQuery = query;
  currentPage = 1;
  totalCount = 0;
  isLoading = false;
  requestToken += 1;
  grid.replaceChildren();
  emptyState.hidden = true;
  setStatus("Loading proteins from RCSB PDB...");
  updatePagination();
  loadPage(currentPage, requestToken);
}

async function loadPage(page, token = requestToken) {
  if (isLoading) return;

  isLoading = true;
  currentPage = page;
  grid.replaceChildren();
  emptyState.hidden = true;
  setStatus("Loading proteins from RCSB PDB...");
  updatePagination();

  try {
    const start = (page - 1) * PAGE_SIZE;
    const { ids, total } = await fetchSearchIds(activeQuery, start);

    if (token !== requestToken) return;

    totalCount = total;

    const proteins = await fetchEntryMetadata(ids);

    if (token !== requestToken) return;

    grid.replaceChildren(...proteins.map(proteinCard));
    emptyState.hidden = grid.children.length > 0;

    const queryLabel = activeQuery ? ` for "${activeQuery}"` : "";
    const firstItem = totalCount === 0 ? 0 : start + 1;
    const lastItem = Math.min(start + proteins.length, totalCount);
    const totalShown = totalCount.toLocaleString();
    setStatus(`Showing ${firstItem.toLocaleString()}-${lastItem.toLocaleString()} of ${totalShown} protein entries${queryLabel}`);
  } catch (error) {
    if (token === requestToken) {
      setStatus("Could not load RCSB PDB data. Please try again in a moment.");
      emptyState.hidden = grid.children.length > 0;
      console.error(error);
    }
  } finally {
    if (token === requestToken) {
      isLoading = false;
      updatePagination();
    }
  }
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const nextPage = Math.min(Math.max(page, 1), totalPages);

  requestToken += 1;
  loadPage(nextPage, requestToken);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function syncQuickSearch(query) {
  quickSearches.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.query === query);
  });
}

quickSearches.forEach((button) => {
  button.addEventListener("click", () => {
    const query = button.dataset.query;
    searchInput.value = query;
    syncQuickSearch(query);
    resetResults(query);
  });
});

prevPageButton.addEventListener("click", () => {
  goToPage(currentPage - 1);
});

nextPageButton.addEventListener("click", () => {
  goToPage(currentPage + 1);
});

searchInput.addEventListener(
  "input",
  debounce(() => {
    const query = searchInput.value.trim();
    syncQuickSearch(query);
    resetResults(query);
  }),
);

resetResults("");
