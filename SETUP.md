# PRIME Sport Santé — Guide de déploiement

## Vue d'ensemble

```
prime-tracker/
├── netlify.toml                    ← Config Netlify
├── package.json                    ← Dépendances (googleapis)
├── public/
│   └── index.html                  ← Application frontend
└── netlify/
    └── functions/
        ├── sheets-read.js          ← Lecture Google Sheets
        └── sheets-update.js        ← Écriture Google Sheets
```

---

## ÉTAPE 1 — Préparer Google Sheets

> ℹ️ **Sheet déjà configuré par défaut.** Le code (`sheets-read.js` et `sheets-update.js`) pointe désormais par défaut vers ce Google Sheet :
> `https://docs.google.com/spreadsheets/d/1DowTMybAneBwQVkAcqaR3Y_KiguKcMJVKXySRNMzfLI/edit`
> Tu n'as donc PAS besoin de définir la variable `GOOGLE_SPREADSHEET_ID` dans Netlify pour utiliser ce fichier — mais tu peux toujours la définir pour pointer vers un autre Sheet sans retoucher le code (elle est prioritaire sur la valeur par défaut).

### 1a. Partager le fichier correctement
Ton fichier Google Sheets doit avoir exactement ces noms d'onglets (le fichier ci-dessus les a déjà) :
- `Prime Back`
- `Prime Fit`
- `Prime Well`
- `Mobilier`
- `Matériel Info & AV`
- `Extras AGM Constructions`

Un onglet `Récapitulatif des investissements` supplémentaire est présent dans le fichier : il est ignoré par l'app (aucun conflit), il reste consultable directement dans Sheets.

⚠️ N'oublie pas de partager ce Sheet avec l'email du Service Account (voir étape 2d) — sans ça, l'app ne pourra ni lire ni écrire dedans.

### 1b. Récupérer l'ID du Spreadsheet (si tu utilises un autre fichier plus tard)
Dans l'URL de ton Sheets :
```
https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
```
Copie la partie entre `/d/` et `/edit`.

---

## ÉTAPE 2 — Créer un Service Account Google

### 2a. Aller sur Google Cloud Console
1. Va sur https://console.cloud.google.com
2. Crée un nouveau projet (ex: "prime-tracker") ou utilise un existant
3. Active l'API **Google Sheets** :
   - Menu → API & Services → Bibliothèque
   - Cherche "Google Sheets API" → Activer

### 2b. Créer le Service Account
1. Menu → API & Services → Identifiants
2. Cliquer "+ Créer des identifiants" → Compte de service
3. Nom : `prime-tracker-bot` → Créer et continuer
4. Rôle : **Éditeur** → Continuer → OK

### 2c. Générer la clé JSON
1. Cliquer sur le compte de service créé
2. Onglet "Clés" → Ajouter une clé → Créer une clé
3. Format : **JSON** → Créer
4. Le fichier JSON se télécharge automatiquement — **le garder en sécurité**

### 2d. Partager le Sheets avec le Service Account
1. Dans le fichier JSON téléchargé, copie le champ `client_email`
   (ressemble à : `prime-tracker-bot@ton-projet.iam.gserviceaccount.com`)
2. Dans ton Google Sheets → Partager
3. Colle cet email → Rôle **Éditeur** → Envoyer

---

## ÉTAPE 3 — Déployer sur Netlify

### 3a. Pousser le code sur GitHub
```bash
cd prime-tracker
git init
git add .
git commit -m "Initial PRIME tracker"
git remote add origin [ton-repo-github]
git push -u origin main
```

### 3b. Connecter Netlify
1. Va sur https://app.netlify.com
2. "Add new site" → "Import an existing project" → Connecte GitHub
3. Sélectionne le repo `prime-tracker`
4. Build settings :
   - **Build command** : `npm install` (ou laisser vide)
   - **Publish directory** : `public`
5. Déployer

### 3c. Configurer les variables d'environnement
Dans Netlify → Site settings → Environment variables → Add variable :

**Variable 1 (optionnelle) :**
```
Key:   GOOGLE_SPREADSHEET_ID
Value: [l'ID copié à l'étape 1b]
```
À définir seulement si tu veux utiliser un Sheet différent de celui pré-configuré par défaut dans le code.

