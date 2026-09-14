const { google } = require("googleapis");

// Par défaut, pointe vers le Google Sheet fourni par François.
// Peut toujours être surchargé via la variable d'environnement Netlify GOOGLE_SPREADSHEET_ID.
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || "1DowTMybAneBwQVkAcqaR3Y_KiguKcMJVKXySRNMzfLI";

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Column mapping: 0-indexed → A, B, C...
const COL_MAP = {
  designation: 0, // A
  qty: 1,         // B
  prix_ht: 2,     // C
  prix_ttc: 3,    // D
  total_ht: 4,    // E
  total_ttc: 5,   // F
  fournisseur: 6, // G
  statut: 7,      // H
  date_livraison: 8, // I
};

function colLetter(idx) {
  return String.fromCharCode(65 + idx);
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { sheet_name, row_index, field, value } = JSON.parse(event.body);

    if (!sheet_name || row_index === undefined || !field) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing parameters" }) };
    }

    const colIdx = COL_MAP[field];
    if (colIdx === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown field: ${field}` }) };
    }

    const col = colLetter(colIdx);
    // row_index is 0-based from parsing, +1 for 1-based Google Sheets
    const range = `'${sheet_name}'!${col}${row_index + 1}`;

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, range, value }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
