# 01 — Analyse du cahier des charges

> **Mise à jour du 2026-10-02** : PayTech et Orange Money ont été retirés. Les paiements se font uniquement par lien Wave Business, vérifiés par l'équipe (voir docs/06). Les passages ci-dessous qui citent l'ancien prestataire décrivent l'historique du projet.

Projet : plateforme eFootball de vente de comptes
Date : 2026-09-23
Référentiel : `lis ce prompt et utilise max de ta capaciter.txt` (1893 lignes)

Ce document inventorie les exigences du cahier des charges, puis liste les incohérences,
risques métier et décisions à trancher avec l'administrateur avant/ pendant le développement.

---

## 1. Inventaire des exigences

### 1.1 Acteurs et rôles (chap. 3, 21)

| Exigence | Source | Statut |
|---|---|---|
| 3 types : CLIENT, VENDEUR, ADMINISTRATEUR | §3, §21 | clair |
| Un vendeur reste un client (peut aussi acheter) | §5 | clair |
| Existence d'un STAFF / MODÉRATEUR (accès limité) | §21 | clair |
| RBAC complet, permissions côté serveur uniquement | §21, §65 | clair |
| Interdiction : client ne contacte jamais vendeur | §43, §65 | clair |
| Interdiction : vendeur ne voit pas les données d'un autre vendeur | §21, §65 | clair |

### 1.2 Comptes et identité

| Exigence | Source | Statut |
|---|---|---|
| Inscription classique **ou** Google | §3.1 | clair |
| Compte limité tant que non vérifié | §3.1, §4 | clair |
| Téléphone + indicatif pays obligatoires à l'inscription | §48 | clair |
| Vérification du téléphone par OTP/SMS avant fonctionnalités sensibles | §48 | clair |
| Statuts téléphone : non vérifié / vérification en cours / vérifié | §48 | clair |
| Téléphone jamais public | §48 | clair |
| Localisation après consentement explicite (pas de GPS permanent) | §49, §63 | clair |
| Conversion coordonnées → adresse approximative | §49 | clair |
| Profil : nom, prénom, DOB éventuel, pays, ville, adresse éventuelle | §50 | clair |
| Ne collecter que les données réellement nécessaires | §50, §63 | clair |

### 1.3 KYC — vérification d'identité (§4, §50, §51, §52, §55, §57)

| Exigence | Source | Statut |
|---|---|---|
| Documents : recto + verso pièce OU passeport + selfie | §4 | clair |
| Statuts : NON_VERIFIE / EN_ATTENTE / EN_COURS / VERIFIE / REFUSE | §4 | clair |
| Client non vérifié = achat impossible | §4, §36 | clair |
| Admin : consulter, accepter, refuser, demander nouvelle soumission, historique | §4, §52 | clair |
| Dossier de vérification permanent (consultable ensuite) | §51 | clair |
| Historique des vérifications conservé (y compris refus) | §52 | clair |
| Changement d'infos importantes ⇒ nouvelle vérification requise, ancien dossier conservé | §57 | clair |
| Documents jamais publics, accès via ticket temporaire signé | §55, §65 | clair |
| Chaque consultation sensible journalistée (AuditLog) | §23, §56 | clair |

### 1.4 Vendeurs (§5, §17, §18)