**Variable 2 (obligatoire) :**
```
Key:   GOOGLE_SERVICE_ACCOUNT_JSON
Value: [contenu COMPLET du fichier JSON téléchargé, sur une seule ligne]
```

Pour mettre le JSON sur une ligne, dans un terminal :
```bash
cat ton-fichier-service-account.json | tr -d '\n'
```

### 3d. Redéployer
Dans Netlify → Deploys → "Trigger deploy" → Deploy site

---

## ÉTAPE 4 — Tester

1. Ouvre l'URL Netlify de ton site
2. L'app doit charger et afficher les données de ton Sheets
3. Modifie un statut ou un prix → vérifie dans Google Sheets que ça s'est mis à jour

---

## Fonctionnement en équipe

- **Tout le monde accède à la même URL Netlify**
- **Toute modification est immédiatement écrite dans Google Sheets**
- **Le Sheets reste consultable directement** (Alicia, Julien, etc.)
- **L'app se rafraîchit automatiquement toutes les 5 minutes**

---

## Sécurité

- ✅ Les credentials ne sont jamais exposés côté client
- ✅ Les fonctions Netlify font le pont de manière sécurisée
- ✅ Seul Netlify a accès au Service Account
- ⚠️  L'app est accessible sans authentification — à protéger via Netlify Identity si besoin (offre Team/Pro)

---

## Champs éditables dans l'app

| Champ           | Colonne Sheets | Éditable |
|-----------------|----------------|----------|
| Prix HT unitaire| C              | ✅ Clic  |
| Prix TTC unitaire| D             | ✅ Clic  |
| Total HT        | E              | ✅ Clic  |
| Total TTC       | F              | ✅ Clic  |
| Fournisseur     | G              | ✅ Clic  |
| Statut          | H              | ✅ Dropdown |
| Date livraison  | I              | ✅ Clic  |

---

## Support

En cas de problème, vérifier dans Netlify → Functions → Logs les erreurs des fonctions serverless.

## Fiches commande

La fiche est disponible sur chaque ligne dont le total HT est strictement
supérieur à 200 €. Le seuil s’applique à la ligne, quantité comprise.

1. Confirmer que `GOOGLE_SPREADSHEET_ID` pointe vers le classeur de production.
2. Dans Netlify, créer `PRIME_ORDER_ACCESS_CODE` avec un secret long et
   aléatoire. Le conserver côté fonctions et le transmettre aux personnes
   autorisées via un canal privé.
3. Vérifier que la colonne N est réservée aux fiches sur les six onglets.
   Le compte de service doit pouvoir écrire dans cette colonne.
4. Déployer la version et ouvrir une fiche Prime Fit. Tester un
   enregistrement et rouvrir la fiche pour vérifier sa persistance.

Les fiches sont enregistrées en colonne N sur la ligne de l’article. Inclure
cette colonne dans tout tri, et vérifier les fiches avant de renommer les
articles existants. Le code d’accès protège la nouvelle fonction uniquement.
Les fonctions historiques doivent être protégées séparément avant une
diffusion de l’application à l’équipe.

### PDF et commandes groupées

Activez l’API Google Drive dans le projet Google Cloud du compte de service.
Créez le dossier « Bons de commande » dans le Drive partagé Prime Sport Santé.
Donnez au compte de service le droit d’y ajouter des fichiers et configurez
`PRIME_ORDER_PDF_FOLDER_ID` sur Netlify avec l’identifiant du dossier.
Les utilisateurs doivent disposer de leurs propres droits Drive pour lire
et télécharger les PDF. Le fichier est importé au moment d’enregistrer la
fiche. Taille maximale : 3 Mio. En cas de remplacement, le PDF précédent
reste dans Drive.

Réservez la colonne O des six onglets aux commandes groupées. Cochez au
moins deux lignes d’un même onglet, puis cliquez sur « Grouper la sélection ».
Les fiches enregistrées se retrouvent dans « Commandes groupées ».
« Fiche globale AGM » couvre l’onglet entier. Les fiches individuelles
restent en colonne N et conservent leurs données et liens existants.
