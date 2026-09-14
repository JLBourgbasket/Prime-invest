const { google } = require("googleapis");

// Par défaut, pointe vers le Google Sheet fourni par François.
// Peut toujours être surchargé via la variable d'environnement Netlify GOOGLE_SPREADSHEET_ID.
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || "1DowTMybAneBwQVkAcqaR3Y_KiguKcMJVKXySRNMzfLI";

const SHEETS_CONFIG = {
  "Prime Back": { key: "back", label: "PRIME BACK", color: "#2563eb", accent: "#1d4ed8" },
  "Prime Fit": { key: "fit", label: "PRIME FIT", color: "#16a34a", accent: "#15803d" },
  "Prime Well": { key: "well", label: "PRIME WELL", color: "#7c3aed", accent: "#6d28d9" },
  "Mobilier": { key: "mobilier", label: "MOBILIER", color: "#d97706", accent: "#b45309" },
  "Matériel Info & AV": { key: "av", label: "INFO & AV", color: "#0891b2", accent: "#0e7490" },
  "Extras AGM Constructions": { key: "agm", label: "AGM CONSTRUCTIONS", color: "#dc2626", accent: "#b91c1c" },
};

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Gère les nombres au format français : "6 000,50" (espace insécable + virgule décimale)
function parseNum(val) {
  if (val === null || val === undefined || val === "") return null;
  const s = String(val)
    .replace(/\s/g, "")
    .replace(/,(?=\d{3})/g, "")
    .replace(/,/g, ".")
    .replace(/\.(?=.*\.)/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseRows(rows) {
  if (!rows || rows.length < 3) return { sections: [], total_ht: 0, total_ttc: 0 };

  let headerIdx = rows.findIndex((r) =>
    r.some((c) => String(c).includes("Désignation produit"))
  );
  if (headerIdx === -1) headerIdx = 2;

  const sections = [];
  let currentSection = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const designation = String(row[0] || "").trim();
    if (!designation) continue;
    if (designation.startsWith("ℹ") || designation.startsWith("⚠") ||
        designation.startsWith("Statuts") || designation.startsWith("🔗") ||
        designation.startsWith("  🔗")) continue;
    if (designation.startsWith("▸")) {
      currentSection = { name: designation.replace(/^[▸\s]+/, "").trim(), items: [] };
      sections.push(currentSection);
      continue;
    }
    if (designation.toLowerCase().includes("sous-total") ||
        designation.toLowerCase().startsWith("total")) continue;

    const item = {
      row_index: i,
      designation,
      qty:            parseNum(row[1]),
      prix_ht:        parseNum(row[2]),
      prix_ttc:       parseNum(row[3]),
      total_ht:       parseNum(row[4]),
      total_ttc:      parseNum(row[5]),
      fournisseur:    String(row[6] || "").trim(),
      statut:         String(row[7] || "En attente").trim() || "En attente",
      date_livraison: String(row[8] || "").trim(),
    };

    if (!currentSection) {
      currentSection = { name: "Général", items: [] };
      sections.push(currentSection);
    }
    currentSection.items.push(item);
  }

  let total_ht = 0, total_ttc = 0;
  sections.forEach((s) => s.items.forEach((item) => {
    total_ht += item.total_ht || 0;
    total_ttc += item.total_ttc || 0;
  }));

  return { sections, total_ht, total_ttc };
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
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
        const parsed = parseRows(response.data.values || []);
        result[config.key] = { ...config, sheet_name: sheetName, ...parsed };
      } catch (e) {
        result[config.key] = { ...config, sheet_name: sheetName, sections: [], total_ht: 0, total_ttc: 0, error: e.message };
      }
    }

    let grand_total_ht = 0, grand_total_ttc = 0;
    Object.values(result).forEach((tab) => {
      grand_total_ht += tab.total_ht || 0;
      grand_total_ttc += tab.total_ttc || 0;
    });

    return { statusCode: 200, headers, body: JSON.stringify({ tabs: result, grand_total_ht, grand_total_ttc }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
