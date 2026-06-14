const detailStatus = document.querySelector("#detailStatus");
const detailContent = document.querySelector("#detailContent");
const detailError = document.querySelector("#detailError");
const detailErrorMessage = document.querySelector("#detailErrorMessage");

const SEQUENCE_PREVIEW = 120;

async function fetchProteinDetail(code) {
  const query = `
    query ProteinDetail($id: String!) {
      entry(entry_id: $id) {
        rcsb_id
        struct { title }
        exptl { method }
        rcsb_accession_info { initial_release_date }
        rcsb_entry_info {
          resolution_combined
          selected_polymer_entity_types
          polymer_entity_count
          deposited_atom_count
          molecular_weight
        }
        audit_author { name }
        rcsb_primary_citation {
          title
          journal_abbrev
          journal_volume
          page_first
          page_last
          year
          pdbx_database_id_PubMed
          pdbx_database_id_DOI
        }
        polymer_entities {
          rcsb_id
          entity_poly { pdbx_seq_one_letter_code }
          rcsb_polymer_entity { pdbx_description }
          rcsb_entity_source_organism {
            ncbi_scientific_name
            ncbi_taxonomy_id
          }
          rcsb_polymer_entity_container_identifiers {
            reference_sequence_identifiers {
              database_name
              database_accession
            }
          }
          polymer_entity_instances { rcsb_id }
        }
        nonpolymer_entities {
          rcsb_id
          pdbx_entity_nonpoly { comp_id name }
          rcsb_nonpolymer_entity { pdbx_description }
        }
      }
    }
  `;

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: code } }),
  });

  if (!response.ok) {
    throw new Error(`Detail request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.errors?.length) {
    throw new Error(data.errors[0].message);
  }

  return data.data.entry;
}

function normalizeDetail(entry) {
  const methods = uniqueValues(entry.exptl?.map((experiment) => experiment.method));
  const resolution = entry.rcsb_entry_info?.resolution_combined?.[0];
  const citation = entry.rcsb_primary_citation || {};
  const authors = uniqueValues(entry.audit_author?.map((author) => author.name));

  const polymers = (entry.polymer_entities || []).map((entity) => {
    const organisms = entity.rcsb_entity_source_organism || [];
    const refs = entity.rcsb_polymer_entity_container_identifiers?.reference_sequence_identifiers || [];

    return {
      id: entity.rcsb_id,
      description: titleCase(entity.rcsb_polymer_entity?.pdbx_description) || "Protein chain",
      sequence: entity.entity_poly?.pdbx_seq_one_letter_code || "",
      organisms: organisms.map((organism) => ({
        name: organism.ncbi_scientific_name,
        taxonomyId: organism.ncbi_taxonomy_id,
      })),
      chains: (entity.polymer_entity_instances || []).map((instance) => instance.rcsb_id),
      references: refs.map((ref) => ({
        database: ref.database_name,
        accession: ref.database_accession,
      })),
    };
  });

  const ligands = (entry.nonpolymer_entities || []).map((entity) => ({
    id: entity.rcsb_id,
    compId: entity.pdbx_entity_nonpoly?.comp_id,
    name: titleCase(entity.pdbx_entity_nonpoly?.name || entity.rcsb_nonpolymer_entity?.pdbx_description),
  }));

  const descriptions = uniqueValues(polymers.map((polymer) => polymer.description));

  return {
    code: entry.rcsb_id,
    title: titleCase(entry.struct?.title) || "Protein structure from the RCSB Protein Data Bank.",
    name: descriptions.slice(0, 2).join(" / ") || entry.rcsb_id,
    group: entry.rcsb_entry_info?.selected_polymer_entity_types || "Protein",
    method: methods.join(", ") || "Unknown",
    resolution: Number.isFinite(resolution) ? `${resolution.toFixed(2)} Å` : "N/A",
    released: formatFullDate(entry.rcsb_accession_info?.initial_release_date),
    polymerCount: entry.rcsb_entry_info?.polymer_entity_count,
    atomCount: entry.rcsb_entry_info?.deposited_atom_count,
    molecularWeight: entry.rcsb_entry_info?.molecular_weight,
    authors,
    citation: {
      title: citation.title ? titleCase(citation.title) : "",
      journal: citation.journal_abbrev || "",
      volume: citation.journal_volume || "",
      pages:
        citation.page_first && citation.page_last
          ? `${citation.page_first}–${citation.page_last}`
          : citation.page_first || "",
      year: citation.year || "",
      pubmed: citation.pdbx_database_id_PubMed,
      doi: citation.pdbx_database_id_DOI,
    },
    polymers,
    ligands,
  };
}

function externalLink(href, label) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function detailSection(title, content) {
  const section = document.createElement("section");
  section.className = "detail-section";

  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading, content);

  return section;
}

function detailFacts(protein) {
  const facts = document.createElement("dl");
  facts.className = "detail-facts";

  const items = [
    ["Method", protein.method],
    ["Resolution", protein.resolution],
    ["Released", protein.released],
    ["Polymer entities", formatNumber(protein.polymerCount)],
    ["Deposited atoms", formatNumber(protein.atomCount)],
    ["Molecular weight", Number.isFinite(protein.molecularWeight) ? `${protein.molecularWeight.toFixed(1)} kDa` : "N/A"],
    ["Classification", protein.group],
  ];

  items.forEach(([label, value]) => facts.append(metadataItem(label, value)));

  return facts;
}

function sequenceBlock(sequence) {
  const wrapper = document.createElement("div");
  wrapper.className = "sequence-block";

  if (!sequence) {
    wrapper.append(createTextElement("p", "detail-muted", "Sequence not available."));
    return wrapper;
  }

  const pre = document.createElement("pre");
  pre.className = "sequence-text";

  if (sequence.length <= SEQUENCE_PREVIEW) {
    pre.textContent = sequence;
    wrapper.append(pre);
    return wrapper;
  }

  const preview = sequence.slice(0, SEQUENCE_PREVIEW);
  pre.textContent = `${preview}…`;
  wrapper.append(pre);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sequence-toggle";
  toggle.textContent = `Show full sequence (${sequence.length} residues)`;

  toggle.addEventListener("click", () => {
    const expanded = toggle.dataset.expanded === "true";

    if (expanded) {
      pre.textContent = `${preview}…`;
      toggle.textContent = `Show full sequence (${sequence.length} residues)`;
      toggle.dataset.expanded = "false";
      return;
    }

    pre.textContent = sequence;
    toggle.textContent = "Show less";
    toggle.dataset.expanded = "true";
  });

  wrapper.append(toggle);
  return wrapper;
}

function referenceList(references) {
  const list = document.createElement("ul");
  list.className = "detail-list";

  if (!references.length) {
    list.append(createTextElement("li", "detail-muted", "No cross-references available."));
    return list;
  }

  references.forEach((ref) => {
    const item = document.createElement("li");
    const label = `${ref.database}: ${ref.accession}`;

    if (ref.database === "UniProt") {
      item.append(externalLink(`https://www.uniprot.org/uniprotkb/${encodeURIComponent(ref.accession)}`, label));
    } else {
      item.textContent = label;
    }

    list.append(item);
  });

  return list;
}

