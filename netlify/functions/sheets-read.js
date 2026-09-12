const { google } = require("googleapis");

// Par défaut, pointe vers le Google Sheet fourni par François.
// Peut toujours être surchargé via la variable d'environnement Netlify GOOGLE_SPREADSHEET_ID.
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || "1DowTMybAneBwQVkAcqaR3Y_KiguKcMJVKXySRNMzfLI";

const SHEETS_CONFIG = {
  "Prime Back": {
    key: "back",
    label: "PRIME BACK",
    color: "#1a3a5c",
    accent: "#2d6a9f",
  },
  "Prime Fit": {
    key: "fit",
    label: "PRIME FIT",
    color: "#1a4a2e",
    accent: "#2d8a50",
  },
  "Prime Well": {
    key: "well",
    label: "PRIME WELL",
    color: "#3a1a4a",
    accent: "#7a3a9a",
  },
  Mobilier: {
    key: "mobilier",
    label: "MOBILIER",
    color: "#3a2a1a",
    accent: "#8a5a2a",
  },
  "Matériel Info & AV": {
    key: "av",
    label: "INFO & AV",
    color: "#1a3a3a",
    accent: "#2a7a7a",
  },
  "Extras AGM Constructions": {
    key: "agm",
    label: "AGM CONSTRUCTIONS",
    color: "#3a1a1a",
    accent: "#8a2a2a",
  },
};

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function parseRows(rows, sheetName) {
  if (!rows || rows.length < 3) return { sections: [], total_ht: 0, total_ttc: 0 };

  // Find header row (contains "Désignation produit")
  let headerIdx = rows.findIndex((r) =>
    r.some((c) => String(c).includes("Désignation produit"))
  );
  if (headerIdx === -1) headerIdx = 2;

  const items = [];
  const sections = [];
  let currentSection = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const designation = String(row[0] || "").trim();
    if (!designation) continue;

    // Skip info/note lines
    if (designation.startsWith("ℹ") || designation.startsWith("⚠") || designation.startsWith("Statuts")) continue;

    // Section header (starts with ▸)
    if (designation.startsWith("▸") || designation.startsWith("▸")) {
      currentSection = {
        name: designation.replace(/^[▸\s]+/, "").trim(),
        items: [],
      };
      sections.push(currentSection);
      continue;
    }

    // Subtotal row — skip
    if (designation.toLowerCase().includes("sous-total") || designation.toLowerCase().includes("total")) continue;

    // Link lines — skip
    if (designation.startsWith("🔗") || designation.startsWith("  🔗")) continue;

    const qty = parseFloat(row[1]) || null;
    const prix_ht = parseFloat(row[2]) || null;
    const prix_ttc = parseFloat(row[3]) || null;
    const total_ht = parseFloat(row[4]) || null;
    const total_ttc = parseFloat(row[5]) || null;
    const fournisseur = String(row[6] || "").trim();
    const statut = String(row[7] || "En attente").trim() || "En attente";
    const date_livraison = String(row[8] || "").trim();

    const item = {
      row_index: i,
      designation,
      qty,
      prix_ht,
      prix_ttc,
      total_ht,
      total_ttc,
      fournisseur,
      statut,
      date_livraison,
    };

    if (currentSection) {
      currentSection.items.push(item);
    } else {
      if (!sections.length) {
        currentSection = { name: "Général", items: [] };
        sections.push(currentSection);
      }
      sections[0].items.push(item);
    }
  }

  // Compute totals from items
  let total_ht = 0;
  let total_ttc = 0;
  sections.forEach((s) => {
    s.items.forEach((item) => {
      total_ht += item.total_ht || 0;
      total_ttc += item.total_ttc || 0;
    });
  });

  return { sections, total_ht, total_ttc };
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const result = {};

    for (const [sheetName, config] of Object.entries(SHEETS_CONFIG)) {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${sheetName}'!A1:I200`,
        });

        const parsed = parseRows(response.data.values || [], sheetName);
        result[config.key] = {
          ...config,
          sheet_name: sheetName,
          ...parsed,
        };
      } catch (e) {
        // Sheet might not exist or be empty
        result[config.key] = {
          ...config,
          sheet_name: sheetName,
          sections: [],
          total_ht: 0,
          total_ttc: 0,
          error: e.message,
        };
      }
    }

    // Global totals
    let grand_total_ht = 0;
    let grand_total_ttc = 0;
    Object.values(result).forEach((tab) => {
      grand_total_ht += tab.total_ht || 0;
      grand_total_ttc += tab.total_ttc || 0;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tabs: result, grand_total_ht, grand_total_ttc }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