| Exigence | Source | Statut |
|---|---|---|
| Client vérifié → paie 1 000 FCFA (non mensuel) → devenir vendeur | §5, §36 R3 | clair |
| Montant frais **configurable** par l'admin | §5, §35 | clair |
| Vendeur publie, gère, suit ventes/revenus | §5 | clair |
| Solde en attente vs solde disponible (libération contrôlée par l'admin) | §17 | clair (règle de libération à préciser, cf. risque R2) |
| Retrait : vérifier infos complètes du vendeur avant | §17 | clair (liste des infos à définir, cf. risque R2) |
| Dashboard vendeur (nb produits, ventes, revenus, commissions, soldes, promos, historique) | §18 | clair |

### 1.5 Produits (§6, §10, §11)

| Exigence | Source | Statut |
|---|---|---|
| Produits vendeurs : paiement **unique** uniquement | §6, §36 R4 | clair |
| Produits admin : paiement en plusieurs fois possible (apport + mensualités) | §8, §36 R5 | clair |
| Champs produit : titre, description, prix, niveau/power, pièces, division, infos complémentaires, captures, e-mail + mot de passe eFootball | §6 | clair |
| Credentials eFootball : jamais publics, chiffrés, accès strict | §6, §41 bis | clair (cf. risque R8) |
| Carte catalogue : nom, power, pièces, division, prix, vendeur ou "Administrateur", badges promo / mis en avant | §10 | clair |
| Page produit : mode de paiement, disponibilité, infos importantes ; pour admin : apport, nb mensualités, montant mensualité, total | §11 | clair |

### 1.6 Promotions et mise en avant (§12, §13, §35)

| Exigence | Source | Statut |
|---|---|---|
| Admin : créer/modifier promos (prix, réduction, dates début/fin), mise en avant | §12 | clair |
| Affichage prix normal + prix promo | §12 | clair |
| Vendeur achète la mise en avant (200 FCFA/jour, configurable) | §13, §35 | clair |
| Désactivation auto à expiration | §13 | clair |
| Admin contrôle les produits mis en avant | §13 | clair |

### 1.7 Paiements (§14, §15, §33)

| Exigence | Source | Statut |
|---|---|---|
| Tous paiements via PayTech | §14, §36 R9 | clair |
| Moyens de paiement PayTech compatibles marché ciblé | §14 | clair |
| Confirmations côté serveur ; jamais croire la redirection frontend | §14, §33, §65 | clair |
| Rôles : transaction interne → demande PayTech → webhook → vérif signature/montant/référence → maj transaction → maj commande → actions | §33 | clair |
| Statuts paiement : pending, processing, success, failed, cancelled, refunded | §14 | clair |
| PayTech : identifiant unique, user, order, montant, type, fournisseur, statut, date, référence, historique | §14 | clair |
| Jamais créditer un vendeur sur déclaration frontend | §33, §65 | clair |

### 1.8 Commandes et livraison (§15, §7, §9)

| Exigence | Source | Statut |
|---|---|---|
| Paiement confirmé → commande "Payée" → récupère infos privées → livraison sécurisée | §15 | clair |
| Commission admin : 15 % du montant (ex. 20 000 → 3 000 ; vendeur 17 000) | §7 | clair, mais cf. R1 |
| Calcul auto : prix de vente, commission, montant vendeur, frais, net ; historique financier | §7 | clair |
| Échéancier client visible (payé, restant, prochaines, en retard, dates, statuts) | §9 | clair |
| Arrondis gérés pour que total payé = prix exact | §8 | clair — algorithme documenté (cf. R4) |

### 1.9 Messagerie (§41–§44, §62)

| Exigence | Source | Statut |
|---|---|---|
| Client ↔ Admin (conversation), Admin ↔ Vendeur | §41, §42 | clair |
| Client ne contacte JAMAIS le vendeur | §43 | clair |
| UI type messagerie : liste, dernier message, non-lus, lu/non-lu, date/heure | §44 | clair |
| Modèles Conversation / Message | §62 | clair |

### 1.10 Notifications (§30, §45–§47, §58–§61)

| Exigence | Source | Statut |
|---|---|---|
| Centre de notifications (type, titre, contenu, date, lu/non-lu, actionUrl) | §47 | clair |
| Notifications in-app + e-mail "lorsque nécessaire" | §30 | clair |
| Push : architecture prête (mobile futur) ; préférences par canal ; certaines critiques obligatoires | §45, §46, §61 | clair |
| Notifications admin / vendeur / client listées | §58–§60 | clair |

### 1.11 Sécurité (§22, §23, §24, §25)

| Exigence | Source | Statut |
|---|---|---|
| Hash mots de passe, sessions HttpOnly/Secure/SameSite, CSRF, XSS, SQLi (ORM), validation, rate limiting, brute force, headers, chiffrement sensibles, stockage docs privé, audit, secrets via env, séparation dev/prod, backups, monitoring, alertes | §22 | clair |
| Données très sensibles listées (pièces, selfies, passwords eFootball, e-mails comptes, paiement, perso) | §23 | clair |
| AuditLog : connexion, profil, rôle, produit, prix, statut, KYC, paiement, remboursement, retrait, consultation sensible, modif admin | §24 | clair |
| Panel admin : 2FA/MFA, sessions courtes, confirmation pour actions critiques, journalisation, limitation tentatives, révocation sessions | §25 | clair |

### 1.12 Base de données (§31, §62)

Liste de modèles demandée : User, Role, Seller, IdentityVerification, PhoneVerification,
Location, Product, ProductImage, ProductCredential, Order, OrderItem, Payment,
InstallmentPlan, Installment, Commission, SellerBalance, Withdrawal, Promotion,
FeaturedProduct, SupportTicket, Notification, AuditLog, Session.
(Modèles supplémentaires demandés en §62 : Conversation, Message, VerificationHistory.)

### 1.13 Performance et catalogue (§26–§29)

| Exigence | Source | Statut |
|---|---|---|
| Mobile-first, rapide, responsive, design premium | §26 | clair |
| Animations légères : PERFORMANCE > ANIMATION | §27 | clair |
| Recherche + filtres (prix, power, division, pièces, vendeur, comptant, plusieurs fois, promo, mis en avant) + recherche nom | §29 | clair |
| Pagination/chargement optimisé, index adaptés, ne jamais tout charger | §28 | clair |

### 1.14 API / Template (§32, §34)

| Exigence | Source | Statut |
|---|---|---|
| API sécurisée, versionnée, routes listées (auth, verification, products, orders, payments, installments, support, seller/featured…) | §32 | clair |
| Backend indépendant du frontend, réutilisable iOS/Android | §34 | clair |

### 1.15 Administration des paramètres (§35)

Valeurs configurables : commission %, frais inscription vendeur, prix mise en avant/jour,
nb max mensualités, durée max, règles de paiement, paramètres promotions, sécurité.
→ Modèle `Settings` (clé/valeur typée) + seed au démarrage.

### 1.16 Tests, phases, objectifs (§38–§40)

- 14 phases (maquette → déploiement).
- Liste de tests obligatoires incluant attaques (SQLi, XSS, brute force, rate limit), accès sensibles, concurrence multi-utilisateurs.

---

## 2. Incohérences et risques identifiés

### R1 — Base de calcul de la commission (15 %)
- **Cas d'ambiguïté** : le §7 donne « 20 000 × 15 % = 3 000 ». Mais « Le reste revient au vendeur, sous réserve des éventuels frais de paiement ». Est-ce que la commission se calcule sur le **prix brut** (20 000) ou sur le **prix net des frais PayTech** ? Et qui porte les frais PayTech (plateforme ou vendeur) ?
- **Choix implémenté par défaut** : commission = 15 % **du prix TTC brut** ; les frais PayTech sont supportés par la plateforme (déduits de la marge admin, mais pas du montant vendeur). Configurable dans Settings (`commission_percent`, `payment_fees_bearer = PLATFORM|SELLER`).
- **À trancher** : si `payment_fees_bearer = SELLER`, l'algorithme devient : net_vendeur = brut − commission − frais_paytech.

### R2 — Libération du solde vendeur
- **Cas d'ambiguïté** : « L'administrateur doit pouvoir contrôler le moment où les fonds deviennent disponibles conformément aux règles de la plateforme » — aucune règle (délai, condition) n'est fournie.
- **Choix implémenté** : paramètres `seller_payout_hold_days` (défaut 3 jours) et libération automatique par job, avec possibilité de libération manuelle admin. À valider avec le PO.

### R3 — « Informations nécessaires » avant retrait
- **Cas d'ambiguïté** : §17 « vérifier que toutes les informations nécessaires du vendeur sont correctement renseignées » — non spécifié.
- **Choix implémenté** : vérification KYC ok + profil complet (nom, prénom, pays, ville) + identité vérifiée + pas de litige support ouvert. Liste extensible via Settings.

### R4 — Arrondis des mensualités
- **Cas d'ambiguïté** : l'exemple 60 000/6 = 10 000 tombe juste. Mais 100 000 / 3 = 33 333,33… La somme des arrondis doit égaler le total exact.
- **Algorithme (retenu, documenté dans docs/06)** : ajouter le reste distribué sur les premières échéances (ou l'ordre de préférence défini en Settings `installment_rounding = FIRST|LAST|BALANCED`), toutes les valeurs en entiers (FCFA/pays sans minor).

### R5 — Livraison des identifiants pour les produits admin échelonnés
- **Cas d'ambiguïté** : pour un produit admin payé en plusieurs fois, le §15 dit « paiement confirmé → commande Payée → livraison ». Faut-il livrer après l'apport initial (le reste encore dû) ?
- **Risque de fraude** : livrer avant paiement total = client peut cesser de payer après avoir reçu les identifiants.
- **Choix implémenté** : paramètre `admin_delivery_after = INITIAL_PAYMENT|FULL_PAYMENT` (défaut : après apport initial payé — cohérent avec un achat échelonné classique), le suivi d'échéances restant exécutoire. **Décision métier requise** — signalé.

### R6 — Que se passe-t-il si le client cesse de payer ses échéances ?
- **Cas d'ambiguïté** : pas de sanction/grec/valeur de pénalité décrite.
- **Choix implémenté** : statuts `OVERDUE` (défaut quotidien) + notifications programmées ; suspension de nouveaux achats possible (Settings `block_new_orders_when_overdue`). Graves : à valider juridiquement (le recouvrement est hors périmètre).

### R7 — Nombre max de mensualités « 8 » vs « configurable »
- **Cas d'ambiguïté** : §8 « Maximum 8 mois » et §35 « nombre maximum de mensualités » modifiable.
- **Choix implémenté** : `max_installments` (8 par défaut, **plafond câblé côté serveur** : l'admin ne peut pas mettre plus de 8 — la valeur du cahier des charges est une constante de sécurité, les settings ne peuvent pas la dépasser). Ce plafond est une constante environnentale/config `INSTALLMENT_HARD_CAP=8`.

### R8 — Partage des credentials eFootball pendant l'échéancier admin
- **Cas d'ambiguïté** : si deux clients achètent le même compte admin en plusieurs fois, ou si le produit est vendu alors que l'échéancier du précédent client roule, conflit d'accès.
- **Choix implémenté** : un produit admin vendu passe en `SOLD` et n'est plus achetable (même en échelon). La rotation de mot de passe multi-clients n'est pas prévue au cahier des charges → **hors périmètre, signalé**.

### R9 — Produit vendu pendant une mise en avant payée
- **Cas d'ambiguïté** : remboursement des jours non consommés ?
- **Choix implémenté** : pas de remboursement (service consommé), la mise en avant expirera naturellement. Paramètre `featured_refund_on_sale=false`. Admin peut tout de même émettre un remboursement manuel (workflow refund).

### R10 — Frais de mise en avant : depuis le solde vendeur ou PayTech ?
- **Cas d'ambiguïté** : §13 « le vendeur paie le montant ». Via PayTech ou débit du solde ?
- **Choix implémenté** : deux modes offerts à terme (`featured_payment_method = BALANCE|PAYTECH`), défaut BALANCE (si solde suffisant) car sans friction, sinon PayTech. Le paiement reste une `Payment` tracée dans les deux cas.

### R11 — Unicité téléphone / multi-comptes
- **Cas d'ambiguïté** : un même numéro peut-il créer plusieurs comptes ?
- **Choix implémenté** : téléphone normalisé (E.164) **unique** pour les comptes avec téléphone vérifié ; un numéro déjà vérifié ne peut être rattaché qu'à 1 compte. Le client peut changer de numéro (re-OTP).

### R12 — Fiabilité des réponses Google OAuth
- Risque : l'email Google ne garantit pas l'identité réelle (NI) ; un compte Google ne remplace jamais le KYC.
- **Choix implémenté** : Google OAuth ne fournit que les coordonnées ; le compte reste `NON_VERIFIE` tant que KYC + téléphone OTP ne sont pas validés. Le téléphone reste obligatoire.

### R13 — Trust du webhook PayTech
- Risque classique : webhook non signé / rejoué / montant non vérifié.
- **Choix implémenté** : signature HMAC-SHA256 (secret), vérification montant + référence + idempotence (stamp `paymentIdempotencyKey`), fenêtre temporelle, GET de statut côté serveur en renfort. Voir docs/06. Les clés PayTech réelles restent en env.

### R14 — Email de notification
- **Cas d'ambiguïté** : §30 « par e-mail lorsque nécessaire » — aucune liste précise.
- **Choix implémenté** : canal e-mail pour événements critiques (paiement, KYC, échéances, support) ; le catalogue de notifications est dans `notification_preferences` + `event_to_channel` dans Settings.

### R15 — Conservation des données (RGPD / droits locaux)
- §63 exige une « politique de conservation définie ». Aucune durée n'est fournie.
- **Choix implémenté** : champs `retention_days_*` dans Settings + job de purge/archivage conforme ; à valider avec un juriste du pays d'exploitation (Sénégal OU CEMAC, marché PayTech mobile money). **Signalé.**

### R16 — Pagination et concurrence sur les paiements
- §39 exige de tester la concurrence. Plusieurs webhooks simultanés → idempotence + transactions atomiques (locks `SELECT ... FOR UPDATE` / upserts) : chaque changement d'état passe par un état atomique unique (paiement ne peut passer `pending→success` qu'une fois). Voir docs/06.

### R17 — « Vérifié » doit-il être vérifié au moment du paiement ou de la commande ?
- **Cas d'ambiguïté** : un client vérifié passe commande, mais sa vérification est révoquée avant paiement.
- **Choix implémenté** : la règle s'applique au **passage de commande ET au paiement** (le service de paiement re-vérifie l'état KYC courant du payeur). Interdit côté serveur.

---

## 3. Tableau de décision pour l'administrateur

| # | Décision | Défaut implémenté | Priorité |
|---|---|---|---|
| R1 | Base commission / porteur des frais PayTech | 15 % du brut ; frais à la plateforme | Haute |
| R2 | Délai de libération du solde vendeur | 3 jours (config.) | Haute |
| R3 | Infos requises avant retrait | KYC + profil complet + pas de litige | Moyenne |
| R5 | Livraison admin échelonné | après apport initial | Haute |
| R6 | Sanction échéances impayées | signal + blocage nouveaux achats (config.) | Haute |
| R7 | Plafond mensualités | 8 (hard cap) | Haute |
| R15 | Durées de conservation / purge | jours configurables | Moyenne |
| R10 | Mode de paiement mise en avant | Balance d'abord, PayTech en secours | Moyenne |

---

## 4. Ce qui a été « stabilisé » sans ambiguïté

- Toute valeur métier affichée (prix, commission, soldes, mensualités, frais) est **calculée côté serveur** et jamais codée en dur côté UI.
- Les permissions sont contrôlées exclusivement côté serveur.
- Les credentials eFootball, pièces d'identité, selfies, passeports ne sont jamais publics.
- Les paiements ne sont confirmés que par webhook/serveur, jamais par redirection frontend.
- Une API indépendante sert web + mobiles futurs.