function ligandList(ligands) {
  const list = document.createElement("ul");
  list.className = "detail-list";

  if (!ligands.length) {
    list.append(createTextElement("li", "detail-muted", "No ligands or small molecules recorded."));
    return list;
  }

  ligands.forEach((ligand) => {
    const item = document.createElement("li");
    const label = ligand.compId ? `${ligand.compId} — ${ligand.name}` : ligand.name;
    item.textContent = label;
    list.append(item);
  });

  return list;
}

function citationBlock(protein) {
  const wrapper = document.createElement("div");
  const { citation, authors } = protein;

  if (authors.length) {
    const authorLine = createTextElement("p", "detail-authors", authors.join(", "));
    wrapper.append(authorLine);
  }

  if (citation.title) {
    wrapper.append(createTextElement("p", "detail-citation-title", citation.title));
  }

  const metaParts = [citation.journal, citation.volume && `Vol. ${citation.volume}`, citation.pages, citation.year]
    .filter(Boolean)
    .join(" · ");

  if (metaParts) {
    wrapper.append(createTextElement("p", "detail-muted", metaParts));
  }

  const links = document.createElement("div");
  links.className = "detail-links";

  if (citation.pubmed) {
    links.append(externalLink(`https://pubmed.ncbi.nlm.nih.gov/${citation.pubmed}/`, `PubMed ${citation.pubmed}`));
  }

  if (citation.doi) {
    links.append(externalLink(`https://doi.org/${citation.doi}`, `DOI ${citation.doi}`));
  }

  if (links.children.length) {
    wrapper.append(links);
  }

  if (!wrapper.children.length) {
    wrapper.append(createTextElement("p", "detail-muted", "Citation information not available."));
  }

  return wrapper;
}

