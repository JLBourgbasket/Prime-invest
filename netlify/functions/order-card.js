const { timingSafeEqual, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { google } = require('googleapis');

const tabs = new Set([
  'Prime Back', 'Prime Fit', 'Prime Well', 'Mobilier', 'Matériel Info & AV',
  'Extras AGM Constructions',
]);
const fields = [
  'reference', 'document', 'supplier', 'contactRole', 'contact', 'email', 'phone', 'owner',
  'delivery', 'installation', 'training', 'notes',
];
const steps = ['ordered', 'delivered', 'installed', 'trained'];
const reply = (statusCode, data) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Méthode non autorisée.' });
  const secret = process.env.PRIME_ORDER_ACCESS_CODE || '';
  if (!secret || !process.env.GOOGLE_SPREADSHEET_ID) {
    return reply(503, { error: 'Fiches commande à configurer sur Netlify.' });
  }
  const supplied = Buffer.from(event.headers.authorization || '');
  const expected = Buffer.from('Bearer ' + secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return reply(401, { error: 'Code d’accès incorrect.' });
  }

  let uploaded = false;
  try {
    const { sheet, row, designation, card, previous, groupId, members, allAgm, listGroups, pdf } = JSON.parse(event.body);
    const grouped = Boolean(groupId || members || allAgm || listGroups);
    if (!tabs.has(sheet) || (!grouped && (!Number.isInteger(row) || row < 4 || row > 200 ||
        typeof designation !== 'string'))) {
      return reply(400, { error: 'Ligne invalide.' });
    }
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });
    const values = google.sheets({ version: 'v4', auth }).spreadsheets.values;
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    let range = `'${sheet}'!N${row}`;
    let stored = '';
    let current = {};
    let append = false;
    if (grouped) {
      const registry = `'${sheet}'!O:O`;
      const result = await values.get({ spreadsheetId, range: registry });
      const records = (result.data.values || []).flatMap(([raw], index) => {
        if (!raw) return [];
        try {
          const entry = JSON.parse(raw);
          return entry.kind === 'prime-order-group' ? [{ entry, raw, index }] : [];
        } catch { return []; }
      });
      if (listGroups) {
        return reply(200, { groups: records.map(({ entry }) => ({
          id: entry.id, members: entry.members, allAgm: entry.allAgm,
          reference: entry.card.reference,
        })) });
      }
      const existing = groupId ? records.find(({ entry }) => entry.id === groupId) :
        allAgm ? records.find(({ entry }) => entry.allAgm) : undefined;
      if (groupId && !existing) return reply(404, { error: 'Commande groupée introuvable.' });
      if (existing) {
        current = existing.entry;
        stored = existing.raw;
        range = `'${sheet}'!O${existing.index + 1}`;
      } else {
        if (allAgm ? sheet !== 'Extras AGM Constructions' :
            !Array.isArray(members) || members.length < 2 || members.length > 197) {
          return reply(400, { error: 'Sélectionnez au moins deux lignes du même onglet.' });
        }
        if (!allAgm) {
          const data = await values.get({ spreadsheetId, range: `'${sheet}'!A1:A200` });
          const seen = new Set();
          for (const member of members) {
            if (!member || !Number.isInteger(member.row) || member.row < 4 || member.row > 200 ||
                seen.has(member.row) || typeof member.designation !== 'string' ||
                String(data.data.values?.[member.row - 1]?.[0] || '').trim() !== member.designation ||
                !member.designation || /^(▸|⚠|ℹ|🔗|statuts|sous-total|total)/i.test(member.designation)) {
              return reply(409, { error: 'La sélection a changé. Actualisez le tableau.' });
            }
            if (records.some(({ entry }) => entry.allAgm || entry.members?.some(existingMember =>
              existingMember.row === member.row && existingMember.designation === member.designation
            ))) {
              return reply(409, { error: 'Une ligne appartient déjà à une commande groupée. Actualisez le tableau.' });
            }
            seen.add(member.row);
          }
        }
        append = true;
        range = registry;
        current = { kind: 'prime-order-group', id: randomUUID(),
          allAgm: allAgm === true, members: allAgm ? [] : members.map(({ row, designation }) => ({ row, designation })) };
      }
    } else {
      const result = await values.get({
        spreadsheetId, range: `'${sheet}'!A${row}:N${row}`, valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const cells = result.data.values?.[0] || [];
      if (String(cells[0] || '').trim() !== designation || (!cells[13] && (typeof cells[4] !== 'number' || cells[4] <= 200))) {
        return reply(409, { error: 'Cette ligne a changé. Actualisez le tableau.' });
      }
      stored = cells[13] || '';
      if (stored) {
        try { current = JSON.parse(stored); } catch { /* Reserved column contains other data. */ }
        if (current?.kind !== 'prime-order-card' || current.designation !== designation) {
          return reply(409, { error: 'La colonne N contient une fiche ou une donnée à vérifier.' });
        }
      }
    }
    if (card === undefined) return reply(200, { card: current.card || {}, version: stored, groupId: append ? undefined : current.id, group: current.id ? { allAgm: current.allAgm, members: current.members } : undefined });
    if (stored !== previous) return reply(409, { error: 'La fiche a été modifiée. Rouvrez-la pour la recharger.' });
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      return reply(400, { error: 'Fiche invalide.' });
    }
    const clean = {};
    for (const field of fields) {
      if (['supplier', 'contactRole'].includes(field) && card[field] === undefined) {
        clean[field] = current.card?.[field] || '';
        continue;
      }
      if (typeof card[field] !== 'string' || card[field].length > (field === 'notes' ? 3000 : 500)) {
        return reply(400, { error: 'Un champ est invalide ou trop long.' });
      }
      clean[field] = card[field].trim();
    }
    if (clean.document) {
      let url;
      try { url = new URL(clean.document); } catch { /* Invalid URL. */ }
      if (!url || url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname)) {
        return reply(400, { error: 'Indiquez un lien Google Drive valide.' });
      }
    }
    for (const step of steps) clean[step] = card[step] === true;
    if (current.card?.pdfId) {
      clean.pdfId = current.card.pdfId;
      clean.pdfName = current.card.pdfName;
    }
    if (pdf !== undefined) {
      const folder = process.env.PRIME_ORDER_PDF_FOLDER_ID;
      if (!folder) return reply(503, { error: 'Dossier PDF à configurer sur Netlify.' });
      if (typeof pdf?.data !== 'string' || pdf.data.length > 4194304 ||
          typeof pdf.name !== 'string' || !/\.pdf$/i.test(pdf.name) || pdf.name.length > 200) {
        return reply(400, { error: 'Sélectionnez un PDF de 3 Mio maximum.' });
      }
      const bytes = Buffer.from(pdf.data, 'base64');
      if (bytes.subarray(0, 5).toString() !== '%PDF-') {
        return reply(400, { error: 'Le fichier sélectionné est invalide.' });
      }
      const drive = google.drive({ version: 'v3', auth });
      const result = await drive.files.create({
        supportsAllDrives: true, fields: 'id',
        requestBody: { name: pdf.name, mimeType: 'application/pdf', parents: [folder] },
        media: { mimeType: 'application/pdf', body: Readable.from([bytes]) },
      });
      uploaded = true;
      clean.pdfId = result.data.id;
      clean.pdfName = pdf.name;
    }
    const record = grouped ? { ...current, card: clean } :
      { kind: 'prime-order-card', designation, card: clean };
    const version = JSON.stringify(record);
    const payload = {
      spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: [[version]] },
    };
    if (append) {
      const saved = await values.append({ ...payload, insertDataOption: 'OVERWRITE' });
      const written = saved.data.updates?.updatedRange;
      if (!written || !/!O[1-9]\d*(?::O[1-9]\d*)?$/.test(written)) {
        throw new Error('Écriture hors de la colonne O.');
      }
      const check = await values.get({ spreadsheetId, range: written });
      if (check.data.values?.[0]?.[0] !== version) {
        throw new Error('Commande groupée introuvable après écriture.');
      }
    } else {
      await values.update(payload);
    }
    return reply(200, { card: clean, version, groupId: record.id });
  } catch {
    return reply(500, { error: uploaded ? 'Le PDF est dans Drive, mais l’enregistrement de la fiche n’a pas pu être confirmé. Vérifiez la liste avant de réessayer.' : 'Enregistrement indisponible. Vérifiez les droits Sheets et Drive, puis réessayez.' });
  }
};
