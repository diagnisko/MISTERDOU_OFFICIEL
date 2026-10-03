# 05 — Sécurité (security-by-design, privacy-by-design)

Périmètre de cette note : authentification, sessions, protections web, rate limiting,
brute force, 2FA admin, chiffrement des données sensibles, stockage privé à ticket signé,
audit, gestion des secrets, environnement. Les paiements ont leur propre note (docs/06).

---

## 1. Authentification

### 1.1 Mots de passe
- Hashing **scrypt** (`node:crypto`, zéro dépendance native) — paramètres stockés dans chaque
  hash (format auto-descriptif `$scrypt$N=..,r=..,p=..$n=<sel>$h=<hash>`), défaut N=16384/r=8/p=1/
  sel 16 octets/clé 64 o. TODO jusque ici argon2id (`@node-rs/argon2`) était visé : la lib native
  est instable sur Node ≥25 (`verify` → `Decoding failed`), d'où ce KDF natif, équivalent
  mémoire-hard, sans dépendance à un binding. Aucun mot de passe n'est jamais loggé.
- Comptes créés par Google : `passwordHash = NULL`, connexion uniquement via OAuth
  (vérification du state + échange de code, `google_sub` unique) — jamais via mot de passe.

### 1.2 Sessions
- Stockées en base (`Session`), token = **`sid` aléatoire 256 bits** généré côté serveur.
  Seul le hash (`sha256`) du sid est persisté (fuite DB ≠ vol de session).
- Cookie web : `sid`, attributs `HttpOnly; Secure; SameSite=Lax` (+ `__Host-` prefix en
  production), chemin `/`.
- **CSRF** : `SameSite=Lax` + double-submit cookie/header `csrf` pour les mutations
  (défense en profondeur ; vérifié sur toutes les routes non idempotentes et non publiques).
- Mobiles (futur) : le même `sid` est présenté en `Authorization: Bearer <sid>` motivé
  (aucune refactorisation nécessaire grâce à la même table `Session`). Pas de stockage local du
  sid côté web : cookie only.