function polymerSection(polymer) {
  const article = document.createElement("article");
  article.className = "polymer-card";

  const header = document.createElement("div");
  header.className = "polymer-card-header";
  header.append(
    createTextElement("h3", "", polymer.description),
    createTextElement("span", "polymer-id", polymer.id),
  );
  article.append(header);

  if (polymer.chains.length) {
    article.append(createTextElement("p", "polymer-chains", `Chains: ${polymer.chains.join(", ")}`));
  }

  if (polymer.organisms.length) {
    const organismLine = polymer.organisms
      .map((organism) => (organism.taxonomyId ? `${organism.name} (${organism.taxonomyId})` : organism.name))
      .join(", ");
    article.append(createTextElement("p", "polymer-organism", organismLine));
  }

  article.append(
    detailSection("Sequence", sequenceBlock(polymer.sequence)),
    detailSection("Cross-references", referenceList(polymer.references)),
  );

  return article;
}

function renderDetailPage(protein) {
  document.title = `${protein.code} — Protein Finder`;

  const page = document.createElement("div");
  page.className = "detail-page";

  const backLink = document.createElement("a");
  backLink.className = "back-link";
  backLink.href = "./index.html";
  backLink.textContent = "← Back to browse";

  const hero = document.createElement("section");
  hero.className = "detail-hero";

  const viewerShell = document.createElement("div");
  viewerShell.className = "detail-viewer";

  const fallback = createTextElement("p", "viewer-fallback", `Loading 3D structure for ${protein.code}`);
  const iframe = document.createElement("iframe");
  iframe.title = `${protein.name} 3D structure`;
  iframe.src = viewerUrl(protein.code);
  iframe.allow = "fullscreen";
  viewerShell.append(fallback, iframe);

  const heroText = document.createElement("div");
  heroText.className = "detail-hero-text";
  heroText.append(
    createTextElement("p", "eyebrow", protein.code),
    createTextElement("h1", "detail-title", protein.name),
    createTextElement("p", "detail-summary", protein.title),
  );

  const actions = document.createElement("div");
  actions.className = "detail-actions";
  actions.append(externalLink(rcsbStructureUrl(protein.code), "View on RCSB.org"));
  heroText.append(actions);

  hero.append(viewerShell, heroText);

  const body = document.createElement("div");
  body.className = "detail-body";
  body.append(
    detailSection("Key facts", detailFacts(protein)),
    detailSection("Citation", citationBlock(protein)),
  );

  if (protein.polymers.length) {
    const polymersWrapper = document.createElement("div");
    polymersWrapper.className = "polymer-grid";
    protein.polymers.forEach((polymer) => polymersWrapper.append(polymerSection(polymer)));
    body.append(detailSection("Protein chains", polymersWrapper));
  }

  body.append(detailSection("Ligands & small molecules", ligandList(protein.ligands)));

  page.append(backLink, hero, body);
  detailContent.replaceChildren(page);
}

function showError(message) {
  detailStatus.hidden = true;
  detailContent.hidden = true;
  detailError.hidden = false;
  detailErrorMessage.textContent = message;
  document.title = "Protein not found — Protein Finder";
}

function showDetail(protein) {
  detailStatus.hidden = true;
  detailError.hidden = true;
  detailContent.hidden = false;
  renderDetailPage(protein);
}

async function initDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code")?.trim().toUpperCase();

  if (!code) {
    showError("No PDB code was provided. Open a protein from the browse page.");
    return;
  }

  try {
    const entry = await fetchProteinDetail(code);

    if (!entry) {
      showError(`PDB entry "${code}" was not found in the RCSB archive.`);
      return;
    }

    showDetail(normalizeDetail(entry));
  } catch (error) {
    showError("Could not load protein data. Please try again in a moment.");
    console.error(error);
  }
}

initDetailPage();