- Durées : session client 30 jours (glissant, `lastActiveAt`) ; **session admin 2 h**
  (`isAdminSession`), renouvellement discret après ré-authentification. Révocation immédiate
  possible (uniquement la sienne pour le client ; l'admin révoque toute session, §25).

### 1.3 OTP téléphone
- Code 6 chiffres, exposition courte (5 min), **3 tentatives**, hash scrypt dans
  `PhoneVerification.otpCodeHash`, compteur anti-envoi (1/SMS ; max 5 requêtes/heure/numéro).
- En dev, le code est loggé via pino en mode `NODE_ENV=development` uniquement ; en production
  un fournisseur SMS (placeholder intégré dans `packages/shared`, fournisseur en env).

### 1.4 2FA admin
- `twoFactorEnabled` sur le compte admin. À la connexion admin : premier cookie temporaire
  (5 min, `kind=COOKIE`, scope TOTP_ONLY) puis validation TOTP (secret encodé en base)
  → élève la session en `isAdminSession`. Provisionnement par QR code (otpauth://) au bootstrap.
- Échecs TOTP consignés et limités (cf. brute force).

---

## 2. Protections applicatives

| Menace | Contrôle |
|---|---|
| **CSRF** | SameSite=Lax + token double-submit vérifié sur les mutations |
| **XSS** | React échappe par défaut ; CSP stricte (`default-src 'self'`), pas d'inline sauf hash nonces ; `helmet` ; désinfection des contenus admin (rich text limité) |
| **SQLi** | ORM Prisma / requêtes paramétrées uniquement — jamais de SQL brut (sauf requêtes contrôlées type FOR UPDATE) |
| **Injection méta** | zod valide chaque entrée ; longueurs, formats, enums |
| **Mass assignment** | `select`/`include` explicites, DTOs en sortie, on exclut `passwordHash`, `otpCodeHash`, `tokenHash`, credentials |
| **SSRF** | Aucune URL utilisateur fetchée par le serveur |
| **Headers** | `@fastify/helmet` : HSTS, X-Frame-Options DENY, nosniff, referrer-policy, permissions-policy |
| **Clickjacking** | X-Frame-Options + CSP `frame-ancestors 'none'` |
| **Enumeration** | erreurs non discriminantes (login : « identifiants invalides »), délai uniforme, pas d'ID séquentiels publics (uuid), rate-limit 404 |

---

## 3. Rate limiting & brute force

- `@fastify/rate-limit` par IP (derrière proxy : `X-Forwarded-For` approuvé par type forwarder
  configuré en env ; jamais trust-bypass).
- Cibles renforcées :
  - `/auth/login`, `/auth/otp/*` : 5 req/min/IP + verrouillage temporaire du compte
    (`loginAttempts`, verrou 15 min) après 5 échecs.
  - `/auth/register` : 3 req/min/IP + anti-bot (Turnstile/honeypot en phase prod).
  - `/v1/admin/*` : 10 req/min/IP + alerte si 20 échecs TOTP sur 15 min.
- Paiements : aucun webhook externe ; seule l'équipe valide un paiement Wave (permission `PAYMENTS`, journalisé).

---

## 4. Chiffrement des données sensibles

Catalogue des données « extra sensibles » (§23) et protections :

| Donnée | Au repos | En transit | Accessible à |
|---|---|---|---|
| Pièces d'identité / passeports / selfies | fichier chiffré AES-256-GCM dans stockage privé | HTTPS | STAFF/ADMIN via ticket + audit |
| e-mail/mot de passe eFootball | **AES-256-GCM par champ** (clé fichier aléatoire) | HTTPS | acheteur après paiement ; ADMIN |
| `passwordHash` (site) | scrypt | — | jamais lisible |
| `otpCodeHash` | scrypt | — | jamais lisible |
| `tokenHash` (session) | sha256 | — | jamais lisible |
| Infos de retrait (IBAN etc.) | AES-256-GCM | HTTPS | vendeur (lui-même) + admin (traitement) |
| Données personnelles profil | clair dans DB privée | HTTPS | l'utilisateur ; admin |

Schéma de chiffrement AES-256-GCM : clé maîtresse `STORAGE_MASTER_KEY` (hex 64) → HKDF-SHA256
dérive une clé par domaine (`storage.documents`, `storage.credentials`) ; chaque fichier/champ
reçoit un IV 96 bits aléatoire + tag AEAD ; stockage de `v1:<iv>:<cipher>:<tag>`. Rotation :
prévue via paramètre de version (`encryptedBy`).

---

## 5. Stockage privé + accès par ticket signé

- Emplacement dev : `data/private-storage/` (PROTÉGÉ par gitignore, hors `public/`).
- Interface `StorageDriver` (`store/get/delete/openTicket`) → impl. locale chiffrée ; prod : R2/S3
  chiffré côté serveur (KMS), un échange de driver sans toucher la logique métier.
- **Accès** :
  1. Requête authentifiée (STAFF/ADMIN ou le propriétaire après paiement),
  2. permission vérifiée côté serveur ⇒ `AuditLog` `SENSITIVE_DATA_ACCESS`,
  3. ticket HMAC (`{objectKey, actorId, exp, purpose}` signé avec clé dédiée) généré,
  4. GET `/api/v1/private-docs/:ticket` : vérif signature + expiration + permission,
     puis flux du fichier décrypté (jamais d'URL pré-existante, jamais de `readonly` public).
- Provient entre autres : interdiction d'enum, pas de liste, pas de téléchargement brut
  sans ticket, ticket non renouvelable après usage (anti-replay, fenêtre 60 s).

---

## 6. Audit & journalisation

- `AuditLog` enregistre toute action sensible avec `{actor, role, ip, session, before/after JSONB, severity}`.
- Événements obligatoires (§24) : login/logout, modif profil, changement rôle, création/
  suppression produit, changement prix, changement statut, validation KYC, paiement,
  remboursement, retrait, consultation de données sensibles, modif admin des settings.
- **Alertes** : severity `CRITICAL` (échecs admin répétés, changement de Settings paiement,
  accès credentials anormal, tentative d'élévation de droits) → notification ADMIN immédiat.
- Logs applicatifs pino : JSON structuré, **redaction automatique** des champs sensibles
  (`password`, `token`, `otp`, `credential`, `iban`), rotation + sauvegarde.

## 7. Secrets & environnement

- Aucun secret dans le code. `.env.example` documentés ; `.env`/`.env.local` gitignorés.
- Variables : `DATABASE_URL`, `COOKIE_SECRET` (min. 32 octets), `STORAGE_MASTER_KEY`,
  `GOOGLE_OAUTH_CLIENT_ID/SECRET`,
  `ADMIN_BOOTSTRAP_EMAIL/PHONE/PASSWORD`, `TOTP_SECRET_*`, `SMTP_URL`, `PUBLIC_URL`, `NODE_ENV`.
- En prod : secrets injectés par le pipeline (pas de fichier) ; rotation périodique ;
  séparation stricte dev/prod.

## 8. Sauvegardes, monitoring, isolation dev/prod

- Sauvegardes Postgres journalières + PITR ; test de restauration périodique.
- Monitoring : métriques (pino/sentry libre), alertes webhook sur erreurs 5xx.
- Dev : données factices ; providers SMS/dev
  loggués ; le cookie `Secure` désactivé sur http localhost uniquement